// DIAGNÓSTICO de UM projeto (leitura pura): imprime a linha da planilha nas colunas que
// importam para a pré-aprovação do líder + o cargo do autor e a régua de isenção D20.
//
// Serve para responder "por que o líder não recebeu a DM?": se a coluna
// `Aprovação do Líder` está VAZIA, o `abrirPreAprovacao` não rodou nessa submissão.
//
// Rodar:  PROJETO=<id> npx vitest run --config scripts/dryrun-lider/diag-projeto.config.ts

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
const { ehCargoDeLideranca } = await import('@/lib/cargo-lideranca');

const ALVO = (process.env.PROJETO || '').toLowerCase();

async function main() {
  const rows = await readAllRows();
  const linha = rows.find((r) => String(r['ID Projeto'] ?? '').trim().toLowerCase() === ALVO);
  if (!linha) {
    console.log(`Projeto ${ALVO} não está na aba GoDocs.`);
    return;
  }
  const COLS = [
    'ID Projeto',
    'Projeto',
    'Nome Completo',
    'Email',
    'Status',
    'Especial?',
    'Tipos Projeto',
    'Data Submissão',
    'Atualizado Em',
    'Aprovação do Líder',
    'Aprovação do Lider',
    'Justificativa Aprovação do Líder',
    'Justificativa Aprovação do Lider',
  ];
  for (const c of COLS) {
    if (c in linha) console.log(`  ${c} = ${JSON.stringify(linha[c])}`);
  }
  // Qualquer cabeçalho que contenha "prova" (aprovação) — pega variações de acento.
  for (const [k, v] of Object.entries(linha)) {
    if (/prova/i.test(k) && !COLS.includes(k)) console.log(`  [extra] ${k} = ${JSON.stringify(v)}`);
  }

  const autor = String(linha['Email'] ?? '').trim().toLowerCase();
  const pessoas = await listarPessoasTeamGuide();
  const p = pessoas.find((x) => x.email.toLowerCase() === autor);
  const { lideresPorEmail } = await buildLiderancaIndex();
  console.log(`\nAutor: ${autor}`);
  console.log(`  na TeamGuide? ${p ? 'sim' : 'NÃO'} · cargo = ${JSON.stringify(p?.cargo ?? null)}`);
  console.log(`  isento por CARGO (D20)? ${ehCargoDeLideranca(p?.cargo) ? 'SIM' : 'não'}`);
  console.log(
    `  líder(es): ${(lideresPorEmail.get(autor) ?? []).map((l) => `${l.nome} <${l.email}>`).join(' · ') || '—'}`,
  );
}

it('diagnóstico de um projeto', main);
