// LEITURA PURA: cabeçalho INTEIRO da aba `GoDocs` (prod) com índice/letra + checagem de
// chaves AMBÍGUAS (2 cabeçalhos que normalizam igual → o valor é descartado no append).
//
//   npx vitest run --config scripts/dryrun-lider/cabecalho-full.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { getAccessToken } = await import('@/lib/google/auth');
const { colLetter, chaveColuna } = await import('@/lib/google/sheets');
const { SHEET_COLUMNS } = await import('@/lib/google/sheets');
const ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';

it('cabeçalho inteiro + ambiguidades', async () => {
  const t = await getAccessToken();
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent("'GoDocs'!1:1")}`,
    { headers: { Authorization: `Bearer ${t}` } },
  );
  const j = (await r.json()) as { values?: string[][] };
  const hdr = (j.values?.[0] ?? []).map((h) => String(h ?? '').trim());

  console.log(`=== cabeçalho: ${hdr.length} colunas ===`);
  hdr.forEach((h, i) => console.log(`  ${String(i).padStart(2)} ${colLetter(i).padEnd(3)} ${h === '' ? '‹VAZIO›' : h}`));

  const vezes = new Map<string, number>();
  hdr.forEach((h) => h && vezes.set(chaveColuna(h), (vezes.get(chaveColuna(h)) ?? 0) + 1));
  console.log('\n=== chaves AMBÍGUAS no cabeçalho (valor descartado no match tolerante) ===');
  let ambig = 0;
  for (const [k, n] of vezes) {
    if (n > 1) {
      ambig++;
      console.log(`  "${k}" aparece ${n}× → ${hdr.filter((h) => chaveColuna(h) === k).join(' | ')}`);
    }
  }
  if (!ambig) console.log('  nenhuma');

  console.log('\n=== colunas que o CÓDIGO conhece e o cabeçalho NÃO tem ===');
  const porChave = new Set(hdr.map((h) => chaveColuna(h)));
  for (const c of SHEET_COLUMNS) {
    if (!hdr.includes(c) && !porChave.has(chaveColuna(c))) console.log(`  ⛔ "${c}"`);
  }
});
