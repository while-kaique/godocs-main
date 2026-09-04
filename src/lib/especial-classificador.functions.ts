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
  getEmbeddingEspecial,
  getEmbeddingsEspeciaisPagina,
  upsertEmbeddingEspecial,
  parseJson,
  type EspecialEmbeddingRow,
} from "@/integrations/db/client.server";
import { lerResumosEspelho, lerLinhaEspelho } from "@/lib/sheet-espelho";
import { chaveProjeto } from "@/lib/projeto-chave";
import { TETO_AGENTE, ehEscape } from "@/lib/estrelas-regua";
import { ajustarNotaComPainel, confiancaPorConsenso, type AjustePainel } from "@/lib/especiais-ajuste";
import { verificarCoerencia, removerNumerosDivergentes } from "@/lib/coerencia-leitura";
import { apenasEspeciais } from "@/lib/especiais-view";
import { mapResumo, type ProjetoDashboardResumo } from "@/lib/dashboard-resumo";
import type { DocumentacaoGerada } from "@/lib/agents/types";
import {
  gerarEmbeddingsLote,
  base64ParaVetor,
  vetorParaBase64,
  embeddingConfig,
} from "@/lib/embeddings";
import {
  textoParaEmbedding,
  hashTexto,
  selecionarVizinhos,
  vizinhosDeMatches,
  K_VIZINHOS,
  type EntradaSemantica,
  type ExemplarEspecial,
  type ExemplarSemVetor,
  type Vizinho,
} from "@/lib/especial-corpus";
import {
  consultarVizinhos,
  upsertVetores,
  namespacePinecone,
  descreverIndice,
  garantirIndice,
  type VetorParaUpsert,
} from "@/lib/pinecone";
import {
  avaliarDesvio,
  ordenarPorGravidade,
  resumirReauditoria,
  type LinhaReauditoria,
  type ResumoReauditoria,
} from "@/lib/especiais-reauditoria";
import {
  classificarEspecial,
  type AlvoClassificacao,
  type RecomendacaoEspecial,
} from "@/lib/agents/especial-classificador";
import {
  medirConcordancia,
  type MetricasConcordancia,
  type ParNota,
} from "@/lib/especiais-concordancia";
import {
  classificarFuncao,
  medirCobertura,
  rotuloFuncao,
  FUNCAO_INDEFINIDA,
  type CoberturaFuncao,
  type EvidenciaVizinho,
  type FuncaoDetectada,
} from "@/lib/especiais-funcao";
import type { Confianca } from "@/lib/especiais-regua";
import {
  avaliarComLentes,
  LENTES,
  LENTE_GATE,
  lentePorChave,
  type AvaliacaoLente,
} from "@/lib/agents/especiais-lentes";
import {
  calibrarRodada,
  entradaDeConsolidado,
  explicarCalibragem,
  type EntradaCalibragem,
  type LinhaCalibrada,
  type MotivoRebaixa,
  type ResumoCalibragem,
} from "@/lib/especiais-calibrador";
import { redigirLeituraCalibrada } from "@/lib/agents/especiais-calibrador";
import {
  aplicarRevisao,
  explicarConvergencia,
  iniciarConvergencia,
  podeRevisarDeNovo,
  TETO_VOLTAS,
  type EstadoConvergencia,
} from "@/lib/especiais-convergencia";
import { revisarAdversarial } from "@/lib/agents/especiais-revisor";
import { confiancaDoPainel, leituraDoPainel, ORIGEM_PAINEL } from "@/lib/especiais-painel";

/** Carimbo de origem gravado em cada recomendação do agente (distingue do seed da força-tarefa). */
export const ORIGEM_AGENTE = "agente-classificador";

/** Modelo de chat configurado — gravado junto da recomendação para saber de quem é a nota. */
function modeloChatConfigurado(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  // ⚠️ O fallback do llm.ts pode trocar o modelo por baixo (proxy >60s → gpt-5.4-mini). Como o
  // `llmChat` só devolve texto, gravamos o modelo CONFIGURADO — a imprecisão aqui é cosmética
  // (a nota é sugestão, nunca vai à planilha sozinha), diferente de um número errado no Sheets.
  return env?.LLM_MODEL || "desconhecido";
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
    partes.push(doc.fluxo.map((f) => `${f.etapa}: ${f.descricao}`).join("\n"));
  }
  if (Array.isArray(doc.atencao) && doc.atencao.length) {
    partes.push(doc.atencao.map((a) => `${a.titulo}: ${a.descricao}`).join("\n"));
  }
  const txt = partes.join("\n").trim();
  return txt || null;
}

/** Só o `o_que_faz` da doc — o campo mais discriminante, que lidera o texto do embedding. */
function oQueFazDoc(conteudoJson: string | null | undefined): string | null {
  if (!conteudoJson) return null;
  const doc = parseJson<DocumentacaoGerada>(conteudoJson);
  const t = doc?.o_que_faz?.trim();
  return t || null;
}

/**
 * Monta a "impressão semântica" de um projeto. Prefere o banco (`projetos`); se o projeto só
 * existe no espelho (legado ainda não criado no SQLite), cai no resumo — embedding mais fraco,
 * mas ainda agrupa por nome/área.
 */
/**
 * Piso abaixo do qual o "Memorial de Saving" não é um memorial, é uma CONTA.
 *
 * Medido na base (03/09/2026): os 30 legados importados à mão têm mediana de **57 caracteres**
 * nessa coluna (`"22h × R$21,29 (Jr) = R$468,38."`), contra **1.903** dos memoriais gerados pelo
 * app. 300 fica confortavelmente entre os dois.
 */
const MEMORIAL_DEGENERADO_MAX = 300;

/**
 * Completa o memorial com a coluna **"Memorial anterior"** quando a principal só tem a conta.
 *
 * ⚠️ Por que existe: nos legados importados à mão, o "Memorial de Saving" é a aritmética que a
 * triagem escreveu, e o texto do AUTOR (o que o projeto faz, para quem, com que frequência) ficou
 * em "Memorial anterior". O agente lia só a conta e concluía, corretamente para o que viu, "só
 * calcula economia de tempo, não comprova uso recorrente": **30 de 30 desses projetos saíram 0★,
 * sendo 15 com nota humana 1** — contra uma taxa base de 50% de zeros nessa faixa. Não era
 * veredito sobre os projetos, era ausência de dossiê. 26 dos 30 têm esse texto, com mediana de
 * 308 caracteres.
 *
 * ⚠️ **Só COMPLEMENTA, nunca substitui**, e só quando a principal é degenerada: em projeto
 * submetido pelo app essa coluna guarda a versão ANTERIOR do memorial, e juntar as duas colocaria
 * números velhos ao lado dos novos no mesmo texto.
 *
 * ⚠️ **"Observações" fica de FORA de propósito.** É a coluna mais rica dessas linhas e é a mais
 * proibida: ela guarda o parecer da TRIAGEM ("Saving OK", "Conservador", "convincente"). Dar ao
 * agente a opinião do humano que ele está sendo comparado contra não melhora a nota, contamina a
 * medição.
 */
async function memorialComplementado(chave: string, memorial: string | null): Promise<string | null> {
  const atual = (memorial ?? '').trim();
  if (atual.length > MEMORIAL_DEGENERADO_MAX) return memorial;
  try {
    const linha = await lerLinhaEspelho(chave);
    const anterior = String(linha?.['Memorial anterior'] ?? '').trim();
    if (!anterior || anterior === '—' || anterior.length < 40) return memorial;
    return atual ? `${atual}\n\n${anterior}` : anterior;
  } catch {
    return memorial; // fonte acessória: falhar aqui não pode derrubar a classificação
  }
}

async function montarEntradaSemantica(
  projetoId: string,
  resumo?: ProjetoDashboardResumo,
): Promise<{ entrada: EntradaSemantica; alvo: AlvoClassificacao } | null> {
  // ⚠️ A planilha guarda o id do legado em MAIÚSCULA (`LEGADO-049`) e o sync reverso cria a
  // linha em `projetos` sempre em minúscula (`sync-reverse.ts`). Como o `=` do SQLite é
  // sensível a caixa, ler cru deixava 30 aprovados **invisíveis** ("projeto sem contexto para
  // classificar") e, no caso do especial — onde o resumo do espelho salva a chamada —, montava
  // um dossiê SILENCIOSAMENTE truncado, sem memorial nem documentação. Match por id é
  // case-insensitive em todo o resto do repo; aqui não era.
  const chave = chaveProjeto(projetoId);
  const ctx = await getProjetoContextoData(chave);
  const docRow = await getDocumentacaoConteudo(chave);
  const doc = resumoDocParaTexto(docRow?.conteudo);
  const oQueFaz = oQueFazDoc(docRow?.conteudo);

  const nome = ctx?.nome ?? resumo?.nome ?? null;
  const area = ctx?.area_nome ?? ctx?.area ?? resumo?.area ?? null;
  const ferramenta = ctx?.ferramenta ?? resumo?.tipos ?? null;
  const tipos = resumo?.tipos ?? ctx?.tipos_projeto ?? null;
  const contexto_especial = ctx?.contexto_especial ?? null;
  const descricao = ctx?.descricao_breve ?? null;
  const memorial = await memorialComplementado(chave, ctx?.memorial_calculo ?? null);

  if (!ctx && !resumo) return null;

  const entrada: EntradaSemantica = {
    nome,
    o_que_faz: oQueFaz,
    area,
    ferramenta,
    tipos: typeof tipos === "string" ? tipos : null,
    contexto_especial,
    descricao,
    memorial,
    doc,
  };
  const alvo: AlvoClassificacao = {
    projeto_id: projetoId,
    nome,
    area,
    ferramenta: typeof ferramenta === "string" ? ferramenta : null,
    tipos: typeof tipos === "string" ? tipos : null,
    contexto_especial,
    descricao,
    memorial,
    doc,
    submetido_em: ctx?.submitted_at ?? resumo?.dataSubmissao ?? null,
  };
  return { entrada, alvo };
}

// ─── Corpus (memória) ──────────────────────────────────────────────────────────

type MapaEmbedding = Map<
  string,
  { vetor: number[]; modelo: string; dim: number; hash: string | null }
>;

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
 * Os exemplares SEM vetor, por id — é o que hidrata os `matches` do Pinecone (que só devolve id +
 * score). Nome/área/leitura/notas continuam vindo da fonte da verdade: o espelho da planilha e a
 * tabela `especial_avaliacao`, não da metadata do índice (decisão 6).
 */
/** Só o recorte de `especial_avaliacao` que o mapa de exemplares usa. */
function avaliacoesParaExemplar(
  rows: { projeto_id: string; estrelas_recomendada: number; leitura: string | null }[],
): Map<string, { estrelas_recomendada: number; leitura: string | null }> {
  return new Map(
    rows.map((a) => [a.projeto_id, { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura }]),
  );
}

function mapaExemplares(
  projetos: ProjetoDashboardResumo[],
  avaliacoes: Map<string, { estrelas_recomendada: number; leitura: string | null }>,
): Map<string, ExemplarSemVetor> {
  const mapa = new Map<string, ExemplarSemVetor>();
  for (const p of projetos) {
    const av = avaliacoes.get(p.id);
    mapa.set(p.id, {
      projeto_id: p.id,
      nome: p.nome,
      area: p.area,
      estrela_humana: p.estrelas,
      estrela_recomendada: av?.estrelas_recomendada ?? null,
      leitura: av?.leitura ?? null,
    });
  }
  return mapa;
}

/** De onde vieram os vizinhos desta corrida — vai no resultado para a operação enxergar o fallback. */
export type OrigemVizinhos = "pinecone" | "sqlite";

/**
 * Recupera os vizinhos do alvo: **Pinecone primeiro, cosseno-em-JS do SQLite como fallback**
 * (decisão 6).
 *
 * ⚠️ **`null` do Pinecone ≠ `[]`.** `null` é indisponibilidade (sem chave, índice fora, HTTP
 * ruim) e é o ÚNICO caso que cai no SQLite; `[]` é resposta legítima ("não há vizinho parecido")
 * e cair no SQLite ali só gastaria RPC para chegar à mesma lista vazia — e mascararia um índice
 * vazio, que é exatamente o que o backfill existe para consertar.
 *
 * ⚠️ O fallback é caminho vivo, não decoração: fallback que nunca roda apodrece calado. O teste
 * `pinecone-especiais.test.ts` exercita o caminho degradado de propósito.
 */
async function recuperarVizinhos(
  alvoVetor: number[],
  args: {
    excluirId: string;
    /** Carregado SÓ quando o Pinecone cai — é a leitura da tabela inteira que o índice evita. */
    corpusFallback: () => Promise<ExemplarEspecial[]>;
    exemplarPorId: Map<string, ExemplarSemVetor>;
    filtro?: Record<string, unknown>;
    k?: number;
  },
): Promise<{ vizinhos: Vizinho[]; origem: OrigemVizinhos }> {
  const k = args.k ?? K_VIZINHOS;
  // topK folgado: o índice não conhece o piso de similaridade nem os exemplares SEM rótulo, e
  // ambos são descartados depois — pedir exatamente `k` devolveria menos que `k` no prompt.
  const matches = await consultarVizinhos(alvoVetor, {
    topK: Math.max(k * 3, 12),
    filtro: args.filtro,
  });
  if (matches != null) {
    return {
      vizinhos: vizinhosDeMatches(matches, args.exemplarPorId, { k, excluirId: args.excluirId }),
      origem: "pinecone",
    };
  }
  const corpus = await args.corpusFallback();
  return {
    vizinhos: selecionarVizinhos(alvoVetor, corpus, { k, excluirId: args.excluirId }),
    origem: "sqlite",
  };
}

/**
 * Monta o vetor + metadata de um especial para o índice (decisão 4). `null` quando não há vetor —
 * sem vetor não há o que indexar.
 */
function vetorParaIndice(
  id: string,
  mapa: MapaEmbedding,
  resumo: ProjetoDashboardResumo | undefined,
  avaliacao: { estrelas_recomendada: number; leitura: string | null } | undefined,
): VetorParaUpsert | null {
  const emb = mapa.get(id);
  if (!emb) return null;
  return {
    id,
    vetor: emb.vetor,
    metadata: {
      projeto_id: id,
      // ⚠️ É esta flag que permite filtrar os vizinhos de rótulo HUMANO no servidor — o
      // anti-feedback-loop do `rotuloExemplar`, e o que a re-auditoria exige.
      tem_nota_humana: resumo?.estrelas != null,
      estrela_humana: resumo?.estrelas ?? null,
      estrela_recomendada: avaliacao?.estrelas_recomendada ?? null,
      area: resumo?.area ?? null,
      texto_hash: emb.hash,
      modelo: emb.modelo,
    },
  };
}

/**
 * Espelha no Pinecone os vetores que acabaram de ser gerados/atualizados. **Best-effort**: o
 * SQLite já gravou, e falhar aqui não pode derrubar a classificação (Pinecone é índice de
 * leitura, não fonte da verdade). O backfill repõe o que ficar para trás.
 */
async function indexarPinecone(
  ids: string[],
  mapa: MapaEmbedding,
  resumoPorId: Map<string, ProjetoDashboardResumo>,
  avaliacoes: Map<string, { estrelas_recomendada: number; leitura: string | null }>,
): Promise<void> {
  const vetores = ids
    .map((id) => vetorParaIndice(id, mapa, resumoPorId.get(id), avaliacoes.get(id)))
    .filter((v): v is VetorParaUpsert => v != null);
  if (vetores.length === 0) return;
  const r = await upsertVetores(vetores);
  if (!r.ok) console.warn(`[especial-classificador] upsert no Pinecone falhou: ${r.motivo}`);
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
  // ⚠️ TRAVA DE CUSTO. As chamadas de LLM vão pelo ai-proxy e são baratas de testar; EMBEDDING é
  // outra coisa: vai direto na OpenAI, com chave própria, e se paga por chamada. Com
  // `EMBEDDINGS_SOMENTE_LEITURA` ligada, nada é gerado — os vetores que existem seguem sendo
  // LIDOS normalmente e quem não tem vetor simplesmente fica sem vizinho.
  //
  // Existe para rodada de calibragem, que repassa a base inteira várias vezes: ali qualquer
  // mudança no texto do dossiê (um complemento de memorial, por exemplo) muda o hash e
  // re-embeddaria o lote todo sem ninguém pedir. Env lida em RUNTIME, nunca em escopo de módulo.
  if (String(process.env.EMBEDDINGS_SOMENTE_LEITURA ?? "") === "1") {
    return { mapa: embeddings, gerados: 0 };
  }
  const cap = opts.capGeracao ?? 40; // teto por corrida (custo + tempo do cron)
  // Modelo-alvo: vetor gerado por OUTRO modelo é "velho" mesmo com o texto igual (troca de
  // `-small`→`-large` muda a dimensão, e cosseno entre dims diferentes é 0 → o vizinho some).
  const modeloAlvo = embeddingConfig()?.modelo;
  const pendentes: { id: string; texto: string; hash: string }[] = [];

  for (const id of ids) {
    if (pendentes.length >= cap) break;
    const montado = await montarEntradaSemantica(id, resumoPorId.get(id));
    if (!montado) continue;
    const texto = textoParaEmbedding(montado.entrada);
    if (!texto) continue;
    const hash = hashTexto(texto);
    const atual = embeddings.get(id);
    const frescoTexto = atual != null && atual.hash === hash;
    const frescoModelo = atual != null && (!modeloAlvo || atual.modelo === modeloAlvo);
    if (frescoTexto && frescoModelo) continue; // já fresco (texto e modelo)
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
  /** `pinecone` ou `sqlite` — deixa o FALLBACK visível na resposta em vez de silencioso. */
  origem_vizinhos?: OrigemVizinhos;
  gravado?: boolean;
};

/**
 * Resolve o ALVO e os VIZINHOS de um projeto — o preparo comum ao classificador de 1 agente e ao
 * painel de lentes.
 *
 * ⚠️ Existe para os dois caminhos não divergirem em silêncio. Se cada um montasse o próprio
 * dossiê e a própria vizinhança, a comparação entre eles deixaria de medir o JULGAMENTO e passaria
 * a medir a diferença de preparo, que é a forma mais fácil de uma troca de arquitetura se
 * disfarçar de mudança de nota.
 */
type AlvoPreparado = {
  alvo: AlvoClassificacao;
  vizinhos: Vizinho[];
  origem: OrigemVizinhos;
  /** Nomes dos OUTROS projetos da base — é contra eles que se confere um dependente nomeado. */
  nomesDaBase: string[];
};

async function prepararAlvo(
  projetoId: string,
  opts: { forcar?: boolean } = {},
): Promise<AlvoPreparado | { ok: boolean; motivo: string }> {
  const { linhas } = await lerResumosEspelho();
  const todos = linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null);
  const especiais = apenasEspeciais(todos);
  const resumoPorId = new Map(especiais.map((p) => [chaveProjeto(p.id), p]));

  // ⚠️ VIZINHOS SAEM DA BASE INTEIRA, não só dos especiais.
  //
  // O índice devolve id + score, e quem hidrata o resto é este mapa. Montado só com os 59
  // especiais, todo vizinho NORMAL era descartado em silêncio — medido em prod: projeto normal
  // recebia 0 vizinhos enquanto um especial recebia 6. A memória certa para posicionar um
  // projeto é a base toda, e são 459 normais com nota humana dada pela triagem contra 59
  // especiais: jogar fora os 459 era jogar fora quase toda a memória que existe.
  //
  // Continua valendo o anti-feedback-loop: `rotuloExemplar` prefere a nota HUMANA à recomendada,
  // então o que ensina o agente é a decisão de gente, não a opinião dele mesmo.
  const avaliacoesRows = await getAvaliacoesEspeciais();
  const avaliacoes = avaliacoesParaExemplar(avaliacoesRows);
  const exemplares = mapaExemplares(todos, avaliacoes);

  const resumoAlvo = resumoPorId.get(projetoId);
  // Nota humana é VERDADE e âncora: recomendar por cima dela é ruído no cartão e, pior, alimenta
  // o corpus com opinião do próprio agente (o anti-feedback-loop).
  if (!opts.forcar && resumoAlvo?.estrelas != null) {
    return {
      ok: true,
      motivo: `já tem nota humana (${resumoAlvo.estrelas}★) — vira âncora, não é reclassificado`,
    };
  }

  const montado = await montarEntradaSemantica(projetoId, resumoAlvo);
  if (!montado) return { ok: false, motivo: "projeto sem contexto para classificar" };

  // Embedding do ALVO — 1 linha, não a tabela inteira. Ler todos os vetores por classificação é
  // exatamente o que encosta no teto de 32 MiB de RPC do Godeploy; com o Pinecone no ar, a tabela
  // só é lida no fallback (o thunk `corpusFallback` abaixo).
  const embAlvo = await getEmbeddingEspecial(projetoId);
  const mapa = (
    await garantirEmbeddings(
      [projetoId],
      resumoPorId,
      decodificarEmbeddings(embAlvo ? [embAlvo] : []),
      { capGeracao: 1 },
    )
  ).mapa;
  const alvoEmb = mapa.get(projetoId);

  // O alvo também vira memória para os próximos — best-effort, nunca derruba a classificação.
  await indexarPinecone([projetoId], mapa, resumoPorId, avaliacoes);

  const recuperado = alvoEmb
    ? await recuperarVizinhos(alvoEmb.vetor, {
        excluirId: projetoId,
        exemplarPorId: exemplares,
        corpusFallback: async () =>
          montarCorpus(
            todos,
            avaliacoes,
            decodificarEmbeddings(await getEmbeddingsEspeciais()),
          ),
      })
    : { vizinhos: [] as Vizinho[], origem: "sqlite" as OrigemVizinhos };

  return {
    alvo: montado.alvo,
    vizinhos: recuperado.vizinhos,
    origem: recuperado.origem,
    nomesDaBase: todos.filter((p) => chaveProjeto(p.id) !== projetoId).map((p) => p.nome ?? "").filter((n): n is string => n.length > 0),
  };
}

/**
 * Classifica UM especial. `dry` não grava — devolve a recomendação e os vizinhos usados
 * (é o que a rota manual/o cron em modo seco mostram).
 *
 * ⚠️ **Projeto que JÁ tem nota humana (coluna "Estrelas") NÃO é reclassificado** — a nota de
 * gente é a verdade e a âncora; gerar uma recomendação competindo com ela (ex.: o agente sugerir
 * 3 para o PIAPP, que é 10) é só ruído no cartão. Ele segue no corpus como EXEMPLAR, ensinando o
 * agente. `forcar` reabre isso (uso manual explícito), nunca o caminho automático.
 */
export async function classificarEspecialProjeto(
  projetoIdBruto: string,
  opts: { dry?: boolean; forcar?: boolean } = {},
): Promise<ResultadoClassificacao> {
  // Chave canônica: o id chega da planilha (`LEGADO-049`) ou do app (hex minúsculo) e daqui
  // para baixo ele endereça o SQLite, o embedding, o Pinecone e a linha de `especial_avaliacao`.
  // Normalizar UMA vez, na entrada, é o que impede leitura e escrita de divergirem de caixa.
  const projetoId = chaveProjeto(projetoIdBruto);
  const pronto = await prepararAlvo(projetoId, { forcar: opts.forcar });
  if ("motivo" in pronto) return { ok: pronto.ok, projeto_id: projetoId, motivo: pronto.motivo, gravado: false };
  const { alvo, vizinhos, origem } = pronto;

  const recomendacao = await classificarEspecial(alvo, vizinhos);
  if (!recomendacao) {
    return { ok: false, projeto_id: projetoId, motivo: "LLM não devolveu recomendação utilizável" };
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
    origem_vizinhos: origem,
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
    console.error("[especial-classificador] falha em background:", e);
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

  // ⚠️ Candidatos = especiais SEM recomendação **e SEM nota humana**. Quem a triagem já notou
  // (coluna "Estrelas") é VERDADE e âncora — não se reclassifica (o PIAPP 10★ não vira "recomenda
  // 3★" no cartão); ele segue no corpus como exemplar. `forcar` reabre tudo (reprocessamento manual).
  const candidatos = especiais
    .filter((p) => opts.forcar || (!jaTemAvaliacao.has(p.id) && p.estrelas == null))
    .slice(0, limite);

  if (candidatos.length === 0) {
    return {
      ok: true,
      dry,
      candidatos: 0,
      embeddings_gerados: 0,
      classificados: 0,
      resultados: [],
      motivo: "nenhum especial pendente de classificação",
    };
  }

  // Constrói a memória: garante embeddings dos exemplares JÁ rotulados (nota humana ou
  // recomendação anterior) + dos candidatos. Assim a recuperação já tem contra o que comparar.
  let embeddings = decodificarEmbeddings(await getEmbeddingsEspeciais());
  const rotulados = especiais
    .filter((p) => p.estrelas != null || jaTemAvaliacao.has(p.id))
    .map((p) => p.id);
  const idsParaEmbeddar = Array.from(new Set([...candidatos.map((c) => c.id), ...rotulados]));
  // `forcar` é a ferramenta da transição de modelo/texto — deixa o teto alto para reembeddar o
  // corpus inteiro numa passada; no cron normal, teto baixo (custo + tempo por corrida).
  const ger = await garantirEmbeddings(idsParaEmbeddar, resumoPorId, embeddings, {
    capGeracao: opts.forcar ? 200 : 60,
  });
  embeddings = ger.mapa;

  const corpus = montarCorpus(especiais, avaliacoes, embeddings);
  const exemplarPorId = mapaExemplares(especiais, avaliacoes);
  // Aqui o corpus JÁ está em memória (a corrida precisou dele para decidir o que re-embeddar),
  // então o thunk do fallback é de graça — nada de segunda leitura.
  const corpusFallback = async () => corpus;
  // Espelha no índice tudo que esta corrida tocou. Best-effort: o SQLite já gravou.
  await indexarPinecone(idsParaEmbeddar, embeddings, resumoPorId, avaliacoes);

  const resultados: ResultadoClassificacao[] = [];
  let classificados = 0;
  for (const cand of candidatos) {
    try {
      const montado = await montarEntradaSemantica(cand.id, cand);
      if (!montado) {
        resultados.push({ ok: false, projeto_id: cand.id, motivo: "sem contexto" });
        continue;
      }
      const alvoEmb = embeddings.get(cand.id);
      const recuperado = alvoEmb
        ? await recuperarVizinhos(alvoEmb.vetor, {
            excluirId: cand.id,
            exemplarPorId,
            corpusFallback,
          })
        : { vizinhos: [] as Vizinho[], origem: "sqlite" as OrigemVizinhos };
      const vizinhos = recuperado.vizinhos;
      const rec = await classificarEspecial(montado.alvo, vizinhos);
      if (!rec) {
        resultados.push({ ok: false, projeto_id: cand.id, motivo: "LLM sem recomendação" });
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
        origem_vizinhos: recuperado.origem,
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
        motivo: e instanceof Error ? e.message : "erro",
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

// ─── T5 — Backfill do índice (SQLite → Pinecone) ───────────────────────────────

export type ResultadoSincronizacao = {
  ok: boolean;
  dry: boolean;
  namespace: string;
  indice?: string;
  com_vetor: number;
  upsertados: number;
  sem_vetor: number;
  proximo_offset: number | null;
  motivo?: string;
};

/**
 * Sobe para o Pinecone os vetores que já existem no SQLite (T5). É o que enche o índice na
 * primeira vez e o que repõe o que ficou para trás quando um upsert best-effort falhou.
 *
 * `dry` é o DEFAULT: em modo seco conta quantos SUBIRIAM e não escreve nada.
 *
 * ⚠️ Varre em PÁGINAS (`getEmbeddingsEspeciaisPagina`). Ler `especial_embedding` inteira aqui
 * seria o mesmo teto de 32 MiB que motivou o índice — corrigir a leitura quente e deixar o
 * backfill estourando seria trocar o problema de lugar. `proximo_offset` diz onde continuar
 * (`null` = acabou).
 */
export async function sincronizarPineconeEspeciais(
  opts: { dry?: boolean; limite?: number; offset?: number } = {},
): Promise<ResultadoSincronizacao> {
  const dry = opts.dry ?? true;
  const limite = opts.limite ?? 200;
  const offset = opts.offset ?? 0;
  const namespace = namespacePinecone();

  const indice = await descreverIndice();
  if (!indice) {
    return {
      ok: false,
      dry,
      namespace,
      com_vetor: 0,
      upsertados: 0,
      sem_vetor: 0,
      proximo_offset: null,
      motivo: 'Pinecone indisponível — rode a rota de setup do índice com {"criar":true}',
    };
  }

  const { linhas } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  );
  const resumoPorId = new Map(especiais.map((p) => [p.id, p]));
  const avaliacoes = new Map(
    (await getAvaliacoesEspeciais()).map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );

  const pagina = await getEmbeddingsEspeciaisPagina(offset, limite);
  const mapa = decodificarEmbeddings(pagina);
  const vetores = pagina
    .map((r) =>
      vetorParaIndice(
        r.projeto_id,
        mapa,
        resumoPorId.get(r.projeto_id),
        avaliacoes.get(r.projeto_id),
      ),
    )
    .filter((v): v is VetorParaUpsert => v != null);

  const proximo = pagina.length === limite ? offset + limite : null;
  if (dry) {
    return {
      ok: true,
      dry,
      namespace,
      indice: indice.nome,
      com_vetor: vetores.length,
      upsertados: 0,
      sem_vetor: pagina.length - vetores.length,
      proximo_offset: proximo,
      motivo: 'modo seco — reenvie com {"dry":false} para gravar',
    };
  }

  const r = await upsertVetores(vetores, { namespace });
  return {
    ok: r.ok,
    dry,
    namespace,
    indice: indice.nome,
    com_vetor: vetores.length,
    upsertados: r.enviados,
    sem_vetor: pagina.length - vetores.length,
    proximo_offset: r.ok ? proximo : offset,
    motivo: r.motivo,
  };
}

/** Setup do índice (T1) — exposto para a rota admin. Só cria com `{criar:true}`. */
export async function prepararIndicePinecone(opts: { criar?: boolean } = {}) {
  return garantirIndice(opts);
}

// ─── T6 — Re-auditoria das estrelas já dadas ───────────────────────────────────

export type ResultadoReauditoria = {
  ok: boolean;
  namespace: string;
  resumo: ResumoReauditoria;
  linhas: LinhaReauditoria[];
  proximo_offset: number | null;
  motivo?: string;
};

/**
 * Re-auditoria (decisão 7): varre os especiais que JÁ têm nota humana, recupera os vizinhos de
 * nota humana no índice e reporta quem está a `LIMIAR_DELTA` estrelas ou mais da mediana dos
 * pares — provável inflação ou deflação.
 *
 * ⚠️ **É SÓ RELATÓRIO — não existe caminho de escrita aqui.** A coluna "Estrelas" é da triagem e
 * só clique humano a escreve (decisão fechada). Por isso a rota não tem `dry`: não há o que
 * secar. Corrigir uma nota apontada continua sendo trabalho de gente na planilha.
 *
 * ⚠️ **Exige o Pinecone** — e de propósito. O que faz a comparação valer é o filtro
 * `tem_nota_humana` resolvido NO SERVIDOR: comparar a nota de gente contra a mediana das
 * recomendações do próprio agente é o feedback loop puro (o agente "confirmando" o agente).
 * Sem índice, a resposta é `ok:false` dizendo isso — melhor que um relatório que parece certo.
 */
export async function reauditarEspeciais(
  opts: { limite?: number; offset?: number } = {},
): Promise<ResultadoReauditoria> {
  const limite = opts.limite ?? 50;
  const offset = opts.offset ?? 0;
  const namespace = namespacePinecone();
  const vazio: ResumoReauditoria = {
    analisados: 0,
    inflada: 0,
    deflada: 0,
    coerente: 0,
    sem_base: 0,
  };

  const indice = await descreverIndice();
  if (!indice) {
    return {
      ok: false,
      namespace,
      resumo: vazio,
      linhas: [],
      proximo_offset: null,
      motivo:
        "a re-auditoria exige o índice do Pinecone (o filtro de nota humana roda no servidor) — " +
        "rode o setup e o backfill antes",
    };
  }

  const { linhas: linhasSheet } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhasSheet.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  );
  const avaliacoes = new Map(
    (await getAvaliacoesEspeciais()).map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );
  const exemplarPorId = mapaExemplares(especiais, avaliacoes);

  // Ordem estável por id: a paginação precisa devolver a mesma fatia entre corridas.
  const comNota = especiais
    .filter((p) => p.estrelas != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  const fatia = comNota.slice(offset, offset + limite);

  const saida: LinhaReauditoria[] = [];
  for (const p of fatia) {
    const row = await getEmbeddingEspecial(p.id);
    const vetor = row ? decodificarEmbeddings([row]).get(p.id)?.vetor : undefined;
    if (!vetor) {
      saida.push({
        projeto_id: p.id,
        nome: p.nome,
        area: p.area,
        estrela_humana: p.estrelas as number,
        desvio: { veredito: "sem_base", referencia: null, delta: null, base: 0 },
        vizinhos: [],
      });
      continue;
    }
    // Filtro no SERVIDOR: só pares com rótulo humano. É o que justifica o índice (decisão 4).
    const matches = await consultarVizinhos(vetor, {
      topK: Math.max(K_VIZINHOS * 3, 12),
      filtro: { tem_nota_humana: { $eq: true } },
    });
    const vizinhos = matches ? vizinhosDeMatches(matches, exemplarPorId, { excluirId: p.id }) : [];
    saida.push({
      projeto_id: p.id,
      nome: p.nome,
      area: p.area,
      estrela_humana: p.estrelas as number,
      desvio: avaliarDesvio(p.estrelas, vizinhos),
      vizinhos: vizinhos.map((v) => ({
        nome: v.nome,
        estrela: v.estrela_efetiva,
        similaridade: Number(v.similaridade.toFixed(3)),
      })),
    });
  }

  const ordenadas = ordenarPorGravidade(saida);
  return {
    ok: true,
    namespace,
    resumo: resumirReauditoria(ordenadas),
    linhas: ordenadas,
    proximo_offset: offset + limite < comNota.length ? offset + limite : null,
  };
}

/**
 * A FUNÇÃO (T2) de um projeto já montado. ⚠️ **FONTE ÚNICA do recipe**: título = o que o AUTOR diz
 * que o projeto é (nome + "o que faz"), corpo = o mesmo texto que vira embedding. O peso do título
 * é o que desempata sem chute (`PESO_TITULO`), e digitar este recipe duas vezes faria o roteador da
 * medição divergir do roteador do lote — matando a comparabilidade que o T2 existe para garantir.
 */
function funcaoDoMontado(entrada: EntradaSemantica, evidencias: EvidenciaVizinho[] = []) {
  const titulo = [entrada.nome, entrada.o_que_faz].filter(Boolean).join(" — ");
  return classificarFuncao({ titulo, corpo: textoParaEmbedding(entrada) }, evidencias);
}

// ─── T1 do painel — harness de concordância contra as notas HUMANAS ────────────

/**
 * O juiz sob medição. O T1 mede o agente ÚNICO de hoje (o baseline a bater); o T7 passa o painel
 * aqui e compara no MESMO harness. É por isso que o juiz é parâmetro e não literal.
 */
export type JuizConcordancia = (
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  /**
   * Contexto DERIVADO que o harness já tem em mãos. Aditivo de propósito: o `classificarEspecial`
   * (agente único) ignora, e o painel usa a FUNÇÃO — que precisa sair do MESMO texto do lote, senão
   * a corrida de medição e a de produção roteariam diferente e deixariam de ser comparáveis.
   */
  extra?: { funcao?: string | null },
) => Promise<{ estrelas_recomendada: number } | null>;

export type ResultadoConcordancia = {
  ok: boolean;
  /** Declarado no payload: este harness NÃO tem caminho de escrita — não existe `dry:false`. */
  somente_leitura: true;
  /** Quem foi medido (`agente-classificador` no T1). */
  juiz: string;
  modelo: string;
  /** Quantos especiais têm nota humana no total — o tamanho do test set. */
  total_com_nota: number;
  avaliados: number;
  falhas: { projeto_id: string; motivo: string }[];
  /** De onde vieram os vizinhos desta fatia — vizinho ruim é a 1ª suspeita de MAE alto. */
  vizinhos_de: { pinecone: number; sqlite: number };
  metricas: MetricasConcordancia;
  pares: ParNota[];
  proximo_offset: number | null;
  motivo?: string;
};

/**
 * Mede o juiz contra o gabarito: roda a classificação nos especiais que JÁ têm nota humana e
 * compara. É o T1 do painel de agentes e a régua de qualquer "melhorou" daqui para a frente.
 *
 * ⚠️ **Nada é gravado em `especial_avaliacao`.** O classificador de produção pula de propósito
 * quem tem nota humana (segunda opinião ao lado da nota de gente é ruído no cartão da triagem) —
 * aqui a mesma nota é o GABARITO, e a recomendação vive só no payload da resposta. O único efeito
 * colateral é o cache de embedding (`especial_embedding`), que é o mesmo texto que a produção já
 * embeddaria; nenhuma nota, nenhuma linha do Sheets.
 *
 * ⚠️ **O projeto medido é excluído da própria vizinhança** (`excluirId`), senão ele apareceria
 * como exemplo few-shot da própria nota e o harness mediria a memória, não o julgamento.
 *
 * Paginado e retomável pelo `proximo_offset` (ordem estável por id), porque são ~1 chamada de LLM
 * por projeto e a fatia inteira não cabe numa corrida.
 */
export async function medirConcordanciaAgente(
  opts: { limite?: number; offset?: number; juiz?: JuizConcordancia; rotuloJuiz?: string } = {},
): Promise<ResultadoConcordancia> {
  const limite = Math.max(1, Math.min(opts.limite ?? 15, 40));
  const offset = Math.max(0, opts.offset ?? 0);
  const juiz: JuizConcordancia = opts.juiz ?? classificarEspecial;
  const rotuloJuiz = opts.rotuloJuiz ?? ORIGEM_AGENTE;

  const { linhas } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhas.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  );
  const resumoPorId = new Map(especiais.map((p) => [p.id, p]));

  const avaliacoesRows = await getAvaliacoesEspeciais();
  const avaliacoes = new Map(
    avaliacoesRows.map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );
  const exemplarPorId = mapaExemplares(especiais, avaliacoes);

  // Ordem estável por id: a paginação precisa devolver a MESMA fatia entre corridas.
  const comNota = especiais
    .filter((p) => p.estrelas != null)
    .sort((a, b) => a.id.localeCompare(b.id));
  const fatia = comNota.slice(offset, offset + limite);

  const vazio = medirConcordancia([]);
  if (fatia.length === 0) {
    return {
      ok: true,
      somente_leitura: true,
      juiz: rotuloJuiz,
      modelo: modeloChatConfigurado(),
      total_com_nota: comNota.length,
      avaliados: 0,
      falhas: [],
      vizinhos_de: { pinecone: 0, sqlite: 0 },
      metricas: vazio,
      pares: [],
      proximo_offset: null,
      motivo:
        comNota.length === 0
          ? "nenhum especial tem nota humana — sem gabarito não há o que medir"
          : "offset além do fim do test set",
    };
  }

  // Os exemplares rotulados são as âncoras few-shot; sem vetor deles a vizinhança fica pobre e o
  // harness mediria um agente pior do que o de produção.
  let embeddings = decodificarEmbeddings(await getEmbeddingsEspeciais());
  const rotulados = especiais
    .filter((p) => p.estrelas != null || avaliacoes.has(p.id))
    .map((p) => p.id);
  const idsParaEmbeddar = Array.from(new Set([...fatia.map((c) => c.id), ...rotulados]));
  const ger = await garantirEmbeddings(idsParaEmbeddar, resumoPorId, embeddings, {
    capGeracao: 60,
  });
  embeddings = ger.mapa;
  const corpus = montarCorpus(especiais, avaliacoes, embeddings);
  const corpusFallback = async () => corpus;

  const pares: ParNota[] = [];
  const falhas: { projeto_id: string; motivo: string }[] = [];
  const vizinhos_de = { pinecone: 0, sqlite: 0 };

  for (const alvoResumo of fatia) {
    try {
      const montado = await montarEntradaSemantica(alvoResumo.id, alvoResumo);
      if (!montado) {
        falhas.push({ projeto_id: alvoResumo.id, motivo: "sem contexto" });
        continue;
      }
      const emb = embeddings.get(alvoResumo.id);
      const recuperado = emb
        ? await recuperarVizinhos(emb.vetor, {
            excluirId: alvoResumo.id,
            exemplarPorId,
            corpusFallback,
          })
        : { vizinhos: [] as Vizinho[], origem: "sqlite" as OrigemVizinhos };
      vizinhos_de[recuperado.origem]++;
      const det = funcaoDoMontado(montado.entrada);
      const rec = await juiz(montado.alvo, recuperado.vizinhos, {
        funcao: det.funcao === FUNCAO_INDEFINIDA ? null : det.funcao,
      });
      if (!rec) {
        falhas.push({ projeto_id: alvoResumo.id, motivo: "juiz sem recomendação" });
        continue;
      }
      pares.push({
        projeto_id: alvoResumo.id,
        nome: alvoResumo.nome,
        area: alvoResumo.area,
        humana: alvoResumo.estrelas as number,
        recomendada: rec.estrelas_recomendada,
      });
    } catch (e) {
      falhas.push({
        projeto_id: alvoResumo.id,
        motivo: e instanceof Error ? e.message : "erro",
      });
    }
  }

  return {
    ok: true,
    somente_leitura: true,
    juiz: rotuloJuiz,
    modelo: modeloChatConfigurado(),
    total_com_nota: comNota.length,
    avaliados: pares.length,
    falhas,
    vizinhos_de,
    metricas: medirConcordancia(pares),
    pares,
    proximo_offset: offset + limite < comNota.length ? offset + limite : null,
  };
}

// ─── T2 do painel — roteamento por FUNÇÃO (sem LLM, sem escrita) ───────────────

export type LinhaFuncao = {
  projeto_id: string;
  nome: string | null;
  /** Só para o relatório: é ela que a taxonomia NÃO usa (lição 2), e ver as duas lado a lado prova. */
  area: string | null;
  estrelas: number | null;
  funcao: string;
  rotulo: string;
  origem: FuncaoDetectada["origem"];
  termos: string[];
  empate: boolean;
};

export type ResultadoFuncoes = {
  ok: boolean;
  /** Este roteador é determinístico e read-only: sem LLM, sem `dry`, sem caminho de escrita. */
  somente_leitura: true;
  total_especiais: number;
  analisados: number;
  falhas: { projeto_id: string; motivo: string }[];
  cobertura: CoberturaFuncao;
  /** Cruzamento função × área — a evidência de que a função ATRAVESSA áreas (lição 2). */
  funcao_por_area: { funcao: string; rotulo: string; areas: string[] }[];
  linhas: LinhaFuncao[];
  proximo_offset: number | null;
};

/**
 * Roteia os especiais por FUNÇÃO e mede a cobertura da `TAXONOMIA_FUNCAO` contra a base real (T2).
 *
 * Sem LLM: o roteador é casamento de vocabulário sobre o MESMO texto que vira embedding
 * (`textoParaEmbedding`) — mesma entrada que o classificador vê, então a rota do painel e a
 * vizinhança do RAG falam do mesmo projeto. Os vizinhos do índice entram só como DESEMPATE, e a
 * evidência que se tem deles é `nome + leitura` (o índice não guarda o texto inteiro).
 *
 * ⚠️ **Faz leitura por projeto** (contexto + doc), o que este repo evita em listagem — aqui é
 * aceitável porque a página é LIMITADA (`limite`, teto 60), a rota é de admin e não há LLM no meio;
 * o que não pode é isso virar caminho de request de usuário.
 *
 * ⚠️ Não escreve nada e não dá nota: função é ROTA, não juízo.
 */
export async function rotearEspeciaisPorFuncao(
  opts: { limite?: number; offset?: number } = {},
): Promise<ResultadoFuncoes> {
  const limite = Math.max(1, Math.min(opts.limite ?? 25, 60));
  const offset = Math.max(0, opts.offset ?? 0);

  const { linhas: linhasSheet } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhasSheet.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  ).sort((a, b) => a.id.localeCompare(b.id));

  const avaliacoesRows = await getAvaliacoesEspeciais();
  const avaliacoes = new Map(
    avaliacoesRows.map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );
  const exemplarPorId = mapaExemplares(especiais, avaliacoes);
  const fatia = especiais.slice(offset, offset + limite);

  // Vetores só dos alvos desta página — nada de carregar a tabela inteira (teto de 32 MiB).
  const mapaVetores = decodificarEmbeddings(
    (await Promise.all(fatia.map((p) => getEmbeddingEspecial(p.id)))).filter(
      (r): r is EspecialEmbeddingRow => r != null,
    ),
  );

  const saida: LinhaFuncao[] = [];
  const falhas: { projeto_id: string; motivo: string }[] = [];

  for (const p of fatia) {
    try {
      const montado = await montarEntradaSemantica(p.id, p);
      if (!montado) {
        falhas.push({ projeto_id: p.id, motivo: "sem contexto" });
        continue;
      }
      // Evidência dos vizinhos: o que o índice permite saber deles é nome + leitura.
      const vetor = mapaVetores.get(p.id)?.vetor;
      let evidencias: EvidenciaVizinho[] = [];
      if (vetor) {
        const matches = await consultarVizinhos(vetor, { topK: Math.max(K_VIZINHOS * 3, 12) });
        const vizinhos = matches
          ? vizinhosDeMatches(matches, exemplarPorId, { excluirId: p.id })
          : [];
        evidencias = vizinhos.map((v) => ({
          texto: [v.nome, v.leitura].filter(Boolean).join(" "),
          similaridade: v.similaridade,
        }));
      }
      const det = funcaoDoMontado(montado.entrada, evidencias);
      saida.push({
        projeto_id: p.id,
        nome: p.nome,
        area: p.area,
        estrelas: p.estrelas,
        funcao: det.funcao,
        rotulo: det.rotulo,
        origem: det.origem,
        termos: det.termos,
        empate: det.empate,
      });
    } catch (e) {
      falhas.push({ projeto_id: p.id, motivo: e instanceof Error ? e.message : "erro" });
    }
  }

  const porFuncaoArea = new Map<string, Set<string>>();
  for (const l of saida) {
    if (!l.area) continue;
    const set = porFuncaoArea.get(l.funcao) ?? new Set<string>();
    set.add(l.area);
    porFuncaoArea.set(l.funcao, set);
  }

  return {
    ok: true,
    somente_leitura: true,
    total_especiais: especiais.length,
    analisados: saida.length,
    falhas,
    cobertura: medirCobertura(
      saida.map((l) => ({
        funcao: l.funcao,
        rotulo: l.rotulo,
        origem: l.origem,
        termos: l.termos,
        placar: [],
        empate: l.empate,
      })),
    ),
    funcao_por_area: [...porFuncaoArea.entries()]
      .map(([funcao, areas]) => ({
        funcao,
        rotulo: rotuloFuncao(funcao),
        areas: [...areas].sort(),
      }))
      .sort((a, b) => b.areas.length - a.areas.length),
    linhas: saida,
    proximo_offset: offset + limite < especiais.length ? offset + limite : null,
  };
}

// ─── T6 do painel — orquestração (lentes → calibrador → revisor → gravação) ────

/**
 * Teto de chamadas de LLM por CORRIDA. ⚠️ Não é polimento: o T1 mediu ~10 s por chamada, e uma
 * passada do painel nos 48 especiais a ~8 chamadas cada é ~380 chamadas / ~1 h. O teto + o
 * `proximo_offset` é o que faz a corrida caber numa requisição e retomar de onde parou.
 */
export const TETO_CHAMADAS_PAINEL = 120;

/**
 * Página padrão. Menor que a do classificador de 1 agente de propósito: aqui cada projeto custa
 * `lentes (em paralelo) + até 3 voltas de revisor + 1 redação`, ou seja **~30–50 s de relógio**,
 * não ~10 s.
 */
export const PAGINA_PAINEL = 5;
export const PAGINA_PAINEL_MAX = 12;

export type JulgamentoPainel = {
  projeto_id: string;
  nome: string | null;
  funcao: string;
  /** A nota preliminar das lentes, antes de qualquer piso ou revisão. */
  nota_lentes: number;
  /** Depois dos pisos de prova (por projeto) e do revisor — ainda ANTES da cota da rodada. */
  nota: number;
  contestada: boolean;
  confianca: Confianca;
  avaliacoes: AvaliacaoLente[];
  falhas_lentes: { lente: string; motivo: string }[];
  convergencia: EstadoConvergencia;
  entrada: EntradaCalibragem;
  linha: LinhaCalibrada;
  origem_vizinhos: OrigemVizinhos;
  chamadas: number;
};

export type OpcoesPainelProjeto = {
  lentes?: string[];
  funcao?: string | null;
  /** `false` (default) não gasta chamada de LLM para redigir — a leitura sai determinística. */
  redigirLeitura?: boolean;
};

/**
 * Julga UM especial pelo painel: lentes em paralelo → pisos de prova → revisor adversarial com
 * teto absorvente. **Não aplica a cota da rodada** (ela é cross-projeto) e **não grava nada**.
 *
 * ⚠️ **Uma volta re-roda o REVISOR, não as lentes.** O material do projeto não muda entre voltas —
 * o que muda é o desafio, e quem tem de produzir argumento novo é o desafiante (ele recebe os
 * argumentos já usados e é proibido de repetir). Re-rodar as 4 lentes por volta triplicaria o custo
 * (de ~8 para ~15 chamadas/projeto) sem nova evidência; se o T7 mostrar que faz falta, isso volta
 * como opção medida, não como default silencioso.
 *
 * É esta função que o T7 passa como `juiz` do harness de concordância.
 */
export async function julgarUmEspecialComPainel(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  opts: OpcoesPainelProjeto = {},
): Promise<JulgamentoPainel> {
  let chamadas = 0;

  const r = await avaliarComLentes(alvo, vizinhos, {
    funcao: opts.funcao,
    lentes: opts.lentes,
  });
  chamadas += opts.lentes?.length ?? LENTES.length;

  const entrada = entradaDeConsolidado(alvo.projeto_id, r.avaliacoes, r.consolidado);
  // Pisos de prova ANTES do revisor: não se gasta chamada defendendo nota que a prova já derrubou.
  const soPisos = calibrarRodada([entrada], { aplicarCota: false });
  let linha = soPisos.linhas[0];

  // PISO ESTRUTURAL do revisor: o que o eixo estrutural provou COM NOME não é apagado por uma
  // refutação de altura (ver `EstadoConvergencia.piso` — o caso VERSTA, 8★ humano, fechado em 0★).
  const gateAv = r.avaliacoes.find((a) => a.lente === LENTE_GATE) ?? null;
  const pisoEstrutural = gateAv && gateAv.evidencia === "nomeada" ? gateAv.nota : 0;
  let estado = iniciarConvergencia(linha.nota_depois, pisoEstrutural);
  const argumentos: string[] = [];
  while (podeRevisarDeNovo(estado)) {
    const veredicto = await revisarAdversarial({
      alvo,
      nota: estado.nota,
      avaliacoes: r.avaliacoes,
      vizinhos,
      comoSaiu: explicarCalibragem(linha),
      refutacoesAnteriores: argumentos,
    });
    chamadas++;
    if (veredicto.refutada) argumentos.push(veredicto.motivo);
    estado = aplicarRevisao(estado, veredicto);
  }

  if (estado.nota !== linha.nota_depois) {
    linha = { ...linha, nota_depois: estado.nota };
  }

  return {
    projeto_id: alvo.projeto_id,
    nome: alvo.nome,
    funcao: opts.funcao ?? FUNCAO_INDEFINIDA,
    nota_lentes: r.consolidado.nota_preliminar,
    nota: estado.nota,
    contestada: estado.contestada,
    confianca: confiancaDoPainel(r.avaliacoes, r.consolidado, estado, estado.nota),
    avaliacoes: r.avaliacoes,
    falhas_lentes: r.falhas,
    convergencia: estado,
    entrada: { ...entrada, nota_preliminar: estado.nota },
    linha,
    origem_vizinhos: "pinecone",
    chamadas,
  };
}

export type LinhaPainel = {
  projeto_id: string;
  nome: string | null;
  area: string | null;
  /** A nota humana, quando existe — só para o relatório (o painel nunca a escreve). */
  estrelas_humana: number | null;
  funcao: string;
  nota_lentes: number;
  nota_pos_prova: number;
  /** A nota FINAL: pisos de prova + revisor + cota da rodada. */
  nota: number;
  contestada: boolean;
  confianca: Confianca;
  motivos: MotivoRebaixa[];
  voltas: number;
  encerramento: string;
  leitura: string;
  gravado: boolean;
  /** Havia recomendação de OUTRA origem neste projeto (só acontece com `forcar`). */
  sobrescreveu: boolean;
  eixos: { lente: string; nota: number; evidencia: string }[];
  falhas_lentes: { lente: string; motivo: string }[];
  chamadas: number;
};

export type ResultadoPainel = {
  ok: boolean;
  dry: boolean;
  origem: string;
  modelo: string;
  total_especiais: number;
  candidatos: number;
  julgados: number;
  gravados: number;
  sobrescritos: number;
  chamadas_llm: number;
  teto_chamadas: number;
  /** `true` quando a corrida parou no teto de custo (e não por fim da página). */
  parou_no_teto: boolean;
  vizinhos_de: { pinecone: number; sqlite: number };
  falhas: { projeto_id: string; motivo: string }[];
  calibragem: ResumoCalibragem;
  linhas: LinhaPainel[];
  proximo_offset: number | null;
  motivo?: string;
};

export type OpcoesPainelLote = {
  /** Seco é o PADRÃO — gravar exige `{dry:false}` explícito. */
  dry?: boolean;
  limite?: number;
  offset?: number;
  /** Reavalia quem já tem recomendação/nota humana (é o único caminho que SOBRESCREVE). */
  forcar?: boolean;
  /** Julga só os especiais COM nota humana — o test set do T7. */
  soComNotaHumana?: boolean;
  lentes?: string[];
  /** `false` mede a rodada contra a curva e RELATA sem rebaixar (o regime do T7). */
  aplicarCota?: boolean;
  curva?: Record<string, number>;
  rotuloCurva?: string;
  tetoChamadas?: number;
  redigirLeitura?: boolean;
};

/**
 * Julga UM projeto com o painel de lentes, resolvendo alvo e vizinhos pelo MESMO preparo do
 * classificador de 1 agente (`prepararAlvo`).
 *
 * ⚠️ Existe pelo motivo já documentado no `/classificar`: **a rota de LOTE processa em SÉRIE**, e
 * uma rodada de painel na base inteira em série não termina. Com uma entrada por projeto, a
 * concorrência mora no cliente, onde dá para limitá-la e recuar quando o gateway reclama.
 *
 * ⚠️ **`dry` é o DEFAULT**, como em todo o caminho do painel: gravar exige `{dry:false}`
 * explícito, e mesmo gravando escreve só em `especial_avaliacao`, NUNCA na coluna "Estrelas".
 */
/** Afirmou dependentes e não escapou: vai ao humano, porque a afirmação ficou sem resposta. */
function pendenteDependenteFlag(incs: ReturnType<typeof verificarCoerencia>): boolean {
  return incs.some((i) => i.tipo === "dependente_sem_escape");
}

export async function julgarProjetoComPainel(
  projetoIdBruto: string,
  opts: { dry?: boolean; forcar?: boolean; lentes?: string[] } = {},
): Promise<{
  ok: boolean;
  projeto_id: string;
  motivo?: string;
  julgamento?: JulgamentoPainel;
  /** A nota do run 1, que é o ponto de partida — fica visível para o ajuste ser auditável. */
  base?: { nota: number; leitura: string };
  /** O porquê final, já composto e verificado — é o que vai ao banco e à tela. */
  leitura?: string;
  ajuste?: AjustePainel;
  /** O que a verificação de coerência achou. Vazio = texto e nota dizem a mesma coisa. */
  incoerencias?: string[];
  escape?: { nota: number; leitura: string; evidencias: Record<string, string> } | null;
  gravado?: boolean;
}> {
  const projetoId = chaveProjeto(projetoIdBruto);
  const dry = opts.dry ?? true;
  const pronto = await prepararAlvo(projetoId, { forcar: opts.forcar });
  if ("motivo" in pronto) return { ok: pronto.ok, projeto_id: projetoId, motivo: pronto.motivo };

  // ── A BASE É O RUN 1. O TIME AJUSTA FINO EM CIMA DELA. ──────────────────────────────────
  //
  // ⚠️ Desenho refeito em 03/09/2026 depois de MEDIR, e a medição é o argumento inteiro. Com o
  // painel decidindo sozinho, o PIAPP saiu **2, 5, 3, 7, 8 e 3** em seis chamadas idênticas, mesmo
  // código e mesma entrada. As lentes até que variavam pouco; o que explodia era o resultado,
  // porque a nota consolidada caía num degrau (encostar ou não no teto decidia se o escape era
  // sequer perguntado) e um eixo oscilando 2 movia a nota final em 5 estrelas.
  //
  // Cinco chamadas de LLM não são cinco medidas do mesmo número: consolidar por mínimo e máximo
  // AMPLIFICA a variação em vez de diluí-la, ao contrário de uma média (que este painel evita de
  // propósito, e por bons motivos, ver `consolidarLentes`).
  //
  // Então a arquitetura passa a ser a que o produto pediu: o classificador de 1 agente dá a NOTA
  // BASE, que é a de sempre, com o escape que já funciona; as lentes entram para **ajustar fino**
  // e, principalmente, para melhorar o PORQUÊ, que é o ganho real de ter cinco olhares. O ajuste é
  // limitado a `AJUSTE_MAX_PAINEL`: acima disso não é calibragem, é outro juiz.
  const base = await classificarEspecial(pronto.alvo, pronto.vizinhos);
  if (!base) return { ok: false, projeto_id: projetoId, motivo: "LLM não devolveu recomendação utilizável" };

  const julgamento = await julgarUmEspecialComPainel(pronto.alvo, pronto.vizinhos, {
    lentes: opts.lentes,
  });

  const pisoNomeado = julgamento.avaliacoes.find((a) => a.piso != null)?.piso ?? null;
  const ajustada = ajustarNotaComPainel(base.estrelas_recomendada, {
    nota_lentes: julgamento.nota_lentes,
    piso: pisoNomeado,
  });
  const notaFinal = ajustada.nota;
  // O PORQUÊ é o ganho real de ter cinco olhares: a base explica o projeto, e as lentes dizem em
  // que eixo ele para. Sem isto o time custaria cinco chamadas para devolver o mesmo texto.
  const porEixo = julgamento.avaliacoes
    .slice()
    .sort((a, b) => b.nota - a.nota)
    .map((a) => `${lentePorChave(a.lente)?.rotulo ?? a.lente} ${a.nota}`)
    .join(", ");
  // ⚠️ Quando o time MOVE a nota, o veredito vem PRIMEIRO. A leitura da base foi escrita para
  // defender a nota DELA, e ela diz isso em letras ("Fica em 5★"). Deixá-la abrindo o texto sob
  // um título que diz 4 faz a justificativa contradizer o número — medido na run 5, e é
  // exatamente o que faz a triagem desconfiar do resto. Quando nada se moveu, a base abre
  // normalmente: não há contradição a desfazer.
  // ⚠️ Quando a nota MUDA, o texto da base é DESCARTADO, não reordenado.
  //
  // Ele foi escrito para defender a nota DELE e diz isso em letras ("Fica em 5★"). Reordenar não
  // resolve: a frase contraditória continua lá dentro, e foi por isso que a run 5 ainda saiu com
  // 39% de leituras que contradizem a própria nota (contra 3% do agente sozinho). No lugar dele
  // entram as justificativas das LENTES, que falam por eixo e não cravam número global — que é,
  // afinal, o que o time tem de melhor a dizer.
  const justificativaDasLentes = julgamento.avaliacoes
    .slice()
    .sort((a, b) => b.nota - a.nota)
    .map((a) => a.justificativa)
    .filter((t) => t && t.length > 20)
    .slice(0, 2)
    .join(" ");
  const leituraCrua =
    ajustada.delta !== 0
      ? [`Nota ${notaFinal}: ${ajustada.motivo}.`, justificativaDasLentes, `Por eixo: ${porEixo}.`]
          .filter(Boolean)
          .join(" ")
      : [base.leitura, `Por eixo: ${porEixo}.`].join(" ");

  // Rede final, em CÓDIGO: nenhuma frase que crave um número diferente do veredito sobrevive.
  // As quatro etapas de verificação do time (lentes, consolidação, revisor, consenso) não olham
  // para isto — o revisor ataca a ALTURA da nota, o consenso mede divergência entre eixos.
  const incoerencias = verificarCoerencia(leituraCrua, notaFinal, TETO_AGENTE, pronto.nomesDaBase);
  const semNumeroErrado = incoerencias.some((i) => i.tipo === "numero_divergente")
    ? removerNumerosDivergentes(leituraCrua, notaFinal)
    : leituraCrua;

  // ⚠️ A pendência do DEPENDENTE tem consequência, não é carimbo.
  //
  // Quando o texto afirma que outros projetos dependem deste e a nota não escapou, o agente
  // escreveu a prova do escape e não a usou. São 60 casos na run 5, e é o caso PIAPP. Aqui isso
  // vira duas coisas concretas: a pendência aparece ESCRITA para quem lê, e o projeto passa a
  // ir ao comitê (`contestada`), que é a rota de quem precisa de olho humano.
  //
  // ⚠️ NÃO promove a nota sozinho. Entrar na faixa 6-10 exige as duas citações e é decisão do
  // comitê; o que não pode é a afirmação morrer sem ninguém responder a ela.
  const pendenteDependente = incoerencias.find((i) => i.tipo === "dependente_sem_escape");
  const leitura = pendenteDependente
    ? `${semNumeroErrado} ⚠ Conferir: o texto diz que «${pendenteDependente.tipo === "dependente_sem_escape" ? pendenteDependente.nomeado : ""}» depende deste projeto, e a nota ficou em ${notaFinal}. Um dependente nomeado é a prova da faixa 6-10, mas não a garante sozinho: ou faltam as duas citações, ou a dependência não sustenta a faixa.`
    : semNumeroErrado;

  const contestada =
    ehEscape(notaFinal) || base.contestada || julgamento.contestada || pendenteDependente != null;

  // ⚠️ A confiança gravada é a do CONSENSO, não a que o painel declarou sozinho: se as lentes
  // divergiram entre si, ou se a base e elas discordaram, a nota sai com a certeza que ela de
  // fato tem. É o que permite construir um limiar em cima dela mais tarde.
  const confianca = confiancaPorConsenso(julgamento.confianca, {
    notasDasLentes: julgamento.avaliacoes.map((a) => a.nota),
    deltaAjuste: ajustada.delta,
  });

  let gravado = false;
  if (!dry) {
    await upsertAvaliacaoEspecial({
      projeto_id: projetoId,
      estrelas_recomendada: notaFinal,
      confianca,
      leitura,
      contestada,
      origem: ORIGEM_PAINEL,
      modelo: modeloChatConfigurado(),
    });
    gravado = true;
  }
  return {
    ok: true,
    projeto_id: projetoId,
    // ⚠️ A pendência sai no resultado em vez de morrer: "o texto afirma que outros dependem
    // deste projeto e a nota não escapou" é justamente o caso PIAPP, e são 60 na run 5.
    // ⚠️ A leitura COMPOSTA sai na resposta. Sem isso o relatório da rodada só via a leitura da
    // BASE e media a versão que a correção existe para substituir — foi assim que eu concluí
    // que o conserto de coerência falhara, quando na verdade eu olhava outro campo.
    leitura,
    incoerencias: incoerencias.map((i) =>
      i.tipo === "numero_divergente"
        ? `texto cravava ${i.noTexto}`
        : `nomeia «${i.nomeado}» como dependente ("${i.pista}") e não escapou`,
    ),
    julgamento: { ...julgamento, nota: notaFinal, contestada, confianca },
    base: { nota: base.estrelas_recomendada, leitura: base.leitura },
    ajuste: ajustada,
    escape: ehEscape(notaFinal) ? { nota: notaFinal, leitura, evidencias: base.evidencias } : null,
    gravado,
  };
}

/**
 * O painel em LOTE (T6). Três fases, nesta ordem:
 * 1. **por projeto**: lentes → pisos de prova → revisor (`julgarUmEspecialComPainel`);
 * 2. **por rodada**: `calibrarRodada` sobre as notas que saíram do revisor — a cota é cross-projeto
 *    e só faz sentido com a página inteira em mãos;
 * 3. **gravação**: `especial_avaliacao` com `origem: 'painel-agentes'`, se `dry` for `false`.
 *
 * ⚠️ **BATCH, jamais pós-submissão** (decisão 6 do plano): 30–50 s por projeto não cabe num
 * request de usuário. ⚠️ **`dry` é o default** e nada é gravado sem `{dry:false}`. ⚠️ **Nunca
 * lança** — falha de projeto vira linha em `falhas` e a corrida segue. ⚠️ **Nunca escreve a coluna
 * "Estrelas"** nem toca o Sheets.
 *
 * Paginado por `offset`/`limite` (ordem estável por id) e limitado por `tetoChamadas`: batendo o
 * teto, para e devolve `proximo_offset` no projeto em que parou — a corrida seguinte continua dali.
 */
export async function julgarEspeciaisComPainel(
  opts: OpcoesPainelLote = {},
): Promise<ResultadoPainel> {
  const dry = opts.dry ?? true;
  const limite = Math.max(1, Math.min(opts.limite ?? PAGINA_PAINEL, PAGINA_PAINEL_MAX));
  const offset = Math.max(0, opts.offset ?? 0);
  const teto = Math.max(8, opts.tetoChamadas ?? TETO_CHAMADAS_PAINEL);
  const modelo = modeloChatConfigurado();

  const { linhas: linhasSheet } = await lerResumosEspelho();
  const especiais = apenasEspeciais(
    linhasSheet.map(mapResumo).filter((p): p is ProjetoDashboardResumo => p != null),
  ).sort((a, b) => a.id.localeCompare(b.id));
  const resumoPorId = new Map(especiais.map((p) => [p.id, p]));

  const avaliacoesRows = await getAvaliacoesEspeciais();
  const origemPorId = new Map(avaliacoesRows.map((a) => [a.projeto_id, a.origem]));
  const avaliacoes = new Map(
    avaliacoesRows.map((a) => [
      a.projeto_id,
      { estrelas_recomendada: a.estrelas_recomendada, leitura: a.leitura },
    ]),
  );
  const exemplarPorId = mapaExemplares(especiais, avaliacoes);

  // Quem entra: por padrão os especiais SEM recomendação e SEM nota humana (a mesma régua do
  // classificador — nota de gente é verdade e âncora). `soComNotaHumana` inverte para o test set do
  // T7; `forcar` abre tudo (e é o único caminho que sobrescreve recomendação de outra origem).
  const universo = opts.soComNotaHumana
    ? especiais.filter((p) => p.estrelas != null)
    : especiais.filter((p) => opts.forcar || (!origemPorId.has(p.id) && p.estrelas == null));
  const fatia = universo.slice(offset, offset + limite);

  const vazio: ResumoCalibragem = calibrarRodada([], {
    curva: opts.curva,
    rotuloCurva: opts.rotuloCurva,
    aplicarCota: opts.aplicarCota,
  }).resumo;

  if (fatia.length === 0) {
    return {
      ok: true,
      dry,
      origem: ORIGEM_PAINEL,
      modelo,
      total_especiais: especiais.length,
      candidatos: universo.length,
      julgados: 0,
      gravados: 0,
      sobrescritos: 0,
      chamadas_llm: 0,
      teto_chamadas: teto,
      parou_no_teto: false,
      vizinhos_de: { pinecone: 0, sqlite: 0 },
      falhas: [],
      calibragem: vazio,
      linhas: [],
      proximo_offset: null,
      motivo:
        universo.length === 0
          ? "nenhum especial elegível para o painel"
          : "offset além do fim da lista",
    };
  }

  // Memória: embeddings dos alvos + dos exemplares rotulados, para a vizinhança ter contra o que
  // comparar. Mesmo caminho do classificador (o corpus do fallback é um thunk preguiçoso).
  let embeddings = decodificarEmbeddings(await getEmbeddingsEspeciais());
  const rotulados = especiais
    .filter((p) => p.estrelas != null || origemPorId.has(p.id))
    .map((p) => p.id);
  const idsParaEmbeddar = Array.from(new Set([...fatia.map((c) => c.id), ...rotulados]));
  const ger = await garantirEmbeddings(idsParaEmbeddar, resumoPorId, embeddings, {
    capGeracao: 60,
  });
  embeddings = ger.mapa;
  const corpus = montarCorpus(especiais, avaliacoes, embeddings);
  const corpusFallback = async () => corpus;

  const falhas: { projeto_id: string; motivo: string }[] = [];
  const vizinhos_de = { pinecone: 0, sqlite: 0 };
  const julgamentos: JulgamentoPainel[] = [];
  let chamadas = 0;
  let parou_no_teto = false;
  let consumidos = 0;

  // Custo máximo de UM projeto: as lentes + o teto de voltas do revisor + a redação (se ligada).
  const custoPorProjeto =
    (opts.lentes?.length ?? LENTES.length) + TETO_VOLTAS + (opts.redigirLeitura ? 1 : 0);

  for (const cand of fatia) {
    if (chamadas + custoPorProjeto > teto) {
      parou_no_teto = true;
      break;
    }
    consumidos++;
    try {
      const montado = await montarEntradaSemantica(cand.id, cand);
      if (!montado) {
        falhas.push({ projeto_id: cand.id, motivo: "sem contexto" });
        continue;
      }
      const emb = embeddings.get(cand.id);
      const recuperado = emb
        ? await recuperarVizinhos(emb.vetor, {
            excluirId: cand.id,
            exemplarPorId,
            corpusFallback,
          })
        : { vizinhos: [] as Vizinho[], origem: "sqlite" as OrigemVizinhos };
      vizinhos_de[recuperado.origem]++;

      // Função (T2): determinística, sem LLM — entra no prompt das lentes como CONTEXTO.
      const det = funcaoDoMontado(montado.entrada);

      const j = await julgarUmEspecialComPainel(montado.alvo, recuperado.vizinhos, {
        lentes: opts.lentes,
        funcao: det.funcao === FUNCAO_INDEFINIDA ? null : det.funcao,
        redigirLeitura: opts.redigirLeitura,
      });
      chamadas += j.chamadas;
      julgamentos.push({ ...j, origem_vizinhos: recuperado.origem });
    } catch (e) {
      falhas.push({ projeto_id: cand.id, motivo: e instanceof Error ? e.message : "erro" });
    }
  }

  // Fase 2 — a cota da RODADA, sobre as notas que saíram do revisor.
  const calibrada = calibrarRodada(
    julgamentos.map((j) => j.entrada),
    { curva: opts.curva, rotuloCurva: opts.rotuloCurva, aplicarCota: opts.aplicarCota },
  );
  const porId = new Map(calibrada.linhas.map((l) => [l.projeto_id, l]));

  // Fase 3 — leitura e gravação.
  const linhas: LinhaPainel[] = [];
  let gravados = 0;
  let sobrescritos = 0;

  for (const j of julgamentos) {
    const linhaFinal = porId.get(j.projeto_id) ?? j.linha;
    const refutacao = [...j.convergencia.historico].reverse().find((h) => h.refutada)?.motivo;
    let leitura = leituraDoPainel({
      linha: linhaFinal,
      avaliacoes: j.avaliacoes,
      estado: j.convergencia,
      refutacao,
    });
    if (opts.redigirLeitura && chamadas + 1 <= teto) {
      leitura = await redigirLeituraCalibrada({
        nome: j.nome,
        linha: linhaFinal,
        avaliacoes: j.avaliacoes,
        resumo: {
          total: calibrada.resumo.total,
          curva_referencia: calibrada.resumo.curva_referencia,
          mais_generosa: calibrada.resumo.mais_generosa,
        },
      });
      chamadas++;
    }

    const origemAnterior = origemPorId.get(j.projeto_id);
    const sobrescreveu = origemAnterior != null && origemAnterior !== ORIGEM_PAINEL;
    if (!dry) {
      await upsertAvaliacaoEspecial({
        projeto_id: j.projeto_id,
        estrelas_recomendada: linhaFinal.nota_depois,
        confianca: j.confianca,
        leitura,
        contestada: j.contestada,
        origem: ORIGEM_PAINEL,
        modelo,
      });
      gravados++;
      if (sobrescreveu) sobrescritos++;
    }

    const resumo = resumoPorId.get(j.projeto_id);
    linhas.push({
      projeto_id: j.projeto_id,
      nome: j.nome,
      area: resumo?.area ?? null,
      estrelas_humana: resumo?.estrelas ?? null,
      funcao: j.funcao,
      nota_lentes: j.nota_lentes,
      nota_pos_prova: j.linha.nota_depois,
      nota: linhaFinal.nota_depois,
      contestada: j.contestada,
      confianca: j.confianca,
      motivos: linhaFinal.motivos,
      voltas: j.convergencia.volta,
      encerramento: explicarConvergencia(j.convergencia),
      leitura,
      gravado: !dry,
      sobrescreveu,
      eixos: j.avaliacoes.map((a) => ({
        lente: a.lente,
        nota: a.nota,
        evidencia: a.evidencia,
      })),
      falhas_lentes: j.falhas_lentes,
      chamadas: j.chamadas,
    });
  }

  // Onde a próxima corrida começa: no projeto em que esta parou (teto) ou depois da página.
  const proximo = offset + consumidos;

  return {
    ok: true,
    dry,
    origem: ORIGEM_PAINEL,
    modelo,
    total_especiais: especiais.length,
    candidatos: universo.length,
    julgados: julgamentos.length,
    gravados,
    sobrescritos,
    chamadas_llm: chamadas,
    teto_chamadas: teto,
    parou_no_teto,
    vizinhos_de,
    falhas,
    calibragem: calibrada.resumo,
    linhas,
    proximo_offset: proximo < universo.length ? proximo : null,
  };
}

// ─── T7 do painel — medir o PAINEL no MESMO harness do T1 ──────────────────────

/** Rótulo do juiz-painel no relatório de concordância (o do agente único é `ORIGEM_AGENTE`). */
export const JUIZ_PAINEL = "painel-agentes";

/**
 * Página padrão da medição do painel. ⚠️ Menor que a do agente único (15) porque aqui cada projeto
 * custa ~7 chamadas e **até ~40 s de relógio** (lentes em paralelo + até 3 voltas de revisor
 * SEQUENCIAIS): 12 projetos numa requisição passariam de 8 minutos.
 */
export const PAGINA_CONCORDANCIA_PAINEL = 5;

/**
 * Mede o PAINEL contra as notas HUMANAS, no MESMO harness do T1 — é a trava de subida do plano.
 *
 * ⚠️ **É fiação, não juiz novo:** o painel entra como `opts.juiz` de `medirConcordanciaAgente`, que
 * já monta o alvo, recupera a vizinhança (excluindo o próprio projeto), deriva a FUNÇÃO pelo mesmo
 * recipe do lote e calcula MAE / ±1 / matriz / `erro_por_nota`. Nada é gravado — o harness não tem
 * caminho de escrita.
 *
 * ⚠️ **A cota da rodada NÃO se aplica aqui, e isso é decisão, não esquecimento:** a curva de
 * referência dos especiais é a distribuição das MESMAS 48 notas que servem de gabarito, então usá-la
 * para rebaixar notas na medição seria calibrar contra o gabarito (vazamento). O que roda por
 * projeto são os **pisos de prova** (que não olham a rodada) e o **revisor**.
 */
export async function medirConcordanciaPainel(
  opts: { limite?: number; offset?: number; lentes?: string[] } = {},
): Promise<ResultadoConcordancia> {
  const juiz: JuizConcordancia = (alvo, vizinhos, extra) =>
    julgarUmEspecialComPainel(alvo, vizinhos, {
      lentes: opts.lentes,
      funcao: extra?.funcao,
    }).then((j) => ({ estrelas_recomendada: j.nota }));

  return medirConcordanciaAgente({
    limite: Math.min(opts.limite ?? PAGINA_CONCORDANCIA_PAINEL, PAGINA_PAINEL_MAX),
    offset: opts.offset,
    juiz,
    rotuloJuiz: JUIZ_PAINEL,
  });
}
