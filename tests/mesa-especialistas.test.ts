/**
 * T5 — bridge PURO entre os votos DETERMINÍSTICOS da mesa e os especialistas LLM.
 * `montarEntradasEspecialistas` transforma os 4 votos calculados em `EntradaEspecialista[]`
 * (cada especialista recebe o próprio voto como INPUT + os outros como contexto);
 * `conciliarJulgamentos` funde os pareceres LLM num `ResultadoConciliado` (agrega + grau + cético).
 */
import { describe, it, expect } from 'vitest';
import {
  montarEntradasEspecialistas,
  conciliarJulgamentos,
  type VotosDeterministicos,
} from '@/lib/agents/mesa-especialistas';
import type { JulgamentoEspecialista, TextoProjeto } from '@/lib/agents/especialista-avaliacao';
import { grauConfianca } from '@/lib/deliberacao';

const TEXTO: TextoProjeto = {
  nome: 'Bot X',
  area: 'Fiscal',
  descricao: 'automatiza conferência',
  o_que_faz: 'confere notas',
  memorial: 'economia de 40h/mês',
  doc: 'fluxo detalhado',
};

function votosBase(over: Partial<VotosDeterministicos> = {}): VotosDeterministicos {
  return {
    fte: { implausivel: false, fte: 0.5, pessoas: 1, motivo: null },
    financeiro: { veredito: 'ok', confianca: 0.9, motivo: null, sinais: [] },
    rag: { apoio: true, confianca: 0.85, vizinhos: 3, topSimilaridade: 0.7, motivo: null },
    cetico: { refuta: false, confianca: 0, motivo: null, sinais: [] },
    ...over,
  };
}

describe('montarEntradasEspecialistas', () => {
  it('produz uma entrada por dimensão, na ordem fte/financeiro/rag/cetico', () => {
    const entradas = montarEntradasEspecialistas(votosBase(), TEXTO, ['Bot Y (Fiscal)']);
    expect(entradas.map((e) => e.dimensao)).toEqual(['fte', 'financeiro', 'rag', 'cetico']);
    for (const e of entradas) {
      expect(e.texto).toEqual(TEXTO);
      expect(e.vizinhos).toEqual(['Bot Y (Fiscal)']);
    }
  });

  it('mapeia o voto FTE implausível para preocupa=true com a confiança do agregador (0.2)', () => {
    const entradas = montarEntradasEspecialistas(
      votosBase({ fte: { implausivel: true, fte: 3, pessoas: 1, motivo: '3 FTE p/ 1 pessoa' } }),
      TEXTO,
      [],
    );
    const fte = entradas.find((e) => e.dimensao === 'fte')!;
    expect(fte.voto.preocupa).toBe(true);
    expect(fte.voto.confianca).toBe(0.2);
    expect(fte.voto.motivo).toBe('3 FTE p/ 1 pessoa');
  });

  it('FTE plausível → preocupa=false com confiança 0.9', () => {
    const entradas = montarEntradasEspecialistas(votosBase(), TEXTO, []);
    const fte = entradas.find((e) => e.dimensao === 'fte')!;
    expect(fte.voto.preocupa).toBe(false);
    expect(fte.voto.confianca).toBe(0.9);
  });

  it('financeiro !== ok → preocupa; rag sem apoio → preocupa; cético refuta → preocupa', () => {
    const entradas = montarEntradasEspecialistas(
      votosBase({
        financeiro: { veredito: 'atencao', confianca: 0.4, motivo: 'material', sinais: ['s'] },
        rag: { apoio: false, confianca: 0.4, vizinhos: 0, topSimilaridade: 0, motivo: 'sem vizinho' },
        cetico: { refuta: true, confianca: 0.6, motivo: 'projetado', sinais: ['proj'] },
      }),
      TEXTO,
      [],
    );
    expect(entradas.find((e) => e.dimensao === 'financeiro')!.voto.preocupa).toBe(true);
    expect(entradas.find((e) => e.dimensao === 'rag')!.voto.preocupa).toBe(true);
    const cet = entradas.find((e) => e.dimensao === 'cetico')!;
    expect(cet.voto.preocupa).toBe(true);
    expect(cet.voto.confianca).toBe(0.6);
    expect(cet.voto.sinais).toEqual(['proj']);
  });

  it('cada entrada vê os OUTROS 3 votos (nunca o próprio) em outrosVotos', () => {
    const entradas = montarEntradasEspecialistas(votosBase(), TEXTO, []);
    for (const e of entradas) {
      const dims = e.outrosVotos.map((o) => o.dimensao);
      expect(dims).not.toContain(e.dimensao);
      expect(dims).toHaveLength(3);
    }
  });
});

function julg(
  dimensao: JulgamentoEspecialista['dimensao'],
  preocupa: boolean,
  confianca: number,
  argumento = `parecer ${dimensao}`,
): JulgamentoEspecialista {
  return { dimensao, preocupa, argumento, confianca, sinais: [], origem: 'llm' };
}

describe('conciliarJulgamentos', () => {
  it('painel unânime tranquilo e seguro → aprovar, cético não refutou, grau bate com a confiança', () => {
    const js = [
      julg('fte', false, 0.9),
      julg('financeiro', false, 0.9),
      julg('rag', false, 0.9),
      julg('cetico', false, 0.9),
    ];
    const r = conciliarJulgamentos(js, {});
    expect(r.veredito).toBe('aprovar');
    expect(r.ceticoRefutou).toBe(false);
    expect(r.grau).toBe(grauConfianca(r.confianca));
    expect(r.aplicarEmValidacao).toBe(false);
  });

  it('cético preocupa → em_validacao, ceticoRefutou=true, motivos incluem o argumento do cético', () => {
    const js = [
      julg('fte', false, 0.9),
      julg('financeiro', false, 0.9),
      julg('rag', false, 0.9),
      julg('cetico', true, 0.8, 'impacto projetado vendido como realizado'),
    ];
    const r = conciliarJulgamentos(js, {});
    expect(r.veredito).toBe('em_validacao');
    expect(r.ceticoRefutou).toBe(true);
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.motivos.join(' ')).toContain('impacto projetado vendido como realizado');
  });

  it('especial/liderança → isento (nunca avalia)', () => {
    const js = [julg('fte', true, 0.9)];
    expect(conciliarJulgamentos(js, { especial: true }).veredito).toBe('isento');
    expect(conciliarJulgamentos(js, { fluxoDireto: true }).veredito).toBe('isento');
  });

  it('sem pareceres → em_validacao, confiança 0, cético não refutou (fail-safe)', () => {
    const r = conciliarJulgamentos([], {});
    expect(r.veredito).toBe('em_validacao');
    expect(r.confianca).toBe(0);
    expect(r.ceticoRefutou).toBe(false);
    expect(r.grau).toBe('baixa');
  });
});
