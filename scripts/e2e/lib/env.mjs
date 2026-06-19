// Carrega o .env da raiz do projeto para process.env (sem dependência externa).
// Import por efeito colateral: `import './env.mjs'` no topo de cada script.
// Mesmo padrão de scripts/test-llm-proxy.mjs.
import { readFileSync } from 'node:fs';

const envUrl = new URL('../../../.env', import.meta.url);
try {
  for (const line of readFileSync(envUrl, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
} catch (e) {
  console.warn('[e2e/env] não consegui ler .env:', e.message);
}

export const BASE_URL =
  process.env.E2E_BASE_URL?.trim() || 'https://godocs.devgogroup.com';

// Dono dos projetos de teste (aparece em Meus Projetos e nas colunas E/F da planilha).
export const OWNER_EMAIL =
  process.env.E2E_OWNER_EMAIL?.trim() || 'luis.albuquerque@gocase.com';

export const OWNER_NOME = process.env.E2E_OWNER_NOME?.trim() || 'Luis Albuquerque';
