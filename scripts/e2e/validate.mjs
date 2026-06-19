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
  const rows = await readAllRows();
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
