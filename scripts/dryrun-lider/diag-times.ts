// DIAGNÓSTICO (leitura pura): a árvore de times da TeamGuide vista pela lente da
// ISENÇÃO D11. Para o ALVO, mostra QUAL time ele/ela lidera e onde ele pendura; e mede,
// na org inteira, quantas das lideranças NÃO têm liderado nenhum — o padrão "time de uma
// pessoa só" que faz a isenção pegar quem não lidera ninguém.
//
// ⚠️ A contagem de membros por time vem do ÍNDICE do GoDocs (`buildLiderancaIndex`, que
// pagina `/teams/{id}/members`), NÃO de `/employees/refs` — o `refs` não devolve
// `teamsIds`, e usá-lo faz TODO time parecer vazio (falso "0 membros").
//
// Rodar:  ALVO=fabl npx vitest run --config scripts/dryrun-lider/diag-times.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const BASE = 'https://api.teamguide.app';
const ALVO = (process.env.ALVO || 'fabl').toLowerCase();
const norm = (s?: string | null) => (s ?? '').toLowerCase().trim();

type TGTeam = {
  id: string;
  name: string;
  teamParent: string | null;
  leader?: { id: string; name: string } | null;
  deleted?: boolean;
};

it('times, líderes e liderados — lente da isenção D11', async () => {
  const { buildLiderancaIndex, listarPessoasTeamGuide } = await import(
    '@/lib/areas/teamguide.server'
  );
  const token = process.env.TG_API_TOKEN!;
  const teams = ((await (
    await fetch(BASE + '/teams', { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as TGTeam[])
    .map((t) => ({
      ...t,
      id: String(t.id),
      teamParent: t.teamParent == null ? null : String(t.teamParent),
      leader: t.leader ? { ...t.leader, id: String(t.leader.id) } : t.leader,
    }))
    .filter((t) => !t.deleted);
  const nomeTime = new Map(teams.map((t) => [t.id, t.name]));

  const { lideresPorEmail, lideradosPorEmail, liderancasPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const nomePorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.nome]));

  console.log(`Times ativos: ${teams.length} · lideranças: ${liderancasPorEmail.size}`);

  // ── O ALVO ────────────────────────────────────────────────────────────────
  for (const p of pessoas.filter(
    (p) => norm(p.email).includes(ALVO) || norm(p.nome).includes(ALVO),
  )) {
    const email = norm(p.email);
    const lidera = teams.filter((t) => norm(t.leader?.name) === norm(p.nome));
    console.log(`\n=== ${p.nome} <${email}> ===`);
    for (const t of lidera) {
      console.log(`  lidera "${t.name}" (pai: "${nomeTime.get(String(t.teamParent)) ?? '—'}")`);
    }
    console.log(`  líder dele(a): ${(lideresPorEmail.get(email) ?? []).map((l) => l.email).join(', ') || 'nenhum'}`);
    const lid = lideradosPorEmail.get(email) ?? [];
    console.log(`  liderados de fato: ${lid.length} ${lid.map((x) => x.email).join(', ')}`);
  }

  // ── O cargo separa liderança de IC? Cruza cargo × tem-liderado nas 108 ─────
  const CHEFIA = /(coordenad|supervisor|gerent|head|diretor|c[eo]o|cto|cfo|s[óo]ci)/i;
  let cargoChefiaSemLiderado = 0;
  let cargoICComLiderado = 0;
  const icComLiderado: string[] = [];
  for (const e of liderancasPorEmail) {
    const cargo = pessoas.find((p) => p.email.toLowerCase() === e)?.cargo ?? '';
    const tem = (lideradosPorEmail.get(e) ?? []).length > 0;
    if (CHEFIA.test(cargo) && !tem) cargoChefiaSemLiderado++;
    if (!CHEFIA.test(cargo) && tem) {
      cargoICComLiderado++;
      icComLiderado.push(`${e} — "${cargo || '—'}" (${(lideradosPorEmail.get(e) ?? []).length} liderados)`);
    }
  }
  console.log(
    `\n=== Cargo × liderados (nas ${liderancasPorEmail.size} lideranças) ===\n` +
      `  cargo de chefia MAS sem liderado: ${cargoChefiaSemLiderado}\n` +
      `  cargo de IC MAS com liderado: ${cargoICComLiderado}`,
  );
  for (const x of icComLiderado.sort()) console.log(`     ${x}`);

  // ── Org inteira: lideranças SEM liderado ──────────────────────────────────
  const semLiderado = [...liderancasPorEmail].filter((e) => !(lideradosPorEmail.get(e) ?? []).length);
  console.log(
    `\n=== Lideranças SEM nenhum liderado: ${semLiderado.length} de ${liderancasPorEmail.size} ===`,
  );
  const cargoPorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.cargo ?? '—']));
  for (const e of semLiderado.sort()) {
    console.log(`   [cargo] ${e} → "${cargoPorEmail.get(e)}"`);
    const meus = teams.filter((t) => norm(t.leader?.name) === norm(nomePorEmail.get(e) ?? '~~'));
    for (const t of meus) {
      const filhos = teams.filter((f) => f.teamParent === t.id);
      const nomePessoa = norm(nomePorEmail.get(e) ?? '');
      const primeiro = nomePessoa.split(' ')[0] ?? '';
      const ehNodoPessoal = primeiro.length > 2 && norm(t.name).includes(primeiro);
      console.log(
        `   ${e} — "${t.name}" · filhos: ${filhos.length} · ` +
          `${ehNodoPessoal ? 'NÓ PESSOAL (nome do time = nome da pessoa)' : 'time real sem gente alocada'}`,
      );
    }
  }
});
