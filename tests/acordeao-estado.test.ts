import { describe, it, expect } from 'vitest';
import {
  ordemBlocos,
  blocoInicial,
  proximoPendente,
  aoCompletar,
  alternarAberto,
  todosCompletos,
} from '@/lib/submeter/acordeao-estado';
import { GANHO_CATEGORIAS, type GanhoCategoria } from '@/lib/ganhos';

describe('ordemBlocos', () => {
  it('devolve as categorias marcadas na ordem CANÔNICA de GANHO_CATEGORIAS, nunca na ordem em que foram passadas', () => {
    expect(ordemBlocos(['receita_incremental', 'saving_efetivado'])).toEqual([
      'saving_efetivado',
      'receita_incremental',
    ]);
  });

  it('reordena a lista completa embaralhada exatamente como GANHO_CATEGORIAS', () => {
    const embaralhada: GanhoCategoria[] = [
      'imensuravel',
      'receita_incremental',
      'custo_evitado',
      'saving_efetivado',
    ];
    expect(ordemBlocos(embaralhada)).toEqual([...GANHO_CATEGORIAS]);
  });

  it('preserva a ordem canônica quando só uma categoria é marcada', () => {
    expect(ordemBlocos(['custo_evitado'])).toEqual(['custo_evitado']);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(ordemBlocos([])).toEqual([]);
  });

  it('categoria DUPLICADA aparece uma única vez', () => {
    expect(
      ordemBlocos(['custo_evitado', 'saving_efetivado', 'custo_evitado']),
    ).toEqual(['saving_efetivado', 'custo_evitado']);
  });

  it('categoria DESCONHECIDA não aparece no resultado', () => {
    const comLixo = [
      'receita_incremental',
      'nao_existe',
      'saving_efetivado',
    ] as unknown as GanhoCategoria[];
    expect(ordemBlocos(comLixo)).toEqual([
      'saving_efetivado',
      'receita_incremental',
    ]);
  });
});

describe('blocoInicial', () => {
  it('devolve o PRIMEIRO bloco da lista', () => {
    expect(blocoInicial(['a', 'b', 'c'])).toBe('a');
  });

  it('lista vazia devolve null', () => {
    expect(blocoInicial([])).toBeNull();
  });

  it('lista de um bloco devolve esse bloco', () => {
    expect(blocoInicial(['unico'])).toBe('unico');
  });
});

describe('proximoPendente', () => {
  it('com depoisDe null procura do começo e devolve o primeiro não-completo', () => {
    expect(proximoPendente(['a', 'b', 'c'], [], null)).toBe('a');
    expect(proximoPendente(['a', 'b', 'c'], ['a'], null)).toBe('b');
  });

  it('procura a partir de depoisDe, EXCLUINDO o próprio depoisDe', () => {
    expect(proximoPendente(['a', 'b', 'c'], [], 'a')).toBe('b');
    // 'b' não está em completos, mas é o ponto de partida — não pode ser devolvido
    expect(proximoPendente(['a', 'b', 'c'], ['a'], 'b')).toBe('c');
  });

  it('CIRCULA até o início quando não há pendente depois de depoisDe', () => {
    expect(proximoPendente(['a', 'b', 'c'], ['c'], 'b')).toBe('a');
    expect(proximoPendente(['a', 'b', 'c'], ['a', 'c'], 'c')).toBe('b');
  });

  it('depoisDe que NÃO está na lista procura do começo', () => {
    expect(proximoPendente(['a', 'b', 'c'], ['a'], 'fantasma')).toBe('b');
  });

  it('devolve null quando todos os blocos estão completos', () => {
    expect(proximoPendente(['a', 'b', 'c'], ['a', 'b', 'c'], 'a')).toBeNull();
    expect(proximoPendente(['a', 'b', 'c'], ['c', 'b', 'a'], null)).toBeNull();
  });

  it('lista vazia devolve null', () => {
    expect(proximoPendente([], [], null)).toBeNull();
    expect(proximoPendente([], ['a'], 'a')).toBeNull();
  });

  it('id em completos que não está em blocos é IGNORADO (não afeta a busca)', () => {
    expect(proximoPendente(['a', 'b'], ['fantasma'], null)).toBe('a');
    expect(proximoPendente(['a', 'b'], ['a', 'fantasma'], null)).toBe('b');
  });

  it('com um único bloco pendente, ele é devolvido mesmo circulando', () => {
    expect(proximoPendente(['a'], [], 'a')).toBe('a');
  });
});

describe('aoCompletar', () => {
  it('abre o bloco seguinte ao que acabou de ser completado', () => {
    expect(aoCompletar(['a', 'b', 'c'], [], 'a')).toBe('b');
  });

  it('considera o atual como COMPLETO mesmo que o chamador não o tenha incluído em completos', () => {
    // 'a' é o único pendente segundo `completos`, mas acabou de ser completado
    expect(aoCompletar(['a', 'b'], ['b'], 'a')).toBeNull();
  });

  it('PULA blocos já completos', () => {
    expect(aoCompletar(['a', 'b', 'c'], ['b'], 'a')).toBe('c');
  });

  it('CIRCULA: completar o bloco DO MEIO primeiro abre o primeiro pendente do início', () => {
    expect(aoCompletar(['a', 'b', 'c'], ['c'], 'b')).toBe('a');
  });

  it('devolve null quando não sobrou nenhum pendente (todos fechados)', () => {
    expect(aoCompletar(['a', 'b', 'c'], ['a', 'b'], 'c')).toBeNull();
    expect(aoCompletar(['a'], [], 'a')).toBeNull();
  });

  it('atual que não está na lista de blocos: devolve o primeiro pendente do começo', () => {
    expect(aoCompletar(['a', 'b'], ['a'], 'fantasma')).toBe('b');
  });

  it('lista vazia devolve null', () => {
    expect(aoCompletar([], [], 'a')).toBeNull();
  });
});

describe('alternarAberto', () => {
  it('alvo DIFERENTE do aberto abre o alvo', () => {
    expect(alternarAberto('a', 'b')).toBe('b');
  });

  it('alvo IGUAL ao aberto fecha (devolve null)', () => {
    expect(alternarAberto('a', 'a')).toBeNull();
  });

  it('nada aberto abre o alvo', () => {
    expect(alternarAberto(null, 'a')).toBe('a');
  });

  it('é um toggle de UM aberto por vez: abrir/abrir/fechar volta a null', () => {
    const passo1 = alternarAberto(null, 'a');
    expect(passo1).toBe('a');
    const passo2 = alternarAberto(passo1, 'b');
    expect(passo2).toBe('b');
    expect(alternarAberto(passo2, 'b')).toBeNull();
  });
});

describe('todosCompletos', () => {
  it('true só quando TODO bloco da lista está em completos', () => {
    expect(todosCompletos(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(todosCompletos(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  it('false quando falta qualquer bloco', () => {
    expect(todosCompletos(['a', 'b'], ['a'])).toBe(false);
    expect(todosCompletos(['a', 'b'], [])).toBe(false);
  });

  it('lista VAZIA é false — não existe "tudo completo" sem bloco nenhum', () => {
    expect(todosCompletos([], [])).toBe(false);
    expect(todosCompletos([], ['a'])).toBe(false);
  });

  it('id extra em completos que não está em blocos não torna a lista completa', () => {
    expect(todosCompletos(['a', 'b'], ['a', 'fantasma'])).toBe(false);
  });

  it('id extra em completos não invalida uma lista realmente completa', () => {
    expect(todosCompletos(['a'], ['a', 'fantasma'])).toBe(true);
  });
});
