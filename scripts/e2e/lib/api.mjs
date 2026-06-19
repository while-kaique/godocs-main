// Wrappers HTTP dos endpoints de chat/submissão do GoDocs.
// Endpoints /api/chat/* são públicos — a identidade vem de responsavel_email no payload.
import { BASE_URL } from './env.mjs';

async function post(path, body) {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path} → ${resp.status}: resposta não-JSON: ${text.slice(0, 300)}`);
  }
  if (!resp.ok) {
    throw new Error(`${path} → ${resp.status}: ${data?.error ?? text.slice(0, 300)}`);
  }
  return data;
}

// Rotas admin exigem o header de email (Godeploy injeta em prod; aqui mandamos
// explicitamente — só funciona se o gateway confiar/repassar o header).
async function postAdmin(path, body, email) {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-godeploy-user-email': email },
    body: JSON.stringify(body ?? {}),
  });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path} → ${resp.status}: resposta não-JSON: ${text.slice(0, 300)}`);
  }
  if (!resp.ok) {
    throw new Error(`${path} → ${resp.status}: ${data?.error ?? text.slice(0, 300)}`);
  }
  return data;
}

export const api = {
  iniciarSubmissao: (payload) => post('/api/chat/iniciar-submissao', payload),
  enviarMensagem: (payload) => post('/api/chat/enviar-mensagem', payload),
  iniciarSaving: (payload) => post('/api/chat/iniciar-saving', payload),
  iniciarReceita: (payload) => post('/api/chat/iniciar-receita', payload),
  atualizarMetadados: (payload) => post('/api/chat/atualizar-metadados', payload),
  atualizarTipos: (payload) => post('/api/chat/atualizar-tipos', payload),
  submeterValidacao: (payload) => post('/api/chat/submeter-validacao', payload),
  // Limpeza (admin)
  e2eCleanup: (email) => postAdmin('/api/admin/e2e-cleanup', {}, email),
  syncSheetsNow: (email) => postAdmin('/api/admin/sync-sheets-now', {}, email),
};

export const toBase64 = (texto) => Buffer.from(texto, 'utf8').toString('base64');
