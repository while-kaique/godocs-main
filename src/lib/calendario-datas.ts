/**
 * Aritmética de calendário — módulo PURO, sem React e sem fuso horário.
 *
 * A unidade daqui é o **dia civil** no formato `YYYY-MM-DD` (o mesmo que um
 * `<input type="date">` produz e que `validarEtapa2` compara como string). Toda a conta
 * é feita em **UTC** (`Date.UTC`), nunca com `new Date('2026-08-17')` seguido de
 * `getDate()`: em fuso negativo (Brasília é UTC-3) isso devolve o dia ANTERIOR, e um
 * calendário que pinta "hoje" no dia errado é pior do que não pintar nada.
 *
 * Quem exibe é o componente (`components/calendario/calendario.tsx`); quem filtra é
 * `dashboard-filtros.ts`. Os dois falam por estas funções, então "que dia é hoje" tem
 * uma resposta só.
 */

/** Dia civil `YYYY-MM-DD`. */
export type DiaIso = string;

export type Intervalo = { inicio: DiaIso; fim: DiaIso };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function ehIsoValido(iso: string | null | undefined): iso is DiaIso {
  if (!iso || !ISO_RE.test(iso)) return false;
  const p = partesIso(iso);
  if (!p) return false;
  // Rejeita 31/02: reconstruir e comparar é o teste mais barato que existe.
  return isoDeUtc(Date.UTC(p.ano, p.mes - 1, p.dia)) === iso;
}

export function partesIso(iso: string): { ano: number; mes: number; dia: number } | null {
  const m = ISO_RE.exec(iso ?? '');
  if (!m) return null;
  return { ano: +m[1], mes: +m[2], dia: +m[3] };
}

/** Epoch ms (UTC, meia-noite) de um dia civil. `NaN` se o ISO não presta. */
export function msDeIso(iso: string): number {
  const p = partesIso(iso);
  return p ? Date.UTC(p.ano, p.mes - 1, p.dia) : NaN;
}

export function isoDeUtc(ms: number): DiaIso {
  const d = new Date(ms);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Hoje na perspectiva de quem está olhando a tela — usa o relógio LOCAL de propósito
 * (`getFullYear`, não `getUTCFullYear`): às 22h de Brasília o UTC já virou o dia
 * seguinte, e "Hoje" precisa ser o dia da pessoa, não o do meridiano de Greenwich.
 */
export function hojeIso(agora: Date = new Date()): DiaIso {
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const dd = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mm}-${dd}`;
}

export function somarDias(iso: DiaIso, dias: number): DiaIso {
  return isoDeUtc(msDeIso(iso) + dias * 86_400_000);
}

export function somarMeses(iso: DiaIso, meses: number): DiaIso {
  const p = partesIso(iso);
  if (!p) return iso;
  const alvo = new Date(Date.UTC(p.ano, p.mes - 1 + meses, 1));
  // Preserva o dia quando ele existe no mês de destino (31/01 + 1 mês → 28/02, não 03/03).
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDeUtc(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(p.dia, ultimo)));
}

export function primeiroDiaDoMes(iso: DiaIso): DiaIso {
  const p = partesIso(iso);
  return p ? isoDeUtc(Date.UTC(p.ano, p.mes - 1, 1)) : iso;
}

export function ultimoDiaDoMes(iso: DiaIso): DiaIso {
  const p = partesIso(iso);
  return p ? isoDeUtc(Date.UTC(p.ano, p.mes, 0)) : iso;
}

/** -1, 0 ou 1 — comparação de strings basta, porque `YYYY-MM-DD` é lexicograficamente ordenado. */
export function compararIso(a: DiaIso, b: DiaIso): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dentroDoIntervalo(iso: DiaIso, intervalo: Intervalo): boolean {
  return iso >= intervalo.inicio && iso <= intervalo.fim;
}

/** Põe as pontas em ordem — o 2º clique pode cair ANTES do 1º, e isso é uso normal. */
export function ordenarIntervalo(a: DiaIso, b: DiaIso): Intervalo {
  return compararIso(a, b) <= 0 ? { inicio: a, fim: b } : { inicio: b, fim: a };
}

/** Dias INCLUSIVOS entre as pontas (17→21 = 5 dias, como o resumo do rodapé mostra). */
export function contarDias({ inicio, fim }: Intervalo): number {
  return Math.round((msDeIso(fim) - msDeIso(inicio)) / 86_400_000) + 1;
}

// ─── Rótulos ─────────────────────────────────────────────────────────────────

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Iniciais da semana começando no domingo (o padrão do calendário brasileiro). */
export const DIAS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Agosto 2026" — cabeçalho do mês. */
export function rotuloMes(iso: DiaIso): string {
  const p = partesIso(iso);
  if (!p) return '';
  return `${capitalizar(MESES[p.mes - 1])} ${p.ano}`;
}

/** "17 ago" — resumo curto do rodapé e do gatilho do filtro. */
export function rotuloDiaCurto(iso: DiaIso): string {
  const p = partesIso(iso);
  if (!p) return '';
  return `${p.dia} ${MESES[p.mes - 1].slice(0, 3)}`;
}

/** "17/08/2026" — o formato do campo de data da submissão. */
export function rotuloDiaBR(iso: DiaIso): string {
  const p = partesIso(iso);
  if (!p) return '';
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

/** Rótulo acessível completo — "17 de agosto de 2026" (só leitor de tela ouve). */
export function rotuloDiaCompleto(iso: DiaIso): string {
  const p = partesIso(iso);
  if (!p) return '';
  return `${p.dia} de ${MESES[p.mes - 1]} de ${p.ano}`;
}

// ─── Grade do mês ────────────────────────────────────────────────────────────

export type CelulaDia = {
  iso: DiaIso;
  dia: number;
  /** `false` = dia de emenda (mês anterior/seguinte) — visível, mas apagado. */
  doMes: boolean;
};

/**
 * As 6 semanas (42 células) que a grade de um mês desenha, sempre começando num domingo.
 *
 * ⚠️ Sempre 42, nunca "o que couber": grade de altura variável faz o popover pular de
 * tamanho ao trocar de mês, e o cursor do usuário fica em cima do botão errado.
 */
export function gradeDoMes(isoDoMes: DiaIso): CelulaDia[] {
  const primeiro = primeiroDiaDoMes(isoDoMes);
  const p = partesIso(primeiro);
  if (!p) return [];
  const diaSemana = new Date(msDeIso(primeiro)).getUTCDay();
  const inicioGrade = msDeIso(primeiro) - diaSemana * 86_400_000;
  return Array.from({ length: 42 }, (_, i) => {
    const iso = isoDeUtc(inicioGrade + i * 86_400_000);
    const parte = partesIso(iso)!;
    return { iso, dia: parte.dia, doMes: parte.mes === p.mes && parte.ano === p.ano };
  });
}

// ─── Atalhos de período ──────────────────────────────────────────────────────

export type PresetPeriodo = {
  chave: string;
  rotulo: string;
  intervalo: (hoje: DiaIso) => Intervalo;
};

/**
 * Os atalhos que aparecem dentro do calendário. Deliberadamente curtos e voltados para
 * TRÁS: a triagem olha o que chegou, não o que vai chegar.
 */
export const PRESETS_PERIODO: PresetPeriodo[] = [
  { chave: 'hoje', rotulo: 'Hoje', intervalo: (h) => ({ inicio: h, fim: h }) },
  { chave: '7d', rotulo: 'Últimos 7 dias', intervalo: (h) => ({ inicio: somarDias(h, -6), fim: h }) },
  {
    chave: '30d',
    rotulo: 'Últimos 30 dias',
    intervalo: (h) => ({ inicio: somarDias(h, -29), fim: h }),
  },
  {
    chave: 'mes',
    rotulo: 'Este mês',
    intervalo: (h) => ({ inicio: primeiroDiaDoMes(h), fim: h }),
  },
  {
    chave: 'mes_passado',
    rotulo: 'Mês passado',
    intervalo: (h) => {
      const anterior = somarMeses(primeiroDiaDoMes(h), -1);
      return { inicio: anterior, fim: ultimoDiaDoMes(anterior) };
    },
  },
  {
    chave: 'ano',
    rotulo: 'Este ano',
    intervalo: (h) => ({ inicio: `${partesIso(h)!.ano}-01-01`, fim: h }),
  },
];

/** Qual atalho descreve exatamente este intervalo (para marcar o botão como ativo). */
export function presetDoIntervalo(intervalo: Intervalo | null, hoje: DiaIso): string | null {
  if (!intervalo) return null;
  const achado = PRESETS_PERIODO.find((p) => {
    const i = p.intervalo(hoje);
    return i.inicio === intervalo.inicio && i.fim === intervalo.fim;
  });
  return achado?.chave ?? null;
}

/** "17 ago – 21 ago", "17 ago" quando é um dia só. Vai no gatilho do filtro. */
export function rotuloIntervalo(intervalo: Intervalo | null): string {
  if (!intervalo) return '';
  if (intervalo.inicio === intervalo.fim) return rotuloDiaCurto(intervalo.inicio);
  return `${rotuloDiaCurto(intervalo.inicio)} – ${rotuloDiaCurto(intervalo.fim)}`;
}
