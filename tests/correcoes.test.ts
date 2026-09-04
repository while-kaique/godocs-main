import { describe, it, expect } from 'vitest';
import {
  ensinaAlgo,
  descreverCorrecao,
  blocoCorrecoes,
  correcoesDoLog,
  licoesPara,
  type Correcao,
} from '@/lib/correcoes';

const base: Correcao = {
  tipo: 'estrela',
  projeto_id: 'p1',
  projeto_nome: 'PIAPP',
  de: 5,
  para: 8,
  recomendado: 5,
  motivo: 'outros projetos rodam em cima dele, é plataforma e não alcance',
  quando: '2026-09-04',
};

/**
 * ⚠️ A distinção que estes testes seguram é a que separa aprender de decorar. Sem o motivo, a
 * correção ensina "concorde com o humano" — o agente decora que projeto parecido com o PIAPP
 * vale 8. Com o motivo, ele aprende a propriedade, e ela generaliza para um projeto que não se
 * parece nada com o PIAPP.
 */
describe('o que uma correção ensina', () => {
  it('correção com motivo e mudança de verdade ensina', () => {
    expect(ensinaAlgo(base)).toBe(true);
  });

  it('correção SEM motivo não ensina, mesmo mudando muito', () => {
    expect(ensinaAlgo({ ...base, motivo: null })).toBe(false);
    expect(ensinaAlgo({ ...base, motivo: '   ' })).toBe(false);
    expect(ensinaAlgo({ ...base, motivo: 'ok' })).toBe(false); // curto demais para ser razão
  });

  it('confirmar a nota do agente não é correção', () => {
    expect(ensinaAlgo({ ...base, para: 5, recomendado: 5 })).toBe(false);
  });

  it('a linha diz a direção, de onde veio e o motivo', () => {
    const t = descreverCorrecao(base);
    expect(t).toContain('PIAPP');
    expect(t).toContain('SUBIU');
    expect(t).toContain('o agente recomendou 5');
    expect(t).toContain('plataforma');
  });

  it('serve para VALOR com a mesma forma, sem estrela no texto', () => {
    const v = descreverCorrecao({ ...base, tipo: 'valor', de: 14000, para: 993, recomendado: 14000 });
    expect(v).toContain('BAIXOU');
    expect(v).not.toContain('★');
  });

  describe('bloco do prompt', () => {
    it('vazio quando nenhuma correção ensina', () => {
      expect(blocoCorrecoes([{ ...base, motivo: null }])).toBe('');
    });

    // ⚠️ Sem esta instrução o agente copia a nota do exemplo mais parecido, que é o decorar
    // gabarito que a correção existe para evitar.
    it('manda usar o CRITÉRIO e não copiar a nota', () => {
      const b = blocoCorrecoes([base]);
      expect(b).toContain('CRITÉRIO');
      expect(b).toMatch(/nunca para copiar a nota/);
    });

    it('respeita o teto de exemplos', () => {
      const muitas = Array.from({ length: 20 }, (_, i) => ({ ...base, projeto_id: `p${i}` }));
      expect(blocoCorrecoes(muitas, 3).split('•').length - 1).toBe(3);
    });
  });
});

describe('leitura das correções do log', () => {
  const linha = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
    acao: 'estrelas',
    projeto_id: 'p1',
    projeto_nome: 'PIAPP',
    created_at: '2026-09-04 10:00',
    meta_json: JSON.stringify({ estrelas: 8, estrelas_anterior: 5, motivo: 'é plataforma, outros rodam nele', recomendado_pelo_agente: 5, ...meta }),
    ...over,
  });

  it('traduz a linha do log em correção', () => {
    const [c] = correcoesDoLog([linha()]);
    expect(c.para).toBe(8);
    expect(c.recomendado).toBe(5);
    expect(c.motivo).toContain('plataforma');
  });

  it('ignora ações que não são de estrela e meta quebrada', () => {
    expect(correcoesDoLog([linha({ acao: 'status' })])).toHaveLength(0);
    expect(correcoesDoLog([linha({ meta_json: '{quebrado' })])).toHaveLength(0);
  });

  // Se a triagem mexeu três vezes no mesmo cartão, o que ensina é onde ela parou.
  it('fica com a correção MAIS RECENTE de cada projeto', () => {
    const cs = correcoesDoLog([linha({ created_at: '2026-09-04 12:00' }, { estrelas: 9 }), linha()]);
    expect(cs).toHaveLength(1);
    expect(cs[0].para).toBe(9);
  });

  // ⚠️ Mostrar ao agente a nota que a triagem já cravou NAQUELE cartão não é ensinar critério,
  // é entregar a resposta.
  it('nunca mostra a correção do próprio projeto julgado', () => {
    const cs = correcoesDoLog([linha()]);
    expect(licoesPara(cs, 'p1')).toHaveLength(0);
    expect(licoesPara(cs, 'outro')).toHaveLength(1);
  });
});
