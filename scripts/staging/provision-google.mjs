/**
 * Provisiona os recursos Google de STAGING:
 *  1. ABA "STAGING" na MESMA planilha de prod (copiando o cabeçalho A→AS).
 *  2. PASTA de Drive de staging (dona = usuário OAuth rpa_ia, igual ao upload).
 *
 * Usa as credenciais de prod do .env (a SA já edita a planilha; o OAuth rpa_ia
 * é o mesmo dono da pasta de prod). Imprime os IDs/nome para alimentar os
 * secrets do app godocs-staging.
 *
 * Uso:
 *   node --env-file=.env scripts/staging/provision-google.mjs
 *
 * Idempotente: se a aba "STAGING" já existir, só reescreve o cabeçalho; a pasta
 * é criada a cada run (passe STAGING_DRIVE_FOLDER_ID p/ pular a criação).
 */

const PROD_SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const PROD_TAB = 'GoDocs';
const STAGING_TAB = process.env.STAGING_SHEETS_TAB || 'STAGING';
const STAGING_FOLDER_NAME = process.env.STAGING_DRIVE_FOLDER_NAME || 'GoDocs — STAGING (testes)';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// ─── Service Account (Sheets) ────────────────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getSaToken() {
  const keyB64 = process.env.GOOGLE_SA_KEY_BASE64;
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  if (!keyB64 || !clientEmail) throw new Error('GOOGLE_SA_KEY_BASE64 / GOOGLE_SA_CLIENT_EMAIL ausentes');

  const pem = Buffer.from(keyB64, 'base64').toString('utf8');
  const crypto = await import('node:crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: clientEmail,
      sub: clientEmail,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    }),
  );
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(pem));
  const jwt = `${header}.${payload}.${sig}`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!resp.ok) throw new Error(`SA token falhou (${resp.status}): ${await resp.text()}`);
  return (await resp.json()).access_token;
}

// ─── OAuth de usuário (Drive — rpa_ia) ───────────────────────────────────────
async function getDriveToken() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('GOOGLE_OAUTH_* ausentes');

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  });
  if (!resp.ok) throw new Error(`OAuth refresh falhou (${resp.status}): ${await resp.text()}`);
  return (await resp.json()).access_token;
}

// ─── 1) Aba de staging ────────────────────────────────────────────────────────
async function ensureStagingTab(token) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${PROD_SPREADSHEET_ID}`;

  const metaResp = await fetch(`${base}?fields=sheets.properties(sheetId,title)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaResp.ok) throw new Error(`get spreadsheet falhou (${metaResp.status}): ${await metaResp.text()}`);
  const meta = await metaResp.json();
  const titles = (meta.sheets || []).map((s) => s.properties.title);
  const exists = titles.includes(STAGING_TAB);

  if (!exists) {
    const buResp = await fetch(`${base}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: STAGING_TAB } } }] }),
    });
    if (!buResp.ok) throw new Error(`addSheet falhou (${buResp.status}): ${await buResp.text()}`);
    console.log(`  ✓ aba "${STAGING_TAB}" criada`);
  } else {
    console.log(`  • aba "${STAGING_TAB}" já existe (reescrevendo só o cabeçalho)`);
  }

  // Copia o cabeçalho (linha 1) de GoDocs → STAGING
  const headerResp = await fetch(`${base}/values/${encodeURIComponent(PROD_TAB)}!1:1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!headerResp.ok) throw new Error(`ler cabeçalho falhou (${headerResp.status}): ${await headerResp.text()}`);
  const headerRow = (await headerResp.json()).values?.[0] || [];
  if (!headerRow.length) throw new Error('cabeçalho de prod veio vazio — abortando');

  const writeResp = await fetch(
    `${base}/values/${encodeURIComponent(STAGING_TAB)}!A1?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [headerRow] }),
    },
  );
  if (!writeResp.ok) throw new Error(`escrever cabeçalho falhou (${writeResp.status}): ${await writeResp.text()}`);
  console.log(`  ✓ cabeçalho copiado (${headerRow.length} colunas: ${headerRow[0]} … ${headerRow[headerRow.length - 1]})`);
}

// ─── 2) Pasta de Drive de staging ──────────────────────────────────────────────
async function createStagingFolder(token) {
  if (process.env.STAGING_DRIVE_FOLDER_ID) {
    console.log(`  • pasta de Drive já informada (STAGING_DRIVE_FOLDER_ID) — pulando criação`);
    return process.env.STAGING_DRIVE_FOLDER_ID;
  }
  const resp = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: STAGING_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!resp.ok) throw new Error(`criar pasta falhou (${resp.status}): ${await resp.text()}`);
  const folder = await resp.json();
  console.log(`  ✓ pasta "${folder.name}" criada → ${folder.webViewLink}`);
  return folder.id;
}

// ─── Run ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('▶ Provisionando recursos Google de STAGING\n');

  console.log('1) Aba de staging (Sheets, via Service Account):');
  const saToken = await getSaToken();
  await ensureStagingTab(saToken);

  console.log('\n2) Pasta de Drive de staging (via OAuth rpa_ia):');
  const driveToken = await getDriveToken();
  const folderId = await createStagingFolder(driveToken);

  console.log('\n─────────────────────────────────────────────');
  console.log('RESULTADO — use nos secrets do app godocs-staging:');
  console.log(`  GOOGLE_SHEETS_ID         = ${PROD_SPREADSHEET_ID}   (mesma planilha de prod)`);
  console.log(`  GOOGLE_SHEETS_TAB        = ${STAGING_TAB}`);
  console.log(`  GOOGLE_DRIVE_FOLDER_ID   = ${folderId}`);
  console.log('─────────────────────────────────────────────');
})().catch((e) => {
  console.error('\n✘ ERRO:', e.message);
  process.exit(1);
});
