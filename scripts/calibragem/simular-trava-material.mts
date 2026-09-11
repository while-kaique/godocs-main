// Simula, sobre os resultados JÁ colhidos (mesa v348), o efeito da trava `aplicarTravaMaterialMesa`
// do commit 0119ce0: quantos `em_validacao` virariam `aprovar` (quórum 2 de preocupações).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { aplicarTravaMaterialMesa } from '../../src/lib/agents/mesa-especialistas.ts';
const PASTA = process.argv[2];
const itens = readdirSync(join(PASTA, 'projetos')).map((f) => JSON.parse(readFileSync(join(PASTA, 'projetos', f), 'utf8'))).filter((i: any) => (i.http ?? 599) < 500);
let emVal = 0, viraria = 0, ficaria = 0; const exemplos: string[] = []; const porDim: Record<string, { antes: number; depois: number }> = {};
for (const it of itens) {
  const m = it.resultado?.mesa; if (!m || m.veredito !== 'em_validacao') continue;
  emVal++;
  const linhas = String(m.motivo ?? '').split('\n').map((l: string) => l.trim()).filter((l: string) => /^(Horas|Financeiro|Precedente|Cético|FTE|Plausibilidade)[^:]*:/i.test(l));
  let preocupados = 0;
  for (const l of linhas) {
    const dim = l.split(':')[0];
    porDim[dim] ??= { antes: 0, depois: 0 }; porDim[dim].antes++;
    const j = aplicarTravaMaterialMesa({ dimensao: 'fte', preocupa: true, argumento: l.replace(/^[^:]+:\s*/, ''), confianca: 0.8, sinais: [], origem: 'llm' } as any);
    if (j.preocupa) { preocupados++; porDim[dim].depois++; }
  }
  if (preocupados < 2) { viraria++; if (exemplos.length < 6) exemplos.push(`${it.nome.slice(0, 40)} | ${linhas.map((l: string) => l.slice(0, 90)).join(' || ')}`); } else ficaria++;
}
console.log(JSON.stringify({ avaliados: itens.length, em_validacao: emVal, virariam_aprovar: viraria, ficariam: ficaria, preocupacoes_por_dimensao: porDim }, null, 1));
console.log(exemplos.join('\n'));
