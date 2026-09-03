// Lista incremental de itens (nome · valor · frequência · o que é) — comportamento PURO.
//
// A mesma lista existe hoje DUAS vezes na v1 (custo evitado e custo do projeto), e na v2
// ela serve ao **custo para rodar**. O que este arquivo protege, em ordem de dano:
// 1. FAIL-CLOSED da conversão: item sem frequência LANÇA. Item de custo que desaparece
//    em silêncio INFLA o impacto do projeto — é a direção gameável.
// 2. A tela nunca fica sem linha: remover o último item devolve UMA linha em branco.
// 3. Pureza: adicionar/remover/atualizar nunca mutam a lista recebida (o estado do React
//    depende de identidade nova para re-renderizar, e mutar é bug invisível).
// 4. As chaves POSICIONAIS de erro e as 4 mensagens exatas da v1 (a tela casa por chave).
import { describe, it, expect } from 'vitest';
import {
  itemVazio,
  comAoMenosUm,
  adicionarItem,
  removerItem,
  atualizarItem,
  itemCompleto,
  listaVazia,
  validarItens,
  itensParaCustoRodar,
  type ItemLista,
} from '@/lib/submeter/itens-lista';
import { parseMoedaBR } from '@/lib/submeter/constants';

const EM_BRANCO: ItemLista = { nome: '', valor: '', frequencia: '', descricao: '' };

function completo(over: Partial<ItemLista> = {}): ItemLista {
  return {
    nome: 'Licença do robô',
    valor: '1.234,56',
    frequencia: 'mensal',
    descricao: 'Assinatura mensal da plataforma que executa a automação',
    ...over,
  };
}

describe('itemVazio', () => {
  it('devolve os 4 campos em branco, com a frequência como string vazia', () => {
    expect(itemVazio()).toEqual({ nome: '', valor: '', frequencia: '', descricao: '' });
  });

  it('devolve um objeto NOVO a cada chamada (duas linhas não podem compartilhar estado)', () => {
    expect(itemVazio()).not.toBe(itemVazio());
  });
});

describe('comAoMenosUm — a tela nunca aparece sem nenhuma linha', () => {
  it('lista vazia vira uma lista com UM item em branco', () => {
    const r = comAoMenosUm([]);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual(EM_BRANCO);
  });

  it('lista que já tem itens volta intacta', () => {
    const itens = [completo(), completo({ nome: 'API de OCR' })];
    expect(comAoMenosUm(itens)).toEqual(itens);
  });
});

describe('adicionarItem', () => {
  it('acrescenta um item em branco no FIM', () => {
    const r = adicionarItem([completo({ nome: 'Primeiro' })]);
    expect(r).toHaveLength(2);
    expect(r[0].nome).toBe('Primeiro');
    expect(r[1]).toEqual(EM_BRANCO);
  });

  it('NÃO muta a lista recebida', () => {
    const itens = [completo()];
    adicionarItem(itens);
    expect(itens).toHaveLength(1);
  });

  it('funciona a partir da lista vazia', () => {
    expect(adicionarItem([])).toEqual([EM_BRANCO]);
  });
});

describe('removerItem', () => {
  it('remove o item do índice pedido', () => {
    const itens = [completo({ nome: 'A' }), completo({ nome: 'B' }), completo({ nome: 'C' })];
    expect(removerItem(itens, 1).map((i) => i.nome)).toEqual(['A', 'C']);
  });

  it('remover o ÚLTIMO item devolve uma lista com UMA linha em branco, nunca uma lista vazia', () => {
    const r = removerItem([completo({ nome: 'Único' })], 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual(EM_BRANCO);
  });

  it('índice fora da lista devolve a lista intacta', () => {
    const itens = [completo({ nome: 'A' }), completo({ nome: 'B' })];
    expect(removerItem(itens, 5)).toEqual(itens);
    expect(removerItem(itens, -1)).toEqual(itens);
  });

  it('NÃO muta a lista recebida', () => {
    const itens = [completo({ nome: 'A' }), completo({ nome: 'B' })];
    removerItem(itens, 0);
    expect(itens).toHaveLength(2);
    expect(itens[0].nome).toBe('A');
  });
});

describe('atualizarItem', () => {
  it('aplica o patch só no índice pedido', () => {
    const itens = [completo({ nome: 'A' }), completo({ nome: 'B' })];
    const r = atualizarItem(itens, 1, { nome: 'B editado' });
    expect(r[0].nome).toBe('A');
    expect(r[1].nome).toBe('B editado');
  });

  it('preserva os campos do item que o patch não menciona', () => {
    const item = completo({ nome: 'A', valor: '10,00', frequencia: 'trimestral', descricao: 'texto original' });
    const r = atualizarItem([item], 0, { valor: '99,90' });
    expect(r[0]).toEqual({
      nome: 'A',
      valor: '99,90',
      frequencia: 'trimestral',
      descricao: 'texto original',
    });
  });

  it('índice fora da lista devolve a lista intacta', () => {
    const itens = [completo({ nome: 'A' })];
    expect(atualizarItem(itens, 3, { nome: 'fantasma' })).toEqual(itens);
    expect(atualizarItem(itens, -1, { nome: 'fantasma' })).toEqual(itens);
  });

  it('NÃO muta a lista nem o item recebido', () => {
    const itens = [completo({ nome: 'A' })];
    atualizarItem(itens, 0, { nome: 'mutado?' });
    expect(itens[0].nome).toBe('A');
  });
});

describe('itemCompleto — só com os 4 campos válidos', () => {
  it('item com nome, valor > 0, frequência e descrição está completo', () => {
    expect(itemCompleto(completo())).toBe(true);
  });

  it('nome só com espaços reprova', () => {
    expect(itemCompleto(completo({ nome: '   ' }))).toBe(false);
  });

  it('descrição só com espaços reprova', () => {
    expect(itemCompleto(completo({ descricao: '  ' }))).toBe(false);
  });

  it('frequência em branco reprova', () => {
    expect(itemCompleto(completo({ frequencia: '' }))).toBe(false);
  });

  it('valor "0,00" reprova (a régua é > 0, não "tem dígito")', () => {
    expect(parseMoedaBR('0,00')).toBe(0);
    expect(itemCompleto(completo({ valor: '0,00' }))).toBe(false);
  });

  it('valor vazio ou não numérico reprova', () => {
    expect(itemCompleto(completo({ valor: '' }))).toBe(false);
    expect(itemCompleto(completo({ valor: 'abc' }))).toBe(false);
  });

  it('item totalmente em branco reprova', () => {
    expect(itemCompleto(EM_BRANCO)).toBe(false);
  });
});

describe('listaVazia — "não declarei nada"', () => {
  it('lista sem itens é vazia', () => {
    expect(listaVazia([])).toBe(true);
  });

  it('lista só com linhas totalmente em branco é vazia', () => {
    expect(listaVazia([{ ...EM_BRANCO }])).toBe(true);
    expect(listaVazia([{ ...EM_BRANCO }, { ...EM_BRANCO }])).toBe(true);
  });

  it('qualquer campo com conteúdo em qualquer item deixa de ser vazia', () => {
    expect(listaVazia([{ ...EM_BRANCO, nome: 'X' }])).toBe(false);
    expect(listaVazia([{ ...EM_BRANCO, valor: '10,00' }])).toBe(false);
    expect(listaVazia([{ ...EM_BRANCO, frequencia: 'pontual' }])).toBe(false);
    expect(listaVazia([{ ...EM_BRANCO, descricao: 'algo' }])).toBe(false);
    expect(listaVazia([{ ...EM_BRANCO }, { ...EM_BRANCO, nome: 'segundo' }])).toBe(false);
  });
});

describe('validarItens — chaves POSICIONAIS e as 4 mensagens da v1', () => {
  it('item em branco gera as 4 chaves do índice 0 com as mensagens exatas', () => {
    expect(validarItens([{ ...EM_BRANCO }], 'cr')).toEqual({
      cr0nome: 'Informe o nome',
      cr0valor: 'Informe o valor',
      cr0frequencia: 'Selecione',
      cr0descricao: 'Informe a justificativa',
    });
  });

  it('numera pela POSIÇÃO do item na lista (cr0…, cr1…)', () => {
    const erros = validarItens([{ ...EM_BRANCO }, { ...EM_BRANCO }], 'cr');
    expect(erros.cr0nome).toBe('Informe o nome');
    expect(erros.cr1nome).toBe('Informe o nome');
    expect(erros.cr1frequencia).toBe('Selecione');
    expect(erros.cr1descricao).toBe('Informe a justificativa');
  });

  it('respeita o prefixo recebido', () => {
    const erros = validarItens([{ ...EM_BRANCO }], 'ce');
    expect(erros.ce0nome).toBe('Informe o nome');
    expect(erros.ce0valor).toBe('Informe o valor');
    expect(erros).not.toHaveProperty('cr0nome');
  });

  it('item completo não gera chave nenhuma', () => {
    expect(validarItens([completo()], 'cr')).toEqual({});
  });

  it('reclama só do campo que falta, mantendo o índice do item incompleto', () => {
    const erros = validarItens([completo(), completo({ valor: '0,00' })], 'cr');
    expect(erros).toEqual({ cr1valor: 'Informe o valor' });
  });
});

describe('itensParaCustoRodar — conversão para o tipo da T3', () => {
  it('converte valor pela régua de moeda BR e leva a descrição para oQueE', () => {
    const itens = [
      completo({ nome: 'Licença', valor: '1.234,56', frequencia: 'mensal', descricao: 'plataforma que roda o robô' }),
      completo({ nome: 'Setup', valor: '900,00', frequencia: 'pontual', descricao: 'implantação inicial' }),
    ];
    expect(itensParaCustoRodar(itens)).toEqual([
      { nome: 'Licença', valor: 1234.56, frequencia: 'mensal', oQueE: 'plataforma que roda o robô' },
      { nome: 'Setup', valor: 900, frequencia: 'pontual', oQueE: 'implantação inicial' },
    ]);
  });

  it('aceita as 4 frequências de impacto.ts', () => {
    const itens: ItemLista[] = (['pontual', 'mensal', 'trimestral', 'semestral'] as const).map((f) =>
      completo({ frequencia: f }),
    );
    expect(itensParaCustoRodar(itens).map((i) => i.frequencia)).toEqual([
      'pontual',
      'mensal',
      'trimestral',
      'semestral',
    ]);
  });

  it('FAIL-CLOSED: item com frequência em branco LANÇA (custo que desaparece infla o impacto)', () => {
    expect(() => itensParaCustoRodar([completo({ frequencia: '' })])).toThrow(/frequ/i);
  });

  it('a mensagem do fail-closed nomeia o índice e o campo que faltou', () => {
    let erro: unknown;
    try {
      itensParaCustoRodar([completo(), completo({ nome: 'Sem frequência', frequencia: '' })]);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(Error);
    const msg = (erro as Error).message;
    expect(msg).toMatch(/frequ/i);
    expect(msg).toContain('1');
  });

  it('linhas totalmente em branco são IGNORADAS (não lançam e não viram item)', () => {
    const itens = [completo({ nome: 'Licença' }), { ...EM_BRANCO }];
    const r = itensParaCustoRodar(itens);
    expect(r).toHaveLength(1);
    expect(r[0].nome).toBe('Licença');
  });

  it('lista só de linhas em branco devolve lista vazia', () => {
    expect(itensParaCustoRodar([{ ...EM_BRANCO }])).toEqual([]);
    expect(itensParaCustoRodar([])).toEqual([]);
  });
});
