/**
 * Reorganiza o cabeçalho da aba da v2: agrupa por CONCEITO, manda para o fim o que a v2
 * não escreve mais (sem apagar — o dado legado fica) e apaga o que está vazio E sem uso.
 *
 * ⚠️ Seguro porque o código casa coluna por NOME (`fetchHeaderMap`), nunca por posição.
 * ⚠️ Faz DUMP da planilha inteira antes de escrever. Uma escrita só, do cabeçalho + linhas.
 */
import { getAccessToken } from '../../src/lib/google/auth';
// ⚠️ FONTE ÚNICA do de-para v1→v2. A aba de PRODUÇÃO ainda tem os nomes antigos
// ('Participantes', 'Saving Reais', 'Ganho Total'…): sem esta ponte, a reorganização criaria
// as colunas novas VAZIAS e empurraria 734 linhas de dado para o fim da planilha.
import { NOME_LEGADO } from '../../src/lib/coluna-chave';
import { writeFile } from 'node:fs/promises';

const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB;
const ESCREVER = process.env.ESCREVER === '1';
if (!TAB) throw new Error('setar GOOGLE_SHEETS_TAB');
if (TAB === 'GoDocs' && process.env.CONFIRMO_PROD !== '1')
  throw new Error('recusado: a aba de PRODUÇÃO exige CONFIRMO_PROD=1');

/** Some de vez: sem uso no código E sem dado em lugar nenhum. */
const APAGAR = ['Custo Externo Mensal'];

/** A ordem da v2 — agrupada pelo que a pessoa preenche, na sequência em que preenche. */
const ORDEM = [
  // identidade
  'Data Submissão', 'ID Projeto', 'Área', 'Nome Completo', 'Email', 'Projeto',
  // time
  'Coautor', 'Participante', 'Contribuidor',
  // o projeto
  'Descrição', 'Escopo', 'Ferramenta', 'Usa AI Proxy', 'URL', 'URL Godeploy',
  // vínculo (feature de outro projeto)
  'ID Pai', 'ID Feature',
  // ── GANHO, na ordem dos blocos da fórmula ──
  'Tipos de Ganho',
  'Saving Efetivado', 'Saving Efetivado Agora', 'Freq. Saving Efetivado', 'Evidência Saving Efetivado',
  'Custo Evitado Horas', 'Custo Evitado Horas Reais', 'Custo Evitado Não Contratado',
  'Freq. Custo Evitado', 'Racional Custo Evitado',
  'Receita Incremental', 'Freq. Receita', 'Racional Receita',
  'Custo para Rodar', 'Freq. Custo para Rodar', 'Justificativa Custo para Rodar',
  'Ganho Imensurável',
  // ── IMPACTO (o que sai da fórmula) ──
  'Impacto Bruto', 'Impacto Líquido', 'Impacto Líquido Mensal',
  // classificação
  'Tipo de Projeto', 'Especial?', 'Complexidade', 'Estrelas',
  // triagem
  'Status', 'Classificação', 'Motivo Reprovado', 'Motivo Reenvio', 'Observações', 'Análise Antiagente',
  // líder
  'Aprovação do Líder', 'Justificativa Aprovação do Lider',
  'Atualizado Em',
];

/** A v2 não escreve — vão para o FIM, com o dado intacto. */
const ARQUIVADAS = [
  'Data Criação', 'Alguém Fazia?', 'Memorial de Saving', 'Memorial anterior',
  'Alocação Ganhos', 'Saving Horas Real', 'Saving Horas Escalado',
  'Diff Horas / Antes', 'Diff Saving / Antes',
];

const token = await getAccessToken();
const auth = { Authorization: `Bearer ${token}` };
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SP}`;
const { values = [] } = (await (await fetch(`${base}/values/${encodeURIComponent(TAB)}`, { headers: auth })).json()) as { values?: string[][] };
const [header, ...linhas] = values;

const idx = new Map(header.map((h, i) => [h.trim(), i]));
/** Onde está o dado de uma coluna da v2: sob o nome NOVO, ou sob o LEGADO se a aba não migrou. */
const de = (col: string): number | undefined => idx.get(col) ?? idx.get(NOME_LEGADO[col] ?? '\u0000');
/** As legadas cujo dado foi ADOTADO por uma coluna da v2 não são "desconhecidas": já viajaram. */
const adotadas = new Set(
  [...ORDEM, ...ARQUIVADAS]
    .filter((c) => !idx.has(c) && NOME_LEGADO[c] && idx.has(NOME_LEGADO[c]))
    .map((c) => NOME_LEGADO[c]),
);
const naOrdem = [...ORDEM, ...ARQUIVADAS];
const desconhecidas = header.filter(
  (h) => h.trim() && !naOrdem.includes(h.trim()) && !APAGAR.includes(h.trim()) && !adotadas.has(h.trim()),
);
const ausentes = naOrdem.filter((n) => de(n) === undefined);

console.log(`${TAB}: ${header.length} colunas · ${linhas.length} linhas`);
console.log(`  apagar: ${APAGAR.join(', ')}`);
console.log(`  arquivar no fim: ${ARQUIVADAS.length}`);
console.log(`  ordem nova: ${ORDEM.length} + ${ARQUIVADAS.length} = ${naOrdem.length} colunas`);
if (adotadas.size) console.log(`  ↻ renomeadas (dado preservado): ${[...adotadas].join(', ')}`);
if (desconhecidas.length) console.log(`  ⚠️ NA PLANILHA mas fora da ordem (vão para o fim): ${desconhecidas.join(', ')}`);
if (ausentes.length) console.log(`  ⚠️ na ordem mas NÃO na planilha (serão criadas vazias): ${ausentes.join(', ')}`);

const finalCols = [...naOrdem, ...desconhecidas];
const matriz = [finalCols, ...linhas.map((l) => finalCols.map((c) => {
  const i = de(c);
  return i === undefined ? '' : (l[i] ?? '');
}))];

if (!ESCREVER) { console.log('\nDRY-RUN — rode com ESCREVER=1.'); process.exit(0); }

const bkp = `${process.env.BACKUP_DIR ?? '.'}/colunas-${TAB}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
await writeFile(bkp, JSON.stringify({ header, linhas }, null, 1));
console.log(`\nbackup da planilha INTEIRA: ${bkp}`);

// A grade precisa comportar o novo nº de colunas, e o resto precisa ser limpo.
const meta = (await (await fetch(`${base}?fields=sheets.properties`, { headers: auth })).json()) as { sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { columnCount?: number } } }> };
const aba = meta.sheets?.find((s) => s.properties.title === TAB)!;
const atual = aba.properties.gridProperties?.columnCount ?? 0;
if (atual < finalCols.length) {
  await fetch(`${base}:batchUpdate`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ appendDimension: { sheetId: aba.properties.sheetId, dimension: 'COLUMNS', length: finalCols.length - atual } }] }) });
}
const limpa = await fetch(`${base}/values/${encodeURIComponent(TAB)}:clear`, { method: 'POST', headers: auth });
if (!limpa.ok) throw new Error(`clear ${limpa.status} ${await limpa.text()}`);
const w = await fetch(`${base}/values/${encodeURIComponent(TAB)}!A1?valueInputOption=RAW`, {
  method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: matriz }),
});
if (!w.ok) throw new Error(`${w.status} ${await w.text()}`);
console.log(`gravado: ${(await w.json() as { updatedCells?: number }).updatedCells} células · ${finalCols.length} colunas`);
