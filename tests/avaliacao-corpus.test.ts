import { describe, it, expect } from 'vitest';
import {
  ROTULO_APROVADO,
  avaliacaoNormaisAtiva,
  selecionarAprovadosNormais,
  montarCorpusNormais,
} from '@/lib/avaliacao-corpus';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

// Helper: monta um ProjetoDashboardResumo preenchendo o resto com defaults;
// os testes só encostam em id/nome/area/statusChave/especial.
function resumo(
  over: Partial<ProjetoDashboardResumo> & { id: string },
): ProjetoDashboardResumo {
  return {
    id: over.id,
    nome: over.nome ?? null,
    autor: null,
    email: null,
    area: over.area ?? null,
    status: null,
    statusChave: over.statusChave ?? null,
    dataSubmissao: null,
    dataOrdenacao: null,
    ganhoTotal: null,
    savingReais: null,
    receitaMensal: null,
    complexidade: null,
    tipos: null,
    especial: over.especial ?? false,
    aprovacaoLider: null,
    estrelas: null,
    busca: '',
  };
}

describe('ROTULO_APROVADO', () => {
  it('é 1 (marcador positivo do veredito humano)', () => {
    expect(ROTULO_APROVADO).toBe(1);
  });
});

describe('avaliacaoNormaisAtiva — DEFAULT OFF', () => {
  it('undefined → false', () => {
    expect(avaliacaoNormaisAtiva(undefined)).toBe(false);
  });

  it('null → false', () => {
    expect(avaliacaoNormaisAtiva(null)).toBe(false);
  });

  it("'' (string vazia) → false", () => {
    expect(avaliacaoNormaisAtiva('')).toBe(false);
  });

  it("valores afirmativos → true ('on', 'sombra', '1', 'true', 'sim')", () => {
    expect(avaliacaoNormaisAtiva('on')).toBe(true);
    expect(avaliacaoNormaisAtiva('sombra')).toBe(true);
    expect(avaliacaoNormaisAtiva('1')).toBe(true);
    expect(avaliacaoNormaisAtiva('true')).toBe(true);
    expect(avaliacaoNormaisAtiva('sim')).toBe(true);
  });

  it('é case-insensitive e tolera espaços em volta', () => {
    expect(avaliacaoNormaisAtiva(' ON ')).toBe(true);
    expect(avaliacaoNormaisAtiva('Sombra')).toBe(true);
  });

  it("valores negativos e desconhecidos → false ('off', '0', 'false', 'nao', 'talvez')", () => {
    expect(avaliacaoNormaisAtiva('off')).toBe(false);
    expect(avaliacaoNormaisAtiva('0')).toBe(false);
    expect(avaliacaoNormaisAtiva('false')).toBe(false);
    expect(avaliacaoNormaisAtiva('nao')).toBe(false);
    expect(avaliacaoNormaisAtiva('talvez')).toBe(false);
  });
});

describe('selecionarAprovadosNormais', () => {
  it("mantém aprovado normal (statusChave==='aprovado' && especial===false)", () => {
    const p = resumo({ id: 'a', statusChave: 'aprovado', especial: false });
    expect(selecionarAprovadosNormais([p])).toEqual([p]);
  });

  it('descarta especial mesmo quando statusChave é aprovado', () => {
    const p = resumo({ id: 'a', statusChave: 'aprovado', especial: true });
    expect(selecionarAprovadosNormais([p])).toEqual([]);
  });

  it('descarta statusChave diferente de aprovado (pendente, reprovado, reenvio pendente, null)', () => {
    const entrada = [
      resumo({ id: 'p1', statusChave: 'pendente', especial: false }),
      resumo({ id: 'p2', statusChave: 'reprovado', especial: false }),
      resumo({ id: 'p3', statusChave: 'reenvio pendente', especial: false }),
      resumo({ id: 'p4', statusChave: null, especial: false }),
    ];
    expect(selecionarAprovadosNormais(entrada)).toEqual([]);
  });

  it('de uma lista mista, devolve só os aprovados normais', () => {
    const okA = resumo({ id: 'okA', statusChave: 'aprovado', especial: false });
    const okB = resumo({ id: 'okB', statusChave: 'aprovado', especial: false });
    const entrada = [
      okA,
      resumo({ id: 'esp', statusChave: 'aprovado', especial: true }),
      resumo({ id: 'pend', statusChave: 'pendente', especial: false }),
      okB,
      resumo({ id: 'rep', statusChave: 'reprovado', especial: false }),
    ];
    const saida = selecionarAprovadosNormais(entrada);
    expect(saida).toHaveLength(2);
    expect(saida.map((p) => p.id)).toEqual(['okA', 'okB']);
  });
});

describe('montarCorpusNormais', () => {
  const aprovados = [
    { id: 'a', nome: 'Projeto A', area: 'Fiscal' },
    { id: 'b', nome: 'Projeto B', area: 'CX' },
  ];

  it('só inclui projetos cujo id está no Map de embeddings (id sem vetor é pulado)', () => {
    const embeddings = new Map<string, number[]>([['a', [0.1, 0.2]]]);
    const corpus = montarCorpusNormais(aprovados, embeddings);
    expect(corpus).toHaveLength(1);
    expect(corpus[0].projeto_id).toBe('a');
  });

  it('cada exemplar carimba o rótulo humano positivo, sem recomendação/leitura, e o vetor do Map', () => {
    const vetor = [0.1, 0.2, 0.3];
    const embeddings = new Map<string, number[]>([['a', vetor]]);
    const corpus = montarCorpusNormais(aprovados, embeddings);
    const ex = corpus[0];
    expect(ex.estrela_humana).toBe(ROTULO_APROVADO);
    expect(ex.estrela_recomendada).toBeNull();
    expect(ex.leitura).toBeNull();
    expect(ex.vetor).toEqual(vetor);
  });

  it('projeto_id, nome e area vêm do aprovado correspondente', () => {
    const embeddings = new Map<string, number[]>([
      ['a', [1]],
      ['b', [2]],
    ]);
    const corpus = montarCorpusNormais(aprovados, embeddings);
    const exB = corpus.find((e) => e.projeto_id === 'b');
    expect(exB).toBeDefined();
    expect(exB!.nome).toBe('Projeto B');
    expect(exB!.area).toBe('CX');
  });

  it('Map vazio → corpus vazio', () => {
    expect(montarCorpusNormais(aprovados, new Map())).toEqual([]);
  });
});
