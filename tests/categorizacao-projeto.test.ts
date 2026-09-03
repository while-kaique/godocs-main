import { describe, it, expect } from 'vitest';
import {
  TIPOS_PROJETO,
  NIVEIS_PROJETO,
  NIVEL_TBD,
  tipoPorSinais,
  tipoValido,
  nivelValido,
  nivelEstaFechado,
  nivelDaComplexidade,
  complexidadeDoNivel,
  normalizarCategoria,
  rotuloCategoria,
  descreverCategorizacao,
} from '@/lib/categorizacao-projeto';

const semNada = {
  decideOProprioPasso: false,
  mantemBaseParaTerceiros: false,
  temInterface: false,
  naInterfaceSeExecutaTrabalho: false,
};

describe('taxonomia', () => {
  it('tem os 5 tipos na ordem de precedência declarada', () => {
    expect(TIPOS_PROJETO.map((t) => t.chave)).toEqual([
      'agente',
      'sistema',
      'app',
      'dashboard',
      'automacao',
    ]);
  });

  it('tem os 4 níveis, com o agêntico marcado TBD', () => {
    expect(NIVEIS_PROJETO.map((n) => n.chave)).toEqual([
      'deterministico',
      'inteligente',
      'autonomo',
      'agentico',
    ]);
    expect(NIVEL_TBD).toEqual(['agentico']);
    expect(nivelEstaFechado('autonomo')).toBe(true);
    expect(nivelEstaFechado('agentico')).toBe(false);
  });

  it('recusa chave desconhecida nos dois eixos', () => {
    expect(tipoValido('plataforma')).toBeNull();
    expect(nivelValido('agentico ')).toBeNull();
    expect(tipoValido('agente')).toBe('agente');
  });
});

describe('tipoPorSinais — precedência', () => {
  it('sem interface e sem base, é automação', () => {
    expect(tipoPorSinais(semNada)).toBe('automacao');
  });

  it('interface onde só se olha é dashboard; onde se trabalha é app', () => {
    expect(tipoPorSinais({ ...semNada, temInterface: true })).toBe('dashboard');
    expect(
      tipoPorSinais({ ...semNada, temInterface: true, naInterfaceSeExecutaTrabalho: true }),
    ).toBe('app');
  });

  it('base consumida por terceiros vence app e dashboard', () => {
    expect(
      tipoPorSinais({
        ...semNada,
        temInterface: true,
        naInterfaceSeExecutaTrabalho: true,
        mantemBaseParaTerceiros: true,
      }),
    ).toBe('sistema');
  });

  it('decidir o próprio passo vence todos os outros sinais', () => {
    expect(
      tipoPorSinais({
        decideOProprioPasso: true,
        mantemBaseParaTerceiros: true,
        temInterface: true,
        naInterfaceSeExecutaTrabalho: true,
      }),
    ).toBe('agente');
  });
});

describe('ponte com a coluna Complexidade que já existe', () => {
  it('traduz o legado nos dois sentidos', () => {
    expect(nivelDaComplexidade('automacao')).toBe('deterministico');
    expect(nivelDaComplexidade('inteligencia')).toBe('inteligente');
    expect(nivelDaComplexidade('autonomia')).toBe('autonomo');
    expect(complexidadeDoNivel('deterministico')).toBe('automacao');
    expect(complexidadeDoNivel('inteligente')).toBe('inteligencia');
    expect(complexidadeDoNivel('autonomo')).toBe('autonomia');
  });

  it('agêntico volta como autonomia — a planilha não aceita valor novo', () => {
    expect(complexidadeDoNivel('agentico')).toBe('autonomia');
  });

  it('ida e volta é estável para os 3 níveis fechados', () => {
    for (const n of NIVEIS_PROJETO.filter((x) => nivelEstaFechado(x.chave))) {
      expect(nivelDaComplexidade(complexidadeDoNivel(n.chave))).toBe(n.chave);
    }
  });
});

describe('normalizarCategoria — fail-closed', () => {
  it('tipo inválido cai em automação, o que menos afirma', () => {
    expect(normalizarCategoria({ tipo: 'plataforma', nivel: 'inteligente' }, 'automacao')).toEqual({
      tipo: 'automacao',
      nivel: 'inteligente',
    });
  });

  it('nível ausente vem da Complexidade já assentada pelo analisador', () => {
    expect(normalizarCategoria({ tipo: 'app' }, 'autonomia')).toEqual({
      tipo: 'app',
      nivel: 'autonomo',
    });
  });

  it('agêntico é REBAIXADO para autônomo enquanto a fronteira for TBD', () => {
    expect(normalizarCategoria({ tipo: 'agente', nivel: 'agentico' }, 'inteligencia')).toEqual({
      tipo: 'agente',
      nivel: 'autonomo',
    });
  });

  it('lixo nos dois campos ainda devolve categoria utilizável', () => {
    expect(normalizarCategoria({}, 'inteligencia')).toEqual({
      tipo: 'automacao',
      nivel: 'inteligente',
    });
  });
});

describe('render', () => {
  it('o rótulo junta os dois eixos', () => {
    expect(rotuloCategoria({ tipo: 'sistema', nivel: 'inteligente' })).toBe('Sistema · Inteligente');
  });

  it('o prompt lista os 5 tipos na precedência e NÃO oferece o nível TBD', () => {
    const t = descreverCategorizacao();
    expect(t).toContain('a PRIMEIRA opção que casar vence');
    for (const tipo of TIPOS_PROJETO) expect(t).toContain(tipo.rotulo);
    expect(t).not.toContain('Agêntico');
  });
});
