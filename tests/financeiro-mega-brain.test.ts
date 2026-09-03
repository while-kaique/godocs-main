import { describe, it, expect } from 'vitest';
import { lerImpacto, explicarLeitura, DESCONTO } from '@/lib/agents/financeiro-mega-brain';

describe('o financeiro diz PARA QUANTO, não só "conservador"', () => {
  it('sem achado, sustenta o declarado — e isso também é parecer', () => {
    const l = lerImpacto(1000, []);
    expect(l.ajustado).toBe(1000);
    expect(explicarLeitura(l)).toContain('sustenta o impacto declarado');
  });

  it('dupla contagem zera o bloco: metade de uma duplicidade ainda é duas vezes', () => {
    const l = lerImpacto(1000, [{ motivo: 'dupla_contagem', bloco: 'receita', detalhe: 'o mesmo valor está no custo evitado' }]);
    expect(l.ajustado).toBe(0);
  });

  it('a memória de cálculo mostra a conta, passo a passo', () => {
    const l = lerImpacto(1000, [
      { motivo: 'sem_lastro_de_horas', bloco: 'custo_evitado', detalhe: '120h sem linha' },
      { motivo: 'fonte_nao_verificavel', bloco: 'total', detalhe: 'sem painel citado' },
    ]);
    expect(l.memoria).toHaveLength(2);
    expect(l.memoria[0]).toMatchObject({ de: 1000, para: 500 });
    expect(l.memoria[1]).toMatchObject({ de: 500, para: 250 });
    expect(l.ajustado).toBe(250);
  });

  it('⚠️ só DESCONTA: nenhum fator declarado é maior que 1', () => {
    for (const [motivo, d] of Object.entries(DESCONTO))
      expect(d.fator, motivo).toBeLessThanOrEqual(1);
  });

  it('a explicação traz os DOIS números e o motivo, sem o adjetivo vazio', () => {
    const t = explicarLeitura(lerImpacto(1000, [{ motivo: 'ganho_projetado', bloco: 'receita', detalhe: 'estimativa' }]));
    expect(t).toContain('R$');
    expect(t).toContain('projetado');
    expect(t).not.toContain('conservador');
  });

  it('declarado negativo não vira ajuste positivo', () => {
    expect(lerImpacto(-500, []).declarado).toBe(0);
  });
});
