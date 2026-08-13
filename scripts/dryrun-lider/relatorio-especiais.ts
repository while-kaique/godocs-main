// RELATÓRIO de PROJETOS ESPECIAIS parados na triagem há mais de N dias (pedido do Luis,
// 13/08/2026: "é só pra eu poder me guiar na hora de aprovar os projetos, vou dar mais
// importância pros projetos mais antigos pra aprovar logo, galera tá reclamando aqui").
// Irmão do `relatorio-espera.ts` — mesma mecânica de escrita, outra pergunta: lá é "quem
// está devendo parecer de líder", aqui é "quais ESPECIAIS a triagem ainda não olhou".
//
// ⚠️ É uma FILA DE TRABALHO, não um painel: ordenada do MAIS ANTIGO para o mais novo, com
// o link da documentação na linha, para o Luis aprovar de cima para baixo.
//
// ⚠️ ESCREVE no Sheets, mas SÓ numa aba nova e dedicada — nunca na `GoDocs`. A aba é
// limpa e regravada a cada execução, então rodar 2× não duplica nada.
// ⚠️ `ESPECIAIS_WRITE=1` para escrever; sem a flag é DRY-RUN (só imprime o resumo).
//
// Rodar:
//   npx vitest run --config scripts/dryrun-lider/especiais.config.ts
//   ESPECIAIS_WRITE=1 npx vitest run --config scripts/dryrun-lider/especiais.config.ts
//
// Fonte: aba `GoDocs` (`readAllRows`) — nada de SQLite. A planilha é a fonte do que
// APARECE (mesma régua do `/dashboard`, que também lê `readAllRows` e não o banco), e é
// nela que a triagem trabalha.
//
// ⚠️ POR QUE ESPECIAL É UMA FILA À PARTE: projeto especial NÃO abre fila de líder (D27 —
// sem memorial financeiro a 3ª pergunta do checklist não tem o que julgar) e pula o
// memorial financeiro inteiro. Ou seja: **a validação humana da RPA é a ÚNICA porta** por
// onde ele passa. Um especial parado é um projeto que ninguém olhou — daí o relatório.
//
// ⚠️ O RELÓGIO é a coluna `Data Submissão` (o cabeçalho da aba repete isso, porque muda a
// leitura do número): para projeto submetido pelo app é quando ele entrou na fila da
// triagem; para LEGADO é a data da planilha e a fila nunca abriu — ali o número é a idade
// da pendência, não o tempo em que a triagem o viu. `parseDataFlexivel` (não `Date.parse`)
// porque legado tem data pt-BR (`12/05/2026`) e o parse nativo a leria como MM/DD.
//
// ⚠️ `Reenvio Pendente` fica FORA (mesma decisão dos 2 relatórios irmãos): reenvio é
// projeto que a triagem JÁ olhou e devolveu — a bola está com o autor, não com ela. O
// console mostra a contagem à parte para o corte não sumir sem ser visto.
//
// ⚠️ O nome da aba carrega o CORTE (`+15 dias`). Assim, mudar o `ESPECIAIS_LIMITE_DIAS`
// escreve numa aba nova em vez de deixar um título mentindo sobre o conteúdo — o preço é
// uma aba órfã se o corte mudar de vez (apagar à mão).

import fs from 'node:fs';
import { it } from 'vitest';

for (const linha of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = linha.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { readAllRows } = await import('@/lib/google/sheets');
const { getAccessToken } = await import('@/lib/google/auth');
const { parseDataFlexivel } = await import('@/lib/format-date');
const { ehProjetoTesteE2E } = await import('@/lib/google/chat');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const ESCREVER = process.env.ESPECIAIS_WRITE === '1';
// A régua do pedido é 15 dias; fica configurável porque o corte é de gestão, não técnico.
const LIMITE_DIAS = Number(process.env.ESPECIAIS_LIMITE_DIAS || 15);
const ABA = `Especiais Pendentes +${LIMITE_DIAS} dias`;

const txt = (v: unknown) => String(v ?? '').trim();
const low = (v: unknown) => txt(v).toLowerCase();

const AGORA = new Date();
const DIA_MS = 86_400_000;
const diasDesde = (valor: unknown): number | null => {
  const d = parseDataFlexivel(txt(valor));
  if (!d) return null;
  return Math.max(0, Math.floor((AGORA.getTime() - d.getTime()) / DIA_MS));
};

// Mesma régua do sync reverso (`parseEspecialFlag`): "Sim"/"sim"/"S" → especial.
// Vazio e "—" NÃO são especial — a ausência de resposta não vira afirmação.
const ehEspecial = (v: unknown) => low(v).startsWith('s');

type Projeto = {
  id: string;
  nome: string;
  autorNome: string;
  autorEmail: string;
  area: string;
  url: string;
  dataSubmissao: string;
  dias: number | null;
};

async function main() {
  // ── 1. Especiais PENDENTES da aba GoDocs ──────────────────────────────────
  const rows = await readAllRows();

  const especiais = rows.filter((r) => ehEspecial(r['Especial?']));
  const pendentesTodos = especiais.filter((r) => low(r['Status']) === 'pendente');
  // Testes E2E não são trabalho de ninguém — o mesmo guard que cala o Chat.
  const pendentes: Projeto[] = pendentesTodos
    .filter((r) => !ehProjetoTesteE2E(txt(r['Projeto'])))
    .map((r) => ({
      id: txt(r['ID Projeto']) || '(sem id)',
      nome: txt(r['Projeto']) || '(sem nome)',
      autorNome: txt(r['Nome Completo']) || '—',
      autorEmail: low(r['Email']),
      area: txt(r['Área']) || '—',
      url: txt(r['URL']) || '—',
      dataSubmissao: txt(r['Data Submissão']) || '—',
      dias: diasDesde(r['Data Submissão']),
    }));

  // Sem data legível não dá para afirmar "há mais de N dias" — mas o projeto está
  // pendente e alguém precisa olhar. Vai numa lista à parte, nunca somado ao corte.
  const semData = pendentes.filter((p) => p.dias == null);
  const atrasados = pendentes
    .filter((p) => (p.dias ?? 0) > LIMITE_DIAS)
    .sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR'));

  // ── 2. Monta as linhas da aba ─────────────────────────────────────────────
  const linhas: (string | number)[][] = [];
  const push = (...cells: (string | number)[]) => linhas.push(cells);

  const carimbo = AGORA.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  push(
    `Gerado em ${carimbo} (BRT) · Fila de aprovação: projetos ESPECIAIS com Status = ` +
      `"Pendente" há mais de ${LIMITE_DIAS} dias, do MAIS ANTIGO para o mais novo · ` +
      '"Dias pendentes" = dias desde a Data Submissão (para LEGADO, é a data da planilha, ' +
      'e a fila nunca chegou a abrir) · especial não passa por líder nem por memorial ' +
      'financeiro: a validação humana da RPA é a única porta.',
  );
  push('');
  push(
    'Dias pendentes',
    'Projeto',
    'Autor',
    'E-mail',
    'Área',
    'Data Submissão',
    'ID Projeto',
    'Documentação (Drive)',
  );
  for (const p of atrasados) {
    push(
      p.dias ?? 0,
      p.nome,
      p.autorNome,
      p.autorEmail || '—',
      p.area,
      p.dataSubmissao,
      p.id,
      p.url,
    );
  }

  if (semData.length) {
    push('');
    push(
      `Pendentes sem Data Submissão legível (${semData.length}) — não dá para medir a espera, ` +
        'mas seguem esperando triagem:',
    );
    push('Projeto', 'Autor', 'E-mail', 'Área', 'ID Projeto');
    for (const p of semData) push(p.nome, p.autorNome, p.autorEmail || '—', p.area, p.id);
  }

  push('');
  push(
    `Resumo: ${especiais.length} especiais na planilha · ${pendentes.length} pendentes · ` +
      `${atrasados.length} há mais de ${LIMITE_DIAS} dias · mais antigo ${atrasados[0]?.dias ?? 0} dias.`,
  );

  // ── 3. Resumo no console (é o que se lê no dry-run) ────────────────────────
  const reenvio = especiais.filter((r) => low(r['Status']).includes('reenvio')).length;
  console.log(
    `Especiais na planilha ${especiais.length} · pendentes ${pendentes.length} ` +
      `(+${pendentesTodos.length - pendentes.length} de teste E2E ignorados) · ` +
      `acima de ${LIMITE_DIAS} dias ${atrasados.length} · sem data ${semData.length} · ` +
      `em reenvio (fora do corte) ${reenvio}`,
  );
  for (const p of atrasados.slice(0, 25)) {
    console.log(`   ${String(p.dias).padStart(4)}d · ${p.nome} — ${p.autorNome} <${p.autorEmail}>`);
  }
  if (atrasados.length > 25) console.log(`   … e mais ${atrasados.length - 25}`);
  console.log(`Linhas do relatório: ${linhas.length}`);

  if (!ESCREVER) {
    console.log('DRY-RUN (sem ESPECIAIS_WRITE=1): nada foi escrito no Sheets.');
    return;
  }

  // ── 4. Escreve na aba dedicada ────────────────────────────────────────────
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
    // Apagar a aba destruiria qualquer comentário/marcação que o Luis tenha deixado nela
    // enquanto aprovava — então só limpamos os valores.
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

it('relatório de projetos especiais pendentes na aba dedicada', main);
