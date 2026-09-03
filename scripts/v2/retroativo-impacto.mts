// Retroativo do impacto sobre a aba alvo. DRY por default: só grava com ESCREVER=1.
//
// Estratégia de escrita: as 3 colunas de saída são gravadas em 3 RANGES INTEIROS
// (um values:batchUpdate), não linha a linha — 581 chamadas de update estourariam a
// cota de escrita do Sheets e levariam ~10 min. Linha não convertida recebe de volta
// o valor que já tinha (lido no MESMO passe), então a coluna nunca é zerada por engano.
import { getAccessToken } from '../../src/lib/google/auth';
import { recalcularLinha, resumir, COLUNAS_SAIDA } from '../../src/lib/impacto-retroativo';
import { NOME_LEGADO } from '../../src/lib/coluna-chave';

const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB;
const ESCREVER = process.env.ESCREVER === '1';
if (!TAB) throw new Error('setar GOOGLE_SHEETS_TAB');
if (TAB === 'GoDocs' && process.env.CONFIRMO_PROD !== '1')
  throw new Error('recusado: aba de PRODUÇÃO exige CONFIRMO_PROD=1');

const token = await getAccessToken();
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`;
const auth = { Authorization: `Bearer ${token}` };

const { values = [] } = (await (
  await fetch(`${base}/values/${encodeURIComponent(TAB)}`, { headers: auth })
).json()) as { values?: string[][] };
const [header, ...linhas] = values;
// ⚠️ Mesmo alias do app: numa aba ainda NÃO migrada (a `GoDocs` de prod) o nome novo não
// existe e a célula certa é a legada — `Impacto Líquido` mora em `Ganho Total`.
const idx = (n: string) => {
  const i = header.indexOf(n);
  if (i >= 0) return i;
  const legado = (NOME_LEGADO as Record<string, string>)[n];
  const j = legado ? header.indexOf(legado) : -1;
  if (j < 0) throw new Error(`coluna "${n}" (nem o legado "${legado ?? '—'}") existe em ${TAB}`);
  return j;
};
const iId = idx('ID Projeto');
const letra = (n: number) => {
  let x = n, s = '';
  do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s;
};
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const resultados = linhas.map((l, i) => {
  const row: Record<string, string> = {};
  header.forEach((h, j) => (row[h] = l[j] ?? ''));
  // Espelha a célula legada sob o nome da v2, para o `recalcularLinha` ler por um nome só.
  for (const [novo, legado] of Object.entries(NOME_LEGADO)) {
    if (!(novo in row) && legado in row) row[novo] = row[legado];
  }
  return recalcularLinha(row, (l[iId] ?? `linha ${i + 2}`).trim());
});
const r = resumir(resultados);

console.log(`aba ${TAB} · ${r.linhas} linhas · ${r.recalculadas} recalculadas · ${r.preservadas} preservadas (legado sem componentes) · ${r.mudaram} mudam`);
console.log(`Impacto Bruto          ${brl(r.totais.antes.bruto)} → ${brl(r.totais.depois.bruto)}`);
console.log(`Impacto Líquido        ${brl(r.totais.antes.liquido)} → ${brl(r.totais.depois.liquido)}`);
console.log(`Impacto Líquido Mensal ${brl(r.totais.antes.liquidoMensal)} → ${brl(r.totais.depois.liquidoMensal)}`);
if (r.nao_convertidas.length) {
  console.log(`\n⚠️ ${r.nao_convertidas.length} NÃO convertidas (mantêm o valor atual):`);
  for (const n of r.nao_convertidas) console.log(`   ${n.id}: ${n.motivo}`);
}
const top = resultados
  .filter((x): x is Extract<typeof x, { ok: true }> => x.ok && x.mudou)
  .sort((a, b) => Math.abs(b.depois.liquido - b.antes.liquido) - Math.abs(a.depois.liquido - a.antes.liquido))
  .slice(0, 10);
console.log('\n10 maiores variações do Impacto Líquido:');
for (const t of top) console.log(`   ${t.id}: ${brl(t.antes.liquido)} → ${brl(t.depois.liquido)}`);

if (!ESCREVER) { console.log('\nDRY-RUN — rode com ESCREVER=1 para gravar as 3 colunas.'); process.exit(0); }

// BACKUP antes de gravar: as 3 colunas + o ID, em JSON. Escrever coluna inteira é
// irreversível pela API, e o dry-run só mostra os totais — sem o dump não há como
// desfazer uma corrida ruim.
const backup = `${process.env.BACKUP_DIR ?? '.'}/retroativo-impacto-${TAB}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
await (await import('node:fs/promises')).writeFile(
  backup,
  JSON.stringify(
    resultados.map((x, i) => ({
      id: x.id,
      linha: i + 2,
      antes: x.antes,
      desfecho: x.ok ? x.desfecho : 'nao_convertida',
    })),
    null,
    1,
  ),
);
console.log(`\nbackup dos valores atuais: ${backup}`);

const dados = (Object.keys(COLUNAS_SAIDA) as Array<keyof typeof COLUNAS_SAIDA>).map((k) => {
  const col = letra(idx(COLUNAS_SAIDA[k]));
  return {
    range: `${TAB}!${col}2:${col}${linhas.length + 1}`,
    values: resultados.map((x) => [x.ok ? x.depois[k] : x.antes[k]]),
  };
});
const res = await fetch(`${base}/values:batchUpdate`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data: dados }),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const j = (await res.json()) as { totalUpdatedCells?: number };
console.log(`\ngravado: ${j.totalUpdatedCells} células em 3 colunas`);
