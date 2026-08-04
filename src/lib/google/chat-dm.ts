// DM privada no Google Chat (pré-aprovação do líder — F2 da SPEC_APROVACAO_LIDER).
//
// A DM é só o CARTEIRO: avisa o líder que há um projeto do time esperando a
// pré-aprovação e leva o link. A decisão acontece DENTRO do GoDocs (D1) e a fonte
// de verdade é a tabela `projeto_aprovacoes` — nada aqui grava estado (D8/gotcha 4).
//
// Como funciona: `spaces:setup` cria (ou reencontra — é idempotente) o espaço de DM
// entre a caixa impersonada (`GOOGLE_CHAT_DM_SUBJECT`, default rpa_ia@gocase.com) e
// o destinatário; depois posta a mensagem nele. Credencial: `CHAT_SA_*` com fallback
// `GOOGLE_SA_*` (mesmo padrão do GMAIL_SA_*), impersonando o subject via DWD.
//
// ⚠️ Nada de `process.env` em escopo de módulo (CLAUDE.md) — tudo lazy.

const CHAT_API = 'https://chat.googleapis.com/v1';
const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.messages.create',
].join(' ');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_LIFETIME_SECS = 3600;
const RENEW_MARGIN_SECS = 300;

/** Caixa real impersonada (remetente da DM). */
export function getChatDmSubject(): string {
  return (process.env.GOOGLE_CHAT_DM_SUBJECT || 'rpa_ia@gocase.com').trim().toLowerCase();
}

/**
 * Gate de rollout: a DM só sai com `GOOGLE_CHAT_DM_ENABLED=true`. Desligada, o
 * envio é no-op silencioso (a aprovação segue pendente e visível no app). É assim
 * que a staging fica MUDA sem código condicional espalhado (D8).
 */
export function dmChatHabilitada(): boolean {
  return (process.env.GOOGLE_CHAT_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

// ── Token (SA impersonando o subject) ────────────────────────────────────────

let _cached: { token: string; expiresAt: number; sub: string } | null = null;

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlStr(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importKey(pemBase64: string): Promise<CryptoKey> {
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

async function getChatAccessToken(): Promise<string> {
  const sub = getChatDmSubject();
  const now = Math.floor(Date.now() / 1000);
  if (_cached && _cached.sub === sub && _cached.expiresAt > now + RENEW_MARGIN_SECS) {
    return _cached.token;
  }

  // Credencial dedicada de Chat com fallback para a SA do Sheets (padrão GMAIL_SA_*).
  const keyBase64 = process.env.CHAT_SA_KEY_BASE64 ?? process.env.GOOGLE_SA_KEY_BASE64;
  const clientEmail = process.env.CHAT_SA_CLIENT_EMAIL ?? process.env.GOOGLE_SA_CLIENT_EMAIL;
  if (!keyBase64 || !clientEmail) {
    throw new Error('CHAT_SA_* (ou GOOGLE_SA_*) são obrigatórios para enviar DM no Google Chat');
  }

  const header = base64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64urlStr(
    JSON.stringify({
      iss: clientEmail,
      sub, // impersonação via domain-wide delegation
      aud: TOKEN_URL,
      iat: now,
      exp: now + TOKEN_LIFETIME_SECS,
      scope: CHAT_SCOPES,
    }),
  );
  const key = await importKey(keyBase64);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  const jwt = `${header}.${payload}.${base64url(new Uint8Array(sig))}`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}` +
      `&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!resp.ok) {
    throw new Error(`Chat token exchange falhou (${resp.status}): ${await resp.text()}`);
  }
  const { access_token, expires_in } = (await resp.json()) as {
    access_token: string;
    expires_in: number;
  };
  _cached = { token: access_token, expiresAt: now + expires_in, sub };
  return access_token;
}

// ── Envio ────────────────────────────────────────────────────────────────────

/**
 * Envia uma DM privada para `email`. Devolve `true` quando a mensagem saiu.
 * NUNCA lança: o chamador é best-effort (a submissão não pode cair por causa da
 * notificação — D8). Casos que viram `false` (com log):
 *  - gate `GOOGLE_CHAT_DM_ENABLED` desligado (staging/rollout);
 *  - destino == remetente (a API do Chat não abre DM consigo mesmo);
 *  - credencial ausente ou erro da API.
 */
export async function enviarDmChat(
  email: string,
  // String = mensagem de texto puro. Objeto = corpo cru da API do Chat (`text` +
  // `cardsV2`), para quem quer cartão — quem monta o corpo é o chamador, este módulo
  // só cuida de credencial + espaço de DM.
  corpo: string | Record<string, unknown>,
): Promise<boolean> {
  const destino = (email ?? '').trim().toLowerCase();
  if (!destino) return false;

  if (!dmChatHabilitada()) {
    console.warn('[chat-dm] GOOGLE_CHAT_DM_ENABLED != true — DM suprimida (no-op).');
    return false;
  }
  if (destino === getChatDmSubject()) {
    console.warn('[chat-dm] destino == remetente — DM suprimida (não há DM consigo mesmo).');
    return false;
  }

  try {
    const token = await getChatAccessToken();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1) Espaço de DM (idempotente: reencontra o existente).
    const setup = await fetch(`${CHAT_API}/spaces:setup`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        space: { spaceType: 'DIRECT_MESSAGE' },
        memberships: [{ member: { name: `users/${destino}`, type: 'HUMAN' } }],
      }),
    });
    if (!setup.ok) {
      console.error(`[chat-dm] spaces:setup falhou (${setup.status}): ${await setup.text()}`);
      return false;
    }
    const space = (await setup.json()) as { name?: string };
    if (!space.name) {
      console.error('[chat-dm] spaces:setup não devolveu o nome do espaço.');
      return false;
    }

    // 2) Mensagem no espaço.
    const msg = await fetch(`${CHAT_API}/${space.name}/messages`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(typeof corpo === 'string' ? { text: corpo } : corpo),
    });
    if (!msg.ok) {
      console.error(`[chat-dm] envio da mensagem falhou (${msg.status}): ${await msg.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[chat-dm] falha ao enviar DM (não-fatal):', e);
    return false;
  }
}
