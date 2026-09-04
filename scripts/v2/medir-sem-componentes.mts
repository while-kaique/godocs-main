import { getAccessToken } from '../../src/lib/google/auth';
import { numeroBR, COLUNAS_ENTRADA as C } from '../../src/lib/impacto-retroativo';
const SPREADSHEET = process.env.GOOGLE_SHEETS_ID!;
const TAB = process.env.GOOGLE_SHEETS_TAB!;
const token = await getAccessToken();
const { values = [] } = (await (await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}/values/${encodeURIComponent(TAB)}`,
  { headers: { Authorization: `Bearer ${token}` } })).json()) as { values?: string[][] };
const [header, ...linhas] = values;
const g = (l: string[], n: string) => l[header.indexOf(n)] ?? '';
let semComp = 0, semCompComValor = 0, somaPerdida = 0;
const exemplos: string[] = [];
for (const l of linhas) {
  const comps = [C.savingAntes, C.ceHoras, C.ceNaoContratado, C.receita].reduce((t, c) => t + numeroBR(g(l, c)), 0);
  const agregado = numeroBR(g(l, 'Impacto Bruto')) + numeroBR(g(l, 'Impacto Líquido'));
  if (comps === 0) {
    semComp++;
    if (agregado !== 0) {
      semCompComValor++;
      somaPerdida += numeroBR(g(l, 'Impacto Líquido'));
      if (exemplos.length < 6)
        exemplos.push(`${g(l, 'ID Projeto')} | Bruto=${g(l, 'Impacto Bruto')} Líquido=${g(l, 'Impacto Líquido')} | horas=${g(l, 'Custo Evitado Horas')} status=${g(l, 'Status')}`);
    }
  }
}
console.log(`linhas sem NENHUM componente: ${semComp}`);
console.log(`  destas, com valor agregado (o retroativo ZERARIA): ${semCompComValor} · Σ Impacto Líquido atual R$ ${somaPerdida.toLocaleString('pt-BR')}`);
console.log(exemplos.join('\n'));
