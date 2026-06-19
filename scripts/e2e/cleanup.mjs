// Limpeza E2E: remove os dados de teste do run. ORDEM IMPORTA — planilha PRIMEIRO,
// depois SQLite. Se o SQLite for limpo antes, o sync reverso por dono
// (listarMeusProjetos) ressuscita os projetos a partir da planilha.
//
//   node --experimental-strip-types scripts/e2e/cleanup.mjs <runId>
//
// Remove da planilha as linhas dos projetos do run; depois chama o endpoint admin
// que apaga do SQLite TODOS os projetos "[E2E-..." (cascata).
import './lib/env.mjs';
import { readFileSync } from 'node:fs';
import { api } from './lib/api.mjs';
import { deleteRowsByProjectIds } from './lib/sheets.mjs';

const runId = process.argv[2];
if (!runId) { console.error('Uso: cleanup.mjs <runId>'); process.exit(1); }

const file = new URL(`./.runs/${runId}.json`, import.meta.url);
const { results } = JSON.parse(readFileSync(file, 'utf8'));
const ids = [...new Set(results.filter((r) => r.projeto_id).map((r) => r.projeto_id))];

async function main() {
  console.log(`\n🧹 Limpeza do run "${runId}" — ${ids.length} projeto(s).`);

  // 1) Planilha primeiro.
  console.log('  1/3 Removendo linhas da planilha…');
  const removidos = await deleteRowsByProjectIds(ids);
  console.log(`      removidas ${removidos.length} linha(s): ${removidos.join(', ') || '(nenhuma)'}`);

  // 2) SQLite (todos os [E2E-...] — pega também órfãos de runs anteriores).
  console.log('  2/3 Removendo do SQLite (admin e2e-cleanup)…');
  try {
    const out = await api.e2eCleanup();
    console.log(`      SQLite: ${out.deletados} projeto(s) removido(s).`);
  } catch (e) {
    console.error(`      ⚠️ Falha no e2e-cleanup (header admin pode não ser aceito pelo gateway): ${e.message}`);
  }

  // 3) Confirma que o sync reverso não ressuscita.
  console.log('  3/3 Disparando sync reverso para confirmar que nada ressuscita…');
  try {
    await api.syncSheetsNow();
    console.log('      sync reverso disparado.');
  } catch (e) {
    console.error(`      ⚠️ Falha ao disparar sync-sheets-now: ${e.message}`);
  }

  console.log('\n✅ Limpeza concluída.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
