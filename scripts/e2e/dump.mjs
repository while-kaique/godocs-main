// Dump COMPLETO (todas as colunas A→AJ) das linhas de um run, para auditoria
// manual coluna-a-coluna. Não valida nada — só imprime o que está na planilha.
//   node --experimental-strip-types scripts/e2e/dump.mjs <runId> [runId2 ...]
import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { readAllRows } from './lib/sheets.mjs';

const runIds = process.argv.slice(2);
if (!runIds.length) { console.error('Uso: dump.mjs <runId> [...]'); process.exit(1); }

const wanted = new Map(); // id -> {key, edicaoDe, baseOnly}
for (const runId of runIds) {
  const { results } = JSON.parse(readFileSync(new URL(`./.runs/${runId}.json`, import.meta.url), 'utf8'));
  for (const r of results) {
    if (r.projeto_id) wanted.set(String(r.projeto_id).trim().toLowerCase(), { key: r.key, edicaoDe: r.edicaoDe, baseOnly: r.baseOnly, runId });
  }
}

const rows = await readAllRows();
const byId = new Map(rows.map((r) => [String(r['ID Projeto'] ?? '').trim().toLowerCase(), r]));

for (const [id, meta] of wanted) {
  const row = byId.get(id);
  console.log(`\n========================================================`);
  console.log(`KEY: ${meta.key}${meta.edicaoDe ? ` (edição de ${meta.edicaoDe})` : ''}${meta.baseOnly ? ' [baseOnly]' : ''}  | id=${id}`);
  console.log(`========================================================`);
  if (!row) { console.log('   (linha não encontrada na planilha)'); continue; }
  for (const col of Object.keys(row)) {
    const v = row[col];
    const s = v == null ? '' : String(v);
    const show = s.length > 200 ? s.slice(0, 200) + `…(${s.length}c)` : s;
    console.log(`  ${col.padEnd(28)} | ${JSON.stringify(show)}`);
  }
}
