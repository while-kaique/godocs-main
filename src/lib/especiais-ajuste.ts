/**
 * Ajuste FINO da nota do run 1 pelas lentes — módulo PURO.
 *
 * ## Por que ajuste, e não um segundo juiz
 * Medido em 03/09/2026: com o painel decidindo sozinho, o PIAPP saiu **2, 5, 3, 7, 8 e 3** em seis
 * chamadas idênticas. As lentes variavam pouco; o resultado é que explodia, porque a nota
 * consolidada caía num degrau e um eixo oscilando 2 movia a nota final em 5 estrelas.
 *
 * Cinco chamadas de LLM não são cinco medidas do mesmo número. Consolidar por mínimo e máximo
 * (que é o desenho certo para não achatar tudo no meio) **amplifica** a variação em vez de
 * diluí-la. Um juiz instável não se calibra: a diferença entre duas rodadas deixa de dizer se a
 * régua melhorou.
 *
 * Então a nota do classificador de 1 agente é a BASE, e as lentes ajustam em cima dela. O ganho de
 * ter cinco olhares não estava em produzir outro número: está em **enxergar por eixo** e em
 * explicar melhor, que é o que a triagem lê.
 */
import { TETO_AGENTE, ehEscape } from '@/lib/estrelas-regua';

/**
 * O quanto as lentes podem mover a nota do run 1, para cima ou para baixo.
 *
 * ⚠️ É 1 de propósito. Acima disso não é calibragem, é substituir o juiz por outro — e foi
 * exatamente o que a medição acima reprovou. Um degrau por rodada é o que permite comparar run a
 * run e saber se a mudança veio da régua ou do ruído.
 */
export const AJUSTE_MAX_PAINEL = 1;

export type AjustePainel = {
  nota: number;
  base: number;
  delta: number;
  /** Uma linha dizendo o que moveu a nota — vai para a leitura e para o relatório da rodada. */
  motivo: string;
};

export type SinalDoPainel = {
  /** A nota que as lentes sustentam por conta própria. */
  nota_lentes: number;
  /** Item do piso nomeado por alguma lente dona dele, ou null. */
  piso: string | null;
};

/**
 * Aplica o ajuste. Três regras, nesta ordem:
 *
 * 1. **Piso nomeado zera**, e zera de qualquer altura. É a única exceção ao limite de um degrau,
 *    porque o piso não é "um pouco menos": é a afirmação de que o projeto não pontua.
 * 2. **A faixa de escape é do run 1.** Se a base entrou em 6-10 com as duas citações conferidas,
 *    as lentes não a tiram de lá: elas julgam eixo isolado e nenhuma sozinha responde à pergunta
 *    do escape. E se a base NÃO entrou, elas também não colocam.
 * 3. **Fora disso, no máximo um degrau** na direção que as lentes apontam.
 */
export function ajustarNotaComPainel(base: number, sinal: SinalDoPainel): AjustePainel {
  if (sinal.piso) {
    return { nota: 0, base, delta: 0 - base, motivo: `zerado pelo piso (${sinal.piso})` };
  }
  if (ehEscape(base)) {
    return { nota: base, base, delta: 0, motivo: 'faixa 6-10 vem do escape, com as duas citações' };
  }
  const querido = sinal.nota_lentes;
  if (querido === base) return { nota: base, base, delta: 0, motivo: 'as lentes concordam com a base' };

  const direcao = querido > base ? 1 : -1;
  const delta = direcao * Math.min(AJUSTE_MAX_PAINEL, Math.abs(querido - base));
  const nota = Math.max(0, Math.min(TETO_AGENTE, base + delta));
  const verbo = delta > 0 ? 'sobe' : 'desce';
  const limitado = Math.abs(querido - base) > AJUSTE_MAX_PAINEL;
  return {
    nota,
    base,
    delta: nota - base,
    motivo: limitado
      ? `${verbo} ${Math.abs(nota - base)} (as lentes sustentavam ${querido}, e o ajuste por rodada é de um degrau)`
      : `${verbo} ${Math.abs(nota - base)} pelas lentes`,
  };
}
