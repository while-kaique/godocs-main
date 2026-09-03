// Varredura de aglutinação sobre a aba alvo. SEMPRE read-only na planilha: escreve no
// máximo o relatório em JSON. PARES=1 pára antes do LLM (só a vizinhança vetorial).
import { getAccessToken } from '../../src/lib/google/auth';
import {
  calcularIdf, tokenizar, tokensPesados, similaridade, tokensEmComum, nomeContido,
  similaridadeFinal,
} from '../../src/lib/similaridade-lexical';
import {
  candidatosDe, consolidarSugestoes, PISO_SIMILARIDADE_AGLUTINACAO,
  type ProjetoAglutinavel, type Sugestao,
} from '../../src/lib/aglutinacao';
import { julgarAglutinacao } from '../../src/lib/agents/aglutinador';
import { ehProjetoTesteE2E } from '../../src/lib/google/chat';

const SPREADSHEET = process.env.GOOGLE_SHEETS_ID || '1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';
const TAB = process.env.GOOGLE_SHEETS_TAB!;
const SO_PARES = process.env.PARES === '1';
const PISO = Number(process.env.PISO ?? PISO_SIMILARIDADE_AGLUTINACAO);
const MAX_JULGAMENTOS = Number(process.env.MAX ?? Infinity);

const token = await getAccessToken();
const base = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET}`;
const { values = [] } = (await (await fetch(`${base}/values/${encodeURIComponent(TAB)}`, {
  headers: { Authorization: `Bearer ${token}` },
})).json()) as { values?: string[][] };
const [header, ...linhas] = values;
const col = (n: string) => header.indexOf(n);
const iId = col('ID Projeto'), iNome = col('Projeto'), iDesc = col('Descrição');
const iData = col('Data Submissão'), iStatus = col('Status');
const iPai = header.indexOf('ID Pai'); // pode não existir na aba de prod ainda
// ⚠️ A documentação de verdade mora no SQLite. Rodando contra a PLANILHA, o melhor
// substituto é o MEMORIAL: ele descreve o processo em detalhe e é o texto mais rico que a
// aba tem. Rotulado como aproximação de propósito — a varredura completa é a rota admin.
const iMem = header.indexOf('Memorial de Saving');
const iRec = header.indexOf('Racional Receita');
const iEsp = header.indexOf('Ganho Imensurável');

/** pt-BR "12/05/2026" ou ISO. Sem data → null (o par não é sugerido). */
const dataMs = (s?: string) => {
  const t = (s ?? '').trim();
  if (!t) return null;
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return Date.UTC(+br[3], +br[2] - 1, +br[1]);
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
};

const projetos: ProjetoAglutinavel[] = [];
for (const l of linhas) {
  const id = (l[iId] ?? '').trim(), nome = (l[iNome] ?? '').trim();
  if (!id || !nome) continue;
  if ((l[iStatus] ?? '').trim().toLowerCase() === 'rascunho') continue;
  // ⚠️ Fixtures do harness E2E ficam FORA: são cópias quase idênticas umas das outras
  // (é para isso que existem) e sozinhas dominariam o ranking de pares parecidos.
  if (ehProjetoTesteE2E(nome)) continue;
  projetos.push({
    id, nome, descricao: l[iDesc],
    documentacao: [iMem, iRec, iEsp]
      .filter((i) => i >= 0)
      .map((i) => (l[i] ?? '').trim())
      .filter((t) => t && t !== '—')
      .join('\n')
      .slice(0, 4000),
    dataMs: dataMs(l[iData]),
    jaVinculado: iPai >= 0 && !!(l[iPai] ?? '').trim() && (l[iPai] ?? '').trim() !== '—',
  });
}
console.log(`${TAB}: ${projetos.length} projetos · piso ${PISO}`);

// ⚠️ Candidatos por LÉXICO, não por embedding (ver src/lib/similaridade-lexical.ts):
// embedding aproxima por TEMA, e tema é o falso positivo que o juiz existe para recusar.
// O sinal de "feature de" é o NOME DO PRODUTO reaparecendo — TF-IDF sobre o próprio corpus.
// ⚠️ A DOCUMENTAÇÃO entra no vocabulário (decisão do Luis) — mas ela mora no SQLite, não na
// planilha. Rodando por script contra a planilha, `documentacao` vem vazia e o sinal é só
// nome+descrição; a varredura COMPLETA precisa rodar dentro do app (rota admin).
const textosProjeto = projetos.map((p) => ({
  nome: p.nome, descricao: p.descricao, documentacao: p.documentacao,
}));
const idf = calcularIdf(
  textosProjeto.map((t) => [
    ...tokenizar(t.nome), ...tokenizar(t.descricao ?? ''), ...tokenizar(t.documentacao ?? ''),
  ]),
);
if (textosProjeto.every((t) => !t.documentacao))
  console.log('⚠️ sem documentação nesta fonte — o sinal é só nome + descrição');
const pesos = textosProjeto.map((t) => tokensPesados(t));
console.log(`vocabulário: ${idf.size} tokens`);

const universo = new Map(projetos.map((p) => [p.id, p]));

// Vizinhança por cosseno (581² = ~337k comparações, instantâneo em JS).
const comCandidatos: Array<{ p: ProjetoAglutinavel; cands: ReturnType<typeof candidatosDe> }> = [];
const porque = new Map<string, string>();
projetos.forEach((p, i) => {
  const viz = projetos
    .map((o, j) => {
      if (o.id === p.id) return null;
      const sim = similaridade(pesos[i], pesos[j], idf);
      // Nome contido vale mais que a soma de tokens — é a assinatura de família.
      const contido = nomeContido(textosProjeto[i], textosProjeto[j], idf);
      const ajustada = similaridadeFinal(sim, contido);
      if (ajustada >= PISO)
        porque.set(
          `${p.id}|${o.id}`,
          [
            contido ? 'nome contido' : '',
            tokensEmComum(pesos[i], pesos[j], idf).join(', '),
          ].filter(Boolean).join(' · '),
        );
      return { id: o.id, similaridade: ajustada };
    })
    .filter((x): x is { id: string; similaridade: number } => !!x);
  const cands = candidatosDe(p, viz, universo, { piso: PISO });
  if (cands.length) comCandidatos.push({ p, cands });
});
const paresUnicos = new Set(comCandidatos.flatMap(({ cands }) => cands.map((c) => `${c.filhoId}>${c.paiId}`)));
console.log(`projetos com ≥1 candidato: ${comCandidatos.length} · pares únicos: ${paresUnicos.size}`);
const vistos = new Set<string>();
const top = comCandidatos
  .flatMap(({ cands }) => cands)
  .filter((c) => { const k = `${c.filhoId}>${c.paiId}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
  .sort((a, b) => b.similaridade - a.similaridade)
  .slice(0, 15);
console.log('\n15 pares mais parecidos (ANTES do julgamento):');
for (const t of top)
  console.log(
    `  ${t.similaridade.toFixed(3)}  ${universo.get(t.filhoId)?.nome.slice(0, 40)}\n` +
    `         filho de  ${universo.get(t.paiId)?.nome.slice(0, 40)}   [${porque.get(`${t.filhoId}|${t.paiId}`) ?? porque.get(`${t.paiId}|${t.filhoId}`) ?? ''}]`,
  );

if (SO_PARES) { console.log('\nPARES=1 — parando antes do LLM.'); process.exit(0); }

const aJulgar = comCandidatos.slice(0, MAX_JULGAMENTOS);
console.log(`\njulgando ${aJulgar.length} projetos...`);
const brutas: Sugestao[] = [];
const erros: string[] = [];
let t0 = Date.now();
for (const [n, { p, cands }] of aJulgar.entries()) {
  const { sugestao, erro } = await julgarAglutinacao(p, cands, universo);
  if (sugestao) brutas.push(sugestao);
  if (erro) erros.push(`${p.id}: ${erro}`);
  process.stdout.write(`  ${n + 1}/${aJulgar.length} · ${brutas.length} sugestões · ${erros.length} falhas (${Math.round((Date.now() - t0) / 1000)}s)\r`);
}
// ⚠️ Falha de chamada NÃO é "não é feature" — sem esta linha, uma rajada de 502 do proxy
// faria a varredura anunciar "nenhuma sugestão" para uma base que nunca foi analisada.
if (erros.length)
  console.log(`\n⚠️ ${erros.length} de ${aJulgar.length} julgamentos FALHARAM (não foram analisados): ${erros.slice(0, 3).join(' · ')}${erros.length > 3 ? ' …' : ''}`);
const sugestoes = consolidarSugestoes(brutas);
console.log(`\n\n${sugestoes.length} sugestões após consolidar (de ${brutas.length} brutas):\n`);
for (const s of sugestoes)
  console.log(
    `  conf ${s.confianca.toFixed(2)} · sim ${s.similaridade.toFixed(3)}\n` +
    `    FILHO: ${universo.get(s.filhoId)?.nome}\n` +
    `    PAI:   ${universo.get(s.paiId)?.nome}\n` +
    `    ${s.justificativa}\n`,
  );
const saida = `${process.env.BACKUP_DIR ?? '.'}/aglutinacao-${TAB}.json`;
await (await import('node:fs/promises')).writeFile(
  saida,
  JSON.stringify(sugestoes.map((s) => ({ ...s, filho: universo.get(s.filhoId)?.nome, pai: universo.get(s.paiId)?.nome })), null, 1),
);
console.log(`relatório: ${saida}`);
