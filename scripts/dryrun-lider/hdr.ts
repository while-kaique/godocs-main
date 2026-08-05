// Confere se as 2 colunas que a tela de aprovações escreve EXISTEM no cabeçalho real da
// aba `GoDocs` (produção) — e se a resolução do código as ACHA.
//
// O cabeçalho de prod e da staging tem "Justificativa Aprovação do Lider" (SEM acento no
// "i") e o código escreve "…do Líder". Com o match só EXATO, a chave não casava e a
// justificativa era descartada com aviso. Desde 05/08/2026 há uma rede tolerante a
// acento/caixa (`resolverColunaLetra`) — este script prova as duas coisas: o nome cru do
// cabeçalho e o que a resolução devolve.
//
// Rodar: npx vitest run --config scripts/dryrun-lider/vitest.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { getAccessToken } = await import('@/lib/google/auth');
const { resolverColunaLetra, colLetter } = await import('@/lib/google/sheets');
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
  // Mesmo mapa que o `updateRowByProjectId` monta (exato + tolerante).
  const letterByName: Record<string, string> = {};
  hdr.forEach((h, i) => {
    const n = String(h ?? '').trim();
    if (n && !(n in letterByName)) letterByName[n] = colLetter(i);
  });
  const mapa = { headers: hdr.map((h) => String(h ?? '').trim()), letterByName, letterByKey: {} };
  // `letterByKey` real vem do fetchHeaderMap; aqui refaço só para o diagnóstico.
  const { chaveColuna } = await import('@/lib/google/sheets');
  const vezes = new Map<string, number>();
  mapa.headers.forEach((h) => h && vezes.set(chaveColuna(h), (vezes.get(chaveColuna(h)) ?? 0) + 1));
  mapa.headers.forEach((h, i) => {
    const k = chaveColuna(h);
    if (h && vezes.get(k) === 1 && !(k in mapa.letterByKey)) {
      (mapa.letterByKey as Record<string, string>)[k] = colLetter(i);
    }
  });

  for (const alvo of ['Aprovação do Líder', 'Justificativa Aprovação do Líder']) {
    const i = hdr.indexOf(alvo);
    console.log(i >= 0 ? `EXATO    "${alvo}" -> coluna ${letra(i)}` : `EXATO    "${alvo}" NÃO casa`);
    const col = resolverColunaLetra(mapa, alvo);
    console.log(
      col ? `RESOLVIDO "${alvo}" -> coluna ${col}` : `⛔ NÃO RESOLVE "${alvo}" — o valor seria ignorado`,
    );
  }
  console.log('Colunas do cabeçalho que mencionam "aprova":');
  hdr.forEach((h, i) => {
    if (/aprova/i.test(h)) console.log(`   ${letra(i)}: "${h}"`);
  });
});
