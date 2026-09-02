// As DUAS LACUNAS de `src/lib/ganhos.ts` apontadas por dois revisores independentes.
// Arquivo SEPARADO de `tests/ganhos.test.ts` de propósito: aquele arquivo já trava 66
// comportamentos verdes e nenhum deles é tocado aqui.
//
// ─── Lacuna 1 — os 2 shapes JSON do modelo não têm serializador nem ida-e-volta ──
//
// O modelo criou 3 colunas que guardam JSON, e só UMA tem par de serialização
// (`ganho_categorias` ↔ `serializarCategorias`/`desserializarCategorias`, já testado).
// As linhas de horas do custo evitado e os itens do custo para rodar não têm par.
//
// O defeito que isso deixa em aberto é de TRADUÇÃO DE CHAVE: a coluna promete
// **snake_case** (`funcao_descricao`/`horas_antes`/`horas_depois`, `o_que_e`) e o tipo
// TS é **camelCase** (`funcaoDescricao`/`horasAntes`/`horasDepois`, `oQueE`). Sem
// serializador, quem grava faz `JSON.stringify` do objeto TS e quem lê faz
// `JSON.parse` esperando a coluna — e a chave trocada devolve **`undefined` em
// silêncio**, apagando a descrição do "Outro" (RF-211) e o "o que é" do item de custo.
// Não é erro que apareça: é um campo que some.
//
// ─── Lacuna 2 — a ponte não guarda o VALOR, só a frequência guarda a si mesma ────
//
// `impacto.ts` tem o guard FAIL-CLOSED `divisorDe`, que LANÇA em frequência
// desconhecida, com o porquê escrito no topo do arquivo: `NaN` → `JSON.stringify` →
// **`null` num campo de dinheiro** (o Gomoon receberia nulo em vez de erro), e um `NaN`
// num `reduce` de rollup **zera o total da área inteira**.
//
// A outra metade da MESMA tupla — o **valor** — atravessa `paraGanhosProjeto` sem
// checagem nenhuma. O caminho da falha é o mesmo, e do mesmo input: valor não-finito
// produz **líquido 0 e mensal NaN**. Então o valor tem de lançar igual à frequência —
// e a mensagem tem de NOMEAR o campo, senão o erro não diz qual bloco está torto.
//
// ⚠️ Os valores sujos aqui não são hipótese de laboratório: a fonte real é o SQLite
// (`number | null`) e o formulário (string pt-BR `'1.000,50'`, campo vazio, `NaN` de um
// `parseFloat('')`). É por isso que a entrada é declarada como `unknown` e injetada por
// um único cast documentado, em vez de literal bem tipado.
//
// ⚠️ Dinheiro por `toBeCloseTo`, nunca `===` (nota no topo de `src/lib/impacto.ts`).
import { describe, it, expect } from 'vitest';
import * as ganhos from '@/lib/ganhos';
import {
  paraGanhosProjeto,
  type CustoEvitadoLinhaHoras,
  type CustoRodarItem,
  type GanhosDeclarados,
} from '@/lib/ganhos';
import {
  DIVISOR_FREQUENCIA,
  impactoBruto,
  impactoLiquido,
  impactoLiquidoMensal,
  type Frequencia,
} from '@/lib/impacto';

// ─── acesso à interface pedida (ainda inexistente) ──────────────────────────────
//
// Os 4 nomes são alcançados pelo NAMESPACE do módulo, e não por `import` nomeado, para
// que a ausência de cada um apareça como a falha do teste que o exercita — um `import`
// nomeado de export inexistente derruba a coleta do arquivo inteiro e esconderia qual
// critério ficou de fora.
function exportado<T>(nome: string): T {
  const fn = (ganhos as unknown as Record<string, unknown>)[nome];
  if (typeof fn !== 'function') {
    throw new Error(`@/lib/ganhos não exporta ${nome}() — o par de serialização falta.`);
  }
  return fn as T;
}

const serializarLinhasHoras = (linhas: CustoEvitadoLinhaHoras[]): string =>
  exportado<(l: CustoEvitadoLinhaHoras[]) => string>('serializarLinhasHoras')(linhas);

const desserializarLinhasHoras = (
  bruto: string | null | undefined,
): CustoEvitadoLinhaHoras[] =>
  exportado<(b: string | null | undefined) => CustoEvitadoLinhaHoras[]>(
    'desserializarLinhasHoras',
  )(bruto);

const serializarCustoRodar = (itens: CustoRodarItem[]): string =>
  exportado<(i: CustoRodarItem[]) => string>('serializarCustoRodar')(itens);

const desserializarCustoRodar = (bruto: string | null | undefined): CustoRodarItem[] =>
  exportado<(b: string | null | undefined) => CustoRodarItem[]>('desserializarCustoRodar')(
    bruto,
  );

// ─── fixtures ───────────────────────────────────────────────────────────────────

/** Uma linha comum e a linha "Outro" da RF-211 (a única que carrega descrição). */
const LINHAS: CustoEvitadoLinhaHoras[] = [
  { funcao: 'Analista Fiscal', horasAntes: 160, horasDepois: 40 },
  {
    funcao: 'Outro',
    funcaoDescricao: 'Conferência de notas de entrada',
    horasAntes: 20,
    horasDepois: 0,
  },
];

const ITENS_CUSTO: CustoRodarItem[] = [
  { nome: 'API de OCR', valor: 600, frequencia: 'mensal', oQueE: 'Leitura das notas.' },
  { nome: 'Licença do painel', valor: 1200, frequencia: 'semestral', oQueE: 'Painel.' },
];

/** As entradas sujas que qualquer desserializador desta base tem de absorver. */
const BRUTOS_SUJOS: (string | null | undefined)[] = [
  null,
  undefined,
  '',
  '   ',
  'não é json',
  '{}',
  '[',
  'null',
  '[1,2,3]',
  '[null]',
];

const FREQUENCIAS = Object.keys(DIVISOR_FREQUENCIA) as Frequencia[];

// ════════════════════════════════════════════════════════════════════════════════
// Lacuna 1 — linhas de horas do custo evitado
// ════════════════════════════════════════════════════════════════════════════════

describe('serializarLinhasHoras / desserializarLinhasHoras — ida-e-volta', () => {
  it('a lista volta IGUAL, com a linha "Outro" e a linha sem descrição', () => {
    expect(desserializarLinhasHoras(serializarLinhasHoras(LINHAS))).toEqual(LINHAS);
  });

  it('a linha SEM descrição não volta com `funcaoDescricao: undefined` explícito', () => {
    const [semDescricao] = desserializarLinhasHoras(serializarLinhasHoras(LINHAS));
    // `toStrictEqual` (≠ `toEqual`) reprova a chave presente valendo undefined: é o que
    // faria a igualdade da edição acusar mudança onde ninguém mexeu.
    expect(semDescricao).toStrictEqual({
      funcao: 'Analista Fiscal',
      horasAntes: 160,
      horasDepois: 40,
    });
    expect('funcaoDescricao' in semDescricao).toBe(false);
  });

  it('a descrição do "Outro" (RF-211) sobrevive ao round-trip', () => {
    const linhas = desserializarLinhasHoras(serializarLinhasHoras(LINHAS));
    expect(linhas[1].funcaoDescricao).toBe('Conferência de notas de entrada');
  });

  it('horas ZERO nos dois lados atravessam (0 é valor, não ausência)', () => {
    const zeradas: CustoEvitadoLinhaHoras[] = [
      { funcao: 'Estagiário', horasAntes: 0, horasDepois: 0 },
    ];
    expect(desserializarLinhasHoras(serializarLinhasHoras(zeradas))).toEqual(zeradas);
  });

  it('lista vazia vira "[]" e volta []', () => {
    expect(serializarLinhasHoras([])).toBe('[]');
    expect(desserializarLinhasHoras('[]')).toEqual([]);
  });
});

describe('serializarLinhasHoras — a chave GRAVADA é snake_case, não camelCase', () => {
  it('as chaves da linha "Outro" são funcao · funcao_descricao · horas_antes · horas_depois', () => {
    const cru = JSON.parse(serializarLinhasHoras(LINHAS)) as Record<string, unknown>[];
    expect(Object.keys(cru[1]).sort()).toEqual(
      ['funcao', 'funcao_descricao', 'horas_antes', 'horas_depois'].sort(),
    );
  });

  it('nenhuma chave camelCase vaza para a coluna', () => {
    const cru = JSON.parse(serializarLinhasHoras(LINHAS)) as Record<string, unknown>[];
    for (const item of cru) {
      expect(item).not.toHaveProperty('funcaoDescricao');
      expect(item).not.toHaveProperty('horasAntes');
      expect(item).not.toHaveProperty('horasDepois');
    }
  });

  it('os valores vão nas chaves snake_case (não ficam nulos ao lado da chave certa)', () => {
    const cru = JSON.parse(serializarLinhasHoras(LINHAS)) as Record<string, unknown>[];
    expect(cru[0]).toStrictEqual({
      funcao: 'Analista Fiscal',
      horas_antes: 160,
      horas_depois: 40,
    });
    expect(cru[1].funcao_descricao).toBe('Conferência de notas de entrada');
  });
});

describe('desserializarLinhasHoras — lê a coluna em snake_case', () => {
  it('a linha gravada à mão em snake_case reabre com os campos camelCase preenchidos', () => {
    const daColuna =
      '[{"funcao":"Outro","funcao_descricao":"Conferência de notas","horas_antes":20,"horas_depois":5}]';
    expect(desserializarLinhasHoras(daColuna)).toEqual([
      {
        funcao: 'Outro',
        funcaoDescricao: 'Conferência de notas',
        horasAntes: 20,
        horasDepois: 5,
      },
    ]);
  });
});

describe('desserializarLinhasHoras — entrada suja nunca lança e nunca inventa', () => {
  for (const suja of BRUTOS_SUJOS) {
    it(`${JSON.stringify(suja)} devolve [] sem lançar`, () => {
      expect(() => desserializarLinhasHoras(suja)).not.toThrow();
      expect(desserializarLinhasHoras(suja)).toEqual([]);
    });
  }

  it('linha sem `funcao` é DESCARTADA e as bem-formadas sobrevivem', () => {
    const daColuna =
      '[{"funcao":"Analista","horas_antes":160,"horas_depois":40},' +
      '{"horas_antes":10,"horas_depois":0},' +
      '{"funcao":"Conferente","horas_antes":8,"horas_depois":2}]';
    expect(desserializarLinhasHoras(daColuna)).toEqual([
      { funcao: 'Analista', horasAntes: 160, horasDepois: 40 },
      { funcao: 'Conferente', horasAntes: 8, horasDepois: 2 },
    ]);
  });

  it('horas não numéricas DESCARTAM a linha (nunca entram como NaN na fórmula)', () => {
    const daColuna =
      '[{"funcao":"Texto","horas_antes":"muitas","horas_depois":0},' +
      '{"funcao":"Nulo","horas_antes":null,"horas_depois":10},' +
      '{"funcao":"Boa","horas_antes":12,"horas_depois":3}]';
    const linhas = desserializarLinhasHoras(daColuna);
    expect(linhas).toEqual([{ funcao: 'Boa', horasAntes: 12, horasDepois: 3 }]);
    for (const linha of linhas) {
      expect(Number.isFinite(linha.horasAntes)).toBe(true);
      expect(Number.isFinite(linha.horasDepois)).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Lacuna 1 — itens do custo para rodar
// ════════════════════════════════════════════════════════════════════════════════

describe('serializarCustoRodar / desserializarCustoRodar — ida-e-volta', () => {
  it('a lista volta IGUAL, com o "o que é" de cada item', () => {
    expect(desserializarCustoRodar(serializarCustoRodar(ITENS_CUSTO))).toEqual(ITENS_CUSTO);
  });

  it('nenhum campo sobra como undefined explícito', () => {
    const [primeiro] = desserializarCustoRodar(serializarCustoRodar(ITENS_CUSTO));
    expect(primeiro).toStrictEqual(ITENS_CUSTO[0]);
  });

  it('as 4 frequências atravessam o round-trip', () => {
    for (const frequencia of FREQUENCIAS) {
      const itens: CustoRodarItem[] = [{ nome: 'X', valor: 10, frequencia, oQueE: 'y' }];
      expect(desserializarCustoRodar(serializarCustoRodar(itens))).toEqual(itens);
    }
  });

  it('lista vazia vira "[]" e volta []', () => {
    expect(serializarCustoRodar([])).toBe('[]');
    expect(desserializarCustoRodar('[]')).toEqual([]);
  });
});

describe('serializarCustoRodar — a chave GRAVADA é snake_case, não camelCase', () => {
  it('as chaves do item são nome · valor · frequencia · o_que_e', () => {
    const cru = JSON.parse(serializarCustoRodar(ITENS_CUSTO)) as Record<string, unknown>[];
    expect(Object.keys(cru[0]).sort()).toEqual(
      ['nome', 'valor', 'frequencia', 'o_que_e'].sort(),
    );
  });

  it('`oQueE` não vaza para a coluna, e o texto vai na chave o_que_e', () => {
    const cru = JSON.parse(serializarCustoRodar(ITENS_CUSTO)) as Record<string, unknown>[];
    expect(cru[0]).not.toHaveProperty('oQueE');
    expect(cru[0].o_que_e).toBe('Leitura das notas.');
  });
});

describe('desserializarCustoRodar — lê a coluna em snake_case', () => {
  it('o item gravado à mão em snake_case reabre com `oQueE` preenchido', () => {
    const daColuna =
      '[{"nome":"API de OCR","valor":600,"frequencia":"mensal","o_que_e":"Leitura das notas."}]';
    expect(desserializarCustoRodar(daColuna)).toEqual([
      { nome: 'API de OCR', valor: 600, frequencia: 'mensal', oQueE: 'Leitura das notas.' },
    ]);
  });
});

describe('desserializarCustoRodar — entrada suja nunca lança e nunca inventa', () => {
  for (const suja of BRUTOS_SUJOS) {
    it(`${JSON.stringify(suja)} devolve [] sem lançar`, () => {
      expect(() => desserializarCustoRodar(suja)).not.toThrow();
      expect(desserializarCustoRodar(suja)).toEqual([]);
    });
  }

  it('frequência fora do enum das 4 DESCARTA o item (é o vocabulário maior da v1)', () => {
    // `'anual'` e `''` existem nas fontes da v1 (`custoPeriodicidade`) e são exatamente
    // o que faria `divisorDe` lançar mais tarde, longe daqui.
    const daColuna =
      '[{"nome":"OCR","valor":600,"frequencia":"mensal","o_que_e":"a"},' +
      '{"nome":"Licença","valor":1200,"frequencia":"anual","o_que_e":"b"},' +
      '{"nome":"Vazia","valor":50,"frequencia":"","o_que_e":"c"},' +
      '{"nome":"Painel","valor":80,"frequencia":"semestral","o_que_e":"d"}]';
    const itens = desserializarCustoRodar(daColuna);
    expect(itens.map((i) => i.nome)).toEqual(['OCR', 'Painel']);
    for (const item of itens) {
      expect(FREQUENCIAS).toContain(item.frequencia);
    }
  });

  it('valor não finito DESCARTA o item e os bem-formados sobrevivem', () => {
    const daColuna =
      '[{"nome":"Nulo","valor":null,"frequencia":"mensal","o_que_e":"a"},' +
      '{"nome":"Texto","valor":"1.000,50","frequencia":"mensal","o_que_e":"b"},' +
      '{"nome":"OCR","valor":600,"frequencia":"mensal","o_que_e":"c"}]';
    const itens = desserializarCustoRodar(daColuna);
    expect(itens.map((i) => i.nome)).toEqual(['OCR']);
    for (const item of itens) {
      expect(Number.isFinite(item.valor)).toBe(true);
    }
  });

  it('item sem `nome` é DESCARTADO', () => {
    const daColuna =
      '[{"valor":600,"frequencia":"mensal","o_que_e":"a"},' +
      '{"nome":"OCR","valor":600,"frequencia":"mensal","o_que_e":"b"}]';
    expect(desserializarCustoRodar(daColuna).map((i) => i.nome)).toEqual(['OCR']);
  });

  it('o que sai daqui atravessa a fórmula sem NaN (o motivo do descarte)', () => {
    const daColuna =
      '[{"nome":"Ruim","valor":null,"frequencia":"anual","o_que_e":"a"},' +
      '{"nome":"OCR","valor":600,"frequencia":"mensal","o_que_e":"b"}]';
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: {
        valor: 1000,
        frequencia: 'mensal',
        evidencia: 'Extrato sem a cobrança.',
        desde: '2026-04-01',
      },
      custoRodar: desserializarCustoRodar(daColuna),
    });
    expect(impactoLiquidoMensal(g)).toBeCloseTo(400, 6);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Lacuna 2 — a ponte guarda o VALOR (fail-closed, espelhando `divisorDe`)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Injeta um valor CRU num campo numérico do bloco.
 *
 * A fonte real desses valores é o SQLite (`number | null`) e o formulário, não um
 * literal bem tipado — daí o `unknown` e o cast ÚNICO, aqui, em vez de um
 * `@ts-expect-error` espalhado por 30 literais.
 */
function comCampoSujo<B extends object>(bloco: B, campo: keyof B, valor: unknown): B {
  return { ...bloco, [campo]: valor } as B;
}

/** Os não-finitos que chegam do banco e do formulário. */
const VALORES_SUJOS: { rotulo: string; valor: unknown }[] = [
  { rotulo: 'undefined (campo nunca preenchido)', valor: undefined },
  { rotulo: 'null (coluna vazia do SQLite)', valor: null },
  { rotulo: 'NaN (parseFloat de campo vazio)', valor: Number.NaN },
  { rotulo: 'Infinity', valor: Number.POSITIVE_INFINITY },
  { rotulo: '-Infinity', valor: Number.NEGATIVE_INFINITY },
  { rotulo: "string pt-BR '1.000,50'", valor: '1.000,50' },
];

const SAVING_OK = {
  valor: 12000,
  frequencia: 'mensal' as Frequencia,
  evidencia: 'Contrato encerrado; extrato de abril e maio sem a cobrança.',
  desde: '2026-04-01',
};

const CE_OK = {
  frequencia: 'trimestral' as Frequencia,
  linhasHoras: LINHAS,
  valorHoras: 8000,
  naoContratado: 2000,
  racional: 'Não foi preciso contratar a terceirizada.',
};

const RECEITA_OK = {
  valor: 51000,
  frequencia: 'pontual' as Frequencia,
  racional: 'Campanha que só existe porque o robô monta a base.',
  tipo: 'venda incremental',
};

const ITEM_CUSTO_OK: CustoRodarItem = {
  nome: 'API de OCR',
  valor: 600,
  frequencia: 'mensal',
  oQueE: 'Leitura das notas.',
};

/**
 * Os 5 números que atravessam a ponte, cada um com o pedaço do nome que o erro tem de
 * citar para dizer QUAL bloco está torto.
 */
const CAMPOS_DE_VALOR: {
  campo: string;
  nomeNoErro: RegExp;
  montar: (valor: unknown) => GanhosDeclarados;
}[] = [
  {
    campo: 'savingEfetivado.valor',
    nomeNoErro: /saving/i,
    montar: (valor) => ({
      categorias: ['saving_efetivado'],
      savingEfetivado: comCampoSujo(SAVING_OK, 'valor', valor),
    }),
  },
  {
    campo: 'custoEvitado.valorHoras',
    nomeNoErro: /horas/i,
    montar: (valor) => ({
      categorias: ['custo_evitado'],
      custoEvitado: comCampoSujo(CE_OK, 'valorHoras', valor),
    }),
  },
  {
    campo: 'custoEvitado.naoContratado',
    nomeNoErro: /contratad/i,
    montar: (valor) => ({
      categorias: ['custo_evitado'],
      custoEvitado: comCampoSujo(CE_OK, 'naoContratado', valor),
    }),
  },
  {
    campo: 'receitaIncremental.valor',
    nomeNoErro: /receita/i,
    montar: (valor) => ({
      categorias: ['receita_incremental'],
      receitaIncremental: comCampoSujo(RECEITA_OK, 'valor', valor),
    }),
  },
  {
    campo: 'custoRodar[].valor',
    nomeNoErro: /rodar/i,
    montar: (valor) => ({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING_OK,
      custoRodar: [ITEM_CUSTO_OK, comCampoSujo(ITEM_CUSTO_OK, 'valor', valor)],
    }),
  },
];

describe('paraGanhosProjeto — valor não finito LANÇA (fail-closed, como divisorDe)', () => {
  for (const { campo, montar } of CAMPOS_DE_VALOR) {
    for (const { rotulo, valor } of VALORES_SUJOS) {
      it(`${campo} = ${rotulo} → lança`, () => {
        expect(() => paraGanhosProjeto(montar(valor))).toThrow();
      });
    }
  }

  it('o mesmo input NÃO produz "líquido 0 e mensal NaN" (o sintoma medido)', () => {
    // O caminho da falha silenciosa que este guard fecha: `NaN` → `JSON.stringify` →
    // `null` num campo de dinheiro, e `NaN` num `reduce` de rollup zera a área.
    expect(() =>
      paraGanhosProjeto({
        categorias: ['saving_efetivado'],
        savingEfetivado: comCampoSujo(SAVING_OK, 'valor', undefined),
      }),
    ).toThrow();
  });
});

describe('paraGanhosProjeto — a mensagem do erro NOMEIA o campo', () => {
  for (const { campo, nomeNoErro, montar } of CAMPOS_DE_VALOR) {
    it(`${campo} aparece na mensagem`, () => {
      expect(() => paraGanhosProjeto(montar(null))).toThrow(nomeNoErro);
    });

    it(`${campo} lança um Error de verdade (não uma string)`, () => {
      expect(() => paraGanhosProjeto(montar(Number.NaN))).toThrow(Error);
    });
  }
});

describe('paraGanhosProjeto — ZERO é valor legítimo e NÃO lança', () => {
  for (const { campo, montar } of CAMPOS_DE_VALOR) {
    it(`${campo} = 0 atravessa`, () => {
      expect(() => paraGanhosProjeto(montar(0))).not.toThrow();
    });
  }

  it('um braço do custo evitado zerado segue somando só o outro', () => {
    const g = paraGanhosProjeto({
      categorias: ['custo_evitado'],
      custoEvitado: comCampoSujo(CE_OK, 'naoContratado', 0),
    });
    expect(impactoBruto(g)).toBeCloseTo(8000, 6);
  });
});

describe('paraGanhosProjeto — valor NEGATIVO não lança (o clamp é de impacto.ts)', () => {
  for (const { campo, montar } of CAMPOS_DE_VALOR) {
    it(`${campo} = -500 atravessa a ponte`, () => {
      expect(() => paraGanhosProjeto(montar(-500))).not.toThrow();
    });
  }

  it('o custo negativo continua clampado em 0 pela fórmula, não pela ponte', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING_OK,
      custoRodar: [comCampoSujo(ITEM_CUSTO_OK, 'valor', -500)],
    });
    expect(impactoLiquido(g)).toBeCloseTo(12000, 6);
  });
});

describe('paraGanhosProjeto — quem manda é a SELEÇÃO, não o resíduo do bloco', () => {
  it('bloco de categoria NÃO marcada com valor sujo NÃO lança (RF-218)', () => {
    // Trocar de categoria no meio do preenchimento deixa o bloco antigo no estado; ele
    // não pode derrubar a submissão de quem já mudou de ideia.
    const declarado: GanhosDeclarados = {
      categorias: ['receita_incremental'],
      receitaIncremental: RECEITA_OK,
      savingEfetivado: comCampoSujo(SAVING_OK, 'valor', undefined),
      custoEvitado: comCampoSujo(CE_OK, 'valorHoras', Number.NaN),
    };
    expect(() => paraGanhosProjeto(declarado)).not.toThrow();
    const g = paraGanhosProjeto(declarado);
    expect(g.savingEfetivado).toBeUndefined();
    expect(g.custoEvitado).toBeUndefined();
    expect(impactoBruto(g)).toBeCloseTo(51000, 6);
  });

  it('imensurável com bloco financeiro sujo sobrando: ZERO, sem lançar (RF-219)', () => {
    const declarado: GanhosDeclarados = {
      categorias: ['imensuravel'],
      imensuravel: { racional: 'Tira o risco de erro manual, sem número que dê para medir.' },
      savingEfetivado: comCampoSujo(SAVING_OK, 'valor', null),
      receitaIncremental: comCampoSujo(RECEITA_OK, 'valor', '1.000,50'),
      custoRodar: [comCampoSujo(ITEM_CUSTO_OK, 'valor', Number.NaN)],
    };
    expect(() => paraGanhosProjeto(declarado)).not.toThrow();
    const g = paraGanhosProjeto(declarado);
    expect(impactoBruto(g)).toBeCloseTo(0, 6);
    expect(impactoLiquido(g)).toBeCloseTo(0, 6);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(0, 6);
  });
});
