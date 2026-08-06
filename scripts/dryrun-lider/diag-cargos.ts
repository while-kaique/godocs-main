// DIAGNÓSTICO (leitura pura): a régua NOVA da isenção — não é "lidera alguém?", é
// "o CARGO é de coordenador pra cima?" (Luis, 05/08/2026). Levanta:
//   1. a cadeia real Fablícia → Kelly → acima, com o cargo de cada elo;
//   2. TODOS os cargos distintos da org, separados em ALTO / FRONTEIRA / BAIXO,
//      para a lista de cargos isentos ser DECLARADA (fonte única) e não um chute;
//   3. o efeito nos pendentes de hoje: quem fica isento e quem passa a ter fila,
//      comparado com a régua atual (é `leader` de time ativo).
//
// Rodar:  npx vitest run --config scripts/dryrun-lider/diag-cargos.config.ts
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();
const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Candidatos à régua do Luis: "coordenador, head, diretor, diretoria, gerente, ceo e
// líderes maiores assim (esses cargos pra cima)". SUPERVISOR fica FORA (o exemplo dele:
// a supervisora Kelly aprova a analista Fablícia, e a Kelly é aprovada pelo gerente).
const ALTO = /(coordenad|head|diretor|diretora|diretoria|gerent|\bceo\b|\bcto\b|\bcfo\b|\bcoo\b|\bcpo\b|\bvp\b|chief|presiden|superintend|s[óo]ci)/i;
// Cargos que PARECEM liderança mas ficam fora pela régua — os que você precisa julgar.
const FRONTEIRA = /(supervisor|\bl[íi]der\b|\bleader\b|\blead\b|encarregad|especialista|staff|principal|manager|owner|respons[áa]vel|master)/i;

it('cargos da org × régua nova da isenção', async () => {
  const { buildLiderancaIndex, listarPessoasTeamGuide } = await import(
    '@/lib/areas/teamguide.server'
  );
  const { readAllRows } = await import('@/lib/google/sheets');

  const pessoas = await listarPessoasTeamGuide();
  const { lideresPorEmail, liderancasPorEmail } = await buildLiderancaIndex();
  const cargoDe = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.cargo ?? '']));
  const nomeDe = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.nome]));

  // ── 1. A cadeia do exemplo ────────────────────────────────────────────────
  console.log('=== Cadeia Fablícia → acima (cargo de cada elo) ===');
  let atual = 'fablicia.lima@gocase.com';
  const vistos = new Set<string>();
  for (let i = 0; i < 8 && atual && !vistos.has(atual); i++) {
    vistos.add(atual);
    const cargo = cargoDe.get(atual) ?? '(fora da TeamGuide)';
    const marca = ALTO.test(cargo) ? 'ISENTO (cargo alto)' : 'precisa de pré-aprovação';
    console.log(`  ${nomeDe.get(atual) ?? atual} <${atual}> — "${cargo}" → ${marca}`);
    const lider = (lideresPorEmail.get(atual) ?? []).filter((l) => l.email)[0];
    if (!lider?.email) {
      console.log(`     ↑ sem líder acima (topo da árvore)`);
      break;
    }
    atual = String(lider.email).toLowerCase();
  }

  // ── 1b. Cadeias que o Luis citou, elo por elo ─────────────────────────────
  const cadeia = (de: string) => {
    console.log(`\n=== Cadeia de ${nomeDe.get(de) ?? de} ===`);
    let a = de;
    const v = new Set<string>();
    for (let i = 0; i < 8 && a && !v.has(a); i++) {
      v.add(a);
      const cargo = cargoDe.get(a) ?? '(fora da TeamGuide)';
      console.log(
        `  ${nomeDe.get(a) ?? a} — "${cargo}" → ${ALTO.test(cargo) ? 'ISENTO' : 'em fila'}`,
      );
      const l = (lideresPorEmail.get(a) ?? []).filter((x) => x.email)[0];
      if (!l?.email) break;
      a = String(l.email).toLowerCase();
    }
  };
  cadeia('arnaldo.viana@gocase.com');

  // ── 1c. Cargo ALTO × quantos liderados de fato (caça-falso-positivo) ──────
  const { lideradosPorEmail } = await buildLiderancaIndex();
  const altos = pessoas
    .filter((p) => ALTO.test(p.cargo ?? ''))
    .map((p) => ({
      ...p,
      n: (lideradosPorEmail.get(p.email.toLowerCase()) ?? []).length,
      lider: (lideresPorEmail.get(p.email.toLowerCase()) ?? []).filter((l) => l.email)[0]?.email ?? '—',
    }))
    .sort((a, b) => a.n - b.n || a.nome.localeCompare(b.nome, 'pt-BR'));
  console.log(`\n=== Cargo ALTO × liderados (${altos.length} pessoas) — os de 0 são suspeitos ===`);
  for (const a of altos) {
    console.log(`   ${String(a.n).padStart(2)} liderados · "${a.cargo}" · ${a.nome} <${a.email}> · líder: ${a.lider}`);
  }

  // ── 2. Cargos distintos da org ────────────────────────────────────────────
  const contagem = new Map<string, number>();
  for (const p of pessoas) contagem.set(p.cargo ?? '(sem cargo)', (contagem.get(p.cargo ?? '(sem cargo)') ?? 0) + 1);
  const buckets: Record<string, [string, number][]> = { ALTO: [], FRONTEIRA: [], BAIXO: [] };
  for (const [c, n] of contagem) {
    const b = ALTO.test(c) ? 'ALTO' : FRONTEIRA.test(c) ? 'FRONTEIRA' : 'BAIXO';
    buckets[b].push([c, n]);
  }
  for (const b of ['ALTO', 'FRONTEIRA', 'BAIXO'] as const) {
    const lista = buckets[b].sort((a, b2) => b2[1] - a[1] || a[0].localeCompare(b2[0], 'pt-BR'));
    const gente = lista.reduce((s, [, n]) => s + n, 0);
    console.log(`\n=== ${b}: ${lista.length} cargos distintos · ${gente} pessoas ===`);
    for (const [c, n] of lista) console.log(`   ${String(n).padStart(3)}× ${c}`);
  }

  // ── 3. Efeito nos pendentes ───────────────────────────────────────────────
  const rows = await readAllRows();
  const pendentes = rows.filter((r) => low(r['Status']) === 'pendente');
  const isentoNovo: string[] = [];
  const entraNaFila: string[] = [];
  const semLider: string[] = [];
  for (const r of pendentes) {
    const email = low(r['Email']);
    if (!email) continue;
    const cargo = cargoDe.get(email) ?? '';
    const rot = `${txt(r['ID Projeto'])} · ${nomeDe.get(email) ?? txt(r['Nome Completo'])} <${email}> — "${cargo || '(sem cargo)'}"`;
    if (ALTO.test(cargo)) {
      isentoNovo.push(rot);
      continue;
    }
    const lideres = (lideresPorEmail.get(email) ?? []).filter((l) => l.email);
    if (!lideres.length) {
      semLider.push(rot);
      continue;
    }
    const lid = String(lideres[0].email).toLowerCase();
    entraNaFila.push(
      `${rot}\n        → aprova: ${nomeDe.get(lid) ?? lid} <${lid}> ("${cargoDe.get(lid) || '—'}")` +
        (liderancasPorEmail.has(email) ? '   [hoje seria ISENTO pela régua atual]' : ''),
    );
  }
  const dump = (t: string, xs: string[]) => {
    console.log(`\n=== ${t} (${xs.length}) ===`);
    for (const x of [...new Set(xs)].sort()) console.log(`   ${x}`);
  };
  console.log(`\n### Pendentes: ${pendentes.length} · régua ATUAL isentava 21 linhas ###`);
  dump('ISENTOS pela régua NOVA (cargo alto)', isentoNovo);
  dump('SEM LÍDER (fica isento com motivo, como hoje)', semLider);
  dump('ENTRAM NA FILA', entraNaFila);
});
