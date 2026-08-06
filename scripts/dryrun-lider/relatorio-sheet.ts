// RELATÓRIO líder↔liderado numa ABA NOVA da planilha de produção (pedido do Luis,
// 04/08/2026: "meu chefe precisa ver de forma organizada e avaliar se está tudo certo").
//
// ⚠️ ESCREVE no Sheets, mas SÓ numa aba nova e dedicada — nunca na `GoDocs`. A aba é
// recriada a cada execução (limpa e regrava), então rodar 2× não duplica nada.
// ⚠️ `RELATORIO_WRITE=1` para escrever; sem a flag é DRY-RUN (só imprime o resumo).
//
// Rodar:
//   npx vitest run --config scripts/dryrun-lider/relatorio.config.ts
//   RELATORIO_WRITE=1 npx vitest run --config scripts/dryrun-lider/relatorio.config.ts
//
// Fontes: aba `GoDocs` (readAllRows) + índice de liderança da TeamGuide
// (`buildLiderancaIndex`) + a régua de isenção por CARGO (`ehCargoDeLideranca`, D20) —
// as MESMAS que a feature usa em produção, para o relatório não contar uma coisa e o
// sistema fazer outra.
//
// Duas tabelas (Luis, 05/08/2026): quem RECEBE a mensagem e quem NÃO recebe, com o
// motivo — a isenção por cargo tem de ser auditável ao lado da fila.

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
const { ehCargoDeLideranca } = await import('@/lib/cargo-lideranca');

const ABA = 'Relação Líder-Liderado';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ESCREVER = process.env.RELATORIO_WRITE === '1';

const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();

type Projeto = { id: string; nome: string; autorNome: string; autorEmail: string; especial: boolean };

async function main() {
  // ── 1. Projetos PENDENTES da aba GoDocs (é o que geraria mensagem hoje) ────
  const rows = await readAllRows();
  const pendentes: Projeto[] = rows
    // Só "Pendente" (Luis, 05/08): "Reenvio Pendente" fica FORA da relação.
    .filter((r) => low(r['Status']) === 'pendente')
    .map((r) => ({
      id: txt(r['ID Projeto']) || '(sem id)',
      nome: txt(r['Projeto']) || '(sem nome)',
      autorNome: txt(r['Nome Completo']) || '—',
      autorEmail: low(r['Email']),
      // D27 (06/08/2026): especial não é pendência do líder. A planilha grava
      // "Sim"/"Não" — qualquer coisa que comece com "s" conta como sim.
      especial: low(r['Especial?']).startsWith('s'),
    }));

  // ── 2. Hierarquia + cargos da TeamGuide (mesma régua da feature) ──────────
  const { lideresPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const nomePorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.nome]));
  const cargoPorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.cargo ?? '']));
  const naTeamGuide = new Set(pessoas.map((p) => p.email.toLowerCase()));

  const nome = (email: string, fallback = '') => nomePorEmail.get(email) || fallback || email || '—';
  const cargo = (email: string) => cargoPorEmail.get(email) || '—';

  // ── 3. Separa em "recebe" × "não recebe" pela régua de produção ───────────
  type LinhaFila = { liderEmail: string; liderNome: string; proj: Projeto };
  const fila: LinhaFila[] = [];
  const foraDaFila: { proj: Projeto; motivo: string }[] = [];

  for (const p of pendentes) {
    // D27 — projeto ESPECIAL fica fora, antes de qualquer pergunta sobre a pessoa:
    // não tem memorial financeiro para o líder julgar (a 3ª pergunta do checklist
    // não teria o que avaliar) e o destino dele é a validação humana da RPA.
    if (p.especial) {
      foraDaFila.push({ proj: p, motivo: 'Projeto especial — sem pré-aprovação do líder' });
      continue;
    }
    if (!p.autorEmail) {
      foraDaFila.push({ proj: p, motivo: 'Sem e-mail do autor na planilha' });
      continue;
    }
    // D20 — isenção pelo CARGO (coordenador para cima).
    if (ehCargoDeLideranca(cargoPorEmail.get(p.autorEmail))) {
      foraDaFila.push({ proj: p, motivo: 'Isento: cargo de liderança (coordenador ou acima)' });
      continue;
    }
    if (!naTeamGuide.has(p.autorEmail)) {
      foraDaFila.push({ proj: p, motivo: 'Autor não está cadastrado na TeamGuide' });
      continue;
    }
    const lideres = (lideresPorEmail.get(p.autorEmail) ?? []).filter((l) => !!l.email);
    if (!lideres.length) {
      foraDaFila.push({ proj: p, motivo: 'Sem líder na TeamGuide' });
      continue;
    }
    // Pessoa em 2+ times gera 2+ linhas (D4): o primeiro que decide resolve.
    for (const l of lideres) {
      const e = String(l.email).toLowerCase();
      fila.push({ liderEmail: e, liderNome: nome(e, l.nome ?? ''), proj: p });
    }
  }

  // ── 4. Monta as linhas da aba ─────────────────────────────────────────────
  const linhas: (string | number)[][] = [];
  const push = (...cells: (string | number)[]) => linhas.push(cells);

  // Tabela 1 — quem RECEBE, agrupado por líder e, dentro dele, por liderado.
  const porLider = new Map<string, LinhaFila[]>();
  for (const f of fila) porLider.set(f.liderEmail, [...(porLider.get(f.liderEmail) ?? []), f]);
  const ranking = [...porLider.entries()].sort((a, b) => b[1].length - a[1].length);

  push('QUEM RECEBE A MENSAGEM (fila de pré-aprovação)');
  push('Líder', 'E-mail do líder', 'Cargo do líder', 'Liderado', 'E-mail do liderado', 'Cargo do liderado', 'Projetos pendentes');
  for (const [email, itens] of ranking) {
    const porAutor = new Map<string, LinhaFila[]>();
    for (const i of itens) {
      porAutor.set(i.proj.autorEmail, [...(porAutor.get(i.proj.autorEmail) ?? []), i]);
    }
    for (const [autorEmail, doAutor] of [...porAutor].sort((a, b) => b[1].length - a[1].length)) {
      push(
        doAutor[0].liderNome,
        email,
        cargo(email),
        nome(autorEmail, doAutor[0].proj.autorNome),
        autorEmail,
        cargo(autorEmail),
        doAutor.length,
      );
    }
  }

  // Tabela 2 — quem NÃO recebe, e por quê (a auditoria da isenção).
  push('');
  push('QUEM NÃO ENTRA NA FILA (ninguém é avisado)');
  push('Autor', 'E-mail', 'Cargo', 'Motivo', 'Projeto', 'ID do projeto');
  for (const f of foraDaFila.sort(
    (a, b) => a.motivo.localeCompare(b.motivo, 'pt-BR') || a.proj.autorNome.localeCompare(b.proj.autorNome, 'pt-BR'),
  )) {
    push(
      nome(f.proj.autorEmail, f.proj.autorNome),
      f.proj.autorEmail || '—',
      cargo(f.proj.autorEmail),
      f.motivo,
      f.proj.nome,
      f.proj.id,
    );
  }

  console.log(
    `Pendentes ${pendentes.length} · na fila ${new Set(fila.map((f) => f.proj.id)).size} projetos ` +
      `(${fila.length} linhas, ${porLider.size} líderes avisados) · fora da fila ${foraDaFila.length}`,
  );
  const porMotivo = new Map<string, number>();
  for (const f of foraDaFila) porMotivo.set(f.motivo, (porMotivo.get(f.motivo) ?? 0) + 1);
  for (const [m, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) console.log(`   ${n}× ${m}`);
  console.log(`Linhas do relatório: ${linhas.length}`);

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
