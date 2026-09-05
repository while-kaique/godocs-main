/**
 * Escreve um motivo ESPECÍFICO por projeto na coluna "Motivo Reprovado" da rodada retroativa.
 *
 * ⚠️ **Este texto é lido pelo AUTOR do projeto**, no card dele em "Meus Projetos". Um motivo
 * genérico igual em 137 linhas comunica "ninguém olhou o seu"; e o motivo errado gera discussão
 * que o time de RPA vai ter de resolver um a um. Daí gerar um por projeto.
 *
 * ## O que é PROIBIDO no texto, e por quê
 * - **citar outro projeto** — a leitura da run 9 compara ("como o Report semanal", "os vizinhos de
 *   nota zero"), porque foi escrita para a triagem. Na tela do autor isso vira "por que o dele
 *   passou e o meu não";
 * - **falar de estrela, nota ou régua** — vocabulário interno que o autor não vê;
 * - **julgar a pessoa ou o esforço** — a decisão é sobre o valor mensal apurado, não sobre trabalho;
 * - **travessão e hífen como pontuação** (regra de escrita da casa).
 *
 * O texto diz o que o projeto faz, o número que motivou a decisão, e o que mudaria a decisão.
 * Termina sempre com a porta de volta: há projeto aqui cujo ganho não é mensal (risco evitado,
 * qualidade), e o autor precisa saber para onde ir.
 *
 * Uso:
 *   npx tsx scripts/v2/motivos-reprovacao.mts            # ENSAIO: gera e salva, não escreve
 *   npx tsx scripts/v2/motivos-reprovacao.mts --valendo  # escreve na planilha
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getAccessToken } from '/home/notebook/godocs-wt-categoria-aglutinacao/src/lib/google/auth';

const SP = '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const ABA = 'GoDocs';
const VALENDO = process.argv.includes('--valendo');
const SAIDA = '/tmp/rep/motivos.json';
const CONC = 8;

const snap = JSON.parse(readFileSync('/tmp/rep/snapshot-reprovacao.json', 'utf8'));
const r9 = JSON.parse(readFileSync('/home/notebook/godocs-wt-categoria-aglutinacao/docs/baselines/runs/run-9.json', 'utf8'));
const LEIT = new Map<string, string>(
  r9.linhas.filter((l: any) => l.leitura).map((l: any) => [String(l.id).toLowerCase(), String(l.leitura)]),
);

const SISTEMA = `Você escreve o aviso que o AUTOR de um projeto lê quando ele não passa na revisão da base do GoDocs.

REGRAS ABSOLUTAS
- No MÁXIMO 2 frases. Curtas.
- Frase 1: o que o projeto faz, em linguagem simples, e o valor mensal apurado dele.
- Frase 2: o que precisaria ser demonstrado para a decisão mudar, concreto para ESTE projeto.
- PROIBIDO citar ou comparar com qualquer outro projeto, por nome ou por semelhança.
- PROIBIDO falar de estrela, nota, pontuação, régua, critério, nível ou classificação.
- PROIBIDO julgar a pessoa, o esforço ou a qualidade técnica. A decisão é sobre valor mensal apurado.
- PROIBIDO travessão e hífen como pontuação. Use vírgula, dois pontos ou ponto.
- Português do Brasil, com acentos. Tom institucional e neutro, nunca irônico.
- Não use "apenas", "só", "simples", "pequeno", "limitado" para qualificar o projeto: descreva o fato, não o tamanho.

Responda com o texto puro, sem aspas e sem rótulo.`;

/**
 * ⚠️ **O modelo é EXPLÍCITO, e um guard recusa modelo fraco.**
 *
 * Este script lia `process.env.LLM_MODEL` do `.env` local, que apontava para `gpt-5.4-mini` (o
 * modelo do antigo fallback). Resultado: os 137 textos que 137 autores leriam foram gerados no
 * modelo fraco, sem ninguém perceber, enquanto a run 9 rodava no `sol` por ir pela rota do app
 * (que usa os secrets de PRODUÇÃO). Herdar modelo de arquivo de ambiente é como um script escolhe
 * o modelo errado em silêncio; declarar e conferir é o conserto.
 */
const MODELO = process.env.MODELO_MOTIVOS ?? 'sol';
if (/mini|fallback|3\.5|4o-mini/i.test(MODELO)) {
  console.error(`modelo recusado: "${MODELO}". Este texto é lido pelo autor do projeto e não sai em modelo fraco.`);
  process.exit(2);
}

async function gerar(nome: string, imp: number, leitura: string): Promise<string> {
  const base = process.env.LLM_BASE_URL!;
  const r = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.API_PROXY_TOKEN}` },
    body: JSON.stringify({
      model: MODELO,
      messages: [
        { role: 'system', content: SISTEMA },
        {
          role: 'user',
          content: `PROJETO: ${nome}
VALOR MENSAL APURADO: R$ ${imp.toFixed(2).replace('.', ',')}
PISO DA REVISÃO: R$ 100,00 por mês

OBSERVAÇÃO INTERNA (use o conteúdo, NUNCA a forma; ela cita outros projetos e fala de nota, e as duas coisas são proibidas na sua resposta):
${leitura}`,
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content ?? '').trim().replace(/^["“]|["”]$/g, '');
}

const FECHO =
  ' Se o ganho deste projeto não aparece no valor mensal, por exemplo risco evitado ou qualidade, procure o time de RPA para reavaliação.';

type Saida = { linha: number; id: string; nome: string; imp: number; motivo: string };
const saidas: Saida[] = [];
let feitos = 0;
const fila = [...snap.alvos];

async function worker() {
  for (;;) {
    const a = fila.shift();
    if (!a) return;
    try {
      const corpo = await gerar(a.nome, a.imp, LEIT.get(String(a.id).toLowerCase()) ?? '');
      saidas.push({ linha: a.linha, id: a.id, nome: a.nome, imp: a.imp, motivo: corpo + FECHO });
    } catch (e) {
      console.error(`  falhou ${a.nome}: ${(e as Error).message}`);
    }
    process.stdout.write(`\r   ${++feitos}/${snap.alvos.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
console.log(`\ngerados: ${saidas.length} de ${snap.alvos.length}`);
writeFileSync(SAIDA, JSON.stringify(saidas, null, 1));

if (!VALENDO) { console.log(`ENSAIO. Textos em ${SAIDA}`); process.exit(0); }

const tk = await getAccessToken();
const data = saidas.map((s) => ({ range: `${ABA}!${snap.colMotivo}${s.linha}`, values: [[s.motivo]] }));
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SP}/values:batchUpdate`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ valueInputOption: 'RAW', data }),
});
const jw = await w.json();
if (!w.ok) { console.error('FALHOU:', JSON.stringify(jw).slice(0, 300)); process.exit(1); }
console.log(`células atualizadas: ${jw.totalUpdatedCells}`);
