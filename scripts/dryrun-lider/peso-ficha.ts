// LEITURA PURA: quanto pesa a LINHA INTEIRA (a ficha de triagem) por projeto.
//   npx vitest run --config scripts/dryrun-lider/peso-ficha.config.ts
import fs from 'node:fs';
import { it } from 'vitest';
for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
it('peso da ficha', async () => {
  const { readAllRows } = await import('@/lib/google/sheets');
  const rows = await readAllRows();
  const b = (s: string) => new TextEncoder().encode(s).length;
  const pesos = rows.map((r) => {
    const campos: Record<string, string> = {};
    for (const [k, v] of Object.entries(r as Record<string, string>)) {
      const s = String(v ?? '').trim();
      if (s && s !== '—') campos[k] = s;
    }
    return b(JSON.stringify(campos));
  }).sort((a, c) => a - c);
  const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';
  const soma = pesos.reduce((a, c) => a + c, 0);
  console.log(`\nfichas: ${pesos.length}`);
  console.log(`  média:   ${kb(soma / pesos.length)}`);
  console.log(`  mediana: ${kb(pesos[Math.floor(pesos.length / 2)])}`);
  console.log(`  p90:     ${kb(pesos[Math.floor(pesos.length * 0.9)])}`);
  console.log(`  maior:   ${kb(pesos[pesos.length - 1])}`);
  console.log(`\numa PÁGINA de 25 fichas (pela média):  ${kb((soma / pesos.length) * 25)}`);
  console.log(`uma PÁGINA de 25 fichas (pelo p90):    ${kb(pesos[Math.floor(pesos.length * 0.9)] * 25)}`);
}, 900_000);
