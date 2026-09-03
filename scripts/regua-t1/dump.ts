// LEITURA PURA da planilha de prod (T1 — validação cega da régua).
// Nunca escreve. Salva o corpus em scratchpad para o passo do LLM.
import fs from 'node:fs';
import { it } from 'vitest';

for (const l of fs.readFileSync('/home/notebook/godocs-main/.env', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const SAIDA = process.env.T1_OUT ?? '/tmp/t1-corpus.json';

it('dump T1', async () => {
  const { readAllRows } = await import('@/lib/google/sheets');
  const rows = (await readAllRows()) as Record<string, string>[];
  const g = (r: Record<string, string>, k: string) => String(r[k] ?? '').trim();

  console.log(`\nlinhas: ${rows.length}`);

  const especial = (r: Record<string, string>) => /^sim$/i.test(g(r, 'Especial?'));
  const desc = (r: Record<string, string>) => /descontinuad/i.test(g(r, 'Status'));
  const notaBruta = (r: Record<string, string>) => g(r, 'Estrelas');
  const nota = (r: Record<string, string>) => {
    const v = notaBruta(r).replace(',', '.');
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const comNota = rows.filter((r) => nota(r) !== null);
  console.log(`com nota (inclui 0): ${comNota.length}`);
  console.log(`  especiais: ${comNota.filter(especial).length} · não-especiais: ${comNota.filter((r) => !especial(r)).length}`);
  console.log(`  descontinuados entre eles: ${comNota.filter(desc).length}`);

  const soEspeciais = process.env.T1_ESPECIAIS === '1';
  const alvo = soEspeciais
    ? rows.filter((r) => especial(r) && !desc(r))
    : comNota.filter((r) => !especial(r) && !desc(r));
  console.log(`\nALVO T1 (não-especial · com nota · não-descontinuado): ${alvo.length}`);

  const curva = new Map<number, number>();
  for (const r of alvo) curva.set(nota(r)!, (curva.get(nota(r)!) ?? 0) + 1);
  console.log('curva humana do alvo:');
  for (const [n, q] of [...curva].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(n).padStart(2)}★  ${String(q).padStart(4)}  ${'█'.repeat(Math.ceil(q / 5))}`);
  }

  // Volume de texto disponível por campo (o que o agente vai poder ler).
  const CAMPOS = ['Projeto', 'Descrição', 'Escopo', 'Memorial de Saving', 'Receita Memorial',
    'Observações', 'Contexto do Projeto Especial', 'Complexidade', 'Tipos Projeto',
    'Justificativa Custo Evitado', 'Alocação Ganhos', 'Área', 'Ferramenta'];
  console.log('\npreenchimento dos campos no alvo:');
  for (const c of CAMPOS) {
    const preenchidos = alvo.filter((r) => g(r, c) !== '' && g(r, c) !== '—').length;
    const chars = alvo.reduce((a, r) => a + g(r, c).length, 0);
    console.log(`  ${c.padEnd(32)} ${String(Math.round((preenchidos / alvo.length) * 100)).padStart(3)}%  média ${String(Math.round(chars / alvo.length)).padStart(5)} chars`);
  }

  const corpus = alvo.map((r) => ({
    id: g(r, 'ID Projeto'),
    nome: g(r, 'Projeto'),
    area: g(r, 'Área'),
    notaHumana: nota(r),
    status: g(r, 'Status'),
    complexidade: g(r, 'Complexidade'),
    tipos: g(r, 'Tipos Projeto'),
    ferramenta: g(r, 'Ferramenta'),
    descricao: g(r, 'Descrição'),
    escopo: g(r, 'Escopo'),
    memorialSaving: g(r, 'Memorial de Saving'),
    memorialReceita: g(r, 'Receita Memorial'),
    observacoes: g(r, 'Observações'),
    contexto: g(r, 'Contexto do Projeto Especial'),
    alguemFazia: g(r, 'Alguém Fazia?'),
    savingReais: g(r, 'Saving Reais'),
    receitaMensal: g(r, 'Receita Mensal'),
    savingHoras: g(r, 'Saving Horas'),
    dataSubmissao: g(r, 'Data Submissão'),
  }));
  fs.writeFileSync(SAIDA, JSON.stringify(corpus, null, 1));
  console.log(`\ncorpus salvo em ${SAIDA} (${(fs.statSync(SAIDA).size / 1024 / 1024).toFixed(1)} MB)`);

  // Também os especiais, para o §6 poder ser recomparado depois.
  const espAtivos = rows.filter((r) => especial(r) && !desc(r));
  fs.writeFileSync(SAIDA.replace('.json', '-especiais.json'), JSON.stringify(espAtivos.map((r) => ({
    id: g(r, 'ID Projeto'), nome: g(r, 'Projeto'), notaHumana: nota(r), area: g(r, 'Área'),
    descricao: g(r, 'Descrição'), escopo: g(r, 'Escopo'), contexto: g(r, 'Contexto do Projeto Especial'),
    observacoes: g(r, 'Observações'),
    contexto: g(r, 'Contexto do Projeto Especial'), complexidade: g(r, 'Complexidade'),
  })), null, 1));
  console.log(`especiais ativos: ${espAtivos.length}`);
}, 900_000);
