/**
 * Comparador de especiais — o agrupamento por nível e as âncoras da régua.
 *
 * O que estes testes prendem: a coluna que um cartão ocupa é a NOTA GRAVADA (nunca a `nota`
 * declarada na referência), níveis 0–5 existem mesmo vazios, a escala aberta ganha coluna
 * quando há projeto/âncora, e a comparação sempre traz a âncora do nível junto.
 */
import { describe, it, expect } from 'vitest';
import {
  CARTOES_INCREMENTO,
  CARTOES_INICIAIS,
  FILTROS_ESPECIAIS_VAZIOS,
  contarFiltrosEspeciais,
  NOTAS_BASE,
  SEM_NOTA,
  MAX_COMPARAR,
  agruparEspeciais,
  apenasEspeciais,
  rotuloNota,
} from '@/lib/especiais-view';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

function projeto(over: Partial<ProjetoDashboardResumo> & { id: string }): ProjetoDashboardResumo {
  return {
    nome: over.nome ?? over.id,
    autor: null,
    email: null,
    area: null,
    status: null,
    statusChave: null,
    dataSubmissao: null,
    dataOrdenacao: over.dataOrdenacao ?? null,
    ganhoTotal: null,
    savingReais: null,
    receitaMensal: null,
    complexidade: null,
    tipos: null,
    especial: over.especial ?? true,
    aprovacaoLider: null,
    estrelas: over.estrelas ?? null,
    busca: '',
    ...over,
  } as ProjetoDashboardResumo;
}

describe('apenasEspeciais', () => {
  it('deixa de fora os projetos financeiros (lá o R$ é a régua)', () => {
    const lista = [projeto({ id: 'a' }), projeto({ id: 'b', especial: false })];
    expect(apenasEspeciais(lista).map((p) => p.id)).toEqual(['a']);
  });
});

describe('agruparEspeciais', () => {
  it('mostra os níveis 0–5 mesmo vazios (a régua da escala tem de ser visível inteira)', () => {
    const colunas = agruparEspeciais([]);
    expect(colunas[0].chave).toBe(SEM_NOTA);
    expect(colunas.map((c) => c.nota).slice(1)).toEqual([...NOTAS_BASE]);
  });

  it('abre coluna para nota acima de 5 quando existe projeto nela (escala aberta)', () => {
    const colunas = agruparEspeciais([projeto({ id: 'piapp', estrelas: 8 })]);
    expect(colunas.at(-1)?.nota).toBe(8);
    expect(colunas.at(-1)?.projetos.map((p) => p.id)).toEqual(['piapp']);
  });

  it('separa "sem nota" (null) de "zero" — são coisas diferentes', () => {
    const colunas = agruparEspeciais([
      projeto({ id: 'novo' }),
      projeto({ id: 'olhado', estrelas: 0 }),
    ]);
    expect(colunas.find((c) => c.chave === SEM_NOTA)?.projetos.map((p) => p.id)).toEqual(['novo']);
    expect(colunas.find((c) => c.nota === 0)?.projetos.map((p) => p.id)).toEqual(['olhado']);
  });

  it('ordena os projetos do mais recente para o mais antigo', () => {
    const colunas = agruparEspeciais([
      projeto({ id: 'velho', estrelas: 1, dataOrdenacao: 10 }),
      projeto({ id: 'novo', estrelas: 1, dataOrdenacao: 99 }),
    ]);
    expect(colunas.find((c) => c.nota === 1)?.projetos.map((p) => p.id)).toEqual(['novo', 'velho']);
  });

  it('conta o total do nível', () => {
    const colunas = agruparEspeciais([
      projeto({ id: 'a', estrelas: 2 }),
      projeto({ id: 'b', estrelas: 2 }),
    ]);
    expect(colunas.find((c) => c.nota === 2)?.total).toBe(2);
  });

  it('o teto do modo comparar continua sendo 3 cartões', () => {
    expect(MAX_COMPARAR).toBe(3);
  });
});

describe('rotuloNota', () => {
  it('distingue sem nota, zero e o singular', () => {
    expect(rotuloNota(null)).toBe('Sem nota');
    expect(rotuloNota(0)).toBe('Zero');
    expect(rotuloNota(1)).toBe('1 estrela');
    expect(rotuloNota(8)).toBe('8 estrelas');
  });
});

describe('filtros e paginação da coluna', () => {
  it('a coluna abre com 7 e cresce de 5 em 5 — quem clica procura UM projeto', () => {
    expect(CARTOES_INICIAIS).toBe(7);
    expect(CARTOES_INCREMENTO).toBeLessThan(CARTOES_INICIAIS);
  });

  it('conta só os filtros realmente ativos (espaço em branco não conta)', () => {
    expect(contarFiltrosEspeciais(FILTROS_ESPECIAIS_VAZIOS)).toBe(0);
    expect(contarFiltrosEspeciais({ ...FILTROS_ESPECIAIS_VAZIOS, termo: '   ' })).toBe(0);
    expect(contarFiltrosEspeciais({ ...FILTROS_ESPECIAIS_VAZIOS, termo: 'piapp' })).toBe(1);
    expect(
      contarFiltrosEspeciais({
        termo: 'piapp',
        periodo: { inicio: '2026-08-01', fim: '2026-08-18' },
        soDivergentes: true,
      }),
    ).toBe(3);
  });
});
