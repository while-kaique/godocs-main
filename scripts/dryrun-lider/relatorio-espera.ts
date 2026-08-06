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
// ⚠️ DUAS RESSALVAS QUE O CABEÇALHO DA ABA REPETE, porque mudam a leitura dos números:
//
// 1. O RELÓGIO é a coluna `Data Submissão`. Para projeto submetido pelo app é exatamente
//    quando a fila do líder abriu; para LEGADO (a maioria dos pendentes hoje) é a data da
//    planilha, e a fila nunca abriu — então ali "dias esperando" é a idade da pendência,
//    não o tempo em que o líder viu o projeto.
// 2. A coluna `Aprovação do Líder` está VAZIA nos 73 pendentes de hoje: a pré-aprovação
//    entrou em produção em 06/08/2026 e SEM backfill — só projeto submetido/reenviado a
//    partir dela nasce com estado. Vazio = ninguém deu parecer (não é erro).
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

// Estado que a planilha guarda; vazio/"—" = ninguém deu parecer (ver ressalva 2).
const SEM_PARECER = 'Aguardando (sem parecer)';
const estadoDaLinha = (v: unknown) => {
  const s = txt(v);
  return !s || s === '—' ? SEM_PARECER : s;
};

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
  dataSubmissao: string;
  dias: number | null;
  estado: string;
  atualizadoEm: string;
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
      dataSubmissao: txt(r['Data Submissão']) || '—',
      dias: diasDesde(r['Data Submissão']),
      estado: estadoDaLinha(r['Aprovação do Líder']),
      atualizadoEm: txt(r['Atualizado Em']) || '—',
    }));

  // ── 2. Hierarquia + cargos da TeamGuide (mesma régua da feature) ───────────
  const { lideresPorEmail } = await buildLiderancaIndex();
  const pessoas = await listarPessoasTeamGuide();
  const nomePorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.nome]));
  const cargoPorEmail = new Map(pessoas.map((p) => [p.email.toLowerCase(), p.cargo ?? '']));
  const naTeamGuide = new Set(pessoas.map((p) => p.email.toLowerCase()));

  const nome = (email: string, fallback = '') => nomePorEmail.get(email) || fallback || email || '—';
  const cargo = (email: string) => cargoPorEmail.get(email) || '—';

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

  const carimbo = AGORA.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  push(`Gerado em ${carimbo} (BRT) · corte de atenção: mais de ${LIMITE_DIAS} dias`);
  push(
    'Dias esperando conta da coluna "Data Submissão". Para projeto submetido pelo app é quando a fila do líder abriu; ' +
      'para LEGADO é a data da planilha (a fila nunca abriu para ele).',
  );
  push(
    `"${SEM_PARECER}" = a coluna "Aprovação do Líder" está vazia: ninguém deu parecer. ` +
      'A pré-aprovação entrou em produção em 06/08/2026 sem backfill, então os projetos antigos nascem sem estado.',
  );
  push('Só Status = "Pendente". "Reenvio Pendente", "Descontinuado", "Aprovado" e "Reprovado" ficam fora.');
  push('');

  // Tabela 1 — um líder por linha, o mais atrasado no topo (é a pergunta do pedido).
  const porLider = new Map<string, LinhaFila[]>();
  for (const f of fila) porLider.set(f.liderEmail, [...(porLider.get(f.liderEmail) ?? []), f]);

  const esperaMax = (itens: LinhaFila[]) =>
    itens.reduce((max, i) => Math.max(max, i.proj.dias ?? 0), 0);
  const acimaDoLimite = (itens: LinhaFila[]) =>
    itens.filter((i) => (i.proj.dias ?? 0) > LIMITE_DIAS).length;

  const ranking = [...porLider.entries()].sort(
    (a, b) =>
      esperaMax(b[1]) - esperaMax(a[1]) ||
      b[1].length - a[1].length ||
      a[0].localeCompare(b[0], 'pt-BR'),
  );

  push('LÍDERES COM PROJETOS ESPERANDO PRÉ-APROVAÇÃO');
  push(
    'Líder',
    'E-mail do líder',
    'Cargo do líder',
    'Projetos pendentes',
    `Esperando mais de ${LIMITE_DIAS} dias`,
    'Espera máxima (dias)',
    'Espera média (dias)',
    'Estado dos pendentes',
  );
  for (const [email, itens] of ranking) {
    const porEstado = new Map<string, number>();
    for (const i of itens) porEstado.set(i.proj.estado, (porEstado.get(i.proj.estado) ?? 0) + 1);
    const media = Math.round(itens.reduce((s, i) => s + (i.proj.dias ?? 0), 0) / itens.length);
    push(
      itens[0].liderNome,
      email,
      cargo(email),
      itens.length,
      acimaDoLimite(itens),
      esperaMax(itens),
      media,
      [...porEstado].map(([e, n]) => `${n}× ${e}`).join(' · '),
    );
  }

  // Tabela 2 — o detalhe projeto a projeto, para o líder saber O QUE cobrar.
  push('');
  push('DETALHE — UM PROJETO POR LINHA (mais antigo primeiro)');
  push(
    'Líder',
    'E-mail do líder',
    'Autor',
    'E-mail do autor',
    'Projeto',
    'ID do projeto',
    'Data submissão',
    'Dias esperando',
    `Mais de ${LIMITE_DIAS} dias?`,
    'Estado da pré-aprovação',
    'Última escrita do sistema',
  );
  for (const f of [...fila].sort(
    (a, b) =>
      (b.proj.dias ?? 0) - (a.proj.dias ?? 0) ||
      a.liderNome.localeCompare(b.liderNome, 'pt-BR') ||
      a.proj.nome.localeCompare(b.proj.nome, 'pt-BR'),
  )) {
    push(
      f.liderNome,
      f.liderEmail,
      nome(f.proj.autorEmail, f.proj.autorNome),
      f.proj.autorEmail,
      f.proj.nome,
      f.proj.id,
      f.proj.dataSubmissao,
      f.proj.dias ?? '—',
      (f.proj.dias ?? 0) > LIMITE_DIAS ? 'SIM' : '—',
      f.proj.estado,
      f.proj.atualizadoEm,
    );
  }

  // Tabela 3 — pendente que NÃO está na fila de ninguém: sem isso o total da aba não
  // fecha com os pendentes da planilha e parece que faltou gente.
  push('');
  push('PENDENTES QUE NÃO ESPERAM NENHUM LÍDER (ninguém deve parecer)');
  push('Autor', 'E-mail', 'Cargo', 'Motivo', 'Projeto', 'ID do projeto', 'Dias desde a submissão');
  for (const f of foraDaFila.sort(
    (a, b) =>
      a.motivo.localeCompare(b.motivo, 'pt-BR') || (b.proj.dias ?? 0) - (a.proj.dias ?? 0),
  )) {
    push(
      nome(f.proj.autorEmail, f.proj.autorNome),
      f.proj.autorEmail || '—',
      cargo(f.proj.autorEmail),
      f.motivo,
      f.proj.nome,
      f.proj.id,
      f.proj.dias ?? '—',
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
