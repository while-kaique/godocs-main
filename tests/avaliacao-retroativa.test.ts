import { describe, it, expect } from 'vitest';
import { compararComHumano, agregarAcuracia } from '@/lib/avaliacao-retroativa';
import type { ResultadoComparacao } from '@/lib/avaliacao-retroativa';

describe('compararComHumano', () => {
  it('veredito null/undefined → sem_base', () => {
    expect(compararComHumano(null, 'aprovado')).toBe('sem_base');
    expect(compararComHumano(undefined, 'reprovado')).toBe('sem_base');
  });

  it('veredito isento → sem_base', () => {
    expect(compararComHumano('isento', 'aprovado')).toBe('sem_base');
    expect(compararComHumano('isento', 'reprovado')).toBe('sem_base');
  });

  it('humano aprovado + aprovar → acerto', () => {
    expect(compararComHumano('aprovar', 'aprovado')).toBe('acerto');
  });

  it('humano aprovado + em_validacao → conservador', () => {
    expect(compararComHumano('em_validacao', 'aprovado')).toBe('conservador');
  });

  it('humano reprovado + aprovar → erro_grave (o caso das 500h)', () => {
    expect(compararComHumano('aprovar', 'reprovado')).toBe('erro_grave');
  });

  it('humano reprovado + em_validacao → acerto', () => {
    expect(compararComHumano('em_validacao', 'reprovado')).toBe('acerto');
  });

  it('normaliza trim + lowercase do status', () => {
    expect(compararComHumano('aprovar', '  Aprovado  ')).toBe('acerto');
    expect(compararComHumano('aprovar', 'REPROVADO')).toBe('erro_grave');
  });

  it('status não assentado → sem_base', () => {
    expect(compararComHumano('aprovar', 'pendente')).toBe('sem_base');
    expect(compararComHumano('aprovar', 'em avaliação')).toBe('sem_base');
    expect(compararComHumano('aprovar', '')).toBe('sem_base');
    expect(compararComHumano('aprovar', null)).toBe('sem_base');
    expect(compararComHumano('em_validacao', undefined)).toBe('sem_base');
  });
});

describe('agregarAcuracia', () => {
  it('lista vazia → tudo 0', () => {
    const a = agregarAcuracia([]);
    expect(a.total).toBe(0);
    expect(a.acerto).toBe(0);
    expect(a.conservador).toBe(0);
    expect(a.erro_grave).toBe(0);
    expect(a.sem_base).toBe(0);
    expect(a.comparaveis).toBe(0);
    expect(a.taxa_acerto).toBe(0);
    expect(a.taxa_erro_grave).toBe(0);
  });

  it('conta cada balde e calcula taxas sobre comparaveis', () => {
    const res: ResultadoComparacao[] = [
      'acerto',
      'acerto',
      'conservador',
      'erro_grave',
      'sem_base',
      'sem_base',
    ];
    const a = agregarAcuracia(res);
    expect(a.total).toBe(6);
    expect(a.acerto).toBe(2);
    expect(a.conservador).toBe(1);
    expect(a.erro_grave).toBe(1);
    expect(a.sem_base).toBe(2);
    // comparaveis = total - sem_base = 4
    expect(a.comparaveis).toBe(4);
    expect(a.taxa_acerto).toBeCloseTo(2 / 4, 10);
    expect(a.taxa_erro_grave).toBeCloseTo(1 / 4, 10);
  });

  it('só sem_base → comparaveis 0 e taxas 0 (sem divisão por zero)', () => {
    const a = agregarAcuracia(['sem_base', 'sem_base']);
    expect(a.total).toBe(2);
    expect(a.comparaveis).toBe(0);
    expect(a.taxa_acerto).toBe(0);
    expect(a.taxa_erro_grave).toBe(0);
  });
});
