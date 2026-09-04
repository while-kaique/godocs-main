// READ-ONLY: imprime o cabeçalho real da aba alvo (GOOGLE_SHEETS_TAB).
import { getAccessToken } from '../../src/lib/google/auth';

const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB;
if (!TAB) throw new Error('setar GOOGLE_SHEETS_TAB');

const token = await getAccessToken();
const r = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/${encodeURIComponent(TAB)}!1:1`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const j = (await r.json()) as { values?: string[][] };
const header = j.values?.[0] ?? [];
console.log(JSON.stringify({ aba: TAB, colunas: header.length, header }, null, 1));
