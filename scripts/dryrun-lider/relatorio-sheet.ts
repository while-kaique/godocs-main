// RELATÓRIO líder↔liderado numa ABA NOVA da planilha de produção (pedido do Luis,
// 04/08/2026: "meu chefe precisa ver de forma organizada e avaliar se está tudo certo").
//
// ⚠️ ESCREVE no Sheets, mas SÓ numa aba nova e dedicada — nunca na `GoDocs`. A aba é
// recriada a cada execução (limpa e regrava), então rodar 2× não duplica nada.
// ⚠️ `RELATORIO_WRITE=1` para escrever; sem a flag é DRY-RUN (só imprime o resumo).
//
// Rodar:
//   npx vitest run --config scripts/dryrun-lider/vitest.config.ts
//   RELATORIO_WRITE=1 npx vitest run --config scripts/dryrun-lider/vitest.config.ts
//
// Fontes: aba `GoDocs` (readAllRows) + índice de liderança da TeamGuide
// (`buildLiderancaIndex` — a MESMA régua que a feature usa em produção, para o relatório
// não contar uma coisa e o sistema fazer outra).

import fs from 'node:fs';
import { it } from 'vitest';

for (const linha of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { readAllRows } = await import('@/lib/google/sheets');
const { getAccessToken } = await import('@/lib/google/auth');
const { buildLiderancaIndex, listarPessoasTeamGuide } = await import(
  '@/lib/areas/teamguide.server'
);

const ABA = 'Relação Líder-Liderado';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ESCREVER = process.env.RELATORIO_WRITE === '1';

const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();

type Projeto = { id: string; nome: string; autorNome: string; autorEmail: string; status: string };

async function main() {
  // ── 1. Projetos PENDENTES da aba GoDocs (é o que geraria DM hoje) ──────────
  const rows = await readAllRows();
  const pendentes: Projeto[] = rows
    // Só "Pendente" (Luis, 05/08): "Reenvio Pendente" fica FORA da relação.
    .filter((r) => low(r['Status']) === 'pendente')
    .map((r) => ({
      id: txt(r['ID Projeto']) || '(sem id)',
      nome: txt(r['Projeto']) || '(sem nome)',
      autorNome: txt(r['Nome Completo']) || '—',
      autorEmail: low(r['Email']),
      status: txt(r['Status']),
    }));

  // ── 2. Hierarquia da TeamGuide (mesma régua da feature) ────────────────────
  const { lideresPorEmail, liderancasPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const nomePorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.nome]));

  const nome = (email: string, fallback = '') =>
    nomePorEmail.get(email) || fallback || email || '—';

  // ── 3. Bloco "fila hoje": líder → liderado → projeto ──────────────────────
  type LinhaFila = { lider: string; liderEmail: string; autor: string; autorEmail: string; proj: Projeto };
  const fila: LinhaFila[] = [];
  const semLider: Projeto[] = [];
  const isentos: Projeto[] = [];

  for (const p of pendentes) {
    if (!p.autorEmail) {
      semLider.push(p);
      continue;
    }
    if (liderancasPorEmail.has(p.autorEmail)) {
      isentos.push(p);
      continue;
    }
    const lideres = (lideresPorEmail.get(p.autorEmail) ?? []).filter((l) => !!l.email);
    if (!lideres.length) {
      semLider.push(p);
      continue;
    }
    for (const l of lideres) {
      const e = String(l.email).toLowerCase();
      fila.push({
        lider: nome(e, l.nome ?? ''),
        liderEmail: e,
        autor: p.autorNome,
        autorEmail: p.autorEmail,
        proj: p,
      });
    }
  }

  // Agrupa por líder e, dentro dele, por liderado (a visão que o Luis pediu).
  const porLider = new Map<string, LinhaFila[]>();
  for (const f of fila) porLider.set(f.liderEmail, [...(porLider.get(f.liderEmail) ?? []), f]);
  const ranking = [...porLider.entries()].sort((a, b) => b[1].length - a[1].length);

  // ── 4. Monta as linhas da aba ─────────────────────────────────────────────
  const linhas: (string | number)[][] = [];
  const push = (...cells: (string | number)[]) => linhas.push(cells);

  // UMA tabela só (Luis, 05/08): a relação líder ↔ liderado dos projetos pendentes.
  // Sem resumo, sem seções — o chefe abre e lê a relação direto.
  push('Líder', 'E-mail do líder', 'Liderado', 'E-mail do liderado', 'Projetos pendentes');
  for (const [email, itens] of ranking) {
    const porAutor = new Map<string, LinhaFila[]>();
    for (const i of itens) porAutor.set(i.autorEmail, [...(porAutor.get(i.autorEmail) ?? []), i]);
    for (const [autorEmail, doAutor] of [...porAutor].sort((a, b) => b[1].length - a[1].length)) {
      push(
        doAutor[0].lider,
        email,
        doAutor[0].autor,
        autorEmail,
        doAutor.length,
      );
    }
  }

  console.log(`Linhas do relatório: ${linhas.length}`);
  console.log(
    `Pendentes ${pendentes.length} · fila ${new Set(fila.map((f) => f.proj.id)).size} · DMs ${fila.length} · ` +
      `líderes ${porLider.size} · isentos ${isentos.length} · sem líder ${semLider.length}`,
  );
  if (!ESCREVER) {
    console.log('DRY-RUN (sem RELATORIO_WRITE=1): nada foi escrito no Sheets.');
    return;
  }

  // ── 5. Escreve na aba dedicada ────────────────────────────────────────────
  const token = await getAccessToken();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const meta = (await (
    await fetch(`${BASE}/${SPREADSHEET_ID}?fields=sheets.properties`, { headers: auth })
  ).json()) as { sheets?: { properties?: { title?: string; sheetId?: number } }[] };
  const existente = meta.sheets?.find((s) => s.properties?.title === ABA)?.properties;

  if (!existente) {
    const r = await fetch(`${BASE}/${SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: ABA } } }] }),
    });
    if (!r.ok) throw new Error(`addSheet falhou: ${r.status} ${await r.text()}`);
    console.log(`Aba "${ABA}" criada.`);
  } else {
    // Recriar do zero seria mais simples, mas apagar a aba destrói qualquer comentário
    // que a gestão tenha deixado nela — então só limpamos os valores.
    const r = await fetch(
      `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${ABA}'!A1:Z10000`)}:clear`,
      { method: 'POST', headers: auth },
    );
    if (!r.ok) throw new Error(`clear falhou: ${r.status} ${await r.text()}`);
    console.log(`Aba "${ABA}" já existia — valores limpos antes de regravar.`);
  }

  const w = await fetch(
    `${BASE}/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${ABA}'!A1`)}?valueInputOption=RAW`,
    { method: 'PUT', headers: auth, body: JSON.stringify({ values: linhas }) },
  );
  if (!w.ok) throw new Error(`escrita falhou: ${w.status} ${await w.text()}`);
  console.log(`✅ Relatório gravado em "${ABA}" (${linhas.length} linhas).`);
}

it('relatório líder↔liderado na aba dedicada', main);
