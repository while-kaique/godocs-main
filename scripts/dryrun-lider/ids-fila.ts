// IDs dos projetos que DEVEM entrar na fila de pré-aprovação (backfill retroativo).
//
// Leitura PURA: não escreve na planilha nem no SQLite. A saída é o `projetoIds` do
// `POST /api/admin/aprovacoes/reabrir` — o backfill do passo 2 do disparo retroativo
// (a fila de prod nasceu vazia; `abrirPreAprovacao` só roda em submissão nova).
//
// Usa a MESMA régua do `relatorio-sheet.ts` (D27 especial → fora · D20 isenção por
// cargo · sem líder na TeamGuide → fora), para o backfill popular exatamente o que a
// aba "Relação Líder-Liderado" mostra ao Luis.
//
// Rodar:
//   npx vitest run --config scripts/dryrun-lider/ids-fila.config.ts

import fs from 'node:fs';
import { it } from 'vitest';

for (const linha of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { readAllRows } = await import('@/lib/google/sheets');
const { buildLiderancaIndex, listarPessoasTeamGuide } = await import(
  '@/lib/areas/teamguide.server'
);
const { ehCargoDeLideranca } = await import('@/lib/cargo-lideranca');
const { ehProjetoTesteE2E } = await import('@/lib/google/chat');

const SAIDA = process.env.IDS_FILA_OUT || '';
const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();

async function main() {
  const rows = await readAllRows();
  const pendentes = rows
    .filter((r) => low(r['Status']) === 'pendente')
    .map((r) => ({
      id: txt(r['ID Projeto']),
      nome: txt(r['Projeto']) || '(sem nome)',
      autorEmail: low(r['Email']),
      especial: low(r['Especial?']).startsWith('s'),
    }));

  const { lideresPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const cargoPorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.cargo ?? '']));
  const naTeamGuide = new Set(pessoas.map((p) => p.email.toLowerCase()));

  const naFila: { id: string; nome: string; autorEmail: string; lideres: string[] }[] = [];
  const fora: { id: string; nome: string; motivo: string }[] = [];

  for (const p of pendentes) {
    if (!p.id) {
      fora.push({ id: '(sem id)', nome: p.nome, motivo: 'linha sem ID Projeto' });
      continue;
    }
    // O `reabrir` NÃO filtra `[E2E-…]` (o filtro do runtime mora em quem monta o
    // payload da DM), então sem este corte o backfill abriria uma pendência FALSA na
    // fila do líder do harness. Descoberto no retroativo de 06/08/2026.
    if (ehProjetoTesteE2E(p.nome)) {
      fora.push({ id: p.id, nome: p.nome, motivo: 'projeto de teste E2E' });
      continue;
    }
    if (p.especial) {
      fora.push({ id: p.id, nome: p.nome, motivo: 'especial (D27)' });
      continue;
    }
    if (!p.autorEmail) {
      fora.push({ id: p.id, nome: p.nome, motivo: 'sem e-mail do autor' });
      continue;
    }
    if (ehCargoDeLideranca(cargoPorEmail.get(p.autorEmail))) {
      fora.push({ id: p.id, nome: p.nome, motivo: 'isento por cargo (D20)' });
      continue;
    }
    if (!naTeamGuide.has(p.autorEmail)) {
      fora.push({ id: p.id, nome: p.nome, motivo: 'autor fora da TeamGuide' });
      continue;
    }
    const lideres = (lideresPorEmail.get(p.autorEmail) ?? [])
      .filter((l) => !!l.email)
      .map((l) => String(l.email).toLowerCase());
    if (!lideres.length) {
      fora.push({ id: p.id, nome: p.nome, motivo: 'sem líder na TeamGuide' });
      continue;
    }
    naFila.push({ id: p.id, nome: p.nome, autorEmail: p.autorEmail, lideres });
  }

  const ids = [...new Set(naFila.map((p) => p.id))];
  console.log(`Pendentes ${pendentes.length} · na fila ${ids.length} · fora ${fora.length}`);
  const porMotivo = new Map<string, number>();
  for (const f of fora) porMotivo.set(f.motivo, (porMotivo.get(f.motivo) ?? 0) + 1);
  for (const [m, n] of [...porMotivo].sort((a, b) => b[1] - a[1])) console.log(`   ${n}× ${m}`);
  for (const p of naFila) console.log(`   ${p.id} · ${p.nome} · ${p.autorEmail} → ${p.lideres.join(', ')}`);
  console.log(JSON.stringify({ projetoIds: ids }, null, 2));

  if (SAIDA) {
    fs.writeFileSync(SAIDA, JSON.stringify({ projetoIds: ids, dry: true }, null, 2));
    console.log(`Corpo do POST salvo em ${SAIDA}`);
  }
}

it('IDs da fila para o backfill retroativo', main);
