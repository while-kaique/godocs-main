// Runner E2E: executa cada cenário de ponta a ponta contra a aplicação (default:
// produção), dirigindo o chat com o LLM responder, e grava os resultados em
// scripts/e2e/.runs/<runId>.json para o validador/limpeza.
//
//   node --experimental-strip-types scripts/e2e/run.mjs [runId]
//
// Pré-requisitos: guard de Chat mudo já deployado (projetos "[E2E-" não notificam).
import './lib/env.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { BASE_URL, OWNER_EMAIL, OWNER_NOME } from './lib/env.mjs';
import { api, toBase64 } from './lib/api.mjs';
import { responder } from './lib/responder.mjs';
import { buildScenarios } from './scenarios.mjs';

const MAX_TURNS = 30;

function defaultRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const runId = process.argv[2] || defaultRunId();

// Dirige a conversa até o chat completar (isComplete), iniciando as fases
// determinísticas (saving/receita) quando o agente transiciona para elas.
async function drive(projetoId, scenario, initialResp, initiated) {
  let resp = initialResp;
  let turns = 0;
  while (resp && !resp.isComplete) {
    const fase = resp.fase;
    if (fase === 'saving' && scenario.saving && !initiated.saving) {
      initiated.saving = true;
      resp = await api.iniciarSaving({ projeto_id: projetoId, ...scenario.saving });
      continue;
    }
    if (fase === 'receita' && scenario.receita && !initiated.receita) {
      initiated.receita = true;
      resp = await api.iniciarReceita({ projeto_id: projetoId, ...scenario.receita });
      continue;
    }
    const ans = await responder(resp, scenario);
    process.stdout.write(`    · [${fase}] ${resp.type} → "${String(ans.content).slice(0, 60)}"\n`);
    resp = await api.enviarMensagem({
      projeto_id: projetoId,
      content: ans.content,
      ...(ans.selected_option != null ? { selected_option: ans.selected_option } : {}),
    });
    if (++turns > MAX_TURNS) {
      throw new Error(`Excedeu ${MAX_TURNS} turnos (fase atual: ${resp?.fase}).`);
    }
  }
  return resp;
}

async function runNova(scenario) {
  const payload = {
    responsavel_nome: OWNER_NOME,
    responsavel_email: OWNER_EMAIL,
    nome_projeto: scenario.nome,
    tipos_projeto: scenario.tipos_projeto,
    ...scenario.meta,
    docs: [{ base64: toBase64(scenario.doc), filename: 'documentacao.txt' }],
    ...(scenario.especial ? { especial: true, contexto_especial: scenario.contexto_especial } : {}),
  };
  const init = await api.iniciarSubmissao(payload);
  const projetoId = init.projeto_id;
  if (!(scenario.especial || init.especial)) {
    await drive(projetoId, scenario, init.response, { saving: false, receita: false });
  }
  const sub = await api.submeterValidacao({ projeto_id: projetoId, modo: 'novo' });
  return { projetoId, ganho: sub.ganho ?? null, status: sub.status ?? null };
}

async function runEdicao(scenario, projetoIdExistente) {
  // Reabre a fase de saving com os novos números e re-submete como edição.
  const resp = await api.iniciarSaving({ projeto_id: projetoIdExistente, ...scenario.saving });
  await drive(projetoIdExistente, scenario, resp, { saving: true, receita: false });
  const sub = await api.submeterValidacao({ projeto_id: projetoIdExistente, modo: 'edicao' });
  return { projetoId: projetoIdExistente, ganho: sub.ganho ?? null, status: sub.status ?? null };
}

async function main() {
  console.log(`\n🚀 E2E run "${runId}" contra ${BASE_URL}`);
  console.log(`   Dono: ${OWNER_EMAIL}\n`);
  const cenarios = buildScenarios(runId);
  const results = [];
  const idByKey = {};

  for (const sc of cenarios) {
    const rotulo = sc.key + (sc.edicaoDe ? ` (edição de ${sc.edicaoDe})` : '');
    console.log(`\n▶ ${rotulo}`);
    try {
      let out;
      if (sc.edicaoDe) {
        const baseId = idByKey[sc.edicaoDe];
        if (!baseId) throw new Error(`Cenário base "${sc.edicaoDe}" não foi criado — pulei a edição.`);
        out = await runEdicao(sc, baseId);
      } else {
        out = await runNova(sc);
        idByKey[sc.key] = out.projetoId;
      }
      console.log(`  ✓ projeto_id=${out.projetoId} status=${out.status} ganho_total=${out.ganho?.ganho_total_mensal ?? '—'}`);
      results.push({
        key: sc.key, edicaoDe: sc.edicaoDe ?? null, nome: sc.nome ?? null,
        projeto_id: out.projetoId, especial: !!sc.especial,
        expected: sc.expected, api_ganho: out.ganho, api_status: out.status,
      });
    } catch (e) {
      console.error(`  ✗ FALHOU: ${e.message}`);
      results.push({ key: sc.key, edicaoDe: sc.edicaoDe ?? null, error: e.message, expected: sc.expected });
    }
  }

  const dir = new URL('./.runs/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`./.runs/${runId}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({ runId, baseUrl: BASE_URL, owner: OWNER_EMAIL, results }, null, 2));
  console.log(`\n💾 Resultados salvos em scripts/e2e/.runs/${runId}.json`);
  console.log(`   Próximo: node --experimental-strip-types scripts/e2e/validate.mjs ${runId}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
