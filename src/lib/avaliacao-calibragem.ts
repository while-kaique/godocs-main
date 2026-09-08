/**
 * CALIBRAGEM da confiança do time de avaliação — módulo PURO.
 *
 * ## Por que existe
 * A confiança que a mesa exibia era **o placar da votação**, não uma medida: com 4 especialistas
 * fixos, `concordanciaDirecional` só pode valer 0,5 · 0,75 · 1,0 e a `confiancaMedia` é
 * auto-declaração do LLM colada em 0,85-0,95 (`agregador-avaliacao.ts`). Daí os "71% quando está
 * boa" (3-1 × 0,95) e os "40 e poucos" (2-2 × 0,85) que se repetiam sem faixa intermediária —
 * dois dígitos significativos exibidos como se fossem medição. A outra metade do repo já sabia
 * disso: `estrelas-regua.ts` registra que "confiança que sai de julgamento do LLM não é
 * auditável" e por isso declara confiança por SINAIS, calibrada de verdade.
 *
 * ## O que este módulo faz
 * O dado para calibrar **já estava no banco**: `avaliacao_retroativa` grava `grau` (a faixa) ao
 * lado do `resultado` (acerto/conservador/erro grave), e a coluna `grau` **nunca era lida de
 * volta** — `agregarAcuracia` mede taxa GLOBAL. Aqui a taxa passa a ser por FAIXA, que é o que
 * transforma "confiança 71%" em "nesta faixa o time bate com a triagem em 8 de 10, sobre 124
 * casos" (INV-18: confiança exibida é frequência MEDIDA ou nada).
 *
 * ⚠️ **Faixa com amostra pequena não exibe número.** Abaixo de `MIN_AMOSTRA_FAIXA` a taxa é
 * `null` e a UI diz que ainda não há medição — nunca 0%, que se leria como "erra sempre".
 * ⚠️ Nada aqui muda status, limiar ou aritmética de confiança: é MEDIÇÃO e EXIBIÇÃO.
 */
import type { ResultadoComparacao } from '@/lib/avaliacao-retroativa';
import type { Confianca } from '@/lib/especiais-regua';

/** As faixas exibíveis: os 3 graus + o balde de quem foi medido sem grau gravado (legado). */
export type FaixaConfianca = Confianca | 'sem_grau';

/** Ordem de leitura das faixas (alta primeiro — é a que autoriza agir sozinho). */
export const FAIXAS_CONFIANCA: readonly FaixaConfianca[] = ['alta', 'media', 'baixa', 'sem_grau'];

/**
 * Amostra mínima para uma faixa exibir taxa.
 *
 * ⚠️ Escolhido pelo que UM caso move: com 20 medições cada projeto vale 5 pontos percentuais, o
 * limite em que "bate 8 de 10" ainda descreve a faixa em vez de descrever o último projeto medido.
 * Abaixo disso a tela diria um número que muda de cara a cada corrida do cron — que é exatamente
 * o defeito que este módulo existe para corrigir. Não é meta estatística: é o piso da honestidade
 * da frase exibida.
 */
export const MIN_AMOSTRA_FAIXA = 20;

/** Uma medição já gravada: a faixa e o balde do comparador. `n` permite alimentar com contagens. */
export type ItemMedido = {
  grau: string | null | undefined;
  resultado: string | null | undefined;
  /** Quantas medições esta linha representa (default 1) — serve ao `GROUP BY` do SQL. */
  n?: number | null;
};

export type CalibragemFaixa = {
  faixa: FaixaConfianca;
  /** Todas as medições da faixa, inclusive as sem gabarito humano. */
  total: number;
  /** As que têm gabarito humano para comparar (total − sem_base). */
  comparaveis: number;
  acerto: number;
  conservador: number;
  erro_grave: number;
  reprovacao_indevida: number;
  sem_base: number;
  /** acerto / comparaveis — `null` quando a amostra não alcança `MIN_AMOSTRA_FAIXA`. */
  taxa_acerto: number | null;
  /** A faixa tem amostra suficiente para exibir número? */
  suficiente: boolean;
};

export type Calibragem = Record<FaixaConfianca, CalibragemFaixa>;

function faixaDe(grau: string | null | undefined): FaixaConfianca {
  const g = String(grau ?? '').trim().toLowerCase();
  if (g === 'alta' || g === 'media' || g === 'baixa') return g;
  return 'sem_grau';
}

function baldeDe(resultado: string | null | undefined): ResultadoComparacao {
  const r = String(resultado ?? '').trim().toLowerCase();
  if (r === 'acerto' || r === 'conservador' || r === 'erro_grave' || r === 'reprovacao_indevida') {
    return r;
  }
  return 'sem_base';
}

function faixaVazia(faixa: FaixaConfianca): CalibragemFaixa {
  return {
    faixa,
    total: 0,
    comparaveis: 0,
    acerto: 0,
    conservador: 0,
    erro_grave: 0,
    reprovacao_indevida: 0,
    sem_base: 0,
    taxa_acerto: null,
    suficiente: false,
  };
}

/** Todas as faixas zeradas — o estado "ainda não medimos nada", que a UI trata como tal. */
export function calibragemVazia(): Calibragem {
  return {
    alta: faixaVazia('alta'),
    media: faixaVazia('media'),
    baixa: faixaVazia('baixa'),
    sem_grau: faixaVazia('sem_grau'),
  };
}

/**
 * Agrupa as medições por faixa de confiança e devolve acerto/erro/n de cada uma. PURA.
 *
 * ⚠️ `taxa_acerto` só existe com `comparaveis >= MIN_AMOSTRA_FAIXA`. Faixa sem amostra fica
 * `null`/`suficiente: false` — jamais 0, que a tela leria como "essa faixa erra sempre".
 */
export function agruparCalibragem(
  itens: ItemMedido[],
  minAmostra: number = MIN_AMOSTRA_FAIXA,
): Calibragem {
  const piso = Number.isFinite(minAmostra) && minAmostra > 0 ? Math.floor(minAmostra) : MIN_AMOSTRA_FAIXA;
  const out = calibragemVazia();
  for (const item of itens) {
    const n =
      typeof item.n === 'number' && Number.isFinite(item.n) && item.n > 0 ? Math.floor(item.n) : 1;
    const f = out[faixaDe(item.grau)];
    const balde = baldeDe(item.resultado);
    f.total += n;
    f[balde] += n;
  }
  for (const faixa of FAIXAS_CONFIANCA) {
    const f = out[faixa];
    f.comparaveis = f.total - f.sem_base;
    f.suficiente = f.comparaveis >= piso;
    f.taxa_acerto = f.suficiente ? f.acerto / f.comparaveis : null;
  }
  return out;
}

/** A taxa em "X de 10" — como a triagem lê frequência (ninguém lê 0,83 de relance). */
export function taxaEmDez(taxa: number): number {
  return Math.round(Math.max(0, Math.min(1, taxa)) * 10);
}

/**
 * A frase que a tela exibe para uma faixa. FONTE ÚNICA do texto (a coluna e a ficha dividem).
 * Sem amostra suficiente devolve a frase de ausência — **nunca um percentual**.
 */
export function descreverFaixaMedida(f: CalibragemFaixa | null | undefined): string {
  if (!f || !f.suficiente || f.taxa_acerto == null) return 'ainda sem medição';
  return `bate com a triagem em ${taxaEmDez(f.taxa_acerto)} de 10 (${f.comparaveis} casos medidos)`;
}

// ─── Concordância implícita (D2 / RF-238) ─────────────────────────────────────

/**
 * Marco a partir do qual a ausência de discordância pode valer como concordância: o deploy da
 * coleta (fatia (b), 08/09/2026). Antes dele **não havia botão de discordar**, então silêncio não
 * era opinião — contar a base passada como acerto seria inventar concordância retroativa.
 */
export const MARCO_CONCORDANCIA_IMPLICITA = '2026-09-08T00:00:00Z';

export type SinalConcordancia = 'concordancia' | 'discordancia' | 'fora';

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}

/**
 * Classifica o sinal humano sobre UMA avaliação. PURA. (D2)
 *
 * A régua tem uma exigência que a torna honesta: **prova de olhada**. Só conta como concordância
 * quem a triagem realmente abriu — ou seja, alguém gravou Status ou Estrelas naquele projeto
 * **depois** de a avaliação existir — e não registrou discordância. Projeto que ninguém abriu fica
 * **FORA da conta**, não vira acerto de graça: seria o jeito mais fácil de a taxa medida subir sem
 * ninguém ter conferido nada.
 *
 * ⚠️ A discordância conta **retroativamente** (vale mesmo antes do marco): ela é ato explícito.
 * ⚠️ Olhada ANTES da avaliação não é prova: a pessoa não podia ter lido o que ainda não existia.
 */
export function classificarConcordanciaImplicita(input: {
  /** Quando a avaliação do time nasceu. */
  avaliadoEm: string | null | undefined;
  /** Quando a triagem gravou Status/Estrelas naquele projeto (a prova de olhada). */
  olhadaEm: string | null | undefined;
  /** Houve 👎 registrado neste projeto? */
  discordou: boolean;
  marco?: string;
}): SinalConcordancia {
  if (input.discordou) return 'discordancia';
  const avaliado = ms(input.avaliadoEm);
  const marco = ms(input.marco ?? MARCO_CONCORDANCIA_IMPLICITA);
  if (avaliado == null || marco == null || avaliado < marco) return 'fora';
  const olhada = ms(input.olhadaEm);
  if (olhada == null || olhada <= avaliado) return 'fora';
  return 'concordancia';
}

export type ContagemConcordancia = { concordancia: number; discordancia: number; fora: number };

/** Soma os sinais. PURA. */
export function contarConcordancia(sinais: SinalConcordancia[]): ContagemConcordancia {
  const out: ContagemConcordancia = { concordancia: 0, discordancia: 0, fora: 0 };
  for (const s of sinais) out[s] += 1;
  return out;
}
