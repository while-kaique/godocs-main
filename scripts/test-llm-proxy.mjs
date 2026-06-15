// Teste real do roteamento de LLM pelo proxy, exercitando o código de verdade
// (src/lib/llm.ts → llmChat), com as env vars do .env. Bate na rede.
//   node --experimental-strip-types scripts/test-llm-proxy.mjs
import { readFileSync } from 'node:fs';

// Carrega o .env mínimo para process.env (sem dependência externa).
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  if (!line.includes('=') || line.trim().startsWith('#')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}

const { llmChat } = await import('../src/lib/llm.ts');

console.log('LLM_BASE_URL =', process.env.LLM_BASE_URL || '(não definida → modo direto)');
console.log('Provider     =', process.env.LLM_PROVIDER, '| Modelo =', process.env.LLM_MODEL);

const resposta = await llmChat(
  [{ role: 'user', content: 'Responda apenas com a palavra: funcionando' }],
  { maxTokens: 16 },
);

console.log('\n→ Resposta do proxy:', JSON.stringify(resposta));
console.log(resposta.toLowerCase().includes('funcionando') ? '\n✅ OK — proxy respondeu pelo código real.' : '\n⚠️ Respondeu, mas conteúdo inesperado.');
