/**
 * Orquestração do agente CLASSIFICADOR de especiais (peça 4) — server-side.
 *
 * Amarra: memória vetorial (`embeddings.ts` + tabela `especial_embedding`) → recuperação de
 * vizinhos (`especial-corpus.ts`) → agente (`agents/especial-classificador.ts`) → gravação da
 * recomendação em `especial_avaliacao` (origem `agente`, NUNCA a coluna "Estrelas").
 *
 * Três entradas:
 * - `classificarEspecialEmBackground(id)` — disparo pós-submissão (só se especial), no worker.
 * - `classificarEspeciaisPendentes({dry})` — backfill/cron dos especiais sem recomendação.
 * - `classificarEspecialProjeto(id, {dry})` — um projeto, para a rota manual de teste.
 *
 * ⚠️ Nunca lança no caminho de background (o `runBackground`/`waitUntil` engole, mas melhor não
 * derrubar nada). ⚠️ Envs lidas LAZY.
 */
import {
  getProjetoContextoData,
  getProjetoById,
  getDocumentacaoConteudo,
  getAvaliacoesEspeciais,
  upsertAvaliacaoEspecial,
  getEmbeddingsEspeciais,
  upsertEmbeddingEspecial,
  parseJson,
  type EspecialEmbeddingRow,
} from '@/integrations/db/client.server';
import { lerResumosEspelho } from '@/lib/sheet-espelho';
import { apenasEspeciais } from '@/lib/especiais-view';
import { mapResumo, type ProjetoDashboardResumo } from '@/lib/dashboard-resumo';
import type { DocumentacaoGerada } from '@/lib/agents/types';
import { gerarEmbeddingsLote, base64ParaVetor, vetorParaBase64 } from '@/lib/embeddings';
import {
  textoParaEmbedding,
  hashTexto,
  selecionarVizinhos,
  type EntradaSemantica,
  type ExemplarEspecial,
} from '@/lib/especial-corpus';
import {
  classificarEspecial,
  type AlvoClassificacao,
  type RecomendacaoEspecial,
} from '@/lib/agents/especial-classificador';

/** Carimbo de origem gravado em cada recomendação do agente (distingue do seed da força-tarefa). */
export const ORIGEM_AGENTE = 'agente-classificador';

/** Modelo de chat configurado — gravado junto da recomendação para saber de quem é a nota. */
function modeloChatConfigurado(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  // ⚠️ O fallback do llm.ts pode trocar o modelo por baixo (proxy >60s → gpt-5.4-mini). Como o
  // `llmChat` só devolve texto, gravamos o modelo CONFIGURADO — a imprecisão aqui é cosmética
  // (a nota é sugestão, nunca vai à planilha sozinha), diferente de um número errado no Sheets.
  return env?.LLM_MODEL || 'desconhecido';
}

// ─── Texto semântico do projeto ────────────────────────────────────────────────

/** Extrai um texto legível da documentação compilada (JSON de DocumentacaoGerada). */
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

/**
 * Monta a "impressão semântica" de um projeto. Prefere o banco (`projetos`); se o projeto só
 * existe no espelho (legado ainda não criado no SQLite), cai no resumo — embedding mais fraco,
 * mas ainda agrupa por nome/área.
 */
async function montarEntradaSemantica(
  projetoId: string,
  resumo?: ProjetoDashboardResumo,
): Promise<{ entrada: EntradaSemantica; alvo: AlvoClassificacao } | null> {
  const ctx = await getProjetoContextoData(projetoId);
  const docRow = await getDocumentacaoConteudo(projetoId);
  const doc = resumoDocParaTexto(docRow?.conteudo);

  const nome = ctx?.nome ?? resumo?.nome ?? null;
  const area = ctx?.area_nome ?? ctx?.area ?? resumo?.area ?? null;
  const ferramenta = ctx?.ferramenta ?? resumo?.tipos ?? null;
  const tipos = resumo?.tipos ?? (ctx?.tipos_projeto ?? null);
  const contexto_especial = ctx?.contexto_especial ?? null;
  const descricao = ctx?.descricao_breve ?? null;
  const memorial = ctx?.memorial_calculo ?? null;

  if (!ctx && !resumo) return null;

  const entrada: EntradaSemantica = {
    nome,
    area,
    ferramenta,
    tipos: typeof tipos === 'string' ? tipos : null,
    contexto_especial,
    descricao,
    memorial,
    doc,
  };
  const alvo: AlvoClassificacao = {
    projeto_id: projetoId,
    nome,
    area,
    ferramenta: typeof ferramenta === 'string' ? ferramenta : null,
    tipos: typeof tipos === 'string' ? tipos : null,
    contexto_especial,
    descricao,
    memorial,
    doc,
    submetido_em: ctx?.submitted_at ?? resumo?.dataSubmissao ?? null,
  };
  return { entrada, alvo };
}

// ─── Corpus (memória) ──────────────────────────────────────────────────────────

type MapaEmbedding = Map<string, { vetor: number[]; modelo: string; dim: number; hash: string | null }>;

function decodificarEmbeddings(rows: EspecialEmbeddingRow[]): MapaEmbedding {
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
      // Vetor corrompido: ignora esta linha (o backfill a regrava).
    }
  }
  return mapa;
}

/**
 * Monta o corpus de exemplares a partir dos resumos do espelho (nome/área/nota humana), das
 * recomendações gravadas (leitura/nota recomendada) e dos vetores. Só entram os que têm vetor —
 * sem vetor não há como medir vizinhança.
 */
function montarCorpus(
  especiais: ProjetoDashboardResumo[],
  avaliacoes: Map<string, { estrelas_recomendada: number; leitura: string | null }>,
  embeddings: MapaEmbedding,
): ExemplarEspecial[] {
  const corpus: ExemplarEspecial[] = [];
  for (const p of especiais) {
    const emb = embeddings.get(p.id);
    if (!emb) continue;
    const av = avaliacoes.get(p.id);
    corpus.push({
      projeto_id: p.id,
      nome: p.nome,
      area: p.area,
      estrela_humana: p.estrelas, // coluna "Estrelas" (verdade)
      estrela_recomendada: av?.estrelas_recomendada ?? null,
      leitura: av?.leitura ?? null,
      vetor: emb.vetor,
    });
  }
  return corpus;
}

/**
 * Garante que os projetos em `ids` tenham embedding FRESCO (hash do texto bate). Gera em lote só
 * os que faltam ou mudaram, grava e devolve o mapa atualizado. Nunca lança.
 */
async function garantirEmbeddings(
  ids: string[],
  resumoPorId: Map<string, ProjetoDashboardResumo>,
  embeddings: MapaEmbedding,
  opts: { capGeracao?: number } = {},
): Promise<{ mapa: MapaEmbedding; gerados: number }> {
  const cap = opts.capGeracao ?? 40; // teto por corrida (custo + tempo do cron)
  const pendentes: { id: string; texto: string; hash: string }[] = [];

  for (const id of ids) {
    if (pendentes.length >= cap) break;
    const montado = await montarEntradaSemantica(id, resumoPorId.get(id));
    if (!montado) continue;
    const texto = textoParaEmbedding(montado.entrada);
    if (!texto) continue;
    const hash = hashTexto(texto);
    const atual = embeddings.get(id);
    if (atual && atual.hash === hash) continue; // já fresco
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
      await upsertEmbeddingEspecial({
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

// ─── Um projeto ────────────────────────────────────────────────────────────────

export type ResultadoClassificacao = {
  ok: boolean;
  projeto_id: string;
  motivo?: string;
  recomendacao?: RecomendacaoEspecial;
  vizinhos?: { nome: string | null; estrela: number; similaridade: number }[];
  gravado?: boolean;
};

/**
 * Classifica UM especial. `dry` não grava — devolve a recomendação e os vizinhos usados
 * (é o que a rota manual/o cron em modo seco mostram).
 */
export async function classificarEspecialProjeto(
  projetoId: string,
  opts: { dry?: boolean } = {},
): Promise<ResultadoClassificacao> {
  const { linhas } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  );
  const resumoPorId = new Map(especiais.map((p) => [p.id, p]));

  const montado = await montarEntradaSemantica(projetoId, resumoPorId.get(projetoId));
  if (!montado) {
    return { ok: false, projeto_id: projetoId, motivo: 'projeto sem contexto para classificar' };
  }

  // Embedding do alvo (também vira memória para os próximos) + corpus atual.
  const embeddings = decodificarEmbeddings(await getEmbeddingsEspeciais());
  const { mapa } = await garantirEmbeddings([projetoId], resumoPorId, embeddings, { capGeracao: 1 });
  const alvoEmb = mapa.get(projetoId);

  const avaliacoesRows = await getAvaliacoesEspeciais();
  const avaliacoes = new Map(
    avaliacoesRows.map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );
  const corpus = montarCorpus(especiais, avaliacoes, mapa);
  const vizinhos = alvoEmb
    ? selecionarVizinhos(alvoEmb.vetor, corpus, { excluirId: projetoId })
    : [];

  const recomendacao = await classificarEspecial(montado.alvo, vizinhos);
  if (!recomendacao) {
    return { ok: false, projeto_id: projetoId, motivo: 'LLM não devolveu recomendação utilizável' };
  }

  let gravado = false;
  if (!opts.dry) {
    await upsertAvaliacaoEspecial({
      projeto_id: projetoId,
      estrelas_recomendada: recomendacao.estrelas_recomendada,
      confianca: recomendacao.confianca,
      leitura: recomendacao.leitura,
      contestada: recomendacao.contestada,
      origem: ORIGEM_AGENTE,
      modelo: modeloChatConfigurado(),
    });
    gravado = true;
  }

  return {
    ok: true,
    projeto_id: projetoId,
    recomendacao,
    gravado,
    vizinhos: vizinhos.map((v) => ({
      nome: v.nome,
      estrela: v.estrela_efetiva,
      similaridade: Number(v.similaridade.toFixed(3)),
    })),
  };
}

// ─── Disparo pós-submissão (worker) ────────────────────────────────────────────

/**
 * Chamado no worker logo após `submeter-validacao`, junto da análise. NO-OP silencioso se o
 * projeto não for especial. Nunca lança.
 */
export async function classificarEspecialEmBackground(projetoId: string): Promise<void> {
  try {
    const p = await getProjetoById(projetoId);
    if (!p || p.especial !== 1) return; // só especiais
    await classificarEspecialProjeto(projetoId);
  } catch (e) {
    console.error('[especial-classificador] falha em background:', e);
  }
}

// ─── Backfill / cron ────────────────────────────────────────────────────────────

export type ResultadoBackfill = {
  ok: boolean;
  dry: boolean;
  candidatos: number;
  embeddings_gerados: number;
  classificados: number;
  resultados: ResultadoClassificacao[];
  motivo?: string;
};

/**
 * Classifica os especiais SEM recomendação (o buraco que a triagem viu). Bounded por `limite`
 * para o cron convergir em várias corridas sem estourar o tempo do worker. `forcar` reavalia
 * TODOS os especiais (reprocessamento sob demanda), não só os pendentes.
 */
export async function classificarEspeciaisPendentes(
  opts: { dry?: boolean; limite?: number; forcar?: boolean } = {},
): Promise<ResultadoBackfill> {
  const dry = opts.dry ?? true; // seco é o padrão — gravar exige {dry:false} explícito
  const limite = opts.limite ?? 15;

  const { linhas } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  );
  const resumoPorId = new Map(especiais.map((p) => [p.id, p]));

  const avaliacoesRows = await getAvaliacoesEspeciais();
  const jaTemAvaliacao = new Set(avaliacoesRows.map((a) => a.projeto_id));
  const avaliacoes = new Map(
    avaliacoesRows.map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );

  const candidatos = especiais
    .filter((p) => opts.forcar || !jaTemAvaliacao.has(p.id))
    .slice(0, limite);

  if (candidatos.length === 0) {
    return {
      ok: true,
      dry,
      candidatos: 0,
      embeddings_gerados: 0,
      classificados: 0,
      resultados: [],
      motivo: 'nenhum especial pendente de classificação',
    };
  }

  // Constrói a memória: garante embeddings dos exemplares JÁ rotulados (nota humana ou
  // recomendação anterior) + dos candidatos. Assim a recuperação já tem contra o que comparar.
  let embeddings = decodificarEmbeddings(await getEmbeddingsEspeciais());
  const rotulados = especiais
    .filter((p) => p.estrelas != null || jaTemAvaliacao.has(p.id))
    .map((p) => p.id);
  const idsParaEmbeddar = Array.from(new Set([...candidatos.map((c) => c.id), ...rotulados]));
  const ger = await garantirEmbeddings(idsParaEmbeddar, resumoPorId, embeddings, {
    capGeracao: 60,
  });
  embeddings = ger.mapa;

  const corpus = montarCorpus(especiais, avaliacoes, embeddings);

  const resultados: ResultadoClassificacao[] = [];
  let classificados = 0;
  for (const cand of candidatos) {
    try {
      const montado = await montarEntradaSemantica(cand.id, cand);
      if (!montado) {
        resultados.push({ ok: false, projeto_id: cand.id, motivo: 'sem contexto' });
        continue;
      }
      const alvoEmb = embeddings.get(cand.id);
      const vizinhos = alvoEmb
        ? selecionarVizinhos(alvoEmb.vetor, corpus, { excluirId: cand.id })
        : [];
      const rec = await classificarEspecial(montado.alvo, vizinhos);
      if (!rec) {
        resultados.push({ ok: false, projeto_id: cand.id, motivo: 'LLM sem recomendação' });
        continue;
      }
      if (!dry) {
        await upsertAvaliacaoEspecial({
          projeto_id: cand.id,
          estrelas_recomendada: rec.estrelas_recomendada,
          confianca: rec.confianca,
          leitura: rec.leitura,
          contestada: rec.contestada,
          origem: ORIGEM_AGENTE,
          modelo: modeloChatConfigurado(),
        });
      }
      classificados++;
      resultados.push({
        ok: true,
        projeto_id: cand.id,
        recomendacao: rec,
        gravado: !dry,
        vizinhos: vizinhos.map((v) => ({
          nome: v.nome,
          estrela: v.estrela_efetiva,
          similaridade: Number(v.similaridade.toFixed(3)),
        })),
      });
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
    dry,
    candidatos: candidatos.length,
    embeddings_gerados: ger.gerados,
    classificados,
    resultados,
  };
}
