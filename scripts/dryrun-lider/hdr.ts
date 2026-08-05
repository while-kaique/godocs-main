// Confere se as 2 colunas que a tela de aprovações escreve EXISTEM no cabeçalho real da
// aba `GoDocs` (produção). O mapeamento do sync é por NOME EXATO: chave que não casa é
// ignorada com aviso — foi o que aconteceu na STAGING, cujo cabeçalho tinha
// "Justificativa Aprovação do Lider" (sem acento) e engolia a justificativa.
//
// Rodar: npx vitest run --config scripts/dryrun-lider/vitest.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { getAccessToken } = await import('@/lib/google/auth');
const ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';

it('cabeçalho real da aba GoDocs tem as colunas da pré-aprovação', async () => {
  const t = await getAccessToken();
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent("'GoDocs'!1:1")}`,
    { headers: { Authorization: `Bearer ${t}` } },
  );
  const j = (await r.json()) as { values?: string[][] };
  const hdr = j.values?.[0] ?? [];
  const letra = (i: number) =>
    i < 26
      ? String.fromCharCode(65 + i)
      : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26));

  console.log(`Colunas no cabeçalho: ${hdr.length}`);
  for (const alvo of ['Aprovação do Líder', 'Justificativa Aprovação do Líder']) {
    const i = hdr.indexOf(alvo);
    console.log(i >= 0 ? `OK    "${alvo}" -> coluna ${letra(i)}` : `FALTA "${alvo}" (nome exato)`);
  }
  console.log('Colunas do cabeçalho que mencionam "aprova":');
  hdr.forEach((h, i) => {
    if (/aprova/i.test(h)) console.log(`   ${letra(i)}: "${h}"`);
  });
});
