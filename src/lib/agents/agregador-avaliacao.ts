/**
 * AGREGADOR / juiz do time autônomo de avaliação (fatia B) — PURO, irmão de
 * `decidirStatusSubmissao`. Concilia os votos dos especialistas:
 *   • Plausibilidade/FTE (`avaliarPlausibilidadeFTE`, já existente da fatia A),
 *   • Financeiro (`avaliarFinanceiro`),
 *   • sinal do RAG por corpus de aprovados (`avaliarSinalRag`, aqui).
 *
 * Regra de ouro (o pedido do dono): **confiança baixa OU divergência → `em_validacao`** (fila
 * humana). O agregador **NUNCA decide sozinho** um desfecho negativo — só há dois caminhos,
 * `aprovar` (todos os votos confiantes e concordes) ou `em_validacao` (qualquer dúvida) — e
 * **especial/liderança são ISENTOS** (herdam a validação 100% humana).
 *
 * ⚠️ MODO SOMBRA (fatia B): esta função só PRODUZ a recomendação. Nada aqui muda o status do
 * projeto — quem registra é `avaliacao-normais.functions.ts`, na tabela `projeto_avaliacao`.
 */
import type { ResultadoPlausibilidadeFTE } from './analyzer';
import type { ResultadoFinanceiro } from './avaliacao-financeira';

// ─── Sinal do RAG (vizinhos aprovados) ──────────────────────────────────────

/** Similaridade mínima do vizinho mais próximo para o RAG "apoiar" a aprovação. */
export const PISO_APOIO_RAG = 0.5;
/** Quantos vizinhos aprovados próximos são precisos para o apoio contar. */
export const MIN_VIZINHOS_APOIO = 2;

export type SinalRag = {
  /** Há vizinhos aprovados próximos o suficiente para apoiar a aprovação. */
  apoio: boolean;
  /** 0..1 — confiança do sinal (apoio forte alto; sem/poucos vizinhos, baixo). */
  confianca: number;
  /** Quantos vizinhos entraram no cálculo. */
  vizinhos: number;
  /** Maior similaridade entre os vizinhos (0 quando não há nenhum). */
  topSimilaridade: number;
  /** Motivo legível — null quando há apoio. */
  motivo: string | null;
};

/**
 * Deriva o sinal do RAG a partir dos vizinhos APROVADOS recuperados (cada um com sua
 * similaridade). Muitos e próximos → apoio (projeto se parece com o que a triagem já aprovou);
 * poucos/nenhum → sem apoio, confiança baixa (empurra para a fila humana). PURA.
 */
export function avaliarSinalRag(
  vizinhos: { similaridade: number }[],
  opts: { pisoApoio?: number; minVizinhos?: number } = {},
): SinalRag {
  const piso =
    typeof opts.pisoApoio === 'number' && isFinite(opts.pisoApoio) ? opts.pisoApoio : PISO_APOIO_RAG;
  const minV =
    typeof opts.minVizinhos === 'number' && isFinite(opts.minVizinhos)
      ? opts.minVizinhos
      : MIN_VIZINHOS_APOIO;

  const n = vizinhos.length;
  const top = n > 0 ? Math.max(...vizinhos.map((v) => v.similaridade)) : 0;
  const apoio = n >= minV && top >= piso;
  const confianca = apoio ? 0.85 : n === 0 ? 0.4 : 0.55;
  const motivo = apoio
    ? null
    : n === 0
      ? 'Nenhum projeto aprovado semelhante no corpus — recomendo conferência humana.'
      : 'Poucos projetos aprovados semelhantes — sinal fraco, recomendo conferência humana.';

  return { apoio, confianca, vizinhos: n, topSimilaridade: top, motivo };
}

// ─── Agregação dos votos ─────────────────────────────────────────────────────

/** Limiar de confiança abaixo do qual a decisão vira humana (`em_validacao`). */
export const LIMIAR_CONFIANCA_AGREGADOR = 0.6;

export type VeredictoAgregado = 'aprovar' | 'em_validacao' | 'isento';

export type ResultadoAgregado = {
  /** 'aprovar' (todos confiantes/concordes), 'em_validacao' (dúvida) ou 'isento' (especial/liderança). */
  veredito: VeredictoAgregado;
  /** 0..1 — confiança agregada (o elo mais fraco entre os votos). */
  confianca: number;
  /** Recomenda enfileirar para a triagem humana. */
  aplicarEmValidacao: boolean;
  /** Os votos apontam para direções diferentes (uns ok, outros problema). */
  divergencia: boolean;
  /** Especial/liderança — a avaliação automática não se aplica. */
  isento: boolean;
  /** Razões legíveis do desfecho. */
  motivos: string[];
};

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Concilia os três votos + confiança. **Nunca** devolve um veredito negativo automático:
 * só `aprovar`, `em_validacao` ou `isento`. Baixa confiança OU divergência → `em_validacao`.
 */
export function agregarVotos(input: {
  fte: ResultadoPlausibilidadeFTE;
  financeiro: ResultadoFinanceiro;
  rag: SinalRag;
  especial?: boolean | null;
  fluxoDireto?: boolean | null;
  limiarConfianca?: number | null;
}): ResultadoAgregado {
  // Especial e liderança: a decisão é 100% humana (herda a isenção da régua de elegibilidade).
  if (input.especial === true || input.fluxoDireto === true) {
    return {
      veredito: 'isento',
      confianca: 1,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: true,
      motivos: [
        'Projeto especial ou de liderança — avaliação automática não se aplica (validação humana).',
      ],
    };
  }

  const limiar =
    typeof input.limiarConfianca === 'number' &&
    isFinite(input.limiarConfianca) &&
    input.limiarConfianca > 0
      ? input.limiarConfianca
      : LIMIAR_CONFIANCA_AGREGADOR;

  // Confiança por voto: FTE implausível derruba forte; os outros trazem a própria confiança.
  const confFte = input.fte.implausivel ? 0.2 : 0.9;
  const confFin = clamp01(input.financeiro.confianca);
  const confRag = clamp01(input.rag.confianca);
  const confianca = Math.min(confFte, confFin, confRag);

  const fteOk = !input.fte.implausivel;
  const finOk = input.financeiro.veredito === 'ok';
  const ragOk = input.rag.apoio;
  const problemas = [!fteOk, !finOk, !ragOk].filter(Boolean).length;
  const oks = [fteOk, finOk, ragOk].filter(Boolean).length;
  const divergencia = problemas > 0 && oks > 0;

  const aplicarEmValidacao = confianca < limiar || divergencia;
  const veredito: VeredictoAgregado = aplicarEmValidacao ? 'em_validacao' : 'aprovar';

  const motivos: string[] = [];
  if (input.fte.implausivel && input.fte.motivo) motivos.push(input.fte.motivo);
  if (!finOk && input.financeiro.motivo) motivos.push(input.financeiro.motivo);
  if (!ragOk && input.rag.motivo) motivos.push(input.rag.motivo);
  if (divergencia) {
    motivos.push('Sinais divergentes entre os especialistas — enviado à triagem humana.');
  }
  if (motivos.length === 0) {
    motivos.push('Saving plausível, financeiro coerente e semelhante a projetos já aprovados.');
  }

  return {
    veredito,
    confianca: clamp01(confianca),
    aplicarEmValidacao,
    divergencia,
    isento: false,
    motivos,
  };
}
