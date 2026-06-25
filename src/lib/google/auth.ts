// Autenticação Google Service Account via Web Crypto API (sem deps npm).
// Gera JWT RS256 e troca por access_token. Cache em módulo.

// A Service Account é usada para Sheets e, via domain-wide delegation, para enviar
// e-mail impersonando uma caixa @gocase.com (Gmail API). O Drive usa OAuth de usuário
// (getDriveAccessToken) porque Service Accounts não têm cota de storage própria.
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_LIFETIME_SECS = 3600;
const RENEW_MARGIN_SECS = 300; // renova 5 min antes de expirar

// ─── Cache de token (module-scope, sobrevive dentro do isolate) ──────────────

let _cached: { token: string; expiresAt: number } | null = null;

// ─── Helpers base64url ───────────────────────────────────────────────────────

function base64urlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncodeString(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── PEM → CryptoKey ────────────────────────────────────────────────────────

async function importPemKey(pemBase64: string): Promise<CryptoKey> {
  // pemBase64 é o PEM inteiro codificado em base64. Decodifica para string PEM.
  const pem = atob(pemBase64);

  // Extrai o corpo (entre BEGIN/END PRIVATE KEY)
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/[\r\n\s]/g, '');

  // Decodifica o base64 do corpo para ArrayBuffer
  const binaryStr = atob(body);
  const buf = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    buf[i] = binaryStr.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'pkcs8',
    buf.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ─── Criar JWT assinado ─────────────────────────────────────────────────────

async function createSignedJwt(
  clientEmail: string,
  privateKey: CryptoKey,
  opts?: { scope?: string; sub?: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const header = base64urlEncodeString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));

  const payload = base64urlEncodeString(
    JSON.stringify({
      iss: clientEmail,
      // `sub` = quem a SA representa. Para Sheets é a própria SA; para Gmail é a
      // caixa @gocase.com impersonada (exige domain-wide delegation no Workspace).
      sub: opts?.sub ?? clientEmail,
      aud: TOKEN_URL,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECS,
      scope: opts?.scope ?? SCOPES,
    }),
  );

  const encoder = new TextEncoder();
  const data = encoder.encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);

  return `${header}.${payload}.${base64urlEncode(signature)}`;
}

// ─── Trocar JWT por access_token ────────────────────────────────────────────

async function exchangeJwtForToken(jwt: string): Promise<{ access_token: string; expires_in: number }> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google token exchange failed (${resp.status}): ${text}`);
  }

  return resp.json() as Promise<{ access_token: string; expires_in: number }>;
}

// ─── API pública ────────────────────────────────────────────────────────────

export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (_cached && _cached.expiresAt > now + RENEW_MARGIN_SECS) {
    return _cached.token;
  }

  const keyBase64 = process.env.GOOGLE_SA_KEY_BASE64;
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;

  if (!keyBase64 || !clientEmail) {
    throw new Error('GOOGLE_SA_KEY_BASE64 e GOOGLE_SA_CLIENT_EMAIL são obrigatórios');
  }

  const privateKey = await importPemKey(keyBase64);
  const jwt = await createSignedJwt(clientEmail, privateKey);
  const { access_token, expires_in } = await exchangeJwtForToken(jwt);

  _cached = {
    token: access_token,
    expiresAt: now + expires_in,
  };

  return access_token;
}

// ─── Token Gmail (envio via domain-wide delegation) ──────────────────────────
//
// Mint de um access_token com escopo `gmail.send` impersonando `sub` (uma caixa
// real @gocase.com, ex. rpa_ia@gocase.com). PRÉ-REQUISITO no Workspace: a
// delegação em todo o domínio (DWD) precisa estar habilitada para o Client ID da
// SA com o escopo gmail.send; sem isso, a troca do JWT retorna 401 unauthorized_client.
// Reusa a chave da SA do Sheets (GOOGLE_SA_*); aceita override dedicado (GMAIL_SA_*).
// Cache por `sub`.

let _gmailCached: Map<string, { token: string; expiresAt: number }> = new Map();

export async function getGmailAccessToken(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const cached = _gmailCached.get(sub);
  if (cached && cached.expiresAt > now + RENEW_MARGIN_SECS) {
    return cached.token;
  }

  const keyBase64 = process.env.GMAIL_SA_KEY_BASE64 ?? process.env.GOOGLE_SA_KEY_BASE64;
  const clientEmail = process.env.GMAIL_SA_CLIENT_EMAIL ?? process.env.GOOGLE_SA_CLIENT_EMAIL;

  if (!keyBase64 || !clientEmail) {
    throw new Error('GOOGLE_SA_KEY_BASE64 e GOOGLE_SA_CLIENT_EMAIL são obrigatórios para enviar e-mail via Gmail');
  }

  const privateKey = await importPemKey(keyBase64);
  const jwt = await createSignedJwt(clientEmail, privateKey, { scope: GMAIL_SCOPE, sub });
  const { access_token, expires_in } = await exchangeJwtForToken(jwt);

  _gmailCached.set(sub, { token: access_token, expiresAt: now + expires_in });
  return access_token;
}

// ─── OAuth de usuário (Drive) ────────────────────────────────────────────────
//
// Service Accounts não têm cota de storage, então o upload ao Drive usa as
// credenciais OAuth de um usuário real (rpa_ia@gocase.com, dono da pasta). Aqui
// trocamos o refresh token (offline) por um access_token de curta duração.
// Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN.

let _driveCached: { token: string; expiresAt: number } | null = null;

export async function getDriveAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  if (_driveCached && _driveCached.expiresAt > now + RENEW_MARGIN_SECS) {
    return _driveCached.token;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OAUTH_REFRESH_TOKEN são obrigatórios para o upload ao Drive',
    );
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Google OAuth refresh falhou (${resp.status}): ${text}`);
  }

  const { access_token, expires_in } = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };

  _driveCached = { token: access_token, expiresAt: now + expires_in };
  return access_token;
}
