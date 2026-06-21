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

const MAX_TURNS = 40;
// Após muitos turnos NA MESMA fase, o agente às vezes fica reperguntando (loop) —
// força uma resposta firme de fechamento para destravar (visto no saving+receita pontual).
const TURNS_FASE_LOOP = 12;

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
  let faseAnterior = null;
  let turnsNaFase = 0;
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
    turnsNaFase = fase === faseAnterior ? turnsNaFase + 1 : 0;
    faseAnterior = fase;
    // Loop-breaker: muitos turnos na mesma fase (agente reperguntando) → fecha firme.
    const ans =
      turnsNaFase >= TURNS_FASE_LOOP && resp.type !== 'preview'
        ? { content: 'Os dados já estão corretos e completos conforme informado. Não há nada a alterar — finalize esta etapa.' }
        : await responder(resp, scenario);
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
  if (scenario.editVia === 'doc') {
    // Edição PESADA: reabre a conversa do agente enviando uma documentação nova
    // (atualizar-metadados reinicia a fase de doc) → o agente re-conversa e gera
    // um memorial NOVO. Depois passa pela fase de saving e re-submete como edição.
    const doc = scenario.editDoc ?? scenario.doc;
    const reset = await api.atualizarMetadados({
      projeto_id: projetoIdExistente,
      docs: [{ base64: toBase64(doc), filename: 'documentacao.txt' }],
    });
    await drive(projetoIdExistente, scenario, reset.response, { saving: false, receita: false });
  } else {
    // Edição LEVE: reabre só a fase de saving com os novos números.
    const resp = await api.iniciarSaving({ projeto_id: projetoIdExistente, ...scenario.saving });
    await drive(projetoIdExistente, scenario, resp, { saving: true, receita: false });
  }
  const sub = await api.submeterValidacao({ projeto_id: projetoIdExistente, modo: 'edicao' });
  return { projetoId: projetoIdExistente, ganho: sub.ganho ?? null, status: sub.status ?? null };
}

// Captura o memorial_calculo (enriquecido, COM R$ — o que vai para a coluna
// "Memorial anterior" na próxima edição) de um projeto JÁ submetido. Tolerante a
// falha (retorna null) — a validação do memorial é opcional por cenário.
async function capturarMemorial(projetoId) {
  try {
    const p = await api.getMeuProjeto(projetoId);
    return p?.memorial_calculo ?? null;
  } catch (e) {
    process.stdout.write(`    · (aviso) não capturei o memorial de ${projetoId}: ${e.message}\n`);
    return null;
  }
}

async function main() {
  console.log(`\n🚀 E2E run "${runId}" contra ${BASE_URL}`);
  console.log(`   Dono: ${OWNER_EMAIL}\n`);
  let cenarios = buildScenarios(runId);
  // E2E_ONLY=key1,key2 → roda só esses cenários (útil para a sanidade).
  const only = process.env.E2E_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
  if (only && only.length) {
    cenarios = cenarios.filter((c) => only.includes(c.key));
    console.log(`   (filtro E2E_ONLY: ${only.join(', ')} → ${cenarios.length} cenário(s))`);
  }
  const results = [];
  const idByKey = {};
  const memorialByKey = {}; // memorial_calculo capturado logo após a submissão (M0)

  for (const sc of cenarios) {
    const rotulo = sc.key + (sc.edicaoDe ? ` (edição de ${sc.edicaoDe})` : '') + (sc.baseOnly ? ' (base)' : '');
    console.log(`\n▶ ${rotulo}`);
    try {
      let out;
      let memorialAnterior = null; // M0 — memorial antes da edição (esperado em "Memorial anterior")
      let memorialNovo = null;     // M1 — memorial após a edição
      if (sc.edicaoDe) {
        const baseId = idByKey[sc.edicaoDe];
        if (!baseId) throw new Error(`Cenário base "${sc.edicaoDe}" não foi criado — pulei a edição.`);
        memorialAnterior = memorialByKey[sc.edicaoDe] ?? null; // capturado quando a base submeteu
        out = await runEdicao(sc, baseId);
        if (sc.memorialCheck) memorialNovo = await capturarMemorial(baseId);
      } else {
        out = await runNova(sc);
        idByKey[sc.key] = out.projetoId;
        // Captura o memorial logo após submeter (serve de M0 se este cenário for base de edição).
        if (!sc.especial) memorialByKey[sc.key] = await capturarMemorial(out.projetoId);
      }
      console.log(`  ✓ projeto_id=${out.projetoId} status=${out.status} ganho_total=${out.ganho?.ganho_total_mensal ?? '—'}`);
      results.push({
        key: sc.key, edicaoDe: sc.edicaoDe ?? null, nome: sc.nome ?? null,
        projeto_id: out.projetoId, especial: !!sc.especial, baseOnly: !!sc.baseOnly,
        complexidade: sc.complexidade ?? null,
        memorial_check: !!sc.memorialCheck,
        memorial_anterior_esperado: memorialAnterior,
        memorial_novo: memorialNovo,
        expected: sc.expected, api_ganho: out.ganho, api_status: out.status,
      });
    } catch (e) {
      console.error(`  ✗ FALHOU: ${e.message}`);
      results.push({ key: sc.key, edicaoDe: sc.edicaoDe ?? null, baseOnly: !!sc.baseOnly, error: e.message, expected: sc.expected });
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
