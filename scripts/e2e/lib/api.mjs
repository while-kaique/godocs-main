// Wrappers HTTP dos endpoints de chat/submissão do GoDocs.
//
// O gateway Godeploy exige OAuth no EDGE para todas as rotas (inclusive /api/*):
// requisições não autenticadas levam 302 → /auth/login. Por isso replicamos o
// COOKIE de sessão de um usuário logado (E2E_COOKIE). O edge valida o cookie e
// injeta o x-godeploy-user-email a partir dele — cobre chat E admin com o mesmo
// cookie (desde que o usuário logado seja admin, ex.: luis.albuquerque@gocase.com).
import { BASE_URL } from './env.mjs';

const COOKIE = process.env.E2E_COOKIE?.trim() || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// O storage do Godeploy (Durable Object) ocasionalmente estoura timeout transitório
// ("Durable Object storage operation exceeded timeout") ou a conexão cai
// ("fetch failed"). Retentamos em 5xx / timeout / erro de rede.
function ehTransitorio(msg) {
  return /\b5\d\d\b/.test(msg) || /Durable Object|timeout|reset|Network connection|fetch failed|ECONNRESET|ETIMEDOUT|socket|terminated/i.test(msg);
}

async function request(path, body, tentativas = 3, method = 'POST') {
  if (!COOKIE) {
    throw new Error('E2E_COOKIE ausente — defina o cookie de sessão (logado em godocs.devgogroup.com) no .env ou no ambiente.');
  }
  let ultimoErro;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const resp = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
        redirect: 'manual', // não seguir o 302 do login — queremos detectá-lo
      });
      if (resp.status >= 300 && resp.status < 400) {
        throw new Error(`${path} → ${resp.status} (redirect p/ login). Sessão não autenticada: E2E_COOKIE inválido/expirado.`);
      }
      const text = await resp.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`${path} → ${resp.status}: resposta não-JSON (provável tela de login): ${text.slice(0, 200)}`);
      }
      if (!resp.ok) {
        throw new Error(`${path} → ${resp.status}: ${data?.error ?? text.slice(0, 300)}`);
      }
      return data;
    } catch (e) {
      ultimoErro = e;
      if (i < tentativas && ehTransitorio(e.message) && !/não autenticada/.test(e.message)) {
        await sleep(1500 * i);
        continue;
      }
      throw e;
    }
  }
  throw ultimoErro;
}

const post = (path, body) => request(path, body);
const postAdmin = (path, body) => request(path, body);
const get = (path) => request(path, null, 3, 'GET');

export const api = {
  iniciarSubmissao: (payload) => post('/api/chat/iniciar-submissao', payload),
  enviarMensagem: (payload) => post('/api/chat/enviar-mensagem', payload),
  iniciarSaving: (payload) => post('/api/chat/iniciar-saving', payload),
  iniciarReceita: (payload) => post('/api/chat/iniciar-receita', payload),
  atualizarMetadados: (payload) => post('/api/chat/atualizar-metadados', payload),
  atualizarTipos: (payload) => post('/api/chat/atualizar-tipos', payload),
  submeterValidacao: (payload) => post('/api/chat/submeter-validacao', payload),
  // GET do projeto (dono/admin) — usado para capturar o memorial_calculo (com R$,
  // o que vai para a coluna "Memorial anterior" na próxima edição) ANTES do update.
  getMeuProjeto: (id) => get(`/api/meus-projetos/${id}`),
  // Limpeza (admin) — identidade vem do cookie (edge injeta o email).
  e2eCleanup: () => postAdmin('/api/admin/e2e-cleanup', {}),
  syncSheetsNow: () => postAdmin('/api/admin/sync-sheets-now', {}),
};

export const toBase64 = (texto) => Buffer.from(texto, 'utf8').toString('base64');
