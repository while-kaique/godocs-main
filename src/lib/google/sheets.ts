// Google Sheets API v4 — append, update e leitura de linhas.

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

// ─── Nomes de coluna conhecidos pelo sistema ─────────────────────────────────
//
// Esta lista é a FONTE DE VERDADE dos NOMES de coluna que o sistema lê/escreve —
// NÃO da posição. O mapeamento posição↔coluna é feito em tempo de execução lendo
// o cabeçalho REAL da planilha (linha 1), por NOME (ver `fetchHeaderMap`). Assim,
// reordenar/inserir colunas na planilha não quebra o sync — basta o NOME bater.
//
// A ordem abaixo apenas documenta o layout atual da aba 'GoDocs' (A→AJ).
//
// ⚠️ "Diff Horas / Antes" e "Diff Saving / Antes" são preenchidas manualmente
// pela equipe — o sistema NUNCA escreve nelas. Já "Memorial anterior" (AF) É
// escrita pelo sistema, mas SÓ na edição: recebe o memorial_calculo da versão
// imediatamente anterior (ver sync.ts → row['Memorial anterior']).
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
  'Horas em Reais',                 // P  (R$ das horas economizadas — bruto)
  'Custo Evitado',                  // Q  (valor R$ mensal do custo evitado)
  'Justificativa Custo Evitado',    // R
  'Custo Mensal ou Pontual',        // S  (recorrência marcada no custo evitado)
  'Saving Reais',                   // T  (líquido: horas + custo evitado − custo externo)
  'Tipo de Saving',                 // U
  'Memorial de Saving',             // V
  'Custo Externo Mensal',           // W
  'Receita Mensal',                 // X
  'Tipo de Receita',                // Y
  'Receita Memorial',               // Z
  'Status',                         // AA
  'Ganho Total',                    // AB
  'Complexidade',                   // AC (preenchida pelo analisador)
  'Diff Horas / Antes',             // AD (manual — não escrever)
  'Diff Saving / Antes',            // AE (manual — não escrever)
  'Memorial anterior',              // AF (escrita pelo sistema só na edição)
  'Observações',                    // AG (preenchida pelo analisador)
  'Contexto do Projeto Especial',   // AH
  'Especial?',                      // AI
  'Atualizado Em',                  // AJ (carimbo da última escrita do sistema)
  'Alocação Ganhos',                // AK (justificativa [2.4] do gate ≥44h — fatiada do memorial)
  'Saving Horas Real',              // AL (carga humana real do split; "—" se não se aplica)
  'Saving Horas Escalado',          // AM (ganho por escala do split; "—" se não se aplica)
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetRow = Partial<Record<SheetColumn, string>>;

// Índice 0-based → letra da coluna (0→A, 25→Z, 26→AA, 27→AB...).
export function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

// ─── Mapeamento por NOME a partir do cabeçalho real ──────────────────────────
//
// Lê a linha 1 da aba e devolve os nomes na ORDEM real + o mapa nome→letra. É a
// peça que torna o sync robusto a reordenação/inserção manual de colunas: nada
// aqui depende de posição fixa.
export type HeaderMap = { headers: string[]; letterByName: Record<string, string> };

export async function fetchHeaderMap(token: string, spreadsheetId: string, sheetName: string): Promise<HeaderMap> {
  const range = `'${sheetName}'!1:1`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets header read falhou (${resp.status}): ${text}`);
  }
  const data = (await resp.json()) as { values?: string[][] };
  const headers = (data.values?.[0] ?? []).map((h) => String(h ?? '').trim());
  const letterByName: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (h && !(h in letterByName)) letterByName[h] = colLetter(i);
  });
  return { headers, letterByName };
}

// Ordena os valores (mapa nome→valor) conforme a ORDEM real do cabeçalho. Colunas
// sem valor entram vazias (preserva alinhamento). Função pura — testável.
export function orderValuesByHeaders(
  headers: string[],
  values: Partial<Record<string, string | number>>,
): (string | number)[] {
  return headers.map((h) => {
    const v = values[h];
    return v == null ? '' : v;
  });
}

// ─── Append: adiciona nova linha ao final da planilha ────────────────────────
//
// Recebe um mapa header→valor e o alinha à ordem REAL do cabeçalho (por nome).
// Colunas ausentes entram vazias. Chaves que não existem no cabeçalho são
// ignoradas (com aviso) — nunca escrevem na coluna errada.
export async function appendRow(values: Partial<Record<SheetColumn, string | number>>): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  const { headers } = await fetchHeaderMap(token, spreadsheetId, sheetName);
  if (headers.length === 0) {
    throw new Error('Sheets append abortado: cabeçalho da planilha está vazio.');
  }

  const headerSet = new Set(headers);
  for (const key of Object.keys(values)) {
    if (values[key as SheetColumn] != null && !headerSet.has(key)) {
      console.warn(`[google/sheets] Coluna "${key}" não existe no cabeçalho da planilha — valor ignorado no append.`);
    }
  }

  const rowValues = orderValuesByHeaders(headers, values);
  const range = `'${sheetName}'!A:${colLetter(headers.length - 1)}`;
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

// ─── Read: lê todas as linhas de dados da aba (Sheets → app) ─────────────────
//
// Usado pelo sync reverso (planilha = fonte de verdade) para atualizar o SQLite.
// Cada célula é chaveada pelo NOME REAL da coluna no cabeçalho (linha 1) — robusto
// a reordenação. Pula o cabeçalho e linhas totalmente vazias; só inclui células
// não-vazias.
export async function readAllRows(): Promise<SheetRow[]> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  // Lê o bloco inteiro de A1 em diante; a 1ª linha é o cabeçalho real.
  const range = `'${sheetName}'!A1:ZZ`;
  const url = `${BASE_URL}/${spreadsheetId}/values/${encodeURIComponent(range)}`;

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sheets read falhou (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as { values?: string[][] };
  const rows = data.values ?? [];
  if (rows.length < 2) return []; // só cabeçalho (ou vazia)

  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());

  const out: SheetRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const v = row[idx];
      if (v != null && String(v).trim() !== '') obj[header] = String(v);
    });
    out.push(obj as SheetRow);
  }
  return out;
}

// ─── Update: atualiza linha existente por ID Projeto ─────────────────────────
//
// O ID é estável e único (ex.: 'legado-270'), então não quebra se o nome do
// projeto mudar. Tanto a coluna do ID quanto as colunas a atualizar são
// resolvidas por NOME a partir do cabeçalho real — robusto a reordenação.
// Atualiza apenas as colunas informadas; as demais (inclusive manuais) ficam
// intactas.
export async function updateRowByProjectId(
  projetoId: string,
  updates: Partial<Record<SheetColumn, string | number>>,
): Promise<void> {
  const token = await getAccessToken();
  const { spreadsheetId, sheetName } = getSheetConfig();

  // 0. Resolver as letras das colunas pelo cabeçalho real.
  const { letterByName } = await fetchHeaderMap(token, spreadsheetId, sheetName);
  const idCol = letterByName['ID Projeto'];
  if (!idCol) {
    console.warn('[google/sheets] Coluna "ID Projeto" não encontrada no cabeçalho — update abortado.');
    return;
  }

  // 1. Ler a coluna do ID para achar o número da linha.
  const searchRange = `'${sheetName}'!${idCol}:${idCol}`;
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

  // Encontrar a linha (1-indexed; pula header na posição 0). Match case-insensitive:
  // linhas legadas inseridas na mão usam ID em MAIÚSCULAS (ex.: "LEGADO-270"),
  // enquanto o ID do banco é minúsculo ("legado-270").
  const alvo = projetoId.trim().toLowerCase();
  let rowNumber = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0]?.trim().toLowerCase() === alvo) {
      rowNumber = i + 1; // Sheets é 1-indexed
      break;
    }
  }

  if (rowNumber === -1) {
    console.warn(`[google/sheets] ID Projeto "${projetoId}" não encontrado na planilha para update`);
    return;
  }

  // 2. Montar ranges/valores para o batch update (coluna resolvida por nome).
  const data: { range: string; values: (string | number)[][] }[] = [];
  for (const [columnName, value] of Object.entries(updates)) {
    if (value == null) continue;
    const col = letterByName[columnName];
    if (!col) {
      console.warn(`[google/sheets] Coluna "${columnName}" não existe no cabeçalho da planilha, pulando`);
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
