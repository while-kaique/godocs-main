/**
 * Comparador de especiais — o agrupamento por nível e as âncoras da régua.
 *
 * O que estes testes prendem: a coluna que um cartão ocupa é a NOTA GRAVADA (nunca a `nota`
 * declarada na referência), níveis 0–5 existem mesmo vazios, a escala aberta ganha coluna
 * quando há projeto/âncora, e a comparação sempre traz a âncora do nível junto.
 */
import { describe, it, expect } from 'vitest';
import {
  ESPERA_ATENCAO,
  ESPERA_CRITICA,
  TETO_REENVIO,
  areasDosProjetos,
  cargaPorDono,
  chaveArea,
  diasDeEspera,
  donoDoProjeto,
  excedeTetoDeReenvio,
  filaDe,
  rotuloValidador,
  urgenciaDaEspera,
  type DonoDeArea,
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

  it('deixa de fora os DESCONTINUADOS — automação que não roda mais não se valida', () => {
    const lista = [projeto({ id: 'a' }), projeto({ id: 'b', statusChave: 'descontinuado' })];
    expect(apenasEspeciais(lista).map((p) => p.id)).toEqual(['a']);
  });

  it('e some das colunas também (o agrupamento passa pelo mesmo corte)', () => {
    const colunas = agruparEspeciais([projeto({ id: 'b', estrelas: 2, statusChave: 'descontinuado' })]);
    expect(colunas.every((c) => c.total === 0)).toBe(true);
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
        ...FILTROS_ESPECIAIS_VAZIOS,
        termo: 'piapp',
        periodo: { inicio: '2026-08-01', fim: '2026-08-18' },
        soDivergentes: true,
      }),
    ).toBe(3);
    expect(contarFiltrosEspeciais({ ...FILTROS_ESPECIAIS_VAZIOS, status: 'pendente' })).toBe(1);
  });
});

describe('filas derivadas (Status + parecer do líder + Especial?)', () => {
  it('reenvio vence tudo — a bola está com o autor', () => {
    expect(filaDe(projeto({ id: 'a', statusChave: 'reenvio pendente', aprovacaoLider: 'Pré-aprovado' }))).toBe('reenvio');
  });

  it('especial vence a marcação de líder (especial não passa por líder — D27)', () => {
    expect(filaDe(projeto({ id: 'a', statusChave: 'pendente', especial: true }))).toBe('especial');
  });

  it('não-especial pendente segue o parecer do líder', () => {
    const base = { statusChave: 'pendente', especial: false } as const;
    expect(filaDe(projeto({ id: 'a', ...base, aprovacaoLider: 'Pré-aprovado' }))).toBe('rpa');
    expect(filaDe(projeto({ id: 'b', ...base, aprovacaoLider: 'Pré-pendente' }))).toBe('lider');
    expect(filaDe(projeto({ id: 'c', ...base, aprovacaoLider: 'Ajuste pedido' }))).toBe('autor');
    expect(filaDe(projeto({ id: 'd', ...base, aprovacaoLider: null }))).toBe('sem_lider');
  });

  it('o cabeçalho sem acento da planilha ("Pre-aprovado") casa igual', () => {
    expect(filaDe(projeto({ id: 'a', statusChave: 'pendente', especial: false, aprovacaoLider: 'Pre-aprovado' }))).toBe('rpa');
  });

  it('status decidido sai das filas de espera', () => {
    expect(filaDe(projeto({ id: 'a', statusChave: 'aprovado', especial: true }))).toBe('decidido');
  });
});

describe('tempo de espera', () => {
  const agora = Date.UTC(2026, 7, 18);

  it('conta os dias desde a submissão', () => {
    expect(diasDeEspera(projeto({ id: 'a', dataOrdenacao: Date.UTC(2026, 6, 9) }), agora)).toBe(40);
  });

  it('sem data não inventa espera', () => {
    expect(diasDeEspera(projeto({ id: 'a' }), agora)).toBeNull();
  });

  it('as faixas do painel: 60d é crítico, 30d é atenção', () => {
    expect(urgenciaDaEspera(ESPERA_CRITICA)).toBe('critica');
    expect(urgenciaDaEspera(ESPERA_ATENCAO)).toBe('atencao');
    expect(urgenciaDaEspera(ESPERA_ATENCAO - 1)).toBe('normal');
    expect(urgenciaDaEspera(null)).toBe('normal');
  });
});

describe('teto de estrelas no reenvio', () => {
  it('avisa acima de 2 só quando o projeto está em reenvio', () => {
    const emReenvio = projeto({ id: 'a', statusChave: 'reenvio pendente' });
    expect(excedeTetoDeReenvio(emReenvio, TETO_REENVIO + 1)).toBe(true);
    expect(excedeTetoDeReenvio(emReenvio, TETO_REENVIO)).toBe(false);
    expect(excedeTetoDeReenvio(projeto({ id: 'b', statusChave: 'pendente' }), 5)).toBe(false);
  });
});

describe('divisão por pessoa', () => {
  const donos = new Map<string, DonoDeArea>([
    ['GROWTH', { area: 'GROWTH', dono_email: 'jg@x.com', dono_nome: 'João Gabriel' }],
  ]);

  it('a área é a unidade: projeto novo da área já nasce com dono', () => {
    expect(donoDoProjeto(projeto({ id: 'a', area: 'Growth' }), donos)).toBe('jg@x.com');
    expect(donoDoProjeto(projeto({ id: 'b', area: 'CX' }), donos)).toBeNull();
  });

  it('mantém o acento na chave — OPERAÇÕES GOCASE ≠ OPERACOES GOBEAUTE', () => {
    expect(chaveArea(' Operações Gocase ')).toBe('OPERAÇÕES GOCASE');
    expect(chaveArea('Operacoes Gobeaute')).not.toBe(chaveArea('Operações Gobeauté'));
  });

  it('a carga conta os SEM DONO também — área órfã é o que some de vista', () => {
    const carga = cargaPorDono(
      [projeto({ id: 'a', area: 'GROWTH' }), projeto({ id: 'b', area: 'CX' })],
      donos,
    );
    expect(carga.get('jg@x.com')).toBe(1);
    expect(carga.get(null)).toBe(1);
  });

  it('lista as áreas da base, maior primeiro', () => {
    const areas = areasDosProjetos([
      projeto({ id: 'a', area: 'CX' }),
      projeto({ id: 'b', area: 'CX' }),
      projeto({ id: 'c', area: 'GROWTH' }),
      projeto({ id: 'd', area: null }),
    ]);
    expect(areas[0]).toEqual({ area: 'CX', total: 2 });
    expect(areas.map((a) => a.area)).toContain('SEM ÁREA');
  });

  it('mostra o nome de quem valida, nunca o e-mail cru quando há nome', () => {
    const validadores = [{ email: 'jg@x.com', nome: 'João Gabriel' }];
    expect(rotuloValidador('jg@x.com', validadores)).toBe('João Gabriel');
    expect(rotuloValidador('outro@x.com', validadores)).toBe('outro@x.com');
    expect(rotuloValidador(null, validadores)).toBe('Sem dono');
  });
});
