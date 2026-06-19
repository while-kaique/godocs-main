// Acesso à planilha de produção via Service Account (Sheets API v4).
// Auto-contido em JS puro — replica src/lib/google/auth.ts (JWT RS256) e
// src/lib/google/sheets.ts (readAllRows por nome de coluna). Usa os globais
// crypto.subtle/btoa/atob/fetch (Node 20+). Lê GOOGLE_SA_* do .env.
import './env.mjs';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_ID =
  process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const SHEET_NAME = process.env.GOOGLE_SHEETS_TAB || 'GoDocs';

// ─── JWT RS256 ───────────────────────────────────────────────────────────────
const b64urlBytes = (buf) => {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlStr = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function importKey(pemBase64) {
  const pem = atob(pemBase64);
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/[\r\n\s]/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    buf.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

let _cached = null;
export async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cached && _cached.expiresAt > now + 300) return _cached.token;

  const keyBase64 = process.env.GOOGLE_SA_KEY_BASE64;
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  if (!keyBase64 || !clientEmail) {
    throw new Error('GOOGLE_SA_KEY_BASE64 e GOOGLE_SA_CLIENT_EMAIL são obrigatórios no .env');
  }
  const key = await importKey(keyBase64);
  const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64urlStr(JSON.stringify({
    iss: clientEmail, sub: clientEmail, aud: TOKEN_URL,
    iat: now, exp: now + 3600, scope: SCOPES,
  }));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);
  const jwt = `${header}.${payload}.${b64urlBytes(sig)}`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!resp.ok) throw new Error(`Google token exchange falhou (${resp.status}): ${await resp.text()}`);
  const { access_token, expires_in } = await resp.json();
  _cached = { token: access_token, expiresAt: now + expires_in };
  return access_token;
}

// ─── Leitura de todas as linhas (chaveado pelo NOME real da coluna) ──────────
export async function readAllRows() {
  const token = await getAccessToken();
  const range = `'${SHEET_NAME}'!A1:ZZ`;
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets read falhou (${resp.status}): ${await resp.text()}`);
  const { values: rows = [] } = await resp.json();
  if (rows.length < 2) return [];
  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || String(c).trim() === '')) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const v = row[idx];
      if (v != null && String(v).trim() !== '') obj[h] = String(v);
    });
    out.push(obj);
  }
  return out;
}

// Acha a linha (objeto) cujo "ID Projeto" casa (case-insensitive).
export async function findRowByProjectId(projetoId) {
  const alvo = String(projetoId).trim().toLowerCase();
  const rows = await readAllRows();
  return rows.find((r) => String(r['ID Projeto'] ?? '').trim().toLowerCase() === alvo) ?? null;
}

// ─── Limpeza: deleta linhas inteiras pelo ID Projeto (deleteDimension) ───────
async function getSheetGid(token) {
  const url = `${BASE}/${SPREADSHEET_ID}?fields=sheets.properties(sheetId,title)`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets metadata falhou (${resp.status}): ${await resp.text()}`);
  const { sheets = [] } = await resp.json();
  const found = sheets.find((s) => s.properties?.title === SHEET_NAME);
  if (!found) throw new Error(`Aba "${SHEET_NAME}" não encontrada na planilha`);
  return found.properties.sheetId;
}

// Remove as linhas cujo ID Projeto está em `ids`. Retorna os ids efetivamente removidos.
export async function deleteRowsByProjectIds(ids) {
  if (!ids || ids.length === 0) return [];
  const token = await getAccessToken();
  const gid = await getSheetGid(token);

  // Lê a planilha inteira para mapear ID → índice de linha (0-based no sheet).
  const range = `'${SHEET_NAME}'!A1:ZZ`;
  const url = `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Sheets read falhou (${resp.status}): ${await resp.text()}`);
  const { values: rows = [] } = await resp.json();
  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const idCol = headers.indexOf('ID Projeto');
  if (idCol === -1) throw new Error('Coluna "ID Projeto" não encontrada no cabeçalho');

  const alvos = new Set(ids.map((i) => String(i).trim().toLowerCase()));
  const found = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = String(rows[i]?.[idCol] ?? '').trim().toLowerCase();
    if (cell && alvos.has(cell)) found.push({ id: rows[i][idCol], rowIndex: i }); // 0-based
  }
  if (found.length === 0) return [];

  // Deletar de baixo para cima para não deslocar os índices.
  found.sort((a, b) => b.rowIndex - a.rowIndex);
  const requests = found.map((f) => ({
    deleteDimension: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: f.rowIndex, endIndex: f.rowIndex + 1 },
    },
  }));

  const batchUrl = `${BASE}/${SPREADSHEET_ID}:batchUpdate`;
  const batchResp = await fetch(batchUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!batchResp.ok) throw new Error(`Sheets deleteDimension falhou (${batchResp.status}): ${await batchResp.text()}`);
  return found.map((f) => f.id);
}

export { SHEET_NAME, SPREADSHEET_ID };
