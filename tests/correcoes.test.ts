import { describe, it, expect } from 'vitest';
import {
  ensinaAlgo,
  licoesPara,
  blocoCorrecoes,
  correcoesDoLog,
  MOTIVO_MIN,
  type Correcao,
} from '@/lib/correcoes';

const base = (over: Partial<Correcao> = {}): Correcao => ({
  tipo: 'estrela',
  projeto_id: 'p1',
  projeto_nome: 'Projeto 1',
  de: 0,
  para: 4,
  recomendado: 0,
  leitura_agente: 'Fica em 0 porque não comprova uso recorrente.',
  motivo: 'Roda em 3 marcas e o Growth decide o preço a partir dele.',
  quando: '2026-09-05T10:00:00Z',
  ...over,
});

describe('o que ensina, e o que não', () => {
  // ⚠️ Sem o porquê, tudo que a correção ensina é "a nota é essa porque sim" — que é o
  // decorar-gabarito que o dono do produto vetou explicitamente.
  it('correção sem motivo NÃO vira lição', () => {
    expect(ensinaAlgo(base({ motivo: null }))).toBe(false);
    expect(ensinaAlgo(base({ motivo: '  ' }))).toBe(false);
    expect(ensinaAlgo(base({ motivo: 'x'.repeat(MOTIVO_MIN - 1) }))).toBe(false);
  });

  it('correção que CONFIRMA o agente não vira lição', () => {
    expect(ensinaAlgo(base({ recomendado: 4, para: 4 }))).toBe(false);
  });

  it('divergência COM motivo ensina', () => {
    expect(ensinaAlgo(base())).toBe(true);
  });
});

describe('quais lições entram, e em que ordem', () => {
  // ⚠️ Mostrar ao agente a nota que a triagem já cravou NAQUELE cartão não é ensinar critério,
  // é entregar a resposta.
  it('nunca mostra a correção do próprio projeto julgado', () => {
    const cs = [base({ projeto_id: 'alvo' }), base({ projeto_id: 'outro' })];
    expect(licoesPara(cs, 'alvo').map((c) => c.projeto_id)).toEqual(['outro']);
  });

  /**
   * ⚠️ A ordem é o desenho: o que ensina é a correção de um projeto PARECIDO, não a mais
   * recente. Os vizinhos vêm do RAG, que já rodou — por isso não existe tool nem base nova.
   */
  it('a correção de um VIZINHO vem antes de uma mais recente que não é vizinha', () => {
    const cs = [
      base({ projeto_id: 'recente', quando: '2026-09-05T23:00:00Z' }),
      base({ projeto_id: 'vizinho', quando: '2026-01-01T00:00:00Z' }),
    ];
    expect(licoesPara(cs, 'alvo', ['vizinho']).map((c) => c.projeto_id)).toEqual([
      'vizinho',
      'recente',
    ]);
  });

  it('sem vizinhos, a ordem é cronológica', () => {
    const cs = [
      base({ projeto_id: 'velho', quando: '2026-01-01T00:00:00Z' }),
      base({ projeto_id: 'novo', quando: '2026-09-05T23:00:00Z' }),
    ];
    expect(licoesPara(cs, 'alvo').map((c) => c.projeto_id)).toEqual(['novo', 'velho']);
  });

  it('casa o id do vizinho sem depender de caixa', () => {
    const cs = [base({ projeto_id: 'LEGADO-032' }), base({ projeto_id: 'outro' })];
    expect(licoesPara(cs, 'alvo', ['legado-032'])[0].projeto_id).toBe('LEGADO-032');
  });
});

describe('o bloco do prompt', () => {
  it('mostra o PAR: o que o agente argumentou e o que a triagem respondeu', () => {
    const t = blocoCorrecoes([base()]);
    expect(t).toContain('o agente argumentou');
    expect(t).toContain('a triagem respondeu');
    expect(t).toContain('não comprova uso recorrente');
    expect(t).toContain('Roda em 3 marcas');
  });

  it('manda usar o critério e PROÍBE copiar a nota', () => {
    expect(blocoCorrecoes([base()])).toMatch(/nunca para copiar a nota/i);
  });

  it('sem lição, não injeta bloco nenhum no prompt', () => {
    expect(blocoCorrecoes([base({ motivo: null })])).toBe('');
    expect(blocoCorrecoes([])).toBe('');
  });

  // ⚠️ O prompt tem um punhado de linhas de atenção: encher de exemplos dilui a régua, que é
  // quem manda. Foi por isso que a tool de consulta foi descartada — não há prompt crescendo.
  it('respeita o teto de lições', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => base({ projeto_id: `p${i}` }));
    const linhas = blocoCorrecoes(muitas).split('•').length - 1;
    expect(linhas).toBe(6);
  });
});

describe('leitura do log de atividade', () => {
  const linha = (meta: Record<string, unknown>, id = 'p1') => ({
    acao: 'estrelas',
    projeto_id: id,
    projeto_nome: 'Projeto',
    meta_json: JSON.stringify(meta),
    created_at: '2026-09-05T10:00:00Z',
  });

  it('lê a nota, a anterior, a recomendada, o motivo e o texto do agente', () => {
    const [c] = correcoesDoLog([
      linha({
        estrelas: 4,
        estrelas_anterior: 0,
        recomendado_pelo_agente: 0,
        motivo: 'roda em 3 marcas',
        leitura_do_agente: 'fica em 0',
      }),
    ]);
    expect(c).toMatchObject({ para: 4, de: 0, recomendado: 0, motivo: 'roda em 3 marcas' });
  });

  it('ignora ação que não é de estrela, e meta corrompida', () => {
    expect(correcoesDoLog([{ ...linha({ estrelas: 4 }), acao: 'status' }])).toHaveLength(0);
    expect(correcoesDoLog([{ ...linha({}), meta_json: '{quebrado' }])).toHaveLength(0);
  });

  // ⚠️ Uma por projeto: o que ensina é onde a triagem PAROU, não o caminho. E repetir o mesmo
  // projeto gastaria as poucas linhas que o bloco tem.
  it('guarda só a correção mais recente de cada projeto', () => {
    const cs = correcoesDoLog([
      linha({ estrelas: 5, motivo: 'a mais nova' }),
      linha({ estrelas: 2, motivo: 'a antiga' }),
    ]);
    expect(cs).toHaveLength(1);
    expect(cs[0].para).toBe(5);
  });
});
