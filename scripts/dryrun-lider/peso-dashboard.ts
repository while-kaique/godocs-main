// LEITURA PURA: quanto pesa o payload de `/api/admin/dashboard/projetos`.
//   npx vitest run --config scripts/dryrun-lider/peso-dashboard.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

it('peso do payload', async () => {
  const { readAllRows } = await import('@/lib/google/sheets');
  const { mapResumo, recortarResumo } = await import('@/lib/dashboard-resumo');
  const rows = await readAllRows();
  const resumos = rows.map(mapResumo).filter(Boolean) as Record<string, unknown>[];
  const kb = (s: string) => (new TextEncoder().encode(s).length / 1024).toFixed(1) + ' KB';

  console.log(`\nlinhas na planilha: ${rows.length} · projetos: ${resumos.length}`);
  console.log(`payload INTEIRO (JSON): ${kb(JSON.stringify(resumos))}`);
  console.log(`linha_resumo guardado no espelho: ${kb(JSON.stringify(rows.map(recortarResumo)))}`);

  const campos = Object.keys(resumos[0] ?? {});
  const peso = campos
    .map((c) => ({ c, b: resumos.reduce((a, r) => a + JSON.stringify(r[c] ?? null).length + c.length + 4, 0) }))
    .sort((a, b) => b.b - a.b);
  console.log('\npeso por campo do resumo:');
  for (const { c, b } of peso) console.log(`  ${String(b / 1024).slice(0, 6).padStart(7)} KB  ${c}`);

  const est = new Map<string, number>();
  for (const r of rows) {
    const v = String((r as Record<string, string>)['Estrelas'] ?? '').trim();
    est.set(v, (est.get(v) ?? 0) + 1);
  }
  console.log('\nvalores da coluna "Estrelas":');
  for (const [v, n] of [...est].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}×  ${v === '' ? '(vazia)' : JSON.stringify(v)}`);
  }
}, 900_000);
