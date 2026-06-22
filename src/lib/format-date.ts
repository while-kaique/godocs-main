/**
 * Parsing/format de datas tolerante a DOIS formatos que convivem no sistema:
 *
 * - **ISO** (`new Date().toISOString()`) — gravado pelo app na submissão
 *   (`submitted_at`, `created_at`).
 * - **pt-BR `dd/mm/yyyy[ HH:MM:SS]`** — escrito na planilha por `sync.ts` (em UTC,
 *   via `getUTC*`) e RELIDO pelo sync reverso para `submitted_at`/`data_criacao`
 *   nos legados. `new Date("22/06/2026 ...")` retorna **Invalid Date** (JS não
 *   parseia dd/mm/yyyy) → a tela mostrava "Enviado em Invalid date".
 *
 * `parseDataFlexivel` reconhece ambos; `fmtDataBR` formata para exibição (UTC, para
 * não deslocar o dia em fusos negativos); `toIsoOrNull` normaliza para ISO (usado
 * na ingestão do sync reverso, para os dados novos ficarem consistentes).
 */
const PT_BR = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

export function parseDataFlexivel(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(PT_BR);
  if (m) {
    const [, dd, mm, yyyy, h = '0', min = '0', sec = '0'] = m;
    // A planilha grava em UTC (sync.ts usa getUTC*) → reconstrói em UTC.
    const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, +h, +min, +sec));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDataBR(value: string | null | undefined): string {
  const d = parseDataFlexivel(value);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function toIsoOrNull(value: string | null | undefined): string | null {
  const d = parseDataFlexivel(value);
  return d ? d.toISOString() : null;
}
