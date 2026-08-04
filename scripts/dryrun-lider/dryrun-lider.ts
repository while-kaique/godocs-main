// DRY-RUN da pré-aprovação do líder sobre a aba GoDocs de PRODUÇÃO.
// 100% LEITURA: readAllRows (Sheets) + índice de liderança da TeamGuide. Não escreve
// nada em lugar nenhum e não manda DM.
//
// Pergunta que responde: se ligássemos a fila HOJE para os projetos pendentes da
// planilha de prod, quem receberia DM, quantas mensagens e quantos projetos cada líder
// veria em /aprovacoes.

import fs from 'node:fs';
import { it } from 'vitest';

// Carrega o .env do repo PRINCIPAL (este worktree não tem .env próprio). Sem
// GOOGLE_SHEETS_ID/TAB, o código cai no default = planilha e aba `GoDocs` de PRODUÇÃO,
// que é exatamente o que queremos ler aqui.
for (const linha of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { readAllRows } = await import('@/lib/google/sheets');
const { getLideresDe, ehLideranca, listarPessoasTeamGuide } = await import(
  '@/lib/areas/teamguide.server'
);

// Base ATIVA da TeamGuide — usada só para separar "não tem líder de verdade" (topo da
// cadeia, D6) de "a pessoa não está na TeamGuide" (desligada / e-mail diferente do
// cadastro), que o `getLideresDe` devolve igual: lista vazia.
const ativos = new Set(
  (await listarPessoasTeamGuide()).map((p) => p.email.trim().toLowerCase()),
);

const txt = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) =>
  txt(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

type Caso = {
  id: string;
  projeto: string;
  autor: string;
  email: string;
  status: string;
  aprovacao: string;
  lideres: { email: string; nome: string | null }[];
  desfecho: 'fila' | 'lideranca' | 'sem_lider' | 'sem_email';
};

async function main() {
  const rows = await readAllRows();
  console.log(`Linhas na aba: ${rows.length}`);

  // "Pendente" = o que hoje entraria em fila se submetesse: não descontinuado, não
  // reprovado, e ainda sem parecer do líder. A coluna Status é a régua de exibição da
  // planilha (regra TEMPORÁRIA grava "Pendente" para tudo).
  const pendentes = rows.filter((r) => {
    const st = norm(r['Status']);
    if (!st) return false;
    // PENDENTE DE VERDADE: só quem ainda espera parecer da triagem. "Aprovado" e
    // "Descontinuado" ficam fora (a 1ª versão deste dry-run os incluía e inflava a
    // conta — 490 das 568 linhas eram "Aprovado").
    if (st !== 'pendente' && st !== 'reenvio pendente') return false;
    const apr = norm(r['Aprovação do Líder']);
    // Já decidido pelo líder não entraria de novo (só o reenvio reabre — D10).
    if (apr.startsWith('pre-aprovado') || apr.startsWith('pre-reprovado')) return false;
    return true;
  });
  console.log(`Pendentes considerados: ${pendentes.length}`);
  // Transparência do filtro: QUAIS valores de Status entraram (e quais ficaram fora).
  const contar = (lista: typeof rows) => {
    const m = new Map<string, number>();
    for (const r of lista) m.set(txt(r['Status']) || '(vazio)', (m.get(txt(r['Status']) || '(vazio)') ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log('-- Status DENTRO do filtro:');
  for (const [k, n] of contar(pendentes)) console.log(`   ${k}: ${n}`);
  console.log('-- Status FORA do filtro:');
  const dentro = new Set(pendentes);
  for (const [k, n] of contar(rows.filter((r) => !dentro.has(r)))) console.log(`   ${k}: ${n}`);

  const casos: Caso[] = [];
  const emailsVistos = new Map<string, { lideres: Caso['lideres']; lideranca: boolean }>();

  for (const r of pendentes) {
    const email = txt(r['Email']).toLowerCase();
    const base = {
      id: txt(r['ID Projeto']) || '(sem id)',
      projeto: txt(r['Projeto']) || '(sem nome)',
      autor: txt(r['Nome Completo']) || '—',
      email,
      status: txt(r['Status']),
      aprovacao: txt(r['Aprovação do Líder']) || '—',
    };
    if (!email) {
      casos.push({ ...base, lideres: [], desfecho: 'sem_email' });
      continue;
    }
    let info = emailsVistos.get(email);
    if (!info) {
      const [lideres, lideranca] = await Promise.all([getLideresDe(email), ehLideranca(email)]);
      info = { lideres: lideres.map((l) => ({ email: l.email, nome: l.nome ?? null })), lideranca };
      emailsVistos.set(email, info);
    }
    const desfecho: Caso['desfecho'] = info.lideranca
      ? 'lideranca'
      : info.lideres.length === 0
        ? 'sem_lider'
        : 'fila';
    casos.push({ ...base, lideres: info.lideres, desfecho });
  }

  // ── Agregação por líder ────────────────────────────────────────────────────
  const porLider = new Map<
    string,
    { nome: string | null; projetos: Caso[]; liderados: Set<string> }
  >();
  for (const c of casos) {
    if (c.desfecho !== 'fila') continue;
    for (const l of c.lideres) {
      const cur = porLider.get(l.email) ?? { nome: l.nome, projetos: [], liderados: new Set() };
      cur.projetos.push(c);
      cur.liderados.add(c.email);
      porLider.set(l.email, cur);
    }
  }

  const entraFila = casos.filter((c) => c.desfecho === 'fila');
  const dms = entraFila.reduce((n, c) => n + c.lideres.length, 0);

  console.log('\n═══ RESUMO ═══');
  console.log(`Projetos que entrariam em fila: ${entraFila.length}`);
  console.log(`DMs que sairiam (1 por projeto × líder): ${dms}`);
  console.log(`Líderes envolvidos: ${porLider.size}`);
  console.log(`Isentos por liderança (D11): ${casos.filter((c) => c.desfecho === 'lideranca').length}`);
  console.log(`Sem líder na TeamGuide (D6): ${casos.filter((c) => c.desfecho === 'sem_lider').length}`);
  console.log(`Sem e-mail na planilha: ${casos.filter((c) => c.desfecho === 'sem_email').length}`);

  console.log('\n═══ POR LÍDER (fila em /aprovacoes) ═══');
  const ranking = [...porLider.entries()].sort((a, b) => b[1].projetos.length - a[1].projetos.length);
  for (const [email, info] of ranking) {
    // Visão pedida pelo Luis (04/08): "Lucas Queiroz (6): Luis Eduardo (2), X (2)…" —
    // o líder, o total que ele abre na fila e a quebra POR LIDERADO.
    const porAutor = new Map<string, { nome: string; projetos: Caso[] }>();
    for (const p of info.projetos) {
      const cur = porAutor.get(p.email) ?? { nome: p.autor, projetos: [] };
      cur.projetos.push(p);
      porAutor.set(p.email, cur);
    }
    const quebra = [...porAutor.values()]
      .sort((a, b) => b.projetos.length - a.projetos.length)
      .map((a) => `${a.nome} (${a.projetos.length})`)
      .join(', ');
    console.log(
      `\n${info.nome ?? email} (${info.projetos.length}) — ${info.projetos.length} DM(s), ` +
        `${porAutor.size} liderado(s): ${quebra}`,
    );
    for (const [, a] of [...porAutor].sort((x, y) => y[1].projetos.length - x[1].projetos.length)) {
      console.log(`   ${a.nome}:`);
      for (const p of a.projetos) console.log(`      · [${p.id}] ${p.projeto}`);
    }
  }

  const semLider = casos.filter((c) => c.desfecho === 'sem_lider');
  const naTG = semLider.filter((c) => ativos.has(c.email));
  const foraTG = semLider.filter((c) => !ativos.has(c.email));
  console.log(
    `\n═══ SEM LÍDER (D6) — ${naTG.length} de pessoa ATIVA na TeamGuide, ` +
      `${foraTG.length} de e-mail que NÃO está na base ativa ═══`,
  );
  console.log('-- ativos na TeamGuide, mas sem líder derivado (revisar a árvore):');
  for (const c of naTG) console.log(`   · [${c.id}] ${c.projeto} — ${c.autor} <${c.email}>`);
  console.log('-- e-mail fora da base ativa (desligado / e-mail diferente do cadastro):');
  for (const c of foraTG) console.log(`   · [${c.id}] ${c.projeto} — ${c.autor} <${c.email}>`);

  console.log('\n═══ ISENTOS POR LIDERANÇA (D11) ═══');
  const porAutorIsento = new Map<string, number>();
  for (const c of casos.filter((c) => c.desfecho === 'lideranca')) {
    porAutorIsento.set(c.email, (porAutorIsento.get(c.email) ?? 0) + 1);
  }
  for (const [e, n] of [...porAutorIsento].sort((a, b) => b[1] - a[1])) {
    console.log(`   · ${e} — ${n} projeto(s)`);
  }

  console.log('\n═══ SEM E-MAIL NA PLANILHA ═══');
  for (const c of casos.filter((c) => c.desfecho === 'sem_email')) {
    console.log(`   · [${c.id}] ${c.projeto} — ${c.autor}`);
  }

  // Distribuição da carga: quantos líderes receberiam 1, 2, 3+ projetos.
  console.log('\n═══ DISTRIBUIÇÃO DA CARGA ═══');
  const faixas = new Map<string, number>();
  for (const [, info] of porLider) {
    const n = info.projetos.length;
    const faixa = n === 1 ? '1 projeto' : n <= 3 ? '2–3 projetos' : n <= 9 ? '4–9 projetos' : '10+ projetos';
    faixas.set(faixa, (faixas.get(faixa) ?? 0) + 1);
  }
  for (const [f, n] of faixas) console.log(`   ${f}: ${n} líder(es)`);
}

it('dry-run da pré-aprovação sobre a aba GoDocs de produção', main);
