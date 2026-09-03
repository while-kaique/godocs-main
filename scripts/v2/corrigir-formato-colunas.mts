// Normaliza o formato de célula das colunas de DINHEIRO da aba alvo.
// Motivo: a coluna "Impacto Líquido Mensal" (BG) nasceu com formato de DATA — os números
// gravados viravam "12/10/1900" na tela e voltavam da API como data, envenenando qualquer
// releitura (o total lido deu R$ 8,1 quatrilhões). Formato de coluna é dado, não estética.
import { getAccessToken } from '../../src/lib/google/auth';
const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB!;
const ESCREVER = process.env.ESCREVER === '1';
const NUMERICAS = ['Impacto Bruto', 'Impacto Líquido', 'Impacto Líquido Mensal', 'Saving Efetivado Agora', 'Custo Evitado Não Contratado'];
const TEXTO = ['Tipo de Projeto', 'ID Pai', 'ID Feature'];

const token = await getAccessToken();
const auth = { Authorization: `Bearer ${token}` };
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`;
const meta = (await (await fetch(`${base}?fields=sheets.properties`, { headers: auth })).json()) as {
  sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number } } }>;
};
const aba = meta.sheets?.find((s) => s.properties.title === TAB);
if (!aba) throw new Error(`aba ${TAB} não encontrada`);
const { values = [] } = (await (await fetch(`${base}/values/${encodeURIComponent(TAB)}!1:1`, { headers: auth })).json()) as { values?: string[][] };
const header = values[0] ?? [];

const pedido = (nomes: string[], numberFormat: { type: string; pattern: string }) =>
  nomes
    .map((n) => ({ n, i: header.indexOf(n) }))
    .filter((x) => x.i >= 0)
    .map((x) => ({
      repeatCell: {
        range: { sheetId: aba.properties.sheetId, startRowIndex: 1, startColumnIndex: x.i, endColumnIndex: x.i + 1 },
        cell: { userEnteredFormat: { numberFormat } },
        fields: 'userEnteredFormat.numberFormat',
      },
    }));
const requests = [
  ...pedido(NUMERICAS, { type: 'NUMBER', pattern: '#,##0.00' }),
  ...pedido(TEXTO, { type: 'TEXT', pattern: '' }),
];
console.log(`${TAB}: ${requests.length} colunas a reformatar`);
if (!ESCREVER) { console.log('DRY-RUN'); process.exit(0); }
const res = await fetch(`${base}:batchUpdate`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests }),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
console.log('formato normalizado');
