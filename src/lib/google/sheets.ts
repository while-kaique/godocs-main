// Google Sheets API v4 — append e update de linhas.

import { getAccessToken } from './auth';

const DEFAULT_SPREADSHEET_ID = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const DEFAULT_SHEET_NAME = 'GoDocs';
const BASE_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

function getSheetConfig() {
  return {
    spreadsheetId: process.env.GOOGLE_SHEETS_ID || DEFAULT_SPREADSHEET_ID,
    sheetName: process.env.GOOGLE_SHEETS_TAB || DEFAULT_SHEET_NAME,
  };
}

// ─── Layout das colunas (FONTE ÚNICA DE VERDADE) ─────────────────────────────
//
// A ordem abaixo DEVE espelhar exatamente a aba 'GoDocs' (coluna A em diante).
// Tanto o append quanto o update derivam daqui — mudou a planilha, muda só aqui.
//
// ⚠️ As colunas "Diff Horas / Antes", "Diff Saving / Antes" e "Memorial anterior"
// são preenchidas manualmente pela equipe — o sistema NUNCA escreve nelas. Elas
// continuam na lista apenas para manter o alinhamento das letras das demais.
export const SHEET_COLUMNS = [
  'Data Submissão',                 // A
  'ID Projeto',                     // B
  'Data Criação',                   // C
  'Área',                           // D
  'Nome Completo',                  // E
  'Email',                          // F
  'Projeto',                        // G
  'Participantes',                  // H
  'Descrição',                      // I
  'URL',                            // J
  'Ferramenta',                     // K
  'Escopo',                         // L
  'Tipos Projeto',                  // M
  'Alguém Fazia?',                  // N
  'Saving Horas',                   // O
  'Saving Reais',                   // P
  'Tipo de Saving',                 // Q
  'Memorial de Saving',             // R
  'Custo Externo Mensal',           // S
  'Receita Mensal',                 // T
  'Tipo de Receita',                // U
  'Receita Memorial',               // V
  'Status',                         // W
  'Ganho Total',                    // X
  'Complexidade',                   // Y  (preenchida pelo analisador)
  'Diff Horas / Antes',             // Z  (manual — não escrever)
  'Diff Saving / Antes',            // AA (manual — não escrever)
  'Memorial anterior',              // AB (manual — não escrever)
  'Observações',                    // AC (preenchida pelo analisador)
  'Contexto do Projeto Especial',   // AD
  'Especial?',                      // AE
  'Custo Evitado',                  // AF
  'Justificativa Custo Evitado',    // AG
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];

// Índice 0-based → letra da coluna (0→A, 25→Z, 26→AA, 27→AB...).
function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

const COLUMN_LETTERS: Record<string, string> = Object.fromEntries(
  SHEET_COLUMNS.map((header, i) => [header, colLetter(i)]),
);

const ID_COLUMN_LETTER = COLUMN_LETTERS['ID Projeto']; // 'B'
const LAST_COLUMN_LETTER = colLetter(SHEET_COLUMNS.length - 1); // 'AG'

// ─── Append: adiciona nova linha ao final da planilha ────────────────────────
//
// Recebe um mapa header→valor. Colunas ausentes (ex.: as manuais, ou as que o
// analisador preenche depois) entram vazias, preservando o alinhamento.
export async function appendRow(values: Partial<Record<SheetColumn, string | number>>): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  const rowValues: (string | number)[] = SHEET_COLUMNS.map((header) => {
    const v = values[header];
    return v == null ? '' : v;
  });

  const range = `'${sheetName}'!A:${LAST_COLUMN_LETTER}`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [rowValues] }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets append falhou (${resp.status}): ${text}`);
  }
}

// ─── Update: atualiza linha existente por ID Projeto (coluna B) ──────────────
//
// O ID é estável e único (ex.: 'legado-270'), então não quebra se o nome do
// projeto mudar — diferente do match por nome. Atualiza apenas as colunas
// informadas em `updates`; as demais (inclusive as manuais) ficam intactas.
export async function updateRowByProjectId(
  projetoId: string,
  updates: Partial<Record<SheetColumn, string | number>>,
): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  // 1. Ler a coluna do ID (B) para achar o número da linha.
  const searchRange = `'${sheetName}'!${ID_COLUMN_LETTER}:${ID_COLUMN_LETTER}`;
  const searchUrl = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(searchRange)}`;

  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!searchResp.ok) {
    const text = await searchResp.text();
    throw new Error(`Sheets read falhou (${searchResp.status}): ${text}`);
  }

  const searchData = (await searchResp.json()) as { values?: string[][] };
  const rows = searchData.values ?? [];

  // Encontrar a linha (1-indexed; pula header na posição 0).
  let rowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0]?.trim() === projetoId.trim()) {
      rowNumber = i + 1; // Sheets é 1-indexed
      break;
    }
  }

  if (rowNumber === -1) {
    console.warn(`[google/sheets] ID Projeto "${projetoId}" não encontrado na planilha para update`);
    return;
  }

  // 2. Montar ranges/valores para o batch update.
  const data: { range: string; values: (string | number)[][] }[] = [];
  for (const [columnName, value] of Object.entries(updates)) {
    if (value == null) continue;
    const col = COLUMN_LETTERS[columnName];
    if (!col) {
      console.warn(`[google/sheets] Coluna "${columnName}" não mapeada, pulando`);
      continue;
    }
    data.push({
      range: `'${sheetName}'!${col}${rowNumber}`,
      values: [[value]],
    });
  }

  if (data.length === 0) return;

  // 3. Batch update.
  const batchUrl = `${BASE_URL}/${spreadsheetId}/values:batchUpdate`;
  const batchResp = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });

  if (!batchResp.ok) {
    const text = await batchResp.text();
    throw new Error(`Sheets batch update falhou (${batchResp.status}): ${text}`);
  }
}
