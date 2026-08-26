/**
 * Harness de concordância (T1 do painel de agentes) — a aritmética do "melhorou".
 *
 * O que estes testes prendem, com casos FIXOS:
 * - sem pares, as médias são `null` e NÃO 0 (0 leria como "acertou tudo" no payload da rota);
 * - o viés tem SINAL: dois juízes com o mesmo MAE, um generoso e um duro, não podem sair iguais;
 * - a matriz agrupa pelas faixas da régua (fonte única) e o 0 tem faixa PRÓPRIA;
 * - a rodada mais generosa que a `CURVA_BASE` é detectada nos cortes que a régua nomeia (3 e 5);
 * - `compararConcordancia` só declara vitória com MAE menor **E** % dentro de ±1 maior — é a
 *   trava de subida do T7, e medição ausente nunca "bate o baseline".
 */
import { describe, it, expect } from 'vitest';
import {
  FAIXAS,
  LIMIARES_GENEROSIDADE,
  compararConcordancia,
  faixaDe,
  medirConcordancia,
  type ParNota,
} from '@/lib/especiais-concordancia';
import { TIERS, percentilAcimaDe } from '@/lib/especiais-regua';

function par(humana: number, recomendada: number, i = 0): ParNota {
  return { projeto_id: `p${i}-${humana}-${recomendada}`, nome: null, area: null, humana, recomendada };
}

describe('faixas', () => {
  it('derivam dos TIERS da régua e acrescentam a faixa do zero', () => {
    expect(FAIXAS).toHaveLength(TIERS.length + 1);
    expect(FAIXAS[0].chave).toBe('zero');
    expect(FAIXAS.slice(1).map((f) => f.chave)).toEqual(TIERS.map((t) => t.chave));
  });

  it('0 tem faixa própria, e cada nota cai no tier da régua', () => {
    expect(faixaDe(0)).toBe('zero');
    expect(faixaDe(1)).toBe('bronze');
    expect(faixaDe(2)).toBe('bronze');
    expect(faixaDe(3)).toBe('prata');
    expect(faixaDe(4)).toBe('prata');
    expect(faixaDe(5)).toBe('ouro');
    expect(faixaDe(7)).toBe('diamante');
    expect(faixaDe(10)).toBe('diamante');
  });

  it('nota fora da escala não cria faixa fantasma', () => {
    expect(faixaDe(-3)).toBe('zero');
    expect(faixaDe(99)).toBe('diamante');
    expect(faixaDe(Number.NaN)).toBe('zero');
  });
});

describe('medirConcordancia', () => {
  it('sem pares devolve null nas médias (não 0)', () => {
    const m = medirConcordancia([]);
    expect(m.pares).toBe(0);
    expect(m.mae).toBeNull();
    expect(m.vies).toBeNull();
    expect(m.exatas_pct).toBeNull();
    expect(m.dentro_de_1_pct).toBeNull();
    expect(m.mais_generosa).toBe(false);
  });

  it('juiz perfeito: MAE 0, 100% exatas, viés 0', () => {
    const m = medirConcordancia([par(0, 0, 1), par(1, 1, 2), par(3, 3, 3)]);
    expect(m.mae).toBe(0);
    expect(m.vies).toBe(0);
    expect(m.exatas_pct).toBe(100);
    expect(m.dentro_de_1_pct).toBe(100);
  });

  it('caso fixo: MAE, exatas e dentro de ±1 saem dos números, não de arredondamento', () => {
    // erros: 0, +1, -1, +3  → soma abs 5 / 4 = 1.25 · dentro de ±1: 3 de 4 = 75%
    const m = medirConcordancia([par(2, 2, 1), par(1, 2, 2), par(3, 2, 3), par(0, 3, 4)]);
    expect(m.pares).toBe(4);
    expect(m.mae).toBe(1.25);
    expect(m.exatas_pct).toBe(25);
    expect(m.dentro_de_1_pct).toBe(75);
    expect(m.vies).toBe(0.75); // (0 +1 -1 +3) / 4
  });

  it('o viés POR NOTA expõe a compressão que o agregado cancela', () => {
    // o defeito medido na 1ª corrida real: infla o zero, esmaga a nota alta, agregado ~0
    const m = medirConcordancia([par(0, 2, 1), par(0, 2, 2), par(8, 4, 3)]);
    expect(m.vies).toBe(0); // (+2 +2 -4) / 3 — leria como juiz calibrado
    const zero = m.erro_por_nota.find((e) => e.humana === 0)!;
    const oito = m.erro_por_nota.find((e) => e.humana === 8)!;
    expect(zero.vies).toBe(2);
    expect(zero.n).toBe(2);
    expect(oito.vies).toBe(-4);
    expect(m.erro_por_nota.map((e) => e.humana)).toEqual([0, 8]); // ordenado pelo gabarito
  });

  it('o viés separa o juiz generoso do duro — o MAE sozinho não', () => {
    const generoso = medirConcordancia([par(0, 1, 1), par(1, 2, 2), par(2, 3, 3)]);
    const duro = medirConcordancia([par(1, 0, 1), par(2, 1, 2), par(3, 2, 3)]);
    expect(generoso.mae).toBe(duro.mae);
    expect(generoso.vies).toBe(1);
    expect(duro.vies).toBe(-1);
  });

  it('a matriz conta por faixa: humana bronze julgada prata aparece nessa célula', () => {
    const m = medirConcordancia([par(1, 4, 1), par(1, 4, 2), par(0, 0, 3)]);
    expect(m.matriz.bronze.prata).toBe(2);
    expect(m.matriz.zero.zero).toBe(1);
    expect(m.matriz.bronze.bronze).toBe(0); // faixa presente mesmo vazia
    for (const linha of FAIXAS) {
      expect(Object.keys(m.matriz[linha.chave]).sort()).toEqual(
        FAIXAS.map((f) => f.chave).sort(),
      );
    }
  });

  it('rodada inflada é apontada nos cortes da régua (3 e 5)', () => {
    // metade em 3★ numa base em que ≥3 é ~4,8% — é inflação, e o corte de 5 também estoura
    const m = medirConcordancia([par(1, 3, 1), par(1, 5, 2), par(0, 0, 3), par(0, 0, 4)]);
    expect(m.generosidade.map((g) => g.limiar)).toEqual([...LIMIARES_GENEROSIDADE]);
    const tres = m.generosidade.find((g) => g.limiar === 3)!;
    expect(tres.corrida_pct).toBe(50);
    expect(tres.base_pct).toBeCloseTo(Number(percentilAcimaDe(3).toFixed(1)), 1);
    expect(tres.mais_generosa).toBe(true);
    expect(m.mais_generosa).toBe(true);
  });

  it('rodada dentro da curva não é acusada de inflação', () => {
    const m = medirConcordancia([par(0, 0, 1), par(1, 1, 2), par(0, 0, 3), par(2, 1, 4)]);
    expect(m.mais_generosa).toBe(false);
    for (const g of m.generosidade) expect(g.corrida_pct).toBe(0);
  });

  it('a distribuição sempre traz as notas da CURVA_BASE, mesmo sem projeto nelas', () => {
    const m = medirConcordancia([par(0, 0, 1)]);
    const notas = m.distribuicao.map((d) => d.nota);
    expect(notas).toContain(10);
    expect(notas).toEqual([...notas].sort((a, b) => a - b));
    const dez = m.distribuicao.find((d) => d.nota === 10)!;
    expect(dez.corrida).toBe(0);
    expect(dez.base_pct).toBeGreaterThan(0); // a base tem 1 projeto de 10★
  });
});

describe('compararConcordancia (a trava de subida do T7)', () => {
  const baseline = medirConcordancia([par(1, 2, 1), par(2, 3, 2), par(0, 1, 3), par(3, 0, 4)]);

  it('exige MAE menor E % dentro de ±1 maior', () => {
    const melhor = medirConcordancia([par(1, 1, 1), par(2, 2, 2), par(0, 0, 3), par(3, 3, 4)]);
    const c = compararConcordancia(baseline, melhor);
    expect(c.mae_menor).toBe(true);
    expect(c.dentro_de_1_maior).toBe(true);
    expect(c.bate_baseline).toBe(true);
    expect(c.delta_mae).toBeLessThan(0);
    expect(c.delta_dentro_de_1).toBeGreaterThan(0);
  });

  it('MAE menor com ±1 igual NÃO bate o baseline', () => {
    // mesmos "dentro de ±1" (3 de 4): o erro grande cai de 3 para 2 — MAE melhora, ±1 empata
    const parcial = medirConcordancia([par(1, 2, 1), par(2, 3, 2), par(0, 1, 3), par(3, 1, 4)]);
    const c = compararConcordancia(baseline, parcial);
    expect(c.mae_menor).toBe(true);
    expect(c.dentro_de_1_maior).toBe(false);
    expect(c.bate_baseline).toBe(false);
  });

  it('empate não é vitória', () => {
    expect(compararConcordancia(baseline, baseline).bate_baseline).toBe(false);
  });

  it('medição ausente nunca bate o baseline', () => {
    const vazio = medirConcordancia([]);
    expect(compararConcordancia(baseline, vazio).bate_baseline).toBe(false);
    expect(compararConcordancia(vazio, baseline).bate_baseline).toBe(false);
    expect(compararConcordancia(vazio, baseline).delta_mae).toBeNull();
  });
});
