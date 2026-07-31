// Inspeciona as PERGUNTAS que o agente fez em cada projeto de um run do E2E.
//
// Para que serve: o harness valida as COLUNAS da planilha, não a conversa. Os pontos
// [1.3] "Processo alterado" e [1.4] "Ponteiro movido e onde verificar" são prompt-only
// (nada bloqueia o preview), então o único jeito de saber se o agente os cumpriu é ler a
// conversa e o memorial. Este script conta as perguntas por fase, marca as que casam com
// o [1.4] e diz se as duas seções chegaram ao memorial.
//
// Uso: node scripts/e2e/inspect-perguntas.mjs <runId>
//   E2E_BASE_URL=https://godocs-staging.devgogroup.com para apontar à staging.
import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { BASE_URL } from './lib/env.mjs';

const runId = process.argv[2];
if (!runId) {
  console.error('uso: node scripts/e2e/inspect-perguntas.mjs <runId>');
  process.exit(1);
}

const COOKIE = process.env.E2E_COOKIE ?? '';

async function get(path) {
  const r = await fetch(`${BASE_URL}${path}`, { headers: { Cookie: COOKIE } });
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r.json();
}

// Casa a pergunta do ponteiro (a) e a de onde conferir (b) — o texto exato varia com o LLM.
const PAT_PONTEIRO = /ponteiro|indicador que mudou|moveu de fato/i;
const PAT_FONTE = /onde .*(confer|verific|abrir)|qual relat[óo]rio|painel|dashboard|em que sistema/i;
const PAT_MAGNITUDE = /volume|frequ[êe]ncia|quantas vezes|quantos por/i;

const run = JSON.parse(readFileSync(new URL(`./.runs/${runId}.json`, import.meta.url), 'utf8'));
console.log(`\n🔍 Perguntas do agente — run "${runId}" contra ${run.baseUrl}\n`);

let totalPerguntas = 0;
let conversas = 0;

for (const r of run.results) {
  if (!r.projeto_id || r.error) {
    console.log(`— ${r.key}: ${r.error ? `FALHOU (${r.error})` : 'sem projeto_id'}`);
    continue;
  }
  let hist;
  try {
    hist = await get(`/api/chat/historico/${r.projeto_id}`);
  } catch (e) {
    console.log(`— ${r.key}: não consegui ler o histórico (${e.message})`);
    continue;
  }

  // ⚠️ O endpoint devolve um ARRAY JÁ ACHATADO de mensagens — não `{messages:[...]}` — e o
  // `content` é TEXTO PURO, com `options`/`fase`/`isPreview`/`isComplete` como campos irmãos
  // (não um JSON `{type,content}` como o orquestrador devolve na rota de chat). Ler como JSON
  // fazia toda conversa reportar 0 pergunta e 0 memorial — falso negativo silencioso.
  const msgs = Array.isArray(hist) ? hist : (hist.messages ?? hist.chat_messages ?? []);
  const perguntas = [];
  let memorial = '';
  for (const m of msgs) {
    if (m.role !== 'assistant') continue;
    const texto = String(m.content ?? '').replace(/\s+/g, ' ');
    const fase = m.fase ?? '—';
    // O memorial vive nos previews das fases financeiras (`saving_preview`/`receita_preview`).
    if (m.isPreview && /###\s*(Contexto|O que gera)/i.test(texto)) memorial = String(m.content);
    // Pergunta = turno do agente que não é preview/fechamento e que de fato pergunta
    // (termina em "?" ou traz opções para clicar).
    if (m.isPreview || m.isComplete) continue;
    if ((m.options?.length ?? 0) > 0 || /\?\s*$/.test(texto)) {
      perguntas.push({ fase, texto });
    }
  }

  conversas++;
  totalPerguntas += perguntas.length;

  const porFase = perguntas.reduce((acc, q) => ({ ...acc, [q.fase]: (acc[q.fase] ?? 0) + 1 }), {});
  const daPonteiro = perguntas.filter((q) => PAT_PONTEIRO.test(q.texto));
  const daFonte = perguntas.filter((q) => PAT_FONTE.test(q.texto));
  const daMagnitude = perguntas.filter((q) => PAT_MAGNITUDE.test(q.texto));

  const temSecao13 = /Processo alterado/i.test(memorial);
  const temSecao14 = /Ponteiro movido|onde verificar/i.test(memorial);

  console.log(`\n═══ ${r.key}  (${r.projeto_id})`);
  console.log(`    perguntas: ${perguntas.length} total — ${JSON.stringify(porFase)}`);
  console.log(`    [1.3] seção "Processo alterado" no memorial: ${temSecao13 ? '✅' : '❌ AUSENTE'}`);
  console.log(`    [1.4] seção "Ponteiro movido..." no memorial: ${temSecao14 ? '✅' : '❌ AUSENTE'}`);
  console.log(`    perguntas de ponteiro: ${daPonteiro.length} ${daPonteiro.length > 1 ? '⚠️ REPETIU' : ''}`);
  console.log(`    perguntas de fonte:    ${daFonte.length} ${daFonte.length > 1 ? '⚠️ REPETIU' : ''}`);
  console.log(`    perguntas de magnitude:${daMagnitude.length}`);
  for (const q of perguntas) console.log(`      [${q.fase}] ${q.texto.slice(0, 160)}`);
  if (memorial) {
    // O agente grava o [1.4] como rótulo em negrito dentro de "### Contexto", não como heading.
    const secao = memorial.match(/\*\*Ponteiro movido[^*]*\*\*[^\n]*/i) ?? memorial.match(/#+\s*Ponteiro movido[^#]*/i);
    if (secao) console.log(`    ── seção [1.4] gravada:\n       ${secao[0].replace(/\s+/g, ' ').slice(0, 400)}`);
  }
}

console.log(
  `\n📊 ${conversas} conversas · ${totalPerguntas} perguntas · média ${
    conversas ? (totalPerguntas / conversas).toFixed(1) : '—'
  } (baseline de produção: 6,4)\n`,
);
