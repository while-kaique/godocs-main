// Backfill do eixo TIPO sobre a aba alvo. DRY por default; grava com ESCREVER=1.
// LOTES=<n> limita quantos lotes rodar (para calibrar a régua antes de gastar os 30).
import { getAccessToken } from '../../src/lib/google/auth';
import { categorizarLote, TAMANHO_LOTE, type ProjetoParaCategorizar } from '../../src/lib/agents/categorizador';
import { ROTULO_TIPO, tipoParaSheet, normalizarTipo } from '../../src/lib/categoria-projeto';

const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB;
const ESCREVER = process.env.ESCREVER === '1';
const MAX_LOTES = Number(process.env.LOTES ?? Infinity);
const SO_VAZIOS = process.env.SO_VAZIOS !== '0'; // default: não reclassifica o que já tem tipo
if (!TAB) throw new Error('setar GOOGLE_SHEETS_TAB');
if (TAB === 'GoDocs' && process.env.CONFIRMO_PROD !== '1')
  throw new Error('recusado: aba de PRODUÇÃO exige CONFIRMO_PROD=1');

const token = await getAccessToken();
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`;
const auth = { Authorization: `Bearer ${token}` };
const { values = [] } = (await (
  await fetch(`${base}/values/${encodeURIComponent(TAB)}`, { headers: auth })
).json()) as { values?: string[][] };
const [header, ...linhas] = values;
const col = (n: string) => {
  const i = header.indexOf(n);
  if (i < 0) throw new Error(`coluna "${n}" não existe em ${TAB}`);
  return i;
};
const iId = col('ID Projeto'), iNome = col('Projeto'), iDesc = col('Descrição');
const iFerr = col('Ferramenta'), iTipo = col('Tipo de Projeto');
const letra = (n: number) => { let x = n, s = ''; do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0); return s; };

// Só linhas com id e nome; por default só as que ainda não têm tipo.
const alvo: Array<{ linha: number; p: ProjetoParaCategorizar }> = [];
linhas.forEach((l, i) => {
  const id = (l[iId] ?? '').trim();
  const nome = (l[iNome] ?? '').trim();
  const jaTem = normalizarTipo(l[iTipo]);
  if (!id || !nome) return;
  if (SO_VAZIOS && jaTem) return;
  alvo.push({ linha: i, p: { id, nome, descricao: l[iDesc], ferramenta: l[iFerr] } });
});

const lotes: (typeof alvo)[] = [];
for (let i = 0; i < alvo.length; i += TAMANHO_LOTE) lotes.push(alvo.slice(i, i + TAMANHO_LOTE));
const aRodar = lotes.slice(0, MAX_LOTES);
console.log(`${TAB}: ${alvo.length} projetos sem tipo → ${lotes.length} lotes de ${TAMANHO_LOTE}; rodando ${aRodar.length}`);

const saida = new Map<number, string>(); // índice da linha → rótulo
const conta = new Map<string, number>();
let t0 = Date.now();
for (const [n, lote] of aRodar.entries()) {
  const r = await categorizarLote(lote.map((x) => x.p));
  r.forEach((res, j) => {
    saida.set(lote[j].linha, tipoParaSheet(res.tipo));
    const k = `${res.tipo ? ROTULO_TIPO[res.tipo] : 'indefinido'}/${res.origem}`;
    conta.set(k, (conta.get(k) ?? 0) + 1);
  });
  process.stdout.write(`  lote ${n + 1}/${aRodar.length} (${Math.round((Date.now() - t0) / 1000)}s)\r`);
}
console.log(`\nconcluído em ${Math.round((Date.now() - t0) / 1000)}s`);
console.log('\ndistribuição (tipo/origem):');
for (const [k, v] of [...conta.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);

console.log('\namostra (20):');
for (const { linha, p } of aRodar.flat().slice(0, 20))
  console.log(`  ${saida.get(linha)?.padEnd(11)} | ${p.nome.slice(0, 58)}`);

if (!ESCREVER) { console.log('\nDRY-RUN — rode com ESCREVER=1 para gravar a coluna.'); process.exit(0); }
const L = letra(iTipo);
const valores = linhas.map((l, i) => [saida.has(i) ? saida.get(i)! : (l[iTipo] ?? '')]);
const res = await fetch(`${base}/values/${encodeURIComponent(TAB)}!${L}2:${L}${linhas.length + 1}?valueInputOption=RAW`, {
  method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: valores }),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
console.log(`gravado: ${(await res.json() as { updatedCells?: number }).updatedCells} células em ${L}`);
