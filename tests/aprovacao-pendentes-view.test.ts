/**
 * Aba TEMPORÁRIA de aprovação de pendentes — o recorte de escopo, o agrupamento por AUTOR e
 * o toggle "só quem tem 2+ projetos".
 *
 * O que estes testes prendem: só pendentes/pré-aprovados do fluxo normal entram (nada de
 * especial, descontinuado, reenvio ou decidido), a coluna é a PESSOA (por e-mail), as colunas
 * saem ordenadas por quem tem mais, e o toggle de 2+ conta sobre o conjunto JÁ filtrado.
 */
import { describe, it, expect } from 'vitest';
import {
  agruparPorAutor,
  apenasAutoresComMultiplos,
  apenasFilaRpa,
  chaveAutor,
  contarFiltrosPendentes,
  ehDaFilaRpa,
  filasPresentes,
  filaDe,
  FILTROS_PENDENTES_VAZIOS,
  rotuloAutor,
} from '@/lib/aprovacao-pendentes-view';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

function projeto(over: Partial<ProjetoDashboardResumo> & { id: string }): ProjetoDashboardResumo {
  return {
    nome: over.nome ?? over.id,
    autor: null,
    email: null,
    area: null,
    status: null,
    statusChave: 'pendente',
    dataSubmissao: null,
    dataOrdenacao: over.dataOrdenacao ?? null,
    ganhoTotal: null,
    savingReais: null,
    receitaMensal: null,
    complexidade: null,
    tipos: null,
    especial: over.especial ?? false,
    aprovacaoLider: null,
    estrelas: null,
    busca: '',
    ...over,
  } as ProjetoDashboardResumo;
}

describe('ehDaFilaRpa / apenasFilaRpa', () => {
  it('entra: pendente e status vazio (ninguém decidiu)', () => {
    expect(ehDaFilaRpa(projeto({ id: 'a', statusChave: 'pendente' }))).toBe(true);
    expect(ehDaFilaRpa(projeto({ id: 'b', statusChave: null }))).toBe(true);
  });

  it('fica de fora: especial (tem aba própria)', () => {
    expect(ehDaFilaRpa(projeto({ id: 'c', especial: true }))).toBe(false);
  });

  it('fica de fora: descontinuado, reenvio, aprovado e reprovado', () => {
    expect(ehDaFilaRpa(projeto({ id: 'd', statusChave: 'descontinuado' }))).toBe(false);
    expect(ehDaFilaRpa(projeto({ id: 'e', statusChave: 'reenvio pendente' }))).toBe(false);
    expect(ehDaFilaRpa(projeto({ id: 'f', statusChave: 'aprovado' }))).toBe(false);
    expect(ehDaFilaRpa(projeto({ id: 'g', statusChave: 'reprovado' }))).toBe(false);
  });

  it('apenasFilaRpa aplica o mesmo corte à lista', () => {
    const lista = [
      projeto({ id: 'ok' }),
      projeto({ id: 'esp', especial: true }),
      projeto({ id: 'rep', statusChave: 'reprovado' }),
    ];
    expect(apenasFilaRpa(lista).map((p) => p.id)).toEqual(['ok']);
  });
});

describe('chaveAutor / rotuloAutor', () => {
  it('a chave é o e-mail em minúsculas (identidade estável)', () => {
    expect(chaveAutor(projeto({ id: 'a', email: 'Ana@Go.com', autor: 'Ana' }))).toBe('ana@go.com');
  });

  it('sem e-mail, cai no nome; sem nada, "sem-autor"', () => {
    expect(chaveAutor(projeto({ id: 'a', email: null, autor: 'João' }))).toBe('joão');
    expect(chaveAutor(projeto({ id: 'b', email: null, autor: null }))).toBe('sem-autor');
  });

  it('rótulo prefere o nome ao e-mail', () => {
    expect(rotuloAutor(projeto({ id: 'a', email: 'ana@go.com', autor: 'Ana' }))).toBe('Ana');
    expect(rotuloAutor(projeto({ id: 'b', email: 'x@go.com', autor: null }))).toBe('x@go.com');
    expect(rotuloAutor(projeto({ id: 'c', email: null, autor: null }))).toBe('Sem autor');
  });
});

describe('agruparPorAutor', () => {
  it('uma coluna por pessoa, ordenada por quem tem mais projetos', () => {
    const lista = [
      projeto({ id: 'a1', email: 'ana@go.com', autor: 'Ana' }),
      projeto({ id: 'a2', email: 'ana@go.com', autor: 'Ana' }),
      projeto({ id: 'a3', email: 'ana@go.com', autor: 'Ana' }),
      projeto({ id: 'b1', email: 'bia@go.com', autor: 'Bia' }),
      projeto({ id: 'b2', email: 'bia@go.com', autor: 'Bia' }),
      projeto({ id: 'c1', email: 'caio@go.com', autor: 'Caio' }),
    ];
    const colunas = agruparPorAutor(lista);
    expect(colunas.map((c) => [c.nome, c.total])).toEqual([
      ['Ana', 3],
      ['Bia', 2],
      ['Caio', 1],
    ]);
  });

  it('mesmo e-mail com nome/caixa diferentes fica na MESMA coluna', () => {
    const colunas = agruparPorAutor([
      projeto({ id: 'a', email: 'ana@go.com', autor: 'Ana Silva' }),
      projeto({ id: 'b', email: 'ANA@GO.COM', autor: 'Ana' }),
    ]);
    expect(colunas).toHaveLength(1);
    expect(colunas[0].total).toBe(2);
  });

  it('dentro da coluna, mais recente primeiro', () => {
    const colunas = agruparPorAutor([
      projeto({ id: 'velho', email: 'ana@go.com', dataOrdenacao: 100 }),
      projeto({ id: 'novo', email: 'ana@go.com', dataOrdenacao: 200 }),
    ]);
    expect(colunas[0].projetos.map((p) => p.id)).toEqual(['novo', 'velho']);
  });
});

describe('apenasAutoresComMultiplos', () => {
  it('mantém só quem tem 2+ na lista dada', () => {
    const lista = [
      projeto({ id: 'a1', email: 'ana@go.com' }),
      projeto({ id: 'a2', email: 'ana@go.com' }),
      projeto({ id: 'c1', email: 'caio@go.com' }),
    ];
    expect(apenasAutoresComMultiplos(lista).map((p) => p.id)).toEqual(['a1', 'a2']);
  });

  it('conta sobre o conjunto JÁ filtrado (respeita os outros filtros)', () => {
    // Ana tem 3 no total, mas só 1 na área "Fiscal" — ali ela não é "múltipla".
    const soFiscal = [
      projeto({ id: 'a1', email: 'ana@go.com', area: 'Fiscal' }),
      projeto({ id: 'b1', email: 'bia@go.com', area: 'Fiscal' }),
      projeto({ id: 'b2', email: 'bia@go.com', area: 'Fiscal' }),
    ];
    expect(apenasAutoresComMultiplos(soFiscal).map((p) => p.id)).toEqual(['b1', 'b2']);
  });
});

describe('filasPresentes', () => {
  it('conta cada fila presente, maior primeiro', () => {
    const lista = [
      projeto({ id: 'a', aprovacaoLider: 'Pré-aprovado (liderança)' }), // rpa
      projeto({ id: 'b', aprovacaoLider: 'Pré-aprovado' }), // rpa
      projeto({ id: 'c', aprovacaoLider: null }), // sem_lider
    ];
    const filas = filasPresentes(lista, filaDe);
    expect(filas[0]).toEqual({ chave: 'rpa', total: 2 });
    expect(filas.find((f) => f.chave === 'sem_lider')?.total).toBe(1);
  });
});

describe('contarFiltrosPendentes', () => {
  it('zero com os filtros vazios', () => {
    expect(contarFiltrosPendentes(FILTROS_PENDENTES_VAZIOS)).toBe(0);
  });

  it('soma cada dimensão ativa', () => {
    expect(
      contarFiltrosPendentes({
        termo: 'x',
        dono: 'ana@go.com',
        fila: 'rpa',
        periodo: { inicio: '2026-01-01', fim: '2026-01-31' },
        soMultiplos: true,
      }),
    ).toBe(5);
  });
});
