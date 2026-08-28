/**
 * DELIBERAÇÃO + CONFIANÇA formalizada do time autônomo de avaliação (fatia C) — PURO.
 *
 * Três peças puras, todas testáveis sem tocar banco/rede:
 *   • `grauConfianca(n)` — formaliza a confiança numérica em GRAU (`alta|media|baixa`), o rótulo de
 *     auditoria que acompanha todo desfecho da mesa (reusa o tipo `Confianca` dos especiais).
 *   • `conciliarComCetico(agregado, cetico)` — funde o voto do CÉTICO no veredito preliminar do
 *     agregador. Se o cético refuta uma aprovação, rebaixa para `em_validacao` (fila humana) e
 *     baixa a confiança pelo lastro da refutação. NUNCA vira `aprovar` (anti-bajulação).
 *   • `avancarDeliberacao(atual, sinais)` — o REDUCER da máquina de estados persistida: quando os
 *     especialistas divergem, a confiança é baixa ou o cético refuta, abre +1 rodada; o CRON
 *     idempotente avança até `consenso` ou `nao_consenso` (→ humano), bounded por `maxRodadas`.
 *
 * ⚠️ MODO SOMBRA: nada aqui muda o status do projeto — só produz a recomendação e o estado. Quem
 * persiste é o orquestrador (`avaliacao-normais.functions.ts`), nas tabelas internas da fatia C.
 */
import type { Confianca } from '@/lib/especiais-regua';

/** Piso do grau ALTA. */
export const LIMIAR_GRAU_ALTA = 0.8;
/** Piso do grau MÉDIA (abaixo dele → baixa). */
export const LIMIAR_GRAU_MEDIA = 0.6;
/** Rodadas máximas da deliberação antes de declarar `nao_consenso` (→ humano). Bounded. */
export const MAX_RODADAS_DELIBERACAO = 2;

/** Limiar de confiança agregada abaixo do qual não há consenso (mesma régua do agregador). */
const LIMIAR_CONFIANCA_PADRAO = 0.6;

/**
 * Formaliza a confiança 0..1 em grau. `>=0.8` alta · `[0.6,0.8)` média · resto baixa. Valor
 * não-finito/negativo → baixa (conservador); `>1` → alta.
 */
export function grauConfianca(n: number): Confianca {
  if (!(typeof n === 'number' && isFinite(n)) || n < 0) return 'baixa';
  if (n >= LIMIAR_GRAU_ALTA) return 'alta';
  if (n >= LIMIAR_GRAU_MEDIA) return 'media';
  return 'baixa';
}

// ─── Concilia o voto do cético no preliminar do agregador ──────────────────────

export type VeredictoMesa = 'aprovar' | 'em_validacao' | 'isento';

export type AgregadoPreliminar = {
  veredito: VeredictoMesa;
  confianca: number;
  aplicarEmValidacao: boolean;
  divergencia: boolean;
  isento: boolean;
  motivos: string[];
};

export type ResultadoConciliado = AgregadoPreliminar & {
  grau: Confianca;
  ceticoRefutou: boolean;
};

/**
 * Funde o cético. Isento fica intacto. Se o cético refuta uma APROVAÇÃO, rebaixa para
 * `em_validacao`, aplica a fila humana e reduz a confiança para `min(atual, 1 - lastroCetico)`.
 * Qualquer outro caso preserva o veredito (anti-bajulação: o cético nunca move para `aprovar`).
 */
export function conciliarComCetico(
  agregado: AgregadoPreliminar,
  cetico: { refuta: boolean; confianca: number; motivo: string | null },
): ResultadoConciliado {
  if (agregado.isento || agregado.veredito === 'isento') {
    return { ...agregado, grau: 'alta', ceticoRefutou: false };
  }

  const refutaAprovacao = cetico.refuta && agregado.veredito === 'aprovar';
  if (!refutaAprovacao) {
    return { ...agregado, grau: grauConfianca(agregado.confianca), ceticoRefutou: false };
  }

  const lastro = typeof cetico.confianca === 'number' && isFinite(cetico.confianca) ? cetico.confianca : 0;
  const confianca = Math.min(agregado.confianca, 1 - lastro);
  const motivos = cetico.motivo ? [...agregado.motivos, cetico.motivo] : [...agregado.motivos];

  return {
    veredito: 'em_validacao',
    confianca,
    aplicarEmValidacao: true,
    divergencia: agregado.divergencia,
    isento: false,
    motivos,
    grau: grauConfianca(confianca),
    ceticoRefutou: true,
  };
}

// ─── Máquina de estados da deliberação (avançada pelo cron) ────────────────────

export type EstadoDeliberacao = 'deliberando' | 'consenso' | 'nao_consenso' | 'isento';

export type SinaisRodada = {
  agregadoVeredito: VeredictoMesa;
  divergencia: boolean;
  confianca: number;
  ceticoRefuta: boolean;
  limiarConfianca?: number | null;
};

export type ResultadoDeliberacao = {
  estado: EstadoDeliberacao;
  rodada: number;
  veredito: VeredictoMesa;
  confianca: number;
  grau: Confianca;
  motivo: string;
  encerrada: boolean;
};

const TERMINAIS: EstadoDeliberacao[] = ['consenso', 'nao_consenso', 'isento'];

function veredictoDeEstadoTerminal(estado: EstadoDeliberacao): VeredictoMesa {
  if (estado === 'consenso') return 'aprovar';
  if (estado === 'isento') return 'isento';
  return 'em_validacao';
}

/**
 * Avança UMA rodada da deliberação. PURA e idempotente sobre estados terminais.
 *
 * - `isento` (o preliminar isentou) → terminal `isento`, sem consumir rodada.
 * - estado já terminal → devolve o mesmo (não incrementa rodada).
 * - senão roda: `rodada = (atual.rodada ?? 0) + 1`.
 *   • CONSENSO quando `aprovar` E sem divergência E sem refuta E confiança ≥ limiar → terminal.
 *   • rodada < maxRodadas → `deliberando` (interino conservador `em_validacao`).
 *   • esgotou as rodadas sem consenso → terminal `nao_consenso` (→ humano).
 */
export function avancarDeliberacao(
  atual: { estado?: EstadoDeliberacao | null; rodada?: number | null },
  sinais: SinaisRodada,
  opts: { maxRodadas?: number | null } = {},
): ResultadoDeliberacao {
  const rodadaAnterior =
    typeof atual.rodada === 'number' && isFinite(atual.rodada) && atual.rodada >= 0
      ? Math.floor(atual.rodada)
      : 0;
  const maxRodadas =
    typeof opts.maxRodadas === 'number' && isFinite(opts.maxRodadas) && opts.maxRodadas > 0
      ? Math.floor(opts.maxRodadas)
      : MAX_RODADAS_DELIBERACAO;
  const limiar =
    typeof sinais.limiarConfianca === 'number' &&
    isFinite(sinais.limiarConfianca) &&
    sinais.limiarConfianca > 0
      ? sinais.limiarConfianca
      : LIMIAR_CONFIANCA_PADRAO;

  // Isento: a decisão é 100% humana — encerra sem gastar rodada.
  if (sinais.agregadoVeredito === 'isento') {
    return {
      estado: 'isento',
      rodada: rodadaAnterior,
      veredito: 'isento',
      confianca: 1,
      grau: 'alta',
      motivo: 'Projeto especial ou de liderança — deliberação não se aplica (validação humana).',
      encerrada: true,
    };
  }

  // Estado já terminal → idempotente (não avança, não incrementa rodada).
  if (atual.estado && TERMINAIS.includes(atual.estado)) {
    const veredito = veredictoDeEstadoTerminal(atual.estado);
    return {
      estado: atual.estado,
      rodada: rodadaAnterior,
      veredito,
      confianca: sinais.confianca,
      grau: grauConfianca(sinais.confianca),
      motivo: 'Deliberação já encerrada — estado preservado.',
      encerrada: true,
    };
  }

  const rodada = rodadaAnterior + 1;
  const grau = grauConfianca(sinais.confianca);

  const consenso =
    sinais.agregadoVeredito === 'aprovar' &&
    !sinais.divergencia &&
    !sinais.ceticoRefuta &&
    sinais.confianca >= limiar;

  if (consenso) {
    return {
      estado: 'consenso',
      rodada,
      veredito: 'aprovar',
      confianca: sinais.confianca,
      grau,
      motivo: 'Consenso da mesa: saving plausível, financeiro coerente e sem objeção do cético.',
      encerrada: true,
    };
  }

  if (rodada < maxRodadas) {
    return {
      estado: 'deliberando',
      rodada,
      veredito: 'em_validacao',
      confianca: sinais.confianca,
      grau,
      motivo: 'Sem consenso ainda (divergência, confiança baixa ou objeção do cético) — nova rodada.',
      encerrada: false,
    };
  }

  return {
    estado: 'nao_consenso',
    rodada,
    veredito: 'em_validacao',
    confianca: sinais.confianca,
    grau,
    motivo: 'Sem consenso após as rodadas previstas — enviado à triagem humana.',
    encerrada: true,
  };
}
