// LEITURA PURA da planilha de prod (aba GoDocs) — todas as colunas, chaveadas pelo nome REAL.
// Nunca escreve. É a fonte do retroativo em SOMBRA (T19): o dossiê de cada projeto nasce de
// `dossieDaLinhaPlanilha(row)`.
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SAIDA = process.env.RETRO_OUT ?? '/tmp/retro-corpus-full.json';

it('dump da planilha de prod para o retroativo', async () => {
  const { readAllRows } = await import('@/lib/google/sheets');
  const rows = (await readAllRows()) as Record<string, string>[];
  const comId = rows.filter((r) => String(r['ID Projeto'] ?? '').trim());
  console.log(`linhas: ${rows.length} · com ID: ${comId.length} · colunas: ${Object.keys(rows[0] ?? {}).length}`);
  fs.writeFileSync(SAIDA, JSON.stringify(comId));
  console.log(`salvo em ${SAIDA} (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);
});
