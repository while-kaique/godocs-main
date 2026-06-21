// Validador E2E: lê a planilha de produção, casa cada projeto pelo "ID Projeto" e
// compara coluna-a-coluna contra o `expected` do cenário. Duas camadas:
//   1) Fórmula independente (cargos × horas, custo evitado ÷12 pontual, etc.)
//   2) Consistência: "Ganho Total" da planilha × valor retornado pela API.
//
//   node --experimental-strip-types scripts/e2e/validate.mjs <runId>
import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { readAllRows } from './lib/sheets.mjs';

const runId = process.argv[2];
if (!runId) { console.error('Uso: validate.mjs <runId>'); process.exit(1); }

const file = new URL(`./.runs/${runId}.json`, import.meta.url);
const { results, owner } = JSON.parse(readFileSync(file, 'utf8'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// O analisador preenche "Complexidade" (AC) em background (+ cron a cada 1 min).
// Relê a planilha até as linhas que esperam complexidade terem AC preenchida, ou
// até estourar o timeout. Projetos especiais NÃO passam pelo analisador → ignorados.
async function lerRowsComPollDeComplexidade() {
  const idsEsperandoAC = new Set(
    results
      .filter((r) => !r.error && !r.especial && r.complexidade && r.complexidade.gateHard)
      .map((r) => String(r.projeto_id).trim().toLowerCase()),
  );
  const MAX_TENTATIVAS = 12; // ~5 min (12 × 25s)
  let rows = await readAllRows();
  if (idsEsperandoAC.size === 0) return rows;
  for (let i = 1; i <= MAX_TENTATIVAS; i++) {
    const byId = new Map(rows.map((r) => [String(r['ID Projeto'] ?? '').trim().toLowerCase(), r]));
    const faltando = [...idsEsperandoAC].filter((id) => {
      const ac = String(byId.get(id)?.['Complexidade'] ?? '').trim();
      return ac === '' || ac === '—';
    });
    if (faltando.length === 0) break;
    console.log(`   ⏳ aguardando Complexidade (analisador) — faltam ${faltando.length} (tentativa ${i}/${MAX_TENTATIVAS})…`);
    await sleep(25000);
    rows = await readAllRows();
  }
  return rows;
}

// Normalização numérica tolerante a formato pt-BR ("1.234,56") e en ("1234.56").
function toNum(v) {
  if (v == null) return null;
  let s = String(v).replace(/[R$\s]/g, '');
  if (s === '' || s === '—' || s === '-') return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function eqNum(a, b) {
  const na = toNum(a), nb = toNum(b);
  if (na == null || nb == null) return false;
  return Math.abs(na - nb) <= 0.02; // tolerância de centavos
}

function eqText(a, b) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

// Compara um valor esperado contra a célula. `null` esperado = "qualquer valor não-vazio".
// Valores numéricos usam tolerância; resto, igualdade textual case-insensitive.
function compara(col, esperado, atual, resolved) {
  if (esperado === null && resolved !== undefined) esperado = resolved; // placeholders (Email/Nome)
  if (esperado === null) {
    const ok = atual != null && String(atual).trim() !== '';
    return { ok, esperado: '(não-vazio)', atual };
  }
  if (typeof esperado === 'number') return { ok: eqNum(esperado, atual), esperado, atual };
  // "(preenchido...)" → só exige presença
  if (typeof esperado === 'string' && esperado.startsWith('(')) {
    return { ok: atual != null && String(atual).trim() !== '', esperado, atual };
  }
  return { ok: eqText(esperado, atual), esperado, atual };
}

async function main() {
  console.log(`\n🔎 Validando run "${runId}" contra a planilha…\n`);
  const rows = await lerRowsComPollDeComplexidade();
  const byId = new Map(rows.map((r) => [String(r['ID Projeto'] ?? '').trim().toLowerCase(), r]));

  // Placeholders resolvidos em runtime (não dependem do cenário).
  const resolved = { 'Email': owner, 'Nome Completo': undefined };

  let totalFail = 0;
  for (const r of results) {
    const titulo = r.key + (r.edicaoDe ? ` (edição)` : '');
    if (r.error) { console.log(`■ ${titulo}: ⚠️ não submetido (${r.error})`); totalFail++; continue; }

    const row = byId.get(String(r.projeto_id).trim().toLowerCase());
    console.log(`■ ${titulo}  [${r.projeto_id}]`);
    if (!row) { console.log(`   ✗ Linha NÃO encontrada na planilha (sync pendente?).`); totalFail++; continue; }

    // Base dedicada de edição: a linha é sobrescrita pela edição (UPDATE in-place),
    // então o estado final não corresponde à submissão original — não validamos
    // colunas standalone. A edição correspondente valida o estado final + memorial.
    if (r.baseOnly) {
      console.log(`   · base de edição — validação standalone pulada (linha reflete a edição).`);
      console.log(`   → OK (base)`);
      continue;
    }

    const hard = r.expected?.hard ?? {};
    const soft = r.expected?.soft ?? {};
    let fails = 0;

    for (const [col, esp] of Object.entries(hard)) {
      const { ok, esperado, atual } = compara(col, esp, row[col], resolved[col]);
      if (!ok) fails++;
      console.log(`   ${ok ? '✓' : '✗'} [hard] ${col}: esperado=${JSON.stringify(esperado)} atual=${JSON.stringify(atual ?? null)}`);
    }
    for (const [col, esp] of Object.entries(soft)) {
      const { ok, esperado, atual } = compara(col, esp, row[col], resolved[col]);
      console.log(`   ${ok ? '✓' : '·'} [soft] ${col}: esperado=${JSON.stringify(esperado)} atual=${JSON.stringify(atual ?? null)}`);
    }

    // Complexidade (coluna AC) — preenchida pelo analisador.
    //   gate 'automacao'      → AC deve ser exatamente 'automacao' (IA=Não)  [HARD]
    //   gate 'nao-automacao'  → AC deve ser ≠ 'automacao' e não-vazia (IA=Sim) [HARD]
    // O nível fino (inteligencia ↔ autonomia) é julgamento do LLM → SOFT (revisão humana).
    const cx = r.complexidade;
    if (cx && cx.gateHard) {
      const acRaw = row['Complexidade'];
      const ac = String(acRaw ?? '').trim().toLowerCase();
      const okGate = cx.gateHard === 'automacao' ? ac === 'automacao' : (ac !== '' && ac !== '—' && ac !== 'automacao');
      if (!okGate) fails++;
      console.log(`   ${okGate ? '✓' : '✗'} [hard] Complexidade (gate ${cx.gateHard}): alvo=${cx.alvo} atual=${JSON.stringify(acRaw ?? null)}`);
      const okFino = ac === cx.alvo;
      const obs = String(row['Observações'] ?? '').replace(/\s+/g, ' ').slice(0, 140);
      console.log(`   ${okFino ? '✓' : '·'} [soft] Complexidade nível-fino: alvo=${cx.alvo} atual=${JSON.stringify(acRaw ?? null)}`);
      console.log(`       ↳ Observações(AC): ${JSON.stringify(obs || null)}`);
    } else if (cx && cx.alvo === 'especial') {
      console.log(`   · [info] Complexidade (especial — analisador não roda): atual=${JSON.stringify(row['Complexidade'] ?? null)}`);
    }

    // Memorial anterior (coluna AF) — só nos cenários de edição com memorialCheck.
    //   AF deve == memorial pré-edição capturado em run (M0)  [HARD]
    //   memorial novo (M1) deve diferir de M0 (nova conversa gerou memorial novo) [SOFT]
    if (r.memorial_check) {
      const af = String(row['Memorial anterior'] ?? '').trim();
      const m0 = String(r.memorial_anterior_esperado ?? '').trim();
      const m1 = String(r.memorial_novo ?? '').trim();
      const okAF = m0 !== '' && af === m0;
      if (!okAF) fails++;
      console.log(`   ${okAF ? '✓' : '✗'} [hard] Memorial anterior (AF) == memorial pré-edição (M0): ${okAF} (AF ${af.length}c · M0 ${m0.length}c)`);
      if (!okAF && m0 !== '') {
        console.log(`       ↳ AF: ${JSON.stringify(af.slice(0, 80))}`);
        console.log(`       ↳ M0: ${JSON.stringify(m0.slice(0, 80))}`);
      }
      const okNovo = m1 !== '' && m1 !== m0;
      console.log(`   ${okNovo ? '✓' : '·'} [soft] Memorial novo difere do anterior (M1 ≠ M0): ${okNovo} (M1 ${m1.length}c)`);
    }

    // Camada 2 — consistência Ganho Total: planilha × API.
    if (r.api_ganho?.ganho_total_mensal != null) {
      const ok = eqNum(r.api_ganho.ganho_total_mensal, row['Ganho Total']);
      if (!ok) fails++;
      console.log(`   ${ok ? '✓' : '✗'} [api] Ganho Total: API=${r.api_ganho.ganho_total_mensal} planilha=${JSON.stringify(row['Ganho Total'] ?? null)}`);
    }
    // Consistência Saving Reais: planilha × API (pega bug de escrita mesmo se a fórmula independente passar).
    if (r.api_ganho?.saving_reais != null) {
      const ok = eqNum(r.api_ganho.saving_reais, row['Saving Reais']);
      console.log(`   ${ok ? '✓' : '·'} [api] Saving Reais: API=${r.api_ganho.saving_reais} planilha=${JSON.stringify(row['Saving Reais'] ?? null)}`);
    }

    if (fails > 0) { totalFail++; console.log(`   → ${fails} falha(s) HARD`); }
    else console.log(`   → OK`);
  }

  console.log(`\n${totalFail === 0 ? '✅ Todos os cenários passaram' : `❌ ${totalFail} cenário(s) com falha/atenção`}\n`);
  process.exit(totalFail === 0 ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
