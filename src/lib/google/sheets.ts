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

// ─── Append: adiciona nova linha ao final da planilha ────────────────────────

export async function appendRow(values: (string | number)[]): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  const range = `'${sheetName}'!A:Z`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [values],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets append falhou (${resp.status}): ${text}`);
  }
}

// ─── Update: atualiza linha existente por nome do projeto ────────────────────

// Mapa de colunas header → letra (0-indexed → A, B, C...)
const COLUMN_LETTERS: Record<string, string> = {
  'Data Submissão': 'A',
  'Data Criação': 'B',
  'Área': 'C',
  'Nome Completo': 'D',
  'Participantes': 'E',
  'Email': 'F',
  'Ferramenta': 'G',
  'Projeto': 'H',
  'Descrição': 'I',
  'URL': 'J',
  'Escopo': 'K',
  'Tipos Projeto': 'L',
  'Saving Horas': 'M',
  'Saving Reais': 'N',
  'Tipo de Saving': 'O',
  'Memorial de Saving': 'P',
  'Custo Externo Mensal': 'Q',
  'Receita Mensal': 'R',
  'Receita Memorial': 'S',
  'Status': 'T',
  'ID Projeto': 'U',
  'Ganho Total': 'V',
  'Tipo de Receita': 'W',
  'Alguém Fazia?': 'X',
  'Contexto do Projeto Especial': 'Y',
  'Especial?': 'Z',
  // Colunas extras (AA em diante)
  'Complexidade': 'AA',
  'Observações': 'AB',
};

// Coluna "Projeto" está na posição H (índice 7)
const PROJETO_COLUMN_INDEX = 7;

export async function updateRowByProjectName(
  projectName: string,
  updates: Record<string, string | number>,
): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  // 1. Ler toda a coluna H (Projeto) para achar o row number
  const searchRange = `'${sheetName}'!H:H`;
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

  // Encontrar a linha (1-indexed, pula header na posição 0)
  let rowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0]?.trim() === projectName.trim()) {
      rowNumber = i + 1; // Sheets é 1-indexed
      break;
    }
  }

  if (rowNumber === -1) {
    console.warn(`[google/sheets] Projeto "${projectName}" não encontrado na planilha para update`);
    return;
  }

  // 2. Montar os ranges e valores para batch update
  const data: { range: string; values: (string | number)[][] }[] = [];

  for (const [columnName, value] of Object.entries(updates)) {
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

  // 3. Batch update
  const batchUrl = `${BASE_URL}/${spreadsheetId}/values:batchUpdate`;

  const batchResp = await fetch(batchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data,
    }),
  });

  if (!batchResp.ok) {
    const text = await batchResp.text();
    throw new Error(`Sheets batch update falhou (${batchResp.status}): ${text}`);
  }
}
