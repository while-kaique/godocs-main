// DIAGNÓSTICO (leitura pura, NÃO escreve nada): por que uma pessoa NÃO apareceu na aba
// "Relação Líder-Liderado"? Cruza a aba `GoDocs` de prod com o índice de liderança da
// TeamGuide e imprime, filtro por filtro, onde a pessoa caiu — mais os 3 baldes de
// pendentes que ficaram FORA da relação (isentos por liderança · sem líder · sem e-mail).
//
// Rodar:  ALVO=fabl npx vitest run --config scripts/dryrun-lider/diag.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { readAllRows } = await import('@/lib/google/sheets');
const { buildLiderancaIndex, listarPessoasTeamGuide } = await import(
  '@/lib/areas/teamguide.server'
);

const ALVO = (process.env.ALVO || 'fabl').toLowerCase();
const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();

it('diagnóstico de uma pessoa na relação líder↔liderado', async () => {
  const rows = await readAllRows();
  const { lideresPorEmail, lideradosPorEmail, liderancasPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const emailsTG = new Set(pessoas.map((p) => p.email.toLowerCase()));

  const achadas = rows.filter((r) => low(r['Email']).includes(ALVO) || low(r['Nome Completo']).includes(ALVO));
  console.log(`\n=== "${ALVO}" na aba GoDocs (${achadas.length} linha(s)) ===`);
  for (const r of achadas) {
    const email = low(r['Email']);
    const lideres = (lideresPorEmail.get(email) ?? []).filter((l) => !!l.email);
    console.log(
      `  ID=${txt(r['ID Projeto'])} Status="${txt(r['Status'])}" Projeto="${txt(r['Projeto'])}"\n` +
        `     ${txt(r['Nome Completo'])} <${email}>  · na TeamGuide? ${emailsTG.has(email) ? 'sim' : 'NÃO'}\n` +
        `     é liderança (isenta D11)? ${liderancasPorEmail.has(email) ? 'SIM' : 'não'}` +
        ` · líder(es): ${lideres.map((l) => l.email).join(', ') || 'NENHUM'}`,
    );
    const liderados = lideradosPorEmail.get(email) ?? [];
    console.log(
      `     lidera ${liderados.length} pessoa(s): ${liderados.map((x) => x.email).slice(0, 12).join(', ') || '—'}`,
    );
  }

  // ── Baldes: todos os pendentes que ficaram FORA da relação ───────────────────
  const pendentes = rows.filter((r) => low(r['Status']) === 'pendente');
  const dentro: string[] = [];
  const isentos: string[] = [];
  const semLider: string[] = [];
  const semEmail: string[] = [];
  const foraDaTG: string[] = [];

  for (const r of pendentes) {
    const email = low(r['Email']);
    const rot = `${txt(r['ID Projeto'])} · ${txt(r['Nome Completo']) || '—'} <${email || 'sem e-mail'}>`;
    if (!email) {
      semEmail.push(rot);
      continue;
    }
    if (!emailsTG.has(email)) foraDaTG.push(rot);
    if (liderancasPorEmail.has(email)) {
      isentos.push(rot);
      continue;
    }
    const lideres = (lideresPorEmail.get(email) ?? []).filter((l) => !!l.email);
    if (!lideres.length) {
      semLider.push(rot);
      continue;
    }
    dentro.push(rot);
  }

  console.log(
    `\n=== Pendentes: ${pendentes.length} · na relação ${dentro.length} · ` +
      `isentos por liderança ${isentos.length} · sem líder ${semLider.length} · sem e-mail ${semEmail.length} ===`,
  );
  const dump = (t: string, xs: string[]) => {
    console.log(`\n-- ${t} (${xs.length}) --`);
    for (const x of [...new Set(xs)].sort()) console.log(`   ${x}`);
  };
  dump('ISENTOS por liderança (é líder de time ativo)', isentos);
  console.log('\n-- ISENTOS: quantos liderados cada um tem de fato --');
  const emailsIsentos = [...new Set(isentos.map((s) => s.replace(/^.*<|>$/g, '')))].sort();
  for (const e of emailsIsentos) {
    const n = (lideradosPorEmail.get(e) ?? []).length;
    const proprioLider = (lideresPorEmail.get(e) ?? []).map((l) => l.email).join(', ') || 'nenhum';
    console.log(`   ${n === 0 ? '⚠️ 0' : String(n).padStart(2)} liderados · ${e} · líder dele(a): ${proprioLider}`);
  }
  dump('SEM LÍDER na TeamGuide', semLider);
  dump('SEM E-MAIL na coluna Email', semEmail);
  dump('E-MAIL não existe na TeamGuide', foraDaTG);
});
