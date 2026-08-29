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
  upsertDeliberacao,
  getDeliberacoesAbertas,
  parseJson,
  type ProjetoEmbeddingRow,
  type ProjetoRow,
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
import { avaliarPlausibilidadeFTE, fatorFtePlausibilidade, HORAS_BASE_FTE } from '@/lib/agents/analyzer';
import {
  avaliarFinanceiro,
  TETO_MATERIALIDADE_FINANCEIRO,
} from '@/lib/agents/avaliacao-financeira';
import {
  redigirJustificativa,
  redatorJustificativaLigado,
} from '@/lib/agents/redator-justificativa.functions';
import type { FatosJustificativa } from '@/lib/agents/redator-justificativa';
import {
  agregarVotos,
  avaliarSinalRag,
  type VeredictoAgregado,
} from '@/lib/agents/agregador-avaliacao';
import { avaliarCetico } from '@/lib/agents/cetico-avaliacao';
import { conciliarComCetico, avancarDeliberacao } from '@/lib/deliberacao';
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

/** Votos crus dos especialistas + juiz + cético (SEM I/O de escrita). Reusado pelo painel, pela
 *  deliberação e pelo retroativo — computar uma vez, gravar onde cada caminho precisa. */
export type VotosPainel = {
  fte: ReturnType<typeof avaliarPlausibilidadeFTE>;
  financeiro: ReturnType<typeof avaliarFinanceiro>;
  rag: ReturnType<typeof avaliarSinalRag>;
  cetico: ReturnType<typeof avaliarCetico>;
  agregado: ReturnType<typeof agregarVotos>;
  conciliado: ReturnType<typeof conciliarComCetico>;
  vizinhos: number;
  ehLider: boolean;
};

/**
 * Materialidade da MESA (sombra): ganho total mensal = saving líquido + receita ÷ 10.
 * Espelha `ganhoTotalMensal` (`chat.functions.ts`): o saving entra CHEIO (`economia_reais_mes`
 * já é líquido — inclui custo evitado e abate custo externo) e a receita bruta
 * (`valor_ganho_mensal`) aplica o ÷10 (fator de equivalência). É a magnitude que o Financeiro
 * pondera contra o teto — ⚠️ SÓ na mesa/sombra: NÃO é o gate REAL do analyzer
 * (`analyzer.ts` / `calcularMaterialidade`), que segue com a receita crua (Decisão 3).
 */
export function materialidadeMesa(
  economiaReaisMes: number | null,
  valorReceita: number | null,
): number {
  return (economiaReaisMes ?? 0) + (valorReceita ?? 0) / 10;
}

/**
 * Roda a MESA completa sobre um projeto JÁ carregado (não especial): FTE + Financeiro + RAG →
 * Agregador → Cético → conciliação. PURO de efeito colateral (só LÊ doc/TeamGuide); NÃO grava.
 */
async function computarVotos(projeto: ProjetoRow, ctx: ContextoAvaliacao): Promise<VotosPainel> {
  const projetoId = projeto.id;

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
  const materialidade = materialidadeMesa(economiaReaisMes, valorReceita);
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
  const vizinhosArr = alvo
    ? selecionarVizinhos(alvo.vetor, ctx.corpus, { excluirId: projetoId })
    : [];
  const rag = avaliarSinalRag(vizinhosArr);

  // ── Juiz preliminar ──
  const agregado = agregarVotos({
    fte,
    financeiro,
    rag,
    especial: projeto.especial === 1,
    fluxoDireto: ehLider,
  });

  // ── Cético (adversarial) + conciliação — a rede anti-bajulação da fatia C ──
  const cetico = avaliarCetico({
    agregadoVeredito: agregado.veredito,
    fte: { implausivel: fte.implausivel, fte: fte.fte, pessoas: fte.pessoas },
    financeiro: { veredito: financeiro.veredito, confianca: financeiro.confianca },
    rag: {
      apoio: rag.apoio,
      confianca: rag.confianca,
      vizinhos: rag.vizinhos,
      topSimilaridade: rag.topSimilaridade,
    },
    fator: fatorFtePlausibilidade(),
  });
  const conciliado = conciliarComCetico(agregado, cetico);

  return { fte, financeiro, rag, cetico, agregado, conciliado, vizinhos: vizinhosArr.length, ehLider };
}

/** Serializa os votos para a coluna de auditoria `votos` (sem R$ cru — só veredito/confiança). */
function serializarVotos(v: VotosPainel): string {
  return JSON.stringify({
    fte: v.fte,
    financeiro: { veredito: v.financeiro.veredito, confianca: v.financeiro.confianca },
    rag: {
      apoio: v.rag.apoio,
      confianca: v.rag.confianca,
      vizinhos: v.rag.vizinhos,
      topSimilaridade: Number(v.rag.topSimilaridade.toFixed(3)),
    },
    cetico: { refuta: v.cetico.refuta, confianca: v.cetico.confianca, sinais: v.cetico.sinais },
    grau: v.conciliado.grau,
    ceticoRefutou: v.conciliado.ceticoRefutou,
  });
}

/**
 * Traduz os votos da mesa em FATOS DETERMINÍSTICOS para o REDATOR (Frente 2). Só passa números que
 * a mesa realmente computou; os motivos concretos (com R$) vão nos `apontamentos` — o redator é
 * proibido de inventar qualquer outro valor. Sem materialidade crua aqui (ela vive no motivo do
 * financeiro), então não a repassamos como número solto.
 */
function montarFatosJustificativa(v: VotosPainel): FatosJustificativa {
  const apontamentos: FatosJustificativa['apontamentos'] = [];
  if (v.fte.implausivel && v.fte.motivo) {
    apontamentos.push({ especialista: 'Plausibilidade (FTE)', motivo: v.fte.motivo });
  }
  if (v.financeiro.veredito !== 'ok' && v.financeiro.motivo) {
    apontamentos.push({ especialista: 'Financeiro', motivo: v.financeiro.motivo });
  }
  if (!v.rag.apoio && v.rag.motivo) {
    apontamentos.push({ especialista: 'Semelhança com aprovados', motivo: v.rag.motivo });
  }
  if (v.cetico.refuta && v.cetico.motivo) {
    apontamentos.push({ especialista: 'Revisor cético', motivo: v.cetico.motivo });
  }
  if (apontamentos.length === 0 && v.conciliado.divergencia) {
    apontamentos.push({ especialista: 'Mesa', motivo: 'Sinais divergentes entre os especialistas.' });
  }
  return {
    fte: v.fte.fte > 0 ? v.fte.fte : null,
    horasTotais: v.fte.fte > 0 ? Math.round(v.fte.fte * HORAS_BASE_FTE) : null,
    pessoasDeclaradas: v.fte.pessoas,
    tetoMaterialidade: v.financeiro.veredito !== 'ok' ? TETO_MATERIALIDADE_FINANCEIRO : null,
    apontamentos,
  };
}

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

  const votos = await computarVotos(projeto, ctx);
  const { conciliado, cetico } = votos;

  // Motivo determinístico de sempre (comportamento padrão). Só quando a Frente 2 (redator) está
  // LIGADA e a mesa manda para conferência humana, humaniza a mensagem com o LLM leve — fail-safe
  // interno cai neste mesmo motivo. DEFAULT OFF = byte-idêntico ao de hoje.
  let motivoFinal = conciliado.motivos.join(' ');
  if (conciliado.aplicarEmValidacao && redatorJustificativaLigado()) {
    motivoFinal = await redigirJustificativa(montarFatosJustificativa(votos));
  }

  let gravado = false;
  if (!ctx.dry) {
    const modelo = embeddingConfig()?.modelo ?? 'deterministico';
    await upsertAvaliacaoNormal({
      projeto_id: projetoId,
      veredito: conciliado.veredito,
      confianca: conciliado.confianca,
      aplicar: conciliado.aplicarEmValidacao,
      divergencia: conciliado.divergencia,
      motivo: motivoFinal,
      votos: serializarVotos(votos),
      origem: ORIGEM_AGREGADOR,
      modelo,
    });

    // Abre a DELIBERAÇÃO a partir dos votos deste turno (rodada 1). Consenso encerra na hora;
    // divergência/confiança baixa/refuta do cético deixa `deliberando` para o cron avançar.
    const delib = avancarDeliberacao(
      { estado: null, rodada: 0 },
      {
        agregadoVeredito: conciliado.veredito,
        divergencia: conciliado.divergencia,
        confianca: conciliado.confianca,
        ceticoRefuta: cetico.refuta,
      },
    );
    await upsertDeliberacao({
      projeto_id: projetoId,
      estado: delib.estado,
      rodada: delib.rodada,
      veredito: delib.veredito,
      confianca: delib.confianca,
      grau: delib.grau,
      encerrada: delib.encerrada,
      motivo: delib.motivo,
      // Rodada 1 ABRE a deliberação: substitui (sem append). Cada entrada carrega a confiança da rodada.
      historico: JSON.stringify([
        { rodada: delib.rodada, estado: delib.estado, confianca: delib.confianca, motivo: delib.motivo },
      ]),
      origem: ORIGEM_AGREGADOR,
    });
    gravado = true;
  }

  return {
    ok: true,
    projeto_id: projetoId,
    veredito: conciliado.veredito,
    confianca: conciliado.confianca,
    aplicar: conciliado.aplicarEmValidacao,
    divergencia: conciliado.divergencia,
    vizinhos: votos.vizinhos,
    motivo: motivoFinal,
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

// ─── Loader de contexto compartilhado (espelho + embeddings + corpus) ──────────

type ContextoCarregado = {
  ctx: ContextoAvaliacao;
  resumos: ProjetoDashboardResumo[];
  aprovados: ReturnType<typeof selecionarAprovadosNormais>;
  gerados: number;
};

/**
 * Lê o espelho, garante os embeddings do corpus (aprovados) + dos `idsAlvo`, e monta o contexto
 * da mesa UMA vez. Reusado pelo backfill, pela deliberação e pelo retroativo (não reler a cada
 * candidato). Bounded por `capGeracao`.
 */
export async function carregarContextoPainel(
  idsAlvo: string[],
  opts: { dry: boolean; capGeracao?: number },
): Promise<ContextoCarregado> {
  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const resumoPorId = new Map(resumos.map((p) => [p.id, p]));
  const aprovados = selecionarAprovadosNormais(resumos);

  let embeddings = decodificarEmbeddings(await getEmbeddingsProjetos());
  const idsEmbeddar = Array.from(new Set([...idsAlvo, ...aprovados.map((a) => a.id)]));
  const ger = await garantirEmbeddings(idsEmbeddar, resumoPorId, embeddings, {
    capGeracao: opts.capGeracao ?? 60,
  });
  embeddings = ger.mapa;
  const corpus = montarCorpusNormais(aprovados, embMapDe(embeddings));

  return {
    ctx: { dry: opts.dry, resumoPorId, corpus, embeddings },
    resumos,
    aprovados,
    gerados: ger.gerados,
  };
}

/**
 * Roda a mesa sobre UM projeto (já carregado ou por id) com o contexto dado, SEM gravar. Usado
 * pelo retroativo (compara a recomendação com o humano) e pela deliberação (fresca a cada rodada).
 * Devolve os votos conciliados ou null (projeto ausente/especial).
 */
export async function computarVotosDoProjeto(
  projetoId: string,
  ctx: ContextoAvaliacao,
): Promise<VotosPainel | null> {
  const projeto = await getProjetoById(projetoId);
  if (!projeto || projeto.especial === 1) return null;
  return computarVotos(projeto, ctx);
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

  // Uma leitura do espelho só para selecionar os candidatos (sem gerar embedding ainda).
  const { linhas } = await lerResumosEspelho();
  const resumos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
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

  const { ctx, gerados } = await carregarContextoPainel(candidatos.map((c) => c.id), {
    dry,
    capGeracao: 60,
  });

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
    embeddings_gerados: gerados,
    avaliados,
    resultados,
  };
}

// ─── Deliberação: cron que avança as mesas ABERTAS (fatia C, MODO SOMBRA) ───────

export type ResultadoDeliberacaoBackfill = {
  ok: boolean;
  ligado: boolean;
  dry: boolean;
  abertas: number;
  avancadas: number;
  encerradas: number;
  resultados: { projeto_id: string; estado: string; rodada: number; encerrada: boolean }[];
  motivo?: string;
};

/**
 * Avança UMA rodada de cada deliberação ABERTA (`estado='deliberando'`). Idempotente e bounded por
 * `limite`. Re-roda a mesa (fresca — o corpus de aprovados pode ter crescido) e aplica o reducer
 * `avancarDeliberacao`. Consenso/nao_consenso encerram. NUNCA muda o status do projeto (sombra).
 */
export async function avancarDeliberacoesPendentes(
  opts: { dry?: boolean; limite?: number } = {},
): Promise<ResultadoDeliberacaoBackfill> {
  if (!avaliacaoNormaisLigada()) {
    return {
      ok: true,
      ligado: false,
      dry: true,
      abertas: 0,
      avancadas: 0,
      encerradas: 0,
      resultados: [],
      motivo: 'AVALIACAO_NORMAIS desligado (modo sombra OFF)',
    };
  }
  const dry = opts.dry ?? true;
  const limite = opts.limite ?? 10;

  const abertas = await getDeliberacoesAbertas(limite);
  if (abertas.length === 0) {
    return {
      ok: true,
      ligado: true,
      dry,
      abertas: 0,
      avancadas: 0,
      encerradas: 0,
      resultados: [],
      motivo: 'nenhuma deliberação aberta',
    };
  }

  // Contexto com os alvos abertos + o corpus de aprovados.
  const { ctx } = await carregarContextoPainel(
    abertas.map((a) => a.projeto_id),
    { dry, capGeracao: 40 },
  );

  const resultados: ResultadoDeliberacaoBackfill['resultados'] = [];
  let avancadas = 0;
  let encerradas = 0;
  for (const aberta of abertas) {
    try {
      const votos = await computarVotosDoProjeto(aberta.projeto_id, ctx);
      // Sinais da rodada: se o projeto sumiu/virou especial, encerra por falta de base.
      const sinais = votos
        ? {
            agregadoVeredito: votos.conciliado.veredito,
            divergencia: votos.conciliado.divergencia,
            confianca: votos.conciliado.confianca,
            ceticoRefuta: votos.cetico.refuta,
          }
        : {
            agregadoVeredito: 'em_validacao' as const,
            divergencia: false,
            confianca: 0,
            ceticoRefuta: false,
          };
      const delib = avancarDeliberacao(
        { estado: 'deliberando', rodada: aberta.rodada },
        sinais,
      );
      if (!dry) {
        await upsertDeliberacao({
          projeto_id: aberta.projeto_id,
          estado: delib.estado,
          rodada: delib.rodada,
          veredito: delib.veredito,
          confianca: delib.confianca,
          grau: delib.grau,
          encerrada: delib.encerrada,
          motivo: delib.motivo,
          // Cada rodada do cron ANEXA sua entrada ao histórico (preserva as anteriores).
          historico: JSON.stringify([
            { rodada: delib.rodada, estado: delib.estado, confianca: delib.confianca, motivo: delib.motivo },
          ]),
          origem: ORIGEM_AGREGADOR,
          apendarHistorico: true,
        });
      }
      avancadas++;
      if (delib.encerrada) encerradas++;
      resultados.push({
        projeto_id: aberta.projeto_id,
        estado: delib.estado,
        rodada: delib.rodada,
        encerrada: delib.encerrada,
      });
    } catch (e) {
      resultados.push({
        projeto_id: aberta.projeto_id,
        estado: 'erro',
        rodada: aberta.rodada,
        encerrada: false,
      });
      console.error('[avaliacao-normais] deliberação falhou:', e);
    }
  }

  return { ok: true, ligado: true, dry, abertas: abertas.length, avancadas, encerradas, resultados };
}
