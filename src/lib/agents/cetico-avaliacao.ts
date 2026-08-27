/**
 * Especialista CÉTICO / adversarial do time autônomo de avaliação (fatia C) — PURO.
 *
 * A rede anti-bajulação da mesa: recebe o veredito PRELIMINAR do agregador + os votos dos outros
 * especialistas e **tenta REFUTAR uma aprovação** — vota para derrubar, nunca para endossar. Se a
 * mesa quer AUTO-APROVAR, o cético procura o motivo de NÃO confiar; se acha, refuta e a decisão
 * cai para a fila humana (via `conciliarComCetico`, `deliberacao.ts`). A `confianca` devolvida é o
 * LASTRO da refutação — quão seguro o cético está de que aquilo não devia passar sozinho.
 *
 * Regra de ouro (anti-bajulação): o cético SÓ desafia um `aprovar`. `em_validacao`/`isento` já vão
 * (ou não vão) ao humano — não há aprovação a derrubar, então ele fica neutro (`refuta:false`). E
 * ele NUNCA produz um caminho que aumente a aprovação (não existe "o cético endossou").
 *
 * Irmão puro de `avaliarPlausibilidadeFTE`/`avaliarFinanceiro`/`agregarVotos`: testável, sem LLM.
 */

export type ResultadoCetico = {
  /** Vota para DERRUBAR a aprovação (só true quando o preliminar é `aprovar` e há condição-limite). */
  refuta: boolean;
  /** 0..1 — lastro da refutação (0 quando não refuta; cresce com o nº de sinais). */
  confianca: number;
  /** Motivo legível ao humano — null quando não refuta. */
  motivo: string | null;
  /** Condições-limite detectadas (auditoria). */
  sinais: string[];
};

/** Teto de FTE por pessoa (mesma régua do detector de plausibilidade). */
const FATOR_PADRAO = 1.5;
/** Fração do teto de FTE a partir da qual já é "raspando" (suspeito, mesmo sem estourar). */
const FRACAO_RASPANDO = 0.8;
/** Vizinhos mínimos para o apoio do RAG não ser marginal. */
const MIN_VIZINHOS_PADRAO = 2;
/** Similaridade mínima do apoio do RAG. */
const PISO_APOIO_PADRAO = 0.5;
/** Margem acima do piso abaixo da qual a similaridade ainda é "raspando". */
const MARGEM_SIM = 0.1;

function num(v: number | null | undefined, fallback: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/**
 * Vota adversarialmente sobre um veredito preliminar. PURA. Só desafia `aprovar`; produz um sinal
 * por condição-limite e refuta se houver ≥1. Confiança = min(1, nº de sinais × 0,3).
 */
export function avaliarCetico(input: {
  agregadoVeredito: 'aprovar' | 'em_validacao' | 'isento';
  fte: { implausivel: boolean; fte: number; pessoas: number };
  financeiro: { veredito: 'ok' | 'atencao' | 'inconclusivo'; confianca: number };
  rag: { apoio: boolean; confianca: number; vizinhos: number; topSimilaridade: number };
  fator?: number | null;
  minVizinhos?: number | null;
  pisoApoio?: number | null;
}): ResultadoCetico {
  // Anti-bajulação: sem aprovação a derrubar, o cético é neutro (confiança máxima na abstenção).
  if (input.agregadoVeredito !== 'aprovar') {
    return { refuta: false, confianca: 1, motivo: null, sinais: [] };
  }

  const fator = num(input.fator, FATOR_PADRAO);
  const minVizinhos = num(input.minVizinhos, MIN_VIZINHOS_PADRAO);
  const pisoApoio = num(input.pisoApoio, PISO_APOIO_PADRAO);

  const sinais: string[] = [];

  // 1. FTE raspando o teto por pessoa — não estourou (senão nem chegaria a `aprovar`), mas passa
  //    de FRACAO_RASPANDO do teto: número apertado demais para auto-aprovar.
  const pessoas = input.fte.pessoas >= 1 ? input.fte.pessoas : 1;
  const tetoRaspando = pessoas * fator * FRACAO_RASPANDO;
  if (!input.fte.implausivel && input.fte.fte > tetoRaspando) {
    const fteTxt = input.fte.fte.toFixed(1).replace('.', ',');
    sinais.push(
      `FTE de ~${fteTxt} por ${pessoas === 1 ? 'pessoa' : `${pessoas} pessoas`} está no limite do plausível — vale conferência humana.`,
    );
  }

  // 2. Financeiro sem evidência clara (inconclusivo) ou com red flag (atencao) sendo aprovado.
  if (input.financeiro.veredito !== 'ok') {
    sinais.push(
      'Aprovação sem sinal financeiro sólido (dados inconclusivos ou com ressalva) — pede um segundo olhar.',
    );
  }

  // 3. Apoio do RAG marginal: apoiou, mas com poucos vizinhos OU similaridade raspando o piso.
  const ragMarginal =
    input.rag.apoio &&
    (input.rag.vizinhos <= minVizinhos || input.rag.topSimilaridade < pisoApoio + MARGEM_SIM);
  if (ragMarginal) {
    sinais.push(
      'Apoio de projetos aprovados semelhantes é fraco (poucos vizinhos ou similaridade baixa) — conferir.',
    );
  }

  const refuta = sinais.length > 0;
  const confianca = Math.max(0, Math.min(1, sinais.length * 0.3));
  const motivo = refuta ? sinais.join(' ') : null;

  return { refuta, confianca, motivo, sinais };
}
