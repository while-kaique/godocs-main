/**
 * Orquestração do TIME AUTÔNOMO DE AVALIAÇÃO de projetos NORMAIS (fatia B) — server-side.
 *
 * Amarra os especialistas do time e o juiz:
 *   • RAG por corpus de APROVADOS (aprende do veredito HUMANO): embeddings (`embeddings.ts`) +
 *     `selecionarVizinhos` (`especial-corpus.ts`) sobre a tabela `projeto_embedding`;
 *   • Plausibilidade/FTE (`avaliarPlausibilidadeFTE`, fatia A);
 *   • Financeiro (`avaliarFinanceiro`);
 *   • Agregador/juiz (`agregarVotos`) → grava a recomendação em `projeto_avaliacao`.
 *
 * ⚠️ **MODO SOMBRA, env-gated DEFAULT OFF** (`AVALIACAO_NORMAIS`): com a flag desligada, TUDO
 * aqui é NO-OP — não gera embedding, não chama a OpenAI, não grava nada (não muda o comportamento
 * de prod). Ligada, calcula e GRAVA a recomendação + confiança, mas **NUNCA muda o status/veredito
 * do projeto** — a decisão segue sendo a de `decidirStatusSubmissao`. Plugar no status é fase
 * posterior, depois de o Luis validar a sombra.
 *
 * ⚠️ Tabelas SEPARADAS das `especial_*` (não atropela a peça do Kaique). NO-OP para especiais.
 * ⚠️ Embeddings SEMPRE direto na OpenAI (o proxy não expõe `/embeddings`) — `embeddings.ts` cuida.
 * ⚠️ Envs lidas LAZY. Nunca lança no caminho de background.
 */
import {
  getProjetoById,
  getDocumentacao,
  getProjetoContextoData,
  getDocumentacaoConteudo,
  getEmbeddingProjeto,
  getEmbeddingsProjetos,
  upsertEmbeddingProjeto,
  getIdsAvaliacoesNormais,
  upsertAvaliacaoNormal,
  parseJson,
  type ProjetoEmbeddingRow,
} from '@/integrations/db/client.server';
import { lerResumosEspelho } from '@/lib/sheet-espelho';
import { mapResumo, type ProjetoDashboardResumo } from '@/lib/dashboard-resumo';
import { ehLideranca } from '@/lib/areas/teamguide.server';
import type { DocumentacaoGerada } from '@/lib/agents/types';
import {
  gerarEmbeddingsLote,
  base64ParaVetor,
  vetorParaBase64,
  embeddingConfig,
} from '@/lib/embeddings';
import {
  textoParaEmbedding,
  hashTexto,
  selecionarVizinhos,
  type EntradaSemantica,
  type ExemplarEspecial,
} from '@/lib/especial-corpus';
import { avaliarPlausibilidadeFTE, fatorFtePlausibilidade } from '@/lib/agents/analyzer';
import { avaliarFinanceiro } from '@/lib/agents/avaliacao-financeira';
import {
  agregarVotos,
  avaliarSinalRag,
  type VeredictoAgregado,
} from '@/lib/agents/agregador-avaliacao';
import {
  avaliacaoNormaisAtiva,
  selecionarAprovadosNormais,
  montarCorpusNormais,
} from '@/lib/avaliacao-corpus';

/** Carimbo de origem gravado em cada recomendação (distingue do que possa vir depois). */
export const ORIGEM_AGREGADOR = 'agregador-normais';

/** A flag `AVALIACAO_NORMAIS` está ligada? Lida LAZY (nunca em escopo de módulo). Default OFF. */
export function avaliacaoNormaisLigada(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return avaliacaoNormaisAtiva(env?.AVALIACAO_NORMAIS);
}

// ─── Texto semântico do projeto (mesma forma do classificador de especiais) ────
// ⚠️ Espelha os helpers PRIVADOS de `especial-classificador.functions.ts` de propósito: fundi-los
// obrigaria a tocar a peça do Kaique (o plano manda NÃO atropelar). São ~2 helpers curtos.

function oQueFazDoc(conteudoJson: string | null | undefined): string | null {
  if (!conteudoJson) return null;
  const doc = parseJson<DocumentacaoGerada>(conteudoJson);
  const t = doc?.o_que_faz?.trim();
  return t || null;
}

function resumoDocParaTexto(conteudoJson: string | null | undefined): string | null {
  if (!conteudoJson) return null;
  const doc = parseJson<DocumentacaoGerada>(conteudoJson);
  if (!doc) return null;
  const partes: string[] = [];
  if (doc.o_que_faz) partes.push(doc.o_que_faz);
  if (doc.execucao) partes.push(doc.execucao);
  if (Array.isArray(doc.fluxo) && doc.fluxo.length) {
    partes.push(doc.fluxo.map((f) => `${f.etapa}: ${f.descricao}`).join('\n'));
  }
  if (Array.isArray(doc.atencao) && doc.atencao.length) {
    partes.push(doc.atencao.map((a) => `${a.titulo}: ${a.descricao}`).join('\n'));
  }
  const txt = partes.join('\n').trim();
  return txt || null;
}

async function montarEntradaSemanticaNormal(
  projetoId: string,
  resumo?: ProjetoDashboardResumo,
): Promise<EntradaSemantica | null> {
  const ctx = await getProjetoContextoData(projetoId);
  const docRow = await getDocumentacaoConteudo(projetoId);
  if (!ctx && !resumo) return null;
  return {
    nome: ctx?.nome ?? resumo?.nome ?? null,
    o_que_faz: oQueFazDoc(docRow?.conteudo),
    area: ctx?.area_nome ?? ctx?.area ?? resumo?.area ?? null,
    descricao: ctx?.descricao_breve ?? null,
    memorial: ctx?.memorial_calculo ?? null,
    doc: resumoDocParaTexto(docRow?.conteudo),
  };
}

// ─── Embeddings (mesma disciplina do classificador: gera só o que mudou) ────────

type MapaEmbedding = Map<
  string,
  { vetor: number[]; modelo: string; dim: number; hash: string | null }
>;

function decodificarEmbeddings(rows: ProjetoEmbeddingRow[]): MapaEmbedding {
  const mapa: MapaEmbedding = new Map();
  for (const r of rows) {
    try {
      mapa.set(r.projeto_id, {
        vetor: base64ParaVetor(r.vetor),
        modelo: r.modelo,
        dim: r.dim,
        hash: r.texto_hash,
      });
    } catch {
      // vetor corrompido: ignora (o backfill regrava)
    }
  }
  return mapa;
}

/**
 * Garante embedding FRESCO (hash do texto bate + mesmo modelo) para os `ids`. Gera em lote só o
 * que falta ou mudou, grava em `projeto_embedding` e devolve o mapa atualizado. Bounded por
 * `capGeracao` (custo + tempo do cron). Nunca lança.
 */
async function garantirEmbeddings(
  ids: string[],
  resumoPorId: Map<string, ProjetoDashboardResumo>,
  embeddings: MapaEmbedding,
  opts: { capGeracao?: number } = {},
): Promise<{ mapa: MapaEmbedding; gerados: number }> {
  const cap = opts.capGeracao ?? 40;
  const modeloAlvo = embeddingConfig()?.modelo;
  const pendentes: { id: string; texto: string; hash: string }[] = [];

  for (const id of ids) {
    if (pendentes.length >= cap) break;
    const entrada = await montarEntradaSemanticaNormal(id, resumoPorId.get(id));
    if (!entrada) continue;
    const texto = textoParaEmbedding(entrada);
    if (!texto) continue;
    const hash = hashTexto(texto);
    const atual = embeddings.get(id);
    const frescoTexto = atual != null && atual.hash === hash;
    const frescoModelo = atual != null && (!modeloAlvo || atual.modelo === modeloAlvo);
    if (frescoTexto && frescoModelo) continue;
    pendentes.push({ id, texto, hash });
  }

  let gerados = 0;
  const CHUNK = 64;
  for (let i = 0; i < pendentes.length; i += CHUNK) {
    const lote = pendentes.slice(i, i + CHUNK);
    const vetores = await gerarEmbeddingsLote(lote.map((p) => p.texto));
    for (let j = 0; j < lote.length; j++) {
      const emb = vetores[j];
      const p = lote[j];
      if (!emb) continue;
      await upsertEmbeddingProjeto({
        projeto_id: p.id,
        modelo: emb.modelo,
        dim: emb.dim,
        vetor: vetorParaBase64(emb.vetor),
        texto_hash: p.hash,
      });
      embeddings.set(p.id, { vetor: emb.vetor, modelo: emb.modelo, dim: emb.dim, hash: p.hash });
      gerados++;
    }
  }
  return { mapa: embeddings, gerados };
}

function embMapDe(mapa: MapaEmbedding): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const [id, e] of mapa) m.set(id, e.vetor);
  return m;
}

// ─── Avaliação de UM projeto (dado o contexto já carregado) ────────────────────

export type ResultadoAvaliacaoNormal = {
  ok: boolean;
  projeto_id: string;
  motivo?: string;
  veredito?: VeredictoAgregado;
  confianca?: number;
  aplicar?: boolean;
  divergencia?: boolean;
  vizinhos?: number;
  gravado?: boolean;
};

type ContextoAvaliacao = {
  dry: boolean;
  resumoPorId: Map<string, ProjetoDashboardResumo>;
  /** Corpus de aprovados JÁ montado — construído UMA vez pelo chamador (não por candidato). */
  corpus: ExemplarEspecial[];
  embeddings: MapaEmbedding;
};

/** Núcleo: avalia com o corpus/embeddings JÁ carregados (evita reler a cada candidato no backfill). */
async function avaliarComContexto(
  projetoId: string,
  ctx: ContextoAvaliacao,
): Promise<ResultadoAvaliacaoNormal> {
  const projeto = await getProjetoById(projetoId);
  if (!projeto) return { ok: false, projeto_id: projetoId, motivo: 'projeto não encontrado' };
  if (projeto.especial === 1) {
    return { ok: true, projeto_id: projetoId, motivo: 'especial — NO-OP', gravado: false };
  }

  // Fluxo direto de liderança → isento (fail-to-false: TeamGuide fora → segue a régua normal).
  let ehLider = false;
  try {
    ehLider = await ehLideranca(projeto.responsavel_email ?? '');
  } catch {
    ehLider = false;
  }

  const docRow = await getDocumentacao(projetoId);
  const conteudo = (parseJson<Record<string, unknown>>(docRow?.conteudo ?? '{}') ?? {}) as Record<
    string,
    unknown
  >;
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  // ── Voto FTE (Plausibilidade) ──
  const membros = parseJson<string[]>((projeto.membros as string | null) ?? null) ?? [];
  const linhas =
    (saving?.linhas as Array<{ economia_horas_mes?: number | null }> | undefined) ?? [];
  const horas =
    typeof saving?.economia_horas_mes === 'number'
      ? (saving.economia_horas_mes as number)
      : linhas.reduce((s, l) => s + (Number(l?.economia_horas_mes) || 0), 0);
  const fte = avaliarPlausibilidadeFTE({
    horasTotais: horas,
    pessoasDeclaradas: membros.length + 1, // + o autor (não entra em `membros`)
    temMultiplo: saving?.teto_pessoa === 'multiplo',
    especial: projeto.especial === 1,
    fluxoDireto: ehLider,
    fator: fatorFtePlausibilidade(),
  });

  // ── Voto Financeiro ──
  const economiaReaisMes =
    typeof saving?.economia_reais_mes === 'number' ? (saving.economia_reais_mes as number) : null;
  const custoEvitado =
    typeof saving?.custo_evitado_reais === 'number' ? (saving.custo_evitado_reais as number) : null;
  const valorReceita =
    typeof receita?.valor_ganho_mensal === 'number'
      ? (receita.valor_ganho_mensal as number)
      : null;
  const materialidade = (economiaReaisMes ?? 0) + (valorReceita ?? 0);
  const financeiro = avaliarFinanceiro({
    temSaving: !!saving,
    temReceita: !!receita,
    economiaReaisMes,
    economiaHorasMes: horas,
    custoEvitadoReais: custoEvitado,
    valorReceitaMensal: valorReceita,
    materialidade,
  });

  // ── Voto RAG (vizinhos aprovados) — corpus JÁ montado no contexto (fora do laço) ──
  const alvo = ctx.embeddings.get(projetoId);
  const vizinhos = alvo
    ? selecionarVizinhos(alvo.vetor, ctx.corpus, { excluirId: projetoId })
    : [];
  const rag = avaliarSinalRag(vizinhos);

  // ── Juiz ──
  const resultado = agregarVotos({
    fte,
    financeiro,
    rag,
    especial: projeto.especial === 1,
    fluxoDireto: ehLider,
  });

  let gravado = false;
  if (!ctx.dry) {
    await upsertAvaliacaoNormal({
      projeto_id: projetoId,
      veredito: resultado.veredito,
      confianca: resultado.confianca,
      aplicar: resultado.aplicarEmValidacao,
      divergencia: resultado.divergencia,
      motivo: resultado.motivos.join(' '),
      votos: JSON.stringify({
        fte,
        financeiro: { veredito: financeiro.veredito, confianca: financeiro.confianca },
        rag: {
          apoio: rag.apoio,
          confianca: rag.confianca,
          vizinhos: rag.vizinhos,
          topSimilaridade: Number(rag.topSimilaridade.toFixed(3)),
        },
      }),
      origem: ORIGEM_AGREGADOR,
      modelo: embeddingConfig()?.modelo ?? 'deterministico',
    });
    gravado = true;
  }

  return {
    ok: true,
    projeto_id: projetoId,
    veredito: resultado.veredito,
    confianca: resultado.confianca,
    aplicar: resultado.aplicarEmValidacao,
    divergencia: resultado.divergencia,
    vizinhos: vizinhos.length,
    gravado,
  };
}

// ─── Um projeto (rota manual / disparo) ────────────────────────────────────────

/**
 * Avalia UM projeto normal. Carrega o espelho + os embeddings, garante o embedding do alvo e
 * roda os especialistas + juiz. `dry` não grava. Respeita a flag (OFF → NO-OP).
 */
export async function avaliarProjetoNormal(
  projetoId: string,
  opts: { dry?: boolean } = {},
): Promise<ResultadoAvaliacaoNormal> {
  if (!avaliacaoNormaisLigada()) {
    return { ok: false, projeto_id: projetoId, motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)' };
  }

  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const resumoPorId = new Map(resumos.map((p) => [p.id, p]));

  // Corpus + alvo numa leitura só da tabela de embeddings; garante o alvo fresco (cap 1).
  const embAlvo = await getEmbeddingProjeto(projetoId);
  const embeddings = decodificarEmbeddings(await getEmbeddingsProjetos());
  if (embAlvo && !embeddings.has(projetoId)) {
    for (const [id, e] of decodificarEmbeddings([embAlvo])) embeddings.set(id, e);
  }
  const ger = await garantirEmbeddings([projetoId], resumoPorId, embeddings, { capGeracao: 1 });

  const corpus = montarCorpusNormais(selecionarAprovadosNormais(resumos), embMapDe(ger.mapa));
  return avaliarComContexto(projetoId, {
    dry: opts.dry ?? false,
    resumoPorId,
    corpus,
    embeddings: ger.mapa,
  });
}

// ─── Disparo pós-submissão (worker — 3ª promise do processarPosSubmissao) ───────

/**
 * Chamado no worker logo após a submissão, EM PARALELO com a análise e a classificação de
 * especiais. NO-OP se a flag está OFF ou se o projeto é especial. Nunca lança.
 */
export async function avaliarProjetoNormalEmBackground(projetoId: string): Promise<void> {
  if (!avaliacaoNormaisLigada()) return; // gate OFF → NO-OP total (não toca OpenAI nem banco)
  try {
    const p = await getProjetoById(projetoId);
    if (!p || p.especial === 1) return; // NO-OP para especiais
    await avaliarProjetoNormal(projetoId, { dry: false });
  } catch (e) {
    console.error('[avaliacao-normais] falha em background:', e);
  }
}

// ─── Backfill / cron irmão (idempotente, bounded) ──────────────────────────────

export type ResultadoBackfillNormais = {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  candidatos: number;
  embeddings_gerados: number;
  avaliados: number;
  resultados: ResultadoAvaliacaoNormal[];
  motivo?: string;
};

/**
 * Rede do disparo pós-submissão: avalia os normais SEM recomendação e (idempotente) mantém os
 * embeddings do corpus de aprovados em dia. Bounded por `limite` (converge em várias corridas).
 * `dry` é o DEFAULT (gravar exige {dry:false}). Respeita a flag (OFF → NO-OP).
 */
export async function avaliarProjetosNormaisPendentes(
  opts: { dry?: boolean; limite?: number } = {},
): Promise<ResultadoBackfillNormais> {
  if (!avaliacaoNormaisLigada()) {
    return {
      ok: true,
      ligado: false,
      dry: true,
      candidatos: 0,
      embeddings_gerados: 0,
      avaliados: 0,
      resultados: [],
      motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)',
    };
  }
  const dry = opts.dry ?? true;
  const limite = opts.limite ?? 15;

  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const resumoPorId = new Map(resumos.map((p) => [p.id, p]));
  const aprovados = selecionarAprovadosNormais(resumos);

  const jaAvaliados = new Set(await getIdsAvaliacoesNormais());
  // Candidatos = normais NÃO especiais, já submetidos (têm status na planilha) e sem avaliação.
  const candidatos = resumos
    .filter((p) => !p.especial && p.statusChave != null && !jaAvaliados.has(p.id))
    .slice(0, limite);

  if (candidatos.length === 0) {
    return {
      ok: true,
      ligado: true,
      dry,
      candidatos: 0,
      embeddings_gerados: 0,
      avaliados: 0,
      resultados: [],
      motivo: 'nenhum projeto normal pendente de avaliação',
    };
  }

  // Garante embeddings do corpus (aprovados) + dos candidatos, bounded.
  let embeddings = decodificarEmbeddings(await getEmbeddingsProjetos());
  const idsEmbeddar = Array.from(new Set([...candidatos.map((c) => c.id), ...aprovados.map((a) => a.id)]));
  const ger = await garantirEmbeddings(idsEmbeddar, resumoPorId, embeddings, { capGeracao: 60 });
  embeddings = ger.mapa;
  // Corpus montado UMA vez (fora do laço de candidatos) — o corpus não depende do candidato.
  const corpus = montarCorpusNormais(aprovados, embMapDe(embeddings));

  const ctx: ContextoAvaliacao = { dry, resumoPorId, corpus, embeddings };
  const resultados: ResultadoAvaliacaoNormal[] = [];
  let avaliados = 0;
  for (const cand of candidatos) {
    try {
      const r = await avaliarComContexto(cand.id, ctx);
      resultados.push(r);
      if (r.ok && r.gravado) avaliados++;
    } catch (e) {
      resultados.push({
        ok: false,
        projeto_id: cand.id,
        motivo: e instanceof Error ? e.message : 'erro',
      });
    }
  }

  return {
    ok: true,
    ligado: true,
    dry,
    candidatos: candidatos.length,
    embeddings_gerados: ger.gerados,
    avaliados,
    resultados,
  };
}
