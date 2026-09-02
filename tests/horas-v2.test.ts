import { describe, it, expect } from 'vitest';
import {
  FUNCAO_OUTRO,
  FUNCOES_HORAS,
  adicionarLinhaHoras,
  atualizarLinhaHoras,
  comAoMenosUmaLinha,
  horasLiberadas,
  linhaHorasVazia,
  linhasParaCustoEvitado,
  parseHorasBR,
  precisaDescricaoFuncao,
  removerLinhaHoras,
  tabelaVazia,
  totalHorasLiberadas,
  validarLinhasHoras,
  type LinhaHorasInput,
} from '@/lib/submeter/horas';
import { CARGOS } from '@/lib/agents/types';

/** Uma linha montada à mão (o formulário carrega tudo como string). */
function linha(patch: Partial<LinhaHorasInput> = {}): LinhaHorasInput {
  return {
    funcao: 'Analista Pleno',
    funcaoDescricao: '',
    horasAntes: '',
    horasDepois: '',
    ...patch,
  };
}

/** Congela a entrada para provar que a função não a mutou. */
function copia<T>(valor: T): T {
  return JSON.parse(JSON.stringify(valor)) as T;
}

const ACENTO = /[áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÉÊÍÓÔÕÚÇ]/;

// ─── parseHorasBR ────────────────────────────────────────────────────────────

describe('parseHorasBR — parser de HORAS em pt-BR (não é parser de moeda)', () => {
  it('lê "12,5" como doze horas e meia — NUNCA como centavos', () => {
    const lido = parseHorasBR('12,5');
    expect(lido).toBe(12.5);
    // As duas leituras monetárias possíveis, explicitamente proibidas:
    expect(lido).not.toBe(0.125);
    expect(lido).not.toBe(1250);
  });

  it('aceita ponto decimal com o mesmo resultado da vírgula', () => {
    expect(parseHorasBR('12.5')).toBe(12.5);
    expect(parseHorasBR('12.5')).toBe(parseHorasBR('12,5'));
  });

  it('aceita inteiro', () => {
    expect(parseHorasBR('160')).toBe(160);
  });

  it('aceita zero como valor VÁLIDO (não confundir com ausência)', () => {
    expect(parseHorasBR('0')).toBe(0);
  });

  it('tolera espaço em volta', () => {
    expect(parseHorasBR('  160  ')).toBe(160);
    expect(parseHorasBR(' 12,5 ')).toBe(12.5);
  });

  it('devolve null para string vazia', () => {
    expect(parseHorasBR('')).toBeNull();
  });

  it('devolve null para string só com espaço', () => {
    expect(parseHorasBR('   ')).toBeNull();
  });

  it('devolve null para texto', () => {
    expect(parseHorasBR('abc')).toBeNull();
  });

  it('devolve null para número negativo', () => {
    expect(parseHorasBR('-3')).toBeNull();
  });

  it('devolve null (nunca NaN nem Infinity) para valores não finitos', () => {
    for (const bruto of ['NaN', 'Infinity', '-Infinity', '1e999']) {
      expect(parseHorasBR(bruto)).toBeNull();
    }
  });

  it('nunca devolve NaN em nenhuma entrada inválida — NaN zera reduce e vira null no JSON', () => {
    for (const bruto of ['', '   ', 'abc', '-3', 'R$ 12,50', '12,5,5', 'NaN']) {
      const lido = parseHorasBR(bruto);
      expect(Number.isNaN(lido as number)).toBe(false);
    }
  });
});

// ─── FUNCOES_HORAS ───────────────────────────────────────────────────────────

describe('FUNCOES_HORAS — as funções ofertadas, SEM valor por hora', () => {
  it('inclui a opção "Outro"', () => {
    expect(FUNCOES_HORAS).toContain(FUNCAO_OUTRO);
  });

  it('oferece mais de uma função além de "Outro"', () => {
    const outras = FUNCOES_HORAS.filter((f) => f !== FUNCAO_OUTRO);
    expect(outras.length).toBeGreaterThan(1);
  });

  it('cada item é uma STRING simples — nenhum objeto com valor_hora', () => {
    for (const item of FUNCOES_HORAS) {
      expect(typeof item).toBe('string');
    }
    expect(JSON.stringify(FUNCOES_HORAS)).not.toContain('valor_hora');
  });

  it('INVARIANTE: nenhum valor/hora dos CARGOS atravessa para o cliente', () => {
    const serializado = JSON.stringify(FUNCOES_HORAS);
    for (const cargo of CARGOS) {
      expect(serializado).not.toContain(String(cargo.valor_hora));
    }
  });
});

// ─── precisaDescricaoFuncao ──────────────────────────────────────────────────

describe('precisaDescricaoFuncao — só "Outro" abre o campo livre', () => {
  it('é true para "Outro"', () => {
    expect(precisaDescricaoFuncao(FUNCAO_OUTRO)).toBe(true);
  });

  it('é false para qualquer função da lista que não seja "Outro"', () => {
    for (const item of FUNCOES_HORAS.filter((f) => f !== FUNCAO_OUTRO)) {
      expect(precisaDescricaoFuncao(item)).toBe(false);
    }
  });

  it('é false para função não escolhida (vazia)', () => {
    expect(precisaDescricaoFuncao('')).toBe(false);
  });
});

// ─── linhaHorasVazia / comAoMenosUmaLinha ────────────────────────────────────

describe('linhaHorasVazia — a linha em branco que a tela sempre tem', () => {
  it('nasce com os 4 campos em branco', () => {
    expect(linhaHorasVazia()).toEqual({
      funcao: '',
      funcaoDescricao: '',
      horasAntes: '',
      horasDepois: '',
    });
  });

  it('devolve uma instância NOVA a cada chamada (nunca o mesmo objeto compartilhado)', () => {
    expect(linhaHorasVazia()).not.toBe(linhaHorasVazia());
  });
});

describe('comAoMenosUmaLinha — a tabela nunca fica sem linha', () => {
  it('lista vazia → uma linha em branco', () => {
    expect(comAoMenosUmaLinha([])).toEqual([linhaHorasVazia()]);
  });

  it('lista com linhas → devolve as mesmas linhas', () => {
    const entrada = [linha({ horasAntes: '160' })];
    expect(comAoMenosUmaLinha(entrada)).toEqual(entrada);
  });

  it('não muta a entrada', () => {
    const entrada = [linha({ horasAntes: '160' })];
    const antes = copia(entrada);
    comAoMenosUmaLinha(entrada);
    expect(entrada).toEqual(antes);
  });
});

// ─── adicionar / remover / atualizar ─────────────────────────────────────────

describe('adicionarLinhaHoras — acrescenta em branco no FIM', () => {
  it('acrescenta uma linha em branco ao final, preservando as existentes', () => {
    const entrada = [linha({ horasAntes: '160' })];
    const saida = adicionarLinhaHoras(entrada);
    expect(saida).toHaveLength(2);
    expect(saida[0]).toEqual(entrada[0]);
    expect(saida[1]).toEqual(linhaHorasVazia());
  });

  it('não muta a entrada', () => {
    const entrada = [linha({ horasAntes: '160' })];
    const antes = copia(entrada);
    adicionarLinhaHoras(entrada);
    expect(entrada).toEqual(antes);
  });
});

describe('removerLinhaHoras', () => {
  it('remove a linha do índice pedido', () => {
    const entrada = [linha({ funcao: 'Assistente' }), linha({ funcao: 'Supervisor' })];
    expect(removerLinhaHoras(entrada, 0)).toEqual([linha({ funcao: 'Supervisor' })]);
  });

  it('remover a ÚLTIMA devolve uma linha em BRANCO, nunca lista vazia', () => {
    const saida = removerLinhaHoras([linha({ horasAntes: '160' })], 0);
    expect(saida).toEqual([linhaHorasVazia()]);
  });

  it('índice fora da lista é no-op', () => {
    const entrada = [linha({ horasAntes: '160' })];
    expect(removerLinhaHoras(entrada, 5)).toEqual(entrada);
    expect(removerLinhaHoras(entrada, -1)).toEqual(entrada);
  });

  it('não muta a entrada', () => {
    const entrada = [linha({ funcao: 'Assistente' }), linha({ funcao: 'Supervisor' })];
    const antes = copia(entrada);
    removerLinhaHoras(entrada, 0);
    expect(entrada).toEqual(antes);
  });
});

describe('atualizarLinhaHoras', () => {
  it('aplica o patch só na linha do índice', () => {
    const entrada = [linha({ funcao: 'Assistente' }), linha({ funcao: 'Supervisor' })];
    const saida = atualizarLinhaHoras(entrada, 1, { horasAntes: '40' });
    expect(saida[1]).toEqual(linha({ funcao: 'Supervisor', horasAntes: '40' }));
    expect(saida[0]).toEqual(entrada[0]);
  });

  it('patch parcial preserva os campos não citados', () => {
    const entrada = [linha({ funcao: FUNCAO_OUTRO, funcaoDescricao: 'Conferente fiscal', horasAntes: '20' })];
    const saida = atualizarLinhaHoras(entrada, 0, { horasDepois: '4' });
    expect(saida[0]).toEqual(
      linha({ funcao: FUNCAO_OUTRO, funcaoDescricao: 'Conferente fiscal', horasAntes: '20', horasDepois: '4' }),
    );
  });

  it('índice fora da lista é no-op', () => {
    const entrada = [linha({ horasAntes: '160' })];
    expect(atualizarLinhaHoras(entrada, 7, { horasAntes: '1' })).toEqual(entrada);
    expect(atualizarLinhaHoras(entrada, -1, { horasAntes: '1' })).toEqual(entrada);
  });

  it('não muta a entrada', () => {
    const entrada = [linha({ funcao: 'Assistente' })];
    const antes = copia(entrada);
    atualizarLinhaHoras(entrada, 0, { horasAntes: '99' });
    expect(entrada).toEqual(antes);
  });
});

// ─── horasLiberadas / totalHorasLiberadas ────────────────────────────────────

describe('horasLiberadas — antes − depois, NUNCA negativo', () => {
  it('subtrai depois de antes', () => {
    expect(horasLiberadas(linha({ horasAntes: '160', horasDepois: '40' }))).toBe(120);
  });

  it('depois MAIOR que antes → 0 (nunca negativo)', () => {
    expect(horasLiberadas(linha({ horasAntes: '10', horasDepois: '40' }))).toBe(0);
  });

  it('depois igual a antes → 0', () => {
    expect(horasLiberadas(linha({ horasAntes: '40', horasDepois: '40' }))).toBe(0);
  });

  it('depois vazio conta como 0 — libera as horas de antes inteiras', () => {
    expect(horasLiberadas(linha({ horasAntes: '160', horasDepois: '' }))).toBe(160);
  });

  it('campo não parseável conta como 0', () => {
    expect(horasLiberadas(linha({ horasAntes: 'abc', horasDepois: '' }))).toBe(0);
    expect(horasLiberadas(linha({ horasAntes: '160', horasDepois: 'abc' }))).toBe(160);
  });

  it('nunca devolve NaN', () => {
    for (const l of [
      linha(),
      linha({ horasAntes: 'abc', horasDepois: 'xyz' }),
      linha({ horasAntes: '-3' }),
    ]) {
      expect(Number.isNaN(horasLiberadas(l))).toBe(false);
    }
  });

  it('respeita o decimal em pt-BR', () => {
    expect(horasLiberadas(linha({ horasAntes: '12,5', horasDepois: '2,5' }))).toBe(10);
  });
});

describe('totalHorasLiberadas', () => {
  it('lista vazia → 0', () => {
    expect(totalHorasLiberadas([])).toBe(0);
  });

  it('soma as linhas', () => {
    expect(
      totalHorasLiberadas([
        linha({ funcao: 'Assistente', horasAntes: '160', horasDepois: '40' }),
        linha({ funcao: 'Supervisor', horasAntes: '20', horasDepois: '0' }),
      ]),
    ).toBe(140);
  });

  it('soma decimais em pt-BR: 12,5 + 7,5 = 20', () => {
    expect(
      totalHorasLiberadas([
        linha({ funcao: 'Assistente', horasAntes: '12,5' }),
        linha({ funcao: 'Supervisor', horasAntes: '7,5' }),
      ]),
    ).toBe(20);
  });

  it('linha inválida não contamina o total com NaN', () => {
    expect(
      totalHorasLiberadas([
        linha({ funcao: 'Assistente', horasAntes: '160' }),
        linha({ funcao: 'Supervisor', horasAntes: 'abc' }),
      ]),
    ).toBe(160);
  });
});

// ─── tabelaVazia ─────────────────────────────────────────────────────────────

describe('tabelaVazia — "não declarei horas"', () => {
  it('lista vazia → true', () => {
    expect(tabelaVazia([])).toBe(true);
  });

  it('uma única linha totalmente em branco → true', () => {
    expect(tabelaVazia([linhaHorasVazia()])).toBe(true);
  });

  it('várias linhas totalmente em branco → true', () => {
    expect(tabelaVazia([linhaHorasVazia(), linhaHorasVazia()])).toBe(true);
  });

  it('qualquer campo preenchido → false', () => {
    expect(tabelaVazia([linha({ funcao: 'Assistente' })])).toBe(false);
    expect(tabelaVazia([{ ...linhaHorasVazia(), horasAntes: '160' }])).toBe(false);
  });

  it('uma linha preenchida no meio de linhas em branco → false', () => {
    expect(tabelaVazia([linhaHorasVazia(), linha({ horasAntes: '160' })])).toBe(false);
  });
});

// ─── validarLinhasHoras ──────────────────────────────────────────────────────

describe('validarLinhasHoras — chaves POSICIONAIS h{i}campo', () => {
  it('linha válida não gera chave nenhuma', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Analista Pleno', horasAntes: '160', horasDepois: '40' }),
    ]);
    expect(erros).toEqual({});
  });

  it('função não escolhida → erro em h0funcao', () => {
    const erros = validarLinhasHoras([linha({ funcao: '', horasAntes: '160', horasDepois: '0' })]);
    expect(erros).toHaveProperty('h0funcao');
    expect(erros.h0funcao).toBeTruthy();
  });

  it('função "Outro" SEM descrição → erro em h0descricao', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: FUNCAO_OUTRO, funcaoDescricao: '', horasAntes: '160', horasDepois: '0' }),
    ]);
    expect(erros).toHaveProperty('h0descricao');
  });

  it('função "Outro" COM descrição não gera h0descricao', () => {
    const erros = validarLinhasHoras([
      linha({
        funcao: FUNCAO_OUTRO,
        funcaoDescricao: 'Conferente fiscal',
        horasAntes: '160',
        horasDepois: '0',
      }),
    ]);
    expect(erros).not.toHaveProperty('h0descricao');
  });

  it('função da lista sem descrição NÃO gera h0descricao', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Assistente', funcaoDescricao: '', horasAntes: '160', horasDepois: '0' }),
    ]);
    expect(erros).not.toHaveProperty('h0descricao');
  });

  it('horasAntes que não parseia → erro em h0antes', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: 'abc', horasDepois: '0' }),
    ]);
    expect(erros).toHaveProperty('h0antes');
  });

  it('horasAntes vazio → erro em h0antes', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: '', horasDepois: '0' }),
    ]);
    expect(erros).toHaveProperty('h0antes');
  });

  it('horasDepois que não parseia → erro em h0depois', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: '160', horasDepois: 'abc' }),
    ]);
    expect(erros).toHaveProperty('h0depois');
  });

  it('DEPOIS maior que ANTES é erro PRÓPRIO em h0depois — não zero silencioso', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: '10', horasDepois: '40' }),
    ]);
    expect(erros).toHaveProperty('h0depois');
    expect(erros.h0depois).toBeTruthy();
  });

  it('a mensagem de "depois > antes" é DIFERENTE da de "depois não parseia"', () => {
    const invertido = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: '10', horasDepois: '40' }),
    ]);
    const ilegivel = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: '10', horasDepois: 'abc' }),
    ]);
    expect(invertido.h0depois).not.toBe(ilegivel.h0depois);
  });

  it('numera por POSIÇÃO: a segunda linha usa h1', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: 'Assistente', horasAntes: '160', horasDepois: '0' }),
      linha({ funcao: '', horasAntes: 'abc', horasDepois: 'xyz' }),
    ]);
    expect(erros).toHaveProperty('h1funcao');
    expect(erros).toHaveProperty('h1antes');
    expect(erros).toHaveProperty('h1depois');
    expect(erros).not.toHaveProperty('h0funcao');
  });

  it('todas as mensagens estão em PORTUGUÊS COM ACENTUAÇÃO', () => {
    const erros = validarLinhasHoras([
      linha({ funcao: '', funcaoDescricao: '', horasAntes: 'abc', horasDepois: 'xyz' }),
      linha({ funcao: FUNCAO_OUTRO, funcaoDescricao: '', horasAntes: '10', horasDepois: '40' }),
    ]);
    const mensagens = Object.values(erros);
    expect(mensagens.length).toBeGreaterThan(0);
    for (const msg of mensagens) {
      expect(typeof msg).toBe('string');
      expect(msg.trim().length).toBeGreaterThan(0);
      expect(msg).toMatch(ACENTO);
    }
  });

  it('não muta a entrada', () => {
    const entrada = [linha({ funcao: '', horasAntes: 'abc' })];
    const antes = copia(entrada);
    validarLinhasHoras(entrada);
    expect(entrada).toEqual(antes);
  });
});

// ─── linhasParaCustoEvitado ──────────────────────────────────────────────────

describe('linhasParaCustoEvitado — ponte para o tipo da T3', () => {
  it('converte as horas para NÚMERO', () => {
    expect(
      linhasParaCustoEvitado([
        linha({ funcao: 'Analista Pleno', horasAntes: '160', horasDepois: '40' }),
      ]),
    ).toEqual([{ funcao: 'Analista Pleno', horasAntes: 160, horasDepois: 40 }]);
  });

  it('respeita o decimal em pt-BR', () => {
    const [convertida] = linhasParaCustoEvitado([
      linha({ funcao: 'Assistente', horasAntes: '12,5', horasDepois: '2,5' }),
    ]);
    expect(convertida.horasAntes).toBe(12.5);
    expect(convertida.horasDepois).toBe(2.5);
  });

  it('descarta linha em BRANCO', () => {
    expect(linhasParaCustoEvitado([linhaHorasVazia()])).toEqual([]);
    expect(
      linhasParaCustoEvitado([
        linha({ funcao: 'Assistente', horasAntes: '160', horasDepois: '0' }),
        linhaHorasVazia(),
      ]),
    ).toEqual([{ funcao: 'Assistente', horasAntes: 160, horasDepois: 0 }]);
  });

  it('lista vazia → lista vazia', () => {
    expect(linhasParaCustoEvitado([])).toEqual([]);
  });

  it('inclui funcaoDescricao SÓ quando há texto', () => {
    const [comTexto] = linhasParaCustoEvitado([
      linha({
        funcao: FUNCAO_OUTRO,
        funcaoDescricao: 'Conferente fiscal',
        horasAntes: '20',
        horasDepois: '0',
      }),
    ]);
    expect(comTexto.funcaoDescricao).toBe('Conferente fiscal');
  });

  it('sem descrição a CHAVE nem existe — chave undefined faria a edição acusar mudança fantasma', () => {
    const [semTexto] = linhasParaCustoEvitado([
      linha({ funcao: 'Assistente', funcaoDescricao: '', horasAntes: '160', horasDepois: '0' }),
    ]);
    expect('funcaoDescricao' in semTexto).toBe(false);
    expect(Object.keys(semTexto).sort()).toEqual(['funcao', 'horasAntes', 'horasDepois']);
  });

  it('descrição só com espaço também não vira chave', () => {
    const [semTexto] = linhasParaCustoEvitado([
      linha({ funcao: 'Assistente', funcaoDescricao: '   ', horasAntes: '160', horasDepois: '0' }),
    ]);
    expect('funcaoDescricao' in semTexto).toBe(false);
  });

  it('FAIL-CLOSED: horas não parseáveis NUNCA viram NaN no resultado', () => {
    const convertidas = linhasParaCustoEvitado([
      linha({ funcao: 'Assistente', horasAntes: 'abc', horasDepois: 'xyz' }),
      linha({ funcao: 'Supervisor', horasAntes: '160', horasDepois: 'abc' }),
    ]);
    for (const c of convertidas) {
      expect(Number.isFinite(c.horasAntes)).toBe(true);
      expect(Number.isFinite(c.horasDepois)).toBe(true);
    }
  });

  it('não muta a entrada', () => {
    const entrada = [linha({ funcao: 'Assistente', horasAntes: '160', horasDepois: '0' })];
    const antes = copia(entrada);
    linhasParaCustoEvitado(entrada);
    expect(entrada).toEqual(antes);
  });
});
