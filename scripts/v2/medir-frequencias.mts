// READ-ONLY: distribuição das colunas que o retroativo de impacto vai ler.
import { getAccessToken } from '../../src/lib/google/auth';
const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB!;
const token = await getAccessToken();
const r = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/${encodeURIComponent(TAB)}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const { values = [] } = (await r.json()) as { values?: string[][] };
const [header, ...linhas] = values;
const idx = (n: string) => header.indexOf(n);
const cols = ['Freq. Saving Efetivado', 'Freq. Custo Evitado', 'Freq. Receita', 'Freq. Custo para Rodar'];
const num = (s?: string) => {
  let t = String(s ?? '').replace(/[^0-9,.-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
console.log(`linhas: ${linhas.length}`);
for (const c of cols) {
  const i = idx(c);
  const conta = new Map<string, number>();
  for (const l of linhas) conta.set((l[i] ?? '').trim(), (conta.get((l[i] ?? '').trim()) ?? 0) + 1);
  console.log(`\n${c} (col ${i + 1}):`, [...conta.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || '(vazio)'}=${v}`).join(' · '));
}
// Quantas linhas têm valor em cada bloco financeiro
for (const c of ['Saving Efetivado', 'Saving Efetivado Agora', 'Custo Evitado Horas Reais', 'Custo Evitado Não Contratado', 'Receita Incremental', 'Custo para Rodar', 'Impacto Bruto', 'Impacto Líquido', 'Impacto Líquido Mensal']) {
  const i = idx(c);
  const comValor = linhas.filter((l) => num(l[i]) !== 0).length;
  const soma = linhas.reduce((t, l) => t + num(l[i]), 0);
  console.log(`${c}: ${comValor} linhas com valor · Σ ${soma.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`);
}
const iStatus = idx('Status');
const aprov = linhas.filter((l) => (l[iStatus] ?? '').trim().toLowerCase() === 'aprovado').length;
console.log(`\naprovados: ${aprov}`);
