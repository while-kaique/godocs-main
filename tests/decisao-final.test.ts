import { describe, it, expect } from 'vitest';
import { decidirComTime, CONFIANCA_PARA_REPROVAR } from '@/lib/agents/decisao-final';

const base = {
  veredito: 'aprovar' as const,
  consenso: true,
  especial: false,
  apontamentos: [],
  classificacao: 'claro_sim' as const,
};
const grave = { agente: 'financeiro', achado: 'o saving declarado não tem lastro nas horas', confianca: 0.9 };

describe('as TRÊS saídas — e só três', () => {
  it('aprova quando há consenso e nada grave', () => {
    expect(decidirComTime(base).status).toBe('aprovado');
  });

  it('⚠️ REPROVA de fato, com o achado sustentando', () => {
    const d = decidirComTime({ ...base, apontamentos: [grave] });
    expect(d.status).toBe('reprovado');
    expect(d.sustentacao).toHaveLength(1);
    expect(d.racional).toContain('lastro');
  });

  it('⚠️ NUNCA reprova sem motivo nomeado', () => {
    // "Não é projeto" sozinho não basta: sem apontamento concreto, vai ao humano.
    const d = decidirComTime({ ...base, classificacao: 'claro_nao' });
    expect(d.status).toBe('em_validacao');
    expect(d.racional).toContain('nenhum especialista sustentou');
  });

  it('achado MORNO não reprova — reprovar é a única saída que devolve trabalho', () => {
    const morno = { ...grave, confianca: CONFIANCA_PARA_REPROVAR - 0.01 };
    expect(decidirComTime({ ...base, apontamentos: [morno] }).status).toBe('aprovado');
  });

  it('sem consenso → humano, mesmo com o agregador querendo aprovar', () => {
    expect(decidirComTime({ ...base, consenso: false }).status).toBe('em_validacao');
  });

  it('especial nunca é decidido por agente', () => {
    const d = decidirComTime({ ...base, especial: true, apontamentos: [grave] });
    expect(d.status).toBe('em_validacao');
    expect(d.racional).toContain('comitê humano');
  });

  it('não existe "ajuste": toda saída é uma das três', () => {
    const casos = [
      base,
      { ...base, apontamentos: [grave] },
      { ...base, consenso: false },
      { ...base, especial: true },
      { ...base, veredito: 'em_validacao' as const },
      { ...base, veredito: 'isento' as const },
    ];
    for (const c of casos)
      expect(['aprovado', 'reprovado', 'em_validacao']).toContain(decidirComTime(c).status);
  });
});
