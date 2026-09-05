/**
 * Grava as estrelas recomendadas pela run 9 na coluna "Estrelas" da aba `GoDocs`.
 *
 * ⚠️ **`dry` é o DEFAULT.** Escrever exige `--valendo`, e isto quebra a trava mais antiga do
 * sistema ("a nota só muda por clique de gente"), então é operação de decisão humana, com data
 * marcada, nunca efeito colateral de outra rotina.
 *
 * ## As três regras que impedem o estrago
 *
 * 1. **Só onde NÃO há nota humana.** Sobrescrever as notas de vocês rebaixaria 72 projetos, entre
 *    eles o PIAPP (10 → 6), o VERSTA (8 → 5), o Prisma (5 → 0) e o GoPrice (4 → 0) — e os dois
 *    últimos são os casos que a própria sessão de 05/09 identificou como ERRO DO AGENTE. Quem tem
 *    nota humana já foi julgado; o agente não desempata isso sozinho.
 *
 * 2. **A faixa 6-10 NÃO é escrita.** A coluna é NUMÉRICA — gravar o texto "6-10" a transformaria
 *    em texto e quebraria soma e ordenação de quem usa a planilha (é a mesma razão pela qual
 *    `definirEstrelasEspecial` não passa por `ouTraco`). E gravar o número 6 seria pior: afirmaria
 *    uma posição que a régua se recusa a afirmar, porque não existe critério que separe um 7 de um
 *    8. A faixa é veredito de COMITÊ; estes projetos saem em lista à parte, para decisão humana.
 *
 * 3. **Não escreve 0 por cima de célula vazia.** Célula vazia e `0` são estados diferentes na
 *    tela ("—" contra "Zero"), e transformar "ninguém avaliou" em "avaliado, vale zero" é uma
 *    afirmação que a rodada não tem como sustentar.
 *
 * Uso:
 *   npx tsx scripts/v2/estrelas-run9-para-planilha.mts             # ENSAIO (default)
 *   npx tsx scripts/v2/estrelas-run9-para-planilha.mts --valendo   # escreve
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getAccessToken } from '/home/notebook/godocs-wt-categoria-aglutinacao/src/lib/google/auth';

const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const ABA = 'GoDocs';
const TETO_AGENTE = 5;
const VALENDO = process.argv.includes('--valendo');
const SNAPSHOT = '/tmp/rep/snapshot-estrelas-run9.json';
const RELATORIO = '/home/notebook/godocs-wt-categoria-aglutinacao/docs/baselines/rodadas/estrelas-run9-para-planilha-DRY.md';

const num = (s: unknown): number | null => {
  const t = (s ?? '').toString().trim();
  if (!t) return null;
  const n = Number(t.replace(/[R$\s.]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const col = (i: number) => {
  let s = '', n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

const tk = await getAccessToken();
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values/${ABA}`, {
  headers: { Authorization: `Bearer ${tk}` },
});
const { values = [] } = (await r.json()) as { values?: string[][] };
const [h, ...ls] = values;
const at = (n: string) => { const i = h.indexOf(n); if (i < 0) throw new Error(`coluna ausente: ${n}`); return i; };
const iId = at('ID Projeto'), iNome = at('Projeto'), iEst = at('Estrelas'), iSt = at('Status'), iEsp = at('Especial?');

const r9 = JSON.parse(readFileSync('/home/notebook/godocs-wt-categoria-aglutinacao/docs/baselines/runs/run-9.json', 'utf8'));
const REC = new Map<string, number>(
  r9.linhas.filter((l: any) => l.agente != null).map((l: any) => [String(l.id).toLowerCase(), Number(l.agente)]),
);

type Linha = { linha: number; id: string; nome: string; rec: number; humana: number | null; status: string; esp: boolean };
const escrever: Linha[] = [];
const faixa: Linha[] = [];
const preservados: Linha[] = [];
const semRec: string[] = [];

ls.forEach((l, k) => {
  const id = (l[iId] ?? '').trim();
  if (!id) return;
  const rec = REC.get(id.toLowerCase());
  const humana = num(l[iEst]);
  const base: Linha = {
    linha: k + 2, id, nome: (l[iNome] ?? '').trim(), rec: rec ?? -1, humana,
    status: (l[iSt] ?? '').trim(), esp: /^(sim|s|1|true)$/i.test((l[iEsp] ?? '').trim()),
  };
  if (rec === undefined) { semRec.push(base.nome); return; }
  if (humana !== null) { preservados.push(base); return; }   // regra 1
  if (rec > TETO_AGENTE) { faixa.push(base); return; }        // regra 2
  if (rec === 0) return;                                      // regra 3
  escrever.push(base);
});

const rebaixados = preservados.filter((p) => p.humana !== null && p.rec < p.humana);
const f = (n: number) => String(n).padStart(4);

console.log(`${VALENDO ? 'VALENDO' : 'ENSAIO'} · aba ${ABA} · coluna "Estrelas" = ${col(iEst)}`);
console.log(`  A ESCREVER (sem nota humana, 1..${TETO_AGENTE}): ${escrever.length}`);
console.log(`  faixa 6-10, NÃO escrita (decisão de comitê):     ${faixa.length}`);
console.log(`  sem nota humana e recomendação 0, não escrito:   ${REC.size - escrever.length - faixa.length - preservados.length}`);
console.log(`  PRESERVADOS (já têm nota humana):                ${preservados.length}   destes, o agente rebaixaria ${rebaixados.length}`);
console.log(`  sem recomendação na run 9:                       ${semRec.length}`);

const dist: Record<number, number> = {};
escrever.forEach((e) => (dist[e.rec] = (dist[e.rec] ?? 0) + 1));

let md = `# Estrelas da run 9 → coluna "Estrelas" (ENSAIO)

> Gerado em 05/09/2026. **Nada foi escrito.** Para valer: \`npx tsx scripts/v2/estrelas-run9-para-planilha.mts --valendo\`.

## O que seria escrito

| | projetos |
|---|---:|
| **a escrever** (sem nota humana, nota 1 a ${TETO_AGENTE}) | **${escrever.length}** |
| faixa 6-10, deixada para o comitê | ${faixa.length} |
| recomendação 0 em célula vazia, não escrito | ${REC.size - escrever.length - faixa.length - preservados.length} |
| preservados (já têm nota de vocês) | ${preservados.length} |
| sem recomendação na run 9 | ${semRec.length} |

Distribuição do que entra: ${Object.keys(dist).map(Number).sort().map((k) => `**${k}★** ${dist[k]}`).join(' · ')}

## As três regras que impedem o estrago

**1. Não sobrescreve nota humana.** Se sobrescrevesse, **${rebaixados.length} projetos seriam rebaixados**:

| humano | agente | projeto |
|---:|---:|---|
${rebaixados.sort((a, b) => (b.humana ?? 0) - (a.humana ?? 0)).slice(0, 12).map((p) => `| **${p.humana}** | ${p.rec} | ${p.nome.replace(/\|/g, '/')} |`).join('\n')}

O PIAPP é a flagship 10★. O Prisma e o GoPrice são os dois casos que a sessão de 05/09 identificou como **erro do agente**, não da triagem.

**2. A faixa 6-10 não é escrita.** A coluna é numérica: o texto "6-10" a quebraria, e o número 6 afirmaria uma posição que a régua se recusa a afirmar. Estes ${faixa.length} vão para o comitê:

${faixa.map((p) => `- ${p.nome}${p.esp ? ' _(especial)_' : ''}`).join('\n') || '_nenhum_'}

**3. Não escreve 0 em célula vazia.** Vazio ("—") e 0 ("Zero") são estados diferentes na tela, e virar "avaliado, vale zero" é afirmação que a rodada não sustenta.

## Rollback

O snapshot da coluna inteira é gravado antes da escrita em \`${SNAPSHOT}\`. Como só se escreve em célula VAZIA, reverter é apagar o que foi escrito — e o snapshot registra exatamente quais linhas.
`;
writeFileSync(RELATORIO, md);
console.log(`\nrelatório: ${RELATORIO}`);

if (!VALENDO) { console.log('ENSAIO — nada escrito.'); process.exit(0); }

writeFileSync(SNAPSHOT, JSON.stringify({ aba: ABA, coluna: col(iEst), gravado_em: new Date().toISOString(), linhas: escrever }, null, 2));
const data = escrever.map((e) => ({ range: `${ABA}!${col(iEst)}${e.linha}`, values: [[e.rec]] }));
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values:batchUpdate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data }),
});
const jw = await w.json();
if (!w.ok) { console.error('FALHOU:', JSON.stringify(jw).slice(0, 300)); process.exit(1); }
console.log(`células atualizadas: ${jw.totalUpdatedCells}`);
