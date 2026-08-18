/**
 * Régua de estrelas — a curva da base e o delta da recomendação.
 *
 * O que estes testes prendem: a curva REAL (é ela que impede inflação — ≥3 é top 4%), o
 * mapeamento de tier, e a regra de que "sem nota gravada" não produz delta (senão a tela
 * mostraria a própria recomendação como se fosse divergência).
 */
import { describe, it, expect } from 'vitest';
import {
  CURVA_BASE,
  NIVEIS,
  NOTA_MAX,
  TIERS,
  TOTAL_AUDITADO,
  deltaRecomendacao,
  definicaoDe,
  percentilAcimaDe,
  raridadeDe,
  rotuloDelta,
  tierDe,
  type AvaliacaoEspecial,
} from '@/lib/especiais-regua';

function avaliacao(nota: number): AvaliacaoEspecial {
  return {
    projeto_id: 'p',
    estrelas_recomendada: nota,
    confianca: 'media',
    leitura: null,
    contestada: false,
    origem: 'teste',
    modelo: null,
    criado_em: null,
  };
}

describe('curva da base', () => {
  it('conta os 541 projetos auditados (os 100 vazios ficam de fora do denominador)', () => {
    expect(TOTAL_AUDITADO).toBe(541);
    expect(CURVA_BASE.vazio).toBe(100);
  });

  it('≥3 estrelas é top ~5% e ≥5 é top ~1% — a régua é dura de propósito', () => {
    expect(percentilAcimaDe(3)).toBeLessThan(6);
    expect(percentilAcimaDe(5)).toBeLessThan(2);
    expect(percentilAcimaDe(1)).toBeGreaterThan(20);
  });

  it('não anuncia raridade nos níveis do piso (0 e 1 são a base, não conquista)', () => {
    expect(raridadeDe(0)).toBeNull();
    expect(raridadeDe(1)).toBeNull();
    expect(raridadeDe(3)).toContain('top');
  });
});

describe('tiers e definições', () => {
  it('mapeia nota → tier pela faixa declarada', () => {
    expect(tierDe(1)?.chave).toBe('bronze');
    expect(tierDe(2)?.chave).toBe('bronze');
    expect(tierDe(3)?.chave).toBe('prata');
    expect(tierDe(5)?.chave).toBe('ouro');
    expect(tierDe(7)?.chave).toBe('diamante');
    expect(tierDe(10)?.chave).toBe('diamante');
  });

  it('zero e sem nota não têm tier (badge é conquista, não rótulo de ausência)', () => {
    expect(tierDe(0)).toBeNull();
    expect(tierDe(null)).toBeNull();
  });

  it('todo nível de 0 a 10 tem definição escrita', () => {
    for (let n = 0; n <= NOTA_MAX; n++) expect(definicaoDe(n)).toBeTruthy();
    expect(NIVEIS).toHaveLength(NOTA_MAX + 1);
    expect(TIERS.at(-1)!.ate).toBe(NOTA_MAX);
  });
});

describe('delta da recomendação', () => {
  it('é a diferença com sinal quando há nota gravada', () => {
    expect(deltaRecomendacao(0, avaliacao(2))).toBe(2);
    expect(deltaRecomendacao(3, avaliacao(1))).toBe(-2);
    expect(rotuloDelta(2)).toBe('+2');
    expect(rotuloDelta(-1)).toBe('−1');
  });

  it('concordância não é divergência', () => {
    expect(deltaRecomendacao(2, avaliacao(2))).toBeNull();
  });

  it('projeto SEM nota gravada não produz delta — senão a recomendação viraria divergência', () => {
    expect(deltaRecomendacao(null, avaliacao(2))).toBeNull();
  });

  it('sem recomendação não há delta', () => {
    expect(deltaRecomendacao(1, undefined)).toBeNull();
    expect(rotuloDelta(null)).toBeNull();
  });
});
