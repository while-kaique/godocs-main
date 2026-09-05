/**
 * Rodada RETROATIVA e PONTUAL: reprova na planilha os projetos de impacto mensal abaixo do piso,
 * exceto os que têm estrela.
 *
 * ## A régua (decisão do dono do produto, 04/09/2026)
 * Aprovado · impacto líquido mensal < R$ 100 · SEM estrela → "Reprovado".
 *
 * ⚠️ **"Ter estrela" conta a nota HUMANA e a recomendação do AGENTE.** É a régua do Luis: se a
 * run 9 diz que um projeto que ninguém pontuou vale 4, ele vale 4. Sem isso, esta rodada reprovaria
 * o «Konduto - Alerta + Travamento» (4★ do agente, trava pedido suspeito, R$ 51/mês de impacto) —
 * projeto cujo valor é fraude evitada, não saving. Medido: a exceção salva 95 dos 238.
 *
 * ⚠️ **Projeto SEM recomendação na run 9 NÃO é reprovado.** "Não sei" não é "zero", e a cobertura
 * da run foi 98%: os 2% que sobraram não podem ser punidos por terem faltado à chamada.
 *
 * ## Por que a planilha, e não o SQLite
 * A planilha é a fonte da verdade do que APARECE (o sync reverso não devolve `status` para
 * `projetos.status`, e as telas leem o espelho). Então escreve-se lá e força-se o sync do espelho.
 *
 * ## Rollback
 * O snapshot do Status e do Motivo Reprovado de CADA linha tocada é gravado ANTES da escrita, em
 * `--snapshot`. `reverter-impacto-baixo.mts` o restaura célula a célula. Sem o snapshot o script
 * ABORTA: uma rodada retroativa sem volta não é uma rodada, é um acidente.
 *
 * Uso:
 *   npx tsx scripts/v2/reprovar-impacto-baixo.mts                 # ENSAIO (default)
 *   npx tsx scripts/v2/reprovar-impacto-baixo.mts --valendo       # escreve
 */
import { writeFileSync } from 'node:fs';
import { getAccessToken } from '/home/notebook/godocs-wt-categoria-aglutinacao/src/lib/google/auth';

const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const ABA = 'GoDocs';
const PISO_REAIS = 100;
const VALENDO = process.argv.includes('--valendo');
const SNAPSHOT = '/tmp/rep/snapshot-reprovacao.json';

const MOTIVO =
  'Reprovado em revisão retroativa da base (04/09/2026): impacto financeiro mensal abaixo de ' +
  'R$ 100 e sem reconhecimento por estrela. Se o ganho deste projeto não está no valor mensal ' +
  '(por exemplo risco evitado ou qualidade), fale com o time de RPA para reavaliação.';

/** pt-BR com vírgula decimal; o `.` é separador de milhar. Ver a auditoria da coluna em 04/09. */
function num(s: unknown): number | null {
  const t = (s ?? '').toString().trim();
  if (!t) return null;
  const n = Number(t.replace(/[R$\s.]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const ehSim = (s: unknown) => /^(sim|s|1|true)$/i.test((s ?? '').toString().trim());
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
const iId = at('ID Projeto'), iNome = at('Projeto'), iSt = at('Status');
const iImp = at('Impacto Líquido Mensal'), iEst = at('Estrelas'), iEsp = at('Especial?');
const iMot = at('Motivo Reprovado');

// Recomendações da run 9 — a régua trata a estrela do agente como estrela.
const r9 = JSON.parse(
  await import('node:fs').then((m) => m.readFileSync('/home/notebook/godocs-wt-categoria-aglutinacao/docs/baselines/runs/run-9.json', 'utf8')),
);
const REC = new Map<string, number>(
  r9.linhas.filter((l: any) => l.agente != null).map((l: any) => [String(l.id).toLowerCase(), Number(l.agente)]),
);

type Alvo = { linha: number; id: string; nome: string; imp: number; statusAntes: string; motivoAntes: string };
const alvos: Alvo[] = [];
const protegidos = { estrelaHumana: 0, estrelaAgente: 0, semRecomendacao: 0, especial: 0 };

ls.forEach((l, k) => {
  if ((l[iSt] ?? '').trim().toLowerCase() !== 'aprovado') return;
  const imp = num(l[iImp]);
  if (imp === null || imp >= PISO_REAIS) return;
  const humana = num(l[iEst]) ?? 0;
  const rec = REC.get(String(l[iId] ?? '').trim().toLowerCase());
  if (ehSim(l[iEsp])) protegidos.especial++;
  if (humana > 0) { protegidos.estrelaHumana++; return; }
  if (rec === undefined) { protegidos.semRecomendacao++; return; }
  if (rec > 0) { protegidos.estrelaAgente++; return; }
  alvos.push({
    linha: k + 2, // +1 do cabeçalho, +1 porque a planilha é 1-based
    id: (l[iId] ?? '').trim(),
    nome: (l[iNome] ?? '').trim(),
    imp,
    statusAntes: l[iSt] ?? '',
    motivoAntes: l[iMot] ?? '',
  });
});

console.log(`piso: R$ ${PISO_REAIS} · aba ${ABA} · ${VALENDO ? 'VALENDO' : 'ENSAIO'}`);
console.log(`protegidos: estrela humana ${protegidos.estrelaHumana} · estrela do agente ${protegidos.estrelaAgente} · sem recomendação ${protegidos.semRecomendacao}`);
console.log(`ALVO: ${alvos.length} projetos`);
for (const a of alvos.slice(0, 10)) console.log(`   L${a.linha} · R$ ${a.imp} · ${a.nome.slice(0, 55)}`);
if (alvos.length > 10) console.log(`   … e mais ${alvos.length - 10}`);

if (!VALENDO) {
  writeFileSync('/tmp/rep/alvos-ensaio.json', JSON.stringify(alvos, null, 1));
  console.log('\nENSAIO — nada escrito. Alvos em /tmp/rep/alvos-ensaio.json');
  process.exit(0);
}

// ⚠️ O snapshot vem ANTES da escrita e é a condição para ela acontecer.
writeFileSync(SNAPSHOT, JSON.stringify({ aba: ABA, colStatus: col(iSt), colMotivo: col(iMot), gravado_em: new Date().toISOString(), alvos }, null, 2));
console.log(`\nsnapshot para rollback: ${SNAPSHOT} (${alvos.length} linhas)`);

const data = alvos.flatMap((a) => [
  { range: `${ABA}!${col(iSt)}${a.linha}`, values: [['Reprovado']] },
  { range: `${ABA}!${col(iMot)}${a.linha}`, values: [[MOTIVO]] },
]);
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values:batchUpdate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data }),
});
const jw = await w.json();
if (!w.ok) { console.error('FALHOU:', JSON.stringify(jw).slice(0, 400)); process.exit(1); }
console.log(`células atualizadas: ${jw.totalUpdatedCells}`);
