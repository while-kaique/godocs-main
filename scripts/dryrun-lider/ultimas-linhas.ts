// LEITURA PURA: imprime as últimas linhas da aba `GoDocs` (prod) nas colunas que
// importam para a pré-aprovação do líder — para ver se as células nascem preenchidas
// ("Pré-pendente"/"—") ou em BRANCO.
//
// Rodar: npx vitest run --config scripts/dryrun-lider/vitest.config.ts ultimas-linhas
// ⚠️ O `rtk` engole a saída — redirecionar para arquivo e ler o arquivo.
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { getAccessToken } = await import('@/lib/google/auth');
const ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const QUANTAS = Number(process.env.QUANTAS || 14);
// ABA=STAGING para inspecionar a aba da staging (a planilha é a MESMA de prod — a aba é o
// isolamento). Default `GoDocs` = PRODUÇÃO.
const ABA = process.env.ABA || 'GoDocs';

it(`últimas linhas da aba ${ABA}`, async () => {
  const t = await getAccessToken();
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ID}/values/${encodeURIComponent(`'${ABA}'!A1:BZ100000`)}`,
    { headers: { Authorization: `Bearer ${t}` } },
  );
  const j = (await r.json()) as { values?: string[][] };
  const rows = j.values ?? [];
  const hdr = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const idx = (nome: string) => hdr.findIndex((h) => h.toLowerCase() === nome.toLowerCase());

  const COLS = [
    'ID Projeto',
    'Projeto',
    'Email',
    'Data Submissão',
    'Atualizado Em',
    'Status',
    'Especial?',
    'Aprovação do Líder',
    'Justificativa Aprovação do Lider',
    'Motivo Reenvio',
  ];
  const pos = COLS.map((c) => ({ c, i: idx(c) }));
  console.log('=== posição das colunas no cabeçalho ===');
  for (const p of pos) console.log(`  ${p.c}: ${p.i >= 0 ? `índice ${p.i}` : 'NÃO EXISTE'}`);

  const corpo = rows.slice(1).filter((r) => (r[idx('ID Projeto')] ?? '').trim());
  console.log(`\n=== ${corpo.length} linhas com ID; últimas ${QUANTAS} ===`);
  for (const linha of corpo.slice(-QUANTAS)) {
    console.log('---');
    for (const p of pos) {
      if (p.i < 0) continue;
      const v = linha[p.i];
      const mostra =
        v === undefined ? '‹CÉLULA AUSENTE›' : v === '' ? '‹VAZIA›' : String(v).slice(0, 90).replace(/\n/g, ' ⏎ ');
      console.log(`  ${p.c}: ${mostra}`);
    }
  }
});
