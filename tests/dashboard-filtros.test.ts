// Filtros da triagem + aritmética do calendário.
//
// Duas coisas que só um teste pega: (1) filtro que SOMA errado — trocar um AND por um OR
// faz a tela mostrar projeto a mais e ninguém percebe; (2) data em fuso — o calendário
// pintando "hoje" no dia errado, ou o projeto enviado hoje sumindo do filtro "Hoje",
// porque alguém trocou `Date.UTC` por `new Date(iso).getDate()`.
import { describe, it, expect } from 'vitest';
import {
  FILTROS_VAZIOS,
  TODAS_AS_AREAS,
  aplicarFiltros,
  areasDisponiveis,
  casaPeriodo,
  contarFiltrosAtivos,
  contarPorPilula,
  totalSemStatus,
  type FiltrosDashboard,
} from '@/lib/dashboard-filtros';
import {
  PRESETS_PERIODO,
  contarDias,
  ehIsoValido,
  gradeDoMes,
  hojeIso,
  ordenarIntervalo,
  presetDoIntervalo,
  rotuloIntervalo,
  rotuloMes,
  somarDias,
  somarMeses,
  ultimoDiaDoMes,
} from '@/lib/calendario-datas';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

function proj(over: Partial<ProjetoDashboardResumo> = {}): ProjetoDashboardResumo {
  return {
    id: 'P1',
    nome: 'Projeto',
    autor: 'Fulano',
    email: 'f@gocase.com',
    area: 'Fiscal',
    status: 'Pendente',
    statusChave: 'pendente',
    dataSubmissao: '10/08/2026',
    dataOrdenacao: Date.UTC(2026, 7, 10),
    ganhoTotal: 1000,
    savingReais: 1000,
    receitaMensal: null,
    complexidade: 'Média',
    tipos: 'Saving',
    especial: false,
    aprovacaoLider: null,
    busca: 'projeto fulano',
    ...over,
  };
}

const filtros = (over: Partial<FiltrosDashboard> = {}): FiltrosDashboard => ({
  ...FILTROS_VAZIOS,
  ...over,
});

describe('composição dos filtros (AND)', () => {
  const base = [
    proj({ id: 'A', especial: true, statusChave: 'pendente', area: 'Fiscal' }),
    proj({ id: 'B', especial: false, statusChave: 'pendente', area: 'CX' }),
    proj({ id: 'C', especial: true, statusChave: 'aprovado', area: 'Fiscal' }),
  ];

  it('sem filtro nenhum devolve a lista inteira', () => {
    expect(aplicarFiltros(base, filtros()).map((p) => p.id)).toEqual(['A', 'B', 'C']);
  });

  it('todos + especiais = só os especiais, de qualquer fila', () => {
    expect(aplicarFiltros(base, filtros({ especial: 'apenas' })).map((p) => p.id)).toEqual([
      'A',
      'C',
    ]);
  });

  it('pendentes + especiais recorta as DUAS dimensões (AND, nunca OR)', () => {
    const r = aplicarFiltros(base, filtros({ status: 'pendente', especial: 'apenas' }));
    expect(r.map((p) => p.id)).toEqual(['A']);
  });

  it('"Padrão" é o inverso de "Especiais", não um sinônimo de "Todos"', () => {
    expect(aplicarFiltros(base, filtros({ especial: 'sem' })).map((p) => p.id)).toEqual(['B']);
  });

  it('área soma com status e natureza', () => {
    const r = aplicarFiltros(
      base,
      filtros({ status: 'pendente', especial: 'apenas', area: 'Fiscal' }),
    );
    expect(r.map((p) => p.id)).toEqual(['A']);
    expect(aplicarFiltros(base, filtros({ area: 'CX' })).map((p) => p.id)).toEqual(['B']);
  });

  it('status legado cai na pílula equivalente (rejeitado → reenvio pendente)', () => {
    const legado = [proj({ id: 'L', statusChave: 'rejeitado' })];
    expect(aplicarFiltros(legado, filtros({ status: 'reenvio pendente' })).map((p) => p.id)).toEqual(
      ['L'],
    );
  });
});

describe('filtro de ganho', () => {
  const base = [
    proj({ id: 'S', savingReais: 5000, receitaMensal: null }),
    proj({ id: 'R', savingReais: null, receitaMensal: 3000 }),
    proj({ id: 'Z', savingReais: 0, receitaMensal: 0 }),
    proj({ id: 'N', savingReais: null, receitaMensal: null }),
  ];

  it('"com saving" exige valor POSITIVO — zero e vazio ficam de fora', () => {
    expect(aplicarFiltros(base, filtros({ ganho: 'saving' })).map((p) => p.id)).toEqual(['S']);
  });

  it('"com receita" olha a receita incremental, não o ganho total', () => {
    expect(aplicarFiltros(base, filtros({ ganho: 'receita' })).map((p) => p.id)).toEqual(['R']);
  });

  it('projeto com os dois ganhos aparece nas duas filas', () => {
    const duplo = [proj({ id: 'D', savingReais: 10, receitaMensal: 10 })];
    expect(aplicarFiltros(duplo, filtros({ ganho: 'saving' })).length).toBe(1);
    expect(aplicarFiltros(duplo, filtros({ ganho: 'receita' })).length).toBe(1);
  });
});

describe('filtro de período', () => {
  it('as duas pontas são INCLUSIVAS, inclusive com hora no carimbo', () => {
    const p = proj({ dataOrdenacao: Date.UTC(2026, 7, 21, 14, 30) });
    expect(casaPeriodo(p, { inicio: '2026-08-17', fim: '2026-08-21' })).toBe(true);
    expect(casaPeriodo(p, { inicio: '2026-08-17', fim: '2026-08-20' })).toBe(false);
    const inicio = proj({ dataOrdenacao: Date.UTC(2026, 7, 17) });
    expect(casaPeriodo(inicio, { inicio: '2026-08-17', fim: '2026-08-21' })).toBe(true);
  });

  it('projeto sem data não entra em janela nenhuma', () => {
    expect(casaPeriodo(proj({ dataOrdenacao: null }), { inicio: '2026-01-01', fim: '2026-12-31' }))
      .toBe(false);
  });

  it('sem período, tudo passa', () => {
    expect(casaPeriodo(proj({ dataOrdenacao: null }), null)).toBe(true);
  });

  it('um dia só: só o projeto daquele dia', () => {
    const base = [
      proj({ id: 'ONTEM', dataOrdenacao: Date.UTC(2026, 7, 16) }),
      proj({ id: 'HOJE', dataOrdenacao: Date.UTC(2026, 7, 17) }),
    ];
    const r = aplicarFiltros(base, filtros({ periodo: { inicio: '2026-08-17', fim: '2026-08-17' } }));
    expect(r.map((p) => p.id)).toEqual(['HOJE']);
  });
});

describe('contagens da faixa de pílulas', () => {
  const base = [
    proj({ id: 'A', especial: true, statusChave: 'pendente' }),
    proj({ id: 'B', especial: false, statusChave: 'pendente' }),
    proj({ id: 'C', especial: true, statusChave: 'aprovado' }),
  ];

  it('a contagem da pílula respeita os demais filtros', () => {
    expect(contarPorPilula(base, filtros())).toEqual({ pendente: 2, aprovado: 1 });
    expect(contarPorPilula(base, filtros({ especial: 'apenas' }))).toEqual({
      pendente: 1,
      aprovado: 1,
    });
  });

  it('a contagem da pílula IGNORA o status escolhido (senão a faixa colapsaria em 1)', () => {
    expect(contarPorPilula(base, filtros({ status: 'aprovado' }))).toEqual({
      pendente: 2,
      aprovado: 1,
    });
  });

  it('"Todos" mostra o total do recorte, não o da planilha', () => {
    expect(totalSemStatus(base, filtros())).toBe(3);
    expect(totalSemStatus(base, filtros({ especial: 'apenas' }))).toBe(2);
  });
});

describe('utilitários da barra', () => {
  it('conta quantos recortes estão ativos (o status não entra)', () => {
    expect(contarFiltrosAtivos(filtros())).toBe(0);
    expect(contarFiltrosAtivos(filtros({ status: 'pendente' }))).toBe(0);
    expect(
      contarFiltrosAtivos(
        filtros({ especial: 'apenas', ganho: 'saving', area: 'CX', periodo: { inicio: 'a', fim: 'b' } }),
      ),
    ).toBe(4);
  });

  it('lista as áreas presentes, sem repetir e em ordem', () => {
    const base = [proj({ area: 'Fiscal' }), proj({ area: 'CX' }), proj({ area: 'Fiscal' }), proj({ area: null })];
    expect(areasDisponiveis(base)).toEqual(['CX', 'Fiscal']);
  });

  it('TODAS_AS_AREAS não recorta nada', () => {
    const base = [proj({ area: 'Fiscal' }), proj({ area: null })];
    expect(aplicarFiltros(base, filtros({ area: TODAS_AS_AREAS })).length).toBe(2);
  });
});

describe('aritmética do calendário', () => {
  it('a grade tem SEMPRE 42 células e começa num domingo', () => {
    for (const mes of ['2026-08-01', '2026-02-01', '2027-01-01']) {
      const g = gradeDoMes(mes);
      expect(g.length).toBe(42);
      expect(new Date(`${g[0].iso}T00:00:00Z`).getUTCDay()).toBe(0);
    }
  });

  it('a grade marca o que é do mês e o que é emenda', () => {
    const g = gradeDoMes('2026-08-01');
    expect(g.filter((c) => c.doMes).length).toBe(31);
    expect(g.find((c) => c.doMes)!.dia).toBe(1);
  });

  it('somarMeses preserva o dia quando ele existe no destino', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-03-15', -1)).toBe('2026-02-15');
    expect(somarMeses('2026-12-10', 1)).toBe('2027-01-10');
  });

  it('somarDias atravessa mês e ano', () => {
    expect(somarDias('2026-08-31', 1)).toBe('2026-09-01');
    expect(somarDias('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('contarDias é inclusivo nas duas pontas (17→21 = 5 dias)', () => {
    expect(contarDias({ inicio: '2026-08-17', fim: '2026-08-21' })).toBe(5);
    expect(contarDias({ inicio: '2026-08-17', fim: '2026-08-17' })).toBe(1);
  });

  it('ordenarIntervalo aceita o 2º clique ANTES do 1º', () => {
    expect(ordenarIntervalo('2026-08-21', '2026-08-17')).toEqual({
      inicio: '2026-08-17',
      fim: '2026-08-21',
    });
  });

  it('rejeita data que não existe', () => {
    expect(ehIsoValido('2026-02-31')).toBe(false);
    expect(ehIsoValido('2026-2-3')).toBe(false);
    expect(ehIsoValido('2026-02-28')).toBe(true);
  });

  it('os atalhos olham para trás e terminam hoje', () => {
    const hoje = '2026-08-17';
    const por = (c: string) => PRESETS_PERIODO.find((p) => p.chave === c)!.intervalo(hoje);
    expect(por('hoje')).toEqual({ inicio: hoje, fim: hoje });
    expect(por('7d')).toEqual({ inicio: '2026-08-11', fim: hoje });
    expect(contarDias(por('7d'))).toBe(7);
    expect(contarDias(por('30d'))).toBe(30);
    expect(por('mes')).toEqual({ inicio: '2026-08-01', fim: hoje });
    expect(por('mes_passado')).toEqual({ inicio: '2026-07-01', fim: '2026-07-31' });
    expect(por('ano')).toEqual({ inicio: '2026-01-01', fim: hoje });
  });

  it('reconhece o atalho que descreve o intervalo (para marcá-lo como ativo)', () => {
    expect(presetDoIntervalo({ inicio: '2026-08-17', fim: '2026-08-17' }, '2026-08-17')).toBe('hoje');
    expect(presetDoIntervalo({ inicio: '2026-08-03', fim: '2026-08-09' }, '2026-08-17')).toBe(null);
    expect(presetDoIntervalo(null, '2026-08-17')).toBe(null);
  });

  it('ultimoDiaDoMes acerta fevereiro bissexto', () => {
    expect(ultimoDiaDoMes('2028-02-10')).toBe('2028-02-29');
    expect(ultimoDiaDoMes('2026-02-10')).toBe('2026-02-28');
  });

  it('rótulos saem em português', () => {
    expect(rotuloMes('2026-08-01')).toBe('Agosto 2026');
    expect(rotuloIntervalo({ inicio: '2026-08-17', fim: '2026-08-21' })).toBe('17 ago – 21 ago');
    expect(rotuloIntervalo({ inicio: '2026-03-01', fim: '2026-03-01' })).toBe('1 mar');
  });

  it('hoje usa o relógio LOCAL — às 22h de Brasília o UTC já virou e o dia estaria errado', () => {
    // 17/08/2026 22:30 em UTC-3 = 18/08 01:30 UTC. "Hoje" tem de ser 17.
    const local = new Date(2026, 7, 17, 22, 30);
    expect(hojeIso(local)).toBe('2026-08-17');
  });
});

describe('peso do payload da listagem', () => {
  // Medido em prod (17/08/2026, 639 projetos): a resposta pesava 563,6 KB e `observacoes`
  // sozinho era 160 KB (28%) — o parecer do analisador, que a TABELA nunca desenhou. Cada
  // campo aqui é multiplicado por ~600, então campo que ninguém desenha é lentidão pura.
  // Este teste é o canário: recolocar um campo desses falha aqui em vez de degradar a tela.
  it('o resumo carrega SÓ o que a tabela e os filtros desenham', () => {
    const chaves = Object.keys(proj()).sort();
    expect(chaves).toEqual(
      [
        'aprovacaoLider',
        'area',
        'autor',
        'busca',
        'complexidade',
        'dataOrdenacao',
        'dataSubmissao',
        'email',
        'especial',
        'ganhoTotal',
        'id',
        'nome',
        'receitaMensal',
        'savingReais',
        'status',
        'statusChave',
        'tipos',
      ].sort(),
    );
  });

  it('os campos removidos não voltam por engano', () => {
    // `Ferramenta` CONTINUA sendo lida (alimenta o índice de busca), mas não viaja
    // como campo próprio — por isso ela some daqui e permanece em `COLUNAS_RESUMO`.
    for (const morto of ['observacoes', 'atualizadoEm', 'savingHoras', 'ferramenta']) {
      expect(Object.keys(proj())).not.toContain(morto);
    }
  });
});
