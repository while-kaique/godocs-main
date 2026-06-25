// Envio de e-mail pela Gmail API impersonando uma caixa @gocase.com (Service Account
// + domain-wide delegation). O e-mail sai de verdade do remetente (aparece nos
// "Enviados" dele e respostas voltam pra ele). Sem deps npm — monta o MIME na mão.
//
// PRÉ-REQUISITO no Workspace: DWD habilitada para o Client ID da SA com o escopo
// https://www.googleapis.com/auth/gmail.send (ver getGmailAccessToken em auth.ts).

import { getGmailAccessToken } from './auth';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const SENDER_NOME = 'GoDocs';

// Caixa impersonada (o "From" real). Override por env; default = time RPA & IA.
// ⚠️ Lido DENTRO da função (lazy): no runtime do worker `process` não existe no
// momento da avaliação do módulo — acessar process.env no topo quebra o bootstrap.
function getSender(): string {
  return process.env.GMAIL_SENDER ?? 'rpa_ia@gocase.com';
}

// base64 de uma string UTF-8 (btoa só lida com latin1 → precisa dos bytes UTF-8).
function base64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// base64url do MIME inteiro (formato exigido pelo campo `raw` da Gmail API).
function base64UrlUtf8(str: string): string {
  return base64Utf8(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Assunto com acentos precisa de encoded-word MIME (=?UTF-8?B?...?=).
function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${base64Utf8(subject)}?=`;
}

function buildRawMessage(from: string, to: string, subject: string, html: string): string {
  const headers = [
    `From: ${SENDER_NOME} <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');

  // Corpo HTML em base64 (UTF-8) preserva acentos de forma robusta.
  const body = base64Utf8(html);
  return base64UrlUtf8(`${headers}\r\n\r\n${body}`);
}

export async function sendGmail(to: string, subject: string, html: string): Promise<void> {
  const sender = getSender();
  const token = await getGmailAccessToken(sender);
  const raw = buildRawMessage(sender, to, subject, html);

  const res = await fetch(GMAIL_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail send error ${res.status}: ${err}`);
  }
}
