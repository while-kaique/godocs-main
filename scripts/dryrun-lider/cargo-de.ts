// LEITURA PURA: cargo + isenção D20 + líderes derivados de um e-mail. Serve para escolher
// um autor NÃO-isento antes de validar a fila de pré-aprovação ponta a ponta.
//
//   ALVO=fulano@gocase.com npx vitest run --config scripts/dryrun-lider/cargo-de.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { getCargoDe, ehLideranca, getLideresDe } = await import('@/lib/areas/teamguide.server');

const ALVOS = (process.env.ALVO || 'luis.albuquerque@gocase.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

it('cargo, isenção e líderes', async () => {
  for (const alvo of ALVOS) {
    const cargo = await getCargoDe(alvo);
    const isento = await ehLideranca(alvo);
    const lideres = (await getLideresDe(alvo)).filter((l) => !!l.email);
    console.log(`\n=== ${alvo}`);
    console.log(`  cargo           : ${cargo ?? '‹sem cargo na TeamGuide›'}`);
    console.log(`  isento (D20)    : ${isento ? 'SIM → "Pré-aprovado", sem fila' : 'não → ENTRA em fila'}`);
    console.log(
      `  líderes         : ${lideres.length ? lideres.map((l) => `${l.nome ?? '?'} <${l.email}>`).join(', ') : '‹nenhum› → sem_lider'}`,
    );
    console.log(
      `  estado esperado : ${isento ? 'Pré-aprovado' : lideres.length ? 'Pré-pendente' : '—'}`,
    );
  }
});
