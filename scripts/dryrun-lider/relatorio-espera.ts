// RELATÓRIO de ESPERA por pré-aprovação, numa ABA NOVA da planilha de produção
// (pedido do Luis, 06/08/2026: "preciso saber quem está há mais de 5 dias esperando
// aprovação"). Irmão do `relatorio-sheet.ts` — mesma mecânica de escrita, outra pergunta:
// lá é "quem recebe a mensagem", aqui é "quem está devendo parecer, e há quanto tempo".
//
// ⚠️ ESCREVE no Sheets, mas SÓ numa aba nova e dedicada — nunca na `GoDocs`. A aba é
// limpa e regravada a cada execução, então rodar 2× não duplica nada.
// ⚠️ `ESPERA_WRITE=1` para escrever; sem a flag é DRY-RUN (só imprime o resumo).
//
// Rodar:
//   npx vitest run --config scripts/dryrun-lider/espera.config.ts
//   ESPERA_WRITE=1 npx vitest run --config scripts/dryrun-lider/espera.config.ts
//
// Fontes: aba `GoDocs` (readAllRows) + índice de liderança da TeamGuide
// (`buildLiderancaIndex`) + a régua de isenção por CARGO (`ehCargoDeLideranca`, D20) —
// as MESMAS da feature em produção, para o relatório não contar uma coisa e o sistema
// fazer outra.
//
// ⚠️ UMA TABELA SÓ, 6 colunas: Líder · E-mail · Projetos pendentes · **Dias pendentes**
// (a lista, do mais antigo para o mais novo: `128, 40, 3`) · **Quem está esperando (dias)**
// (o autor de cada pendência, na MESMA ordem: `Ana — 128 · Bruno — 40`) · Mais antigo
// (dias). A 1ª versão tinha 3 tabelas e 11 colunas e o Luis cortou: *"está com muita
// informação"*; a coluna das pessoas ele pediu de volta em seguida, para pesquisar o
// projeto de cada um e conferir se o relatório acertou.
// O que segue fora, se algum dia voltar a fazer falta: cargo, espera média, detalhe
// projeto a projeto (nome/ID/data/estado) e a tabela dos pendentes que não esperam líder.
//
// ⚠️ O RELÓGIO é a coluna `Data Submissão` (o cabeçalho da aba repete isso, porque muda a
// leitura do número): para projeto submetido pelo app é exatamente quando a fila do líder
// abriu; para LEGADO (a maioria dos pendentes hoje) é a data da planilha e a fila nunca
// abriu — ali o número é a idade da pendência, não o tempo em que o líder viu o projeto.
// ⚠️ A coluna `Aprovação do Líder` está VAZIA nos 73 pendentes de hoje (produção entrou em
// 06/08/2026 SEM backfill) — foi por isso que o estado saiu da aba: hoje é uma coluna com
// o mesmo valor em todas as linhas.
//
// `Reenvio Pendente` fica FORA (mesma decisão do relatório líder↔liderado, 05/08/2026):
// a relação é sobre a fila de pré-aprovação, e reenvio é assunto da triagem da RPA.

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
const { parseDataFlexivel } = await import('@/lib/format-date');

const ABA = 'Aprovações Pendentes por Líder';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ESCREVER = process.env.ESPERA_WRITE === '1';
// A régua do pedido é 5 dias; fica configurável porque o corte é de gestão, não técnico.
const LIMITE_DIAS = Number(process.env.ESPERA_LIMITE_DIAS || 5);

const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();

const AGORA = new Date();
const DIA_MS = 86_400_000;
const diasDesde = (valor: unknown): number | null => {
  const d = parseDataFlexivel(txt(valor));
  if (!d) return null;
  return Math.max(0, Math.floor((AGORA.getTime() - d.getTime()) / DIA_MS));
};

type Projeto = {
  id: string;
  nome: string;
  autorNome: string;
  autorEmail: string;
  dias: number | null;
};

async function main() {
  // ── 1. Projetos PENDENTES da aba GoDocs ────────────────────────────────────
  const rows = await readAllRows();
  const pendentes: Projeto[] = rows
    .filter((r) => low(r['Status']) === 'pendente')
    .map((r) => ({
      id: txt(r['ID Projeto']) || '(sem id)',
      nome: txt(r['Projeto']) || '(sem nome)',
      autorNome: txt(r['Nome Completo']) || '—',
      autorEmail: low(r['Email']),
      dias: diasDesde(r['Data Submissão']),
    }));

  // ── 2. Hierarquia + cargos da TeamGuide (mesma régua da feature) ───────────
  const { lideresPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const nomePorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.nome]));
  const cargoPorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.cargo ?? '']));
  const naTeamGuide = new Set(pessoas.map((p) => p.email.toLowerCase()));

  const nome = (email: string, fallback = '') => nomePorEmail.get(email) || fallback || email || '—';

  // ── 3. Quem está na fila de alguém (régua de produção, D20) ────────────────
  type LinhaFila = { liderEmail: string; liderNome: string; proj: Projeto };
  const fila: LinhaFila[] = [];
  const foraDaFila: { proj: Projeto; motivo: string }[] = [];

  for (const p of pendentes) {
    if (!p.autorEmail) {
      foraDaFila.push({ proj: p, motivo: 'Sem e-mail do autor na planilha' });
      continue;
    }
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
    // Pessoa em 2+ times gera 2+ linhas (D4): o primeiro que decide resolve para todos.
    for (const l of lideres) {
      const e = String(l.email).toLowerCase();
      fila.push({ liderEmail: e, liderNome: nome(e, l.nome ?? ''), proj: p });
    }
  }

  // ── 4. Monta as linhas da aba ─────────────────────────────────────────────
  const linhas: (string | number)[][] = [];
  const push = (...cells: (string | number)[]) => linhas.push(cells);

  // UMA tabela só (pedido do Luis, 06/08 — a 1ª versão tinha 3 tabelas e 11 colunas:
  // "está com muita informação"). Fica o essencial: quem é o líder, quantos projetos
  // esperam ele e HÁ QUANTOS DIAS cada um espera.
  const porLider = new Map<string, LinhaFila[]>();
  for (const f of fila) porLider.set(f.liderEmail, [...(porLider.get(f.liderEmail) ?? []), f]);

  // Ordena UMA vez por espera e deriva as duas colunas da MESMA lista — se cada coluna
  // ordenasse por conta própria, "42, 34" e "Ana — 34, Bruno — 42" sairiam trocados e a
  // conferência apontaria a pessoa errada.
  const porEspera = (itens: LinhaFila[]) =>
    [...itens].sort((a, b) => (b.proj.dias ?? 0) - (a.proj.dias ?? 0));
  const diasOrdenados = (itens: LinhaFila[]) => porEspera(itens).map((i) => i.proj.dias ?? 0);
  const esperaMax = (itens: LinhaFila[]) => diasOrdenados(itens)[0] ?? 0;
  const acimaDoLimite = (itens: LinhaFila[]) =>
    itens.filter((i) => (i.proj.dias ?? 0) > LIMITE_DIAS).length;
  // Quem está esperando, na MESMA ordem dos dias. O nome vem da TeamGuide com fallback
  // para o "Nome Completo" da planilha — é por ele que o Luis pesquisa o projeto para
  // conferir se o relatório acertou.
  const pessoasEsperando = (itens: LinhaFila[]) =>
    porEspera(itens)
      .map((i) => `${nome(i.proj.autorEmail, i.proj.autorNome)} — ${i.proj.dias ?? '—'}`)
      .join(' · ');

  const ranking = [...porLider.entries()].sort(
    (a, b) =>
      esperaMax(b[1]) - esperaMax(a[1]) ||
      b[1].length - a[1].length ||
      a[0].localeCompare(b[0], 'pt-BR'),
  );

  const carimbo = AGORA.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  push(
    `Gerado em ${carimbo} (BRT) · "Dias pendentes" = dias desde a submissão de cada projeto que espera esse líder, ` +
      'do mais antigo para o mais novo · "Quem está esperando" traz o autor de cada um, na MESMA ordem · ' +
      'só Status = "Pendente".',
  );
  push('');
  push(
    'Líder',
    'E-mail do líder',
    'Projetos pendentes',
    'Dias pendentes',
    'Quem está esperando (dias)',
    'Mais antigo (dias)',
  );
  for (const [email, itens] of ranking) {
    push(
      itens[0].liderNome,
      email,
      itens.length,
      diasOrdenados(itens).join(', '),
      pessoasEsperando(itens),
      esperaMax(itens),
    );
  }

  // ── 5. Resumo no console (é o que se lê no dry-run) ────────────────────────
  const projetosNaFila = new Set(fila.map((f) => f.proj.id));
  const atrasados = new Set(
    fila.filter((f) => (f.proj.dias ?? 0) > LIMITE_DIAS).map((f) => f.proj.id),
  );
  const lideresAtrasados = ranking.filter(([, itens]) => acimaDoLimite(itens) > 0);
  console.log(
    `Pendentes ${pendentes.length} · na fila ${projetosNaFila.size} projetos (${fila.length} linhas, ` +
      `${porLider.size} líderes) · fora da fila ${foraDaFila.length}`,
  );
  console.log(
    `Acima de ${LIMITE_DIAS} dias: ${atrasados.size} projetos com ${lideresAtrasados.length} líderes`,
  );
  for (const [email, itens] of lideresAtrasados.slice(0, 12)) {
    console.log(
      `   ${esperaMax(itens)}d máx · ${acimaDoLimite(itens)}/${itens.length} atrasados · ` +
        `${itens[0].liderNome} <${email}>`,
    );
  }
  // Amostra do pareamento dias × pessoas: é o que se confere de olho antes de escrever.
  console.log('Amostra (dias | quem está esperando):');
  for (const [, itens] of ranking.slice(0, 10)) {
    console.log(`   ${itens[0].liderNome}: ${diasOrdenados(itens).join(', ')} | ${pessoasEsperando(itens)}`);
  }
  console.log(`Linhas do relatório: ${linhas.length}`);

  if (!ESCREVER) {
    console.log('DRY-RUN (sem ESPERA_WRITE=1): nada foi escrito no Sheets.');
    return;
  }

  // ── 6. Escreve na aba dedicada ────────────────────────────────────────────
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
    // Apagar a aba destruiria qualquer comentário que a gestão tenha deixado nela —
    // então só limpamos os valores.
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

it('relatório de espera por pré-aprovação na aba dedicada', main);
