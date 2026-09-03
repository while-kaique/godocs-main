// Cria o cabeçalho da coluna "Tipo de Projeto" ao FINAL da aba alvo (BH).
// Escrever no fim NÃO move nenhuma célula das 578 linhas existentes.
import { getAccessToken } from '../../src/lib/google/auth';

const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB;
const NOME = 'Tipo de Projeto';
const ESCREVER = process.env.ESCREVER === '1';
if (!TAB) throw new Error('setar GOOGLE_SHEETS_TAB');
if (TAB === 'GoDocs') throw new Error('recusado: a aba de PRODUÇÃO não é alvo deste script');

const token = await getAccessToken();
const url = (r: string) =>
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/${encodeURIComponent(TAB)}!${r}`;

const atual = (await (await fetch(url('1:1'), { headers: { Authorization: `Bearer ${token}` } })).json()) as {
  values?: string[][];
};
const header = atual.values?.[0] ?? [];
if (header.includes(NOME)) {
  console.log(`já existe em ${TAB} (posição ${header.indexOf(NOME) + 1}) — nada a fazer`);
  process.exit(0);
}
const idx = header.length; // 0-based → próxima livre
const letra = (() => {
  let n = idx, s = '';
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
})();
console.log(`${TAB}: ${header.length} colunas → "${NOME}" vai para ${letra}1`);
if (!ESCREVER) { console.log('DRY-RUN (rode com ESCREVER=1 para gravar)'); process.exit(0); }

// ⚠️ A grade da aba tem EXATAMENTE 59 colunas — escrever em BH1 devolve
// "exceeds grid limits". Primeiro estende a grade em 1 coluna (appendDimension,
// que acrescenta no FIM e não move célula alguma), depois grava o cabeçalho.
const meta = (await (
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}?fields=sheets.properties`, {
    headers: { Authorization: `Bearer ${token}` },
  })
).json()) as { sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } } }> };
const aba = meta.sheets?.find((x) => x.properties.title === TAB);
if (!aba) throw new Error(`aba ${TAB} não encontrada`);
if ((aba.properties.gridProperties?.columnCount ?? 0) <= idx) {
  const bu = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ appendDimension: { sheetId: aba.properties.sheetId, dimension: 'COLUMNS', length: 1 } }],
    }),
  });
  if (!bu.ok) throw new Error(`appendDimension ${bu.status} ${await bu.text()}`);
  console.log(`grade estendida: ${aba.properties.gridProperties?.columnCount} → ${idx + 1} colunas`);
}

const res = await fetch(`${url(`${letra}1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: [[NOME]] }),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
console.log(`gravado em ${letra}1`);
