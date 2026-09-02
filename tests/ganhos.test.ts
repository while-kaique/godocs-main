// As 4 CATEGORIAS DE GANHO da v2 (T3 do plano `docs/plans/godocs-v2-submissao-deterministica.md`)
// × a fórmula única da T2 (`src/lib/impacto.ts`).
//
// `src/lib/ganhos.ts` é o modelo declarado pelo formulário (o que a pessoa marca e digita) e a
// PONTE até o núcleo do impacto. Todo o risco mora em quatro pontos:
//
// 1. **RF-202 — exclusividade.** Saving efetivado, custo evitado e receita incremental combinam
//    livremente; ganho imensurável é EXCLUSIVO (marcá-lo desmarca os outros 3, e vice-versa).
//    Sem isso, um projeto entra com número E sem número ao mesmo tempo, e a estrela do
//    imensurável passa a conviver com R$ — os dois significados que a v2 separou.
// 2. **Ordem canônica.** A seleção e a string gravada seguem a ordem de `GANHO_CATEGORIAS`,
//    NUNCA a ordem dos cliques: o `metaChanged` do wizard compara o que foi gravado, e ordem
//    por clique faz a MESMA escolha parecer mudança (razão já registrada na v1, em
//    `serializarFerramentas`).
// 3. **Ida-e-volta.** O que a pessoa marcou tem de reabrir IGUAL na edição. Categoria perdida no
//    round-trip apaga um bloco inteiro de ganho em silêncio.
// 4. **RF-218 / RF-219.** Bloco não marcado entra como ZERO na fórmula, e o ganho imensurável
//    fica FORA das três contas.
//
// ⚠️ A fonte única da frequência/divisor e dos pesos é `@/lib/impacto`. Por isso os esperados
// deste arquivo são MONTADOS de `DIVISOR_FREQUENCIA`/`PESO_*` importados de lá, e não de números
// redigitados aqui: um divisor copiado dentro de `ganhos.ts` passaria por um teste com literais.
//
// ⚠️ Dinheiro se compara por epsilon (`toBeCloseTo`), nunca por `===` — `PESO_RECEITA = 0.1`
// deixa resíduo de ponto flutuante (nota explícita no topo de `src/lib/impacto.ts`).
import { describe, it, expect } from 'vitest';
import {
  GANHO_CATEGORIAS,
  CATEGORIA_IMENSURAVEL,
  CATEGORIAS_MENSURAVEIS,
  categoriasValidas,
  alternarCategoria,
  serializarCategorias,
  desserializarCategorias,
  paraGanhosProjeto,
  type GanhoCategoria,
  type GanhosDeclarados,
} from '@/lib/ganhos';
import {
  DIVISOR_FREQUENCIA,
  PESO_SAVING,
  PESO_CUSTO_EVITADO,
  PESO_RECEITA,
  impactoBruto,
  impactoLiquido,
  impactoLiquidoMensal,
  type Frequencia,
} from '@/lib/impacto';

// ─── fixtures: blocos preenchidos, do jeito que o formulário entrega ────────────

const SAVING = {
  valor: 12000,
  frequencia: 'mensal' as Frequencia,
  evidencia: 'Contrato encerrado; extrato de abril e maio sem a cobrança.',
  desde: '2026-04-01',
};

const CUSTO_EVITADO = {
  frequencia: 'trimestral' as Frequencia,
  linhasHoras: [
    { funcao: 'Analista Fiscal', horasAntes: 160, horasDepois: 40 },
    { funcao: 'Outro', funcaoDescricao: 'Conferência de notas', horasAntes: 20, horasDepois: 0 },
  ],
  valorHoras: 8000,
  naoContratado: 2000,
  racional: 'Não foi preciso contratar a terceirizada que faria a conferência.',
};

const RECEITA = {
  valor: 51000,
  frequencia: 'pontual' as Frequencia,
  racional: 'Campanha que só existe porque o robô monta a base.',
  tipo: 'venda incremental',
};

const IMENSURAVEL = {
  racional: 'Tira o risco de erro manual no cadastro, sem número que dê para medir hoje.',
};

const CUSTO_RODAR = [
  { nome: 'API de OCR', valor: 600, frequencia: 'mensal' as Frequencia, oQueE: 'Leitura das notas.' },
  { nome: 'Licença anualizada', valor: 1200, frequencia: 'semestral' as Frequencia, oQueE: 'Painel.' },
];

/** As 8 combinações válidas: as 3 mensuráveis em qualquer arranjo + o imensurável sozinho. */
const COMBINACOES_VALIDAS: GanhoCategoria[][] = [
  ['saving_efetivado'],
  ['custo_evitado'],
  ['receita_incremental'],
  ['saving_efetivado', 'custo_evitado'],
  ['saving_efetivado', 'receita_incremental'],
  ['custo_evitado', 'receita_incremental'],
  ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
  ['imensuravel'],
];

// ─── as constantes: quem são as 4 categorias ────────────────────────────────────

describe('GANHO_CATEGORIAS — as 4 categorias da v2, e nenhuma a mais', () => {
  it('são exatamente saving efetivado · custo evitado · receita incremental · imensurável', () => {
    expect([...GANHO_CATEGORIAS]).toEqual([
      'saving_efetivado',
      'custo_evitado',
      'receita_incremental',
      'imensuravel',
    ]);
  });

  it('o imensurável é nomeado por constante (o código não redigita a literal)', () => {
    expect(CATEGORIA_IMENSURAVEL).toBe('imensuravel');
    expect(GANHO_CATEGORIAS).toContain(CATEGORIA_IMENSURAVEL);
  });

  it('as mensuráveis são as OUTRAS três, e o imensurável não está entre elas', () => {
    expect([...CATEGORIAS_MENSURAVEIS]).toEqual([
      'saving_efetivado',
      'custo_evitado',
      'receita_incremental',
    ]);
    expect(CATEGORIAS_MENSURAVEIS).not.toContain(CATEGORIA_IMENSURAVEL);
  });

  it('mensuráveis + imensurável cobrem GANHO_CATEGORIAS (nenhuma categoria órfã)', () => {
    expect([...CATEGORIAS_MENSURAVEIS, CATEGORIA_IMENSURAVEL].sort()).toEqual(
      [...GANHO_CATEGORIAS].sort(),
    );
  });
});

// ─── RF-202: a régua da seleção ─────────────────────────────────────────────────

describe('categoriasValidas — RF-202 (imensurável XOR o resto) + "ao menos uma"', () => {
  it('lista VAZIA é inválida: todo projeto declara ao menos um ganho', () => {
    expect(categoriasValidas([])).toBe(false);
  });

  it('cada mensurável sozinha é válida', () => {
    for (const c of CATEGORIAS_MENSURAVEIS) {
      expect(categoriasValidas([c])).toBe(true);
    }
  });

  it('as 3 mensuráveis combinam livremente (1, 2 ou 3)', () => {
    expect(categoriasValidas(['saving_efetivado', 'custo_evitado'])).toBe(true);
    expect(categoriasValidas(['saving_efetivado', 'receita_incremental'])).toBe(true);
    expect(categoriasValidas(['custo_evitado', 'receita_incremental'])).toBe(true);
    expect(
      categoriasValidas(['saving_efetivado', 'custo_evitado', 'receita_incremental']),
    ).toBe(true);
  });

  it('o imensurável SOZINHO é válido', () => {
    expect(categoriasValidas(['imensuravel'])).toBe(true);
  });

  // O caso que a régua existe para recusar: número e "não tem número" no mesmo projeto.
  it('imensurável misturado com QUALQUER mensurável é inválido', () => {
    for (const c of CATEGORIAS_MENSURAVEIS) {
      expect(categoriasValidas([CATEGORIA_IMENSURAVEL, c])).toBe(false);
      expect(categoriasValidas([c, CATEGORIA_IMENSURAVEL])).toBe(false);
    }
    expect(categoriasValidas([...CATEGORIAS_MENSURAVEIS, CATEGORIA_IMENSURAVEL])).toBe(false);
  });

  it('todas as 8 combinações válidas passam', () => {
    for (const combo of COMBINACOES_VALIDAS) {
      expect(categoriasValidas(combo)).toBe(true);
    }
  });
});

describe('alternarCategoria — o clique no checkbox, com a exclusividade nos DOIS sentidos', () => {
  it('marcar a primeira categoria devolve uma seleção de 1', () => {
    expect(alternarCategoria([], 'saving_efetivado')).toEqual(['saving_efetivado']);
  });

  it('marcar imensurável DESMARCA as outras três', () => {
    const cheio: GanhoCategoria[] = [
      'saving_efetivado',
      'custo_evitado',
      'receita_incremental',
    ];
    expect(alternarCategoria(cheio, CATEGORIA_IMENSURAVEL)).toEqual([CATEGORIA_IMENSURAVEL]);
  });

  it('marcar qualquer mensurável DESMARCA o imensurável', () => {
    for (const c of CATEGORIAS_MENSURAVEIS) {
      expect(alternarCategoria([CATEGORIA_IMENSURAVEL], c)).toEqual([c]);
    }
  });

  it('o resultado de qualquer clique é sempre uma seleção VÁLIDA (a régua não é só do submit)', () => {
    const partidas: GanhoCategoria[][] = [
      [],
      ['imensuravel'],
      ['saving_efetivado'],
      ['saving_efetivado', 'receita_incremental'],
      ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
    ];
    for (const partida of partidas) {
      for (const alvo of GANHO_CATEGORIAS) {
        const depois = alternarCategoria(partida, alvo);
        // a única saída inválida aceitável é o vazio (desmarcar a última), que o submit barra
        if (depois.length > 0) {
          expect(categoriasValidas(depois)).toBe(true);
        }
      }
    }
  });

  it('clicar de novo numa já marcada DESMARCA (é toggle, não "marcar")', () => {
    expect(alternarCategoria(['saving_efetivado', 'custo_evitado'], 'custo_evitado')).toEqual([
      'saving_efetivado',
    ]);
    expect(alternarCategoria(['imensuravel'], 'imensuravel')).toEqual([]);
    expect(alternarCategoria(['saving_efetivado'], 'saving_efetivado')).toEqual([]);
  });

  it('nunca devolve duplicata, mesmo com a mesma categoria repetida na entrada', () => {
    const r = alternarCategoria(
      ['saving_efetivado', 'saving_efetivado'] as GanhoCategoria[],
      'custo_evitado',
    );
    expect(new Set(r).size).toBe(r.length);
    const r2 = alternarCategoria(['custo_evitado'], 'custo_evitado');
    expect(new Set(r2).size).toBe(r2.length);
  });

  // Ordem por clique faz o `metaChanged` do wizard acusar mudança fantasma (razão da v1).
  it('a seleção sai na ordem CANÔNICA, não na ordem dos cliques', () => {
    let sel: GanhoCategoria[] = [];
    sel = alternarCategoria(sel, 'receita_incremental');
    sel = alternarCategoria(sel, 'saving_efetivado');
    sel = alternarCategoria(sel, 'custo_evitado');
    expect(sel).toEqual(['saving_efetivado', 'custo_evitado', 'receita_incremental']);
  });

  it('não muta a lista recebida', () => {
    const atuais: GanhoCategoria[] = ['saving_efetivado'];
    alternarCategoria(atuais, 'receita_incremental');
    expect(atuais).toEqual(['saving_efetivado']);
  });
});

// ─── serialização: o que vai para a coluna e o que a edição reabre ──────────────

describe('serializarCategorias — a string gravada', () => {
  it('é um JSON array das categorias', () => {
    expect(JSON.parse(serializarCategorias(['saving_efetivado', 'custo_evitado']))).toEqual([
      'saving_efetivado',
      'custo_evitado',
    ]);
  });

  it('seleção vazia vira um JSON array vazio (nunca "null" nem lixo)', () => {
    expect(JSON.parse(serializarCategorias([]))).toEqual([]);
  });

  it('a ordem é a canônica: marcar em ordem diferente grava a MESMA string', () => {
    const a = serializarCategorias(['receita_incremental', 'saving_efetivado', 'custo_evitado']);
    const b = serializarCategorias(['saving_efetivado', 'custo_evitado', 'receita_incremental']);
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual(['saving_efetivado', 'custo_evitado', 'receita_incremental']);
  });
});

describe('ida-e-volta: marcar → gravar → reabrir devolve a MESMA escolha', () => {
  for (const combo of COMBINACOES_VALIDAS) {
    it(`[${combo.join(', ')}]`, () => {
      expect(desserializarCategorias(serializarCategorias(combo))).toEqual(combo);
    });
  }

  it('marcar em ordem qualquer reabre na ordem canônica, com o mesmo conjunto', () => {
    const gravado = serializarCategorias([
      'receita_incremental',
      'custo_evitado',
      'saving_efetivado',
    ]);
    expect(desserializarCategorias(gravado)).toEqual([
      'saving_efetivado',
      'custo_evitado',
      'receita_incremental',
    ]);
  });

  it('string fora de ordem (gravação anterior, edição manual) também reabre canônica', () => {
    expect(desserializarCategorias('["receita_incremental","saving_efetivado"]')).toEqual([
      'saving_efetivado',
      'receita_incremental',
    ]);
  });
});

describe('desserializarCategorias — entrada suja nunca lança e nunca inventa categoria', () => {
  const sujas: (string | null | undefined)[] = [
    null,
    undefined,
    '',
    '   ',
    'saving_efetivado',
    'não é json',
    '{}',
    '[',
    '[1,2,3]',
    'null',
    '[null]',
    '["INVENTO"]',
  ];

  for (const suja of sujas) {
    it(`${JSON.stringify(suja)} devolve [] sem lançar`, () => {
      expect(() => desserializarCategorias(suja)).not.toThrow();
      expect(desserializarCategorias(suja)).toEqual([]);
    });
  }

  it('categoria desconhecida no meio da string é DESCARTADA, e as conhecidas sobrevivem', () => {
    expect(
      desserializarCategorias('["saving_efetivado","ganho_moral","receita_incremental"]'),
    ).toEqual(['saving_efetivado', 'receita_incremental']);
  });
});

// ─── a ponte com a fórmula da T2 ────────────────────────────────────────────────

describe('paraGanhosProjeto — RF-218: bloco NÃO marcado entra como ZERO', () => {
  it('só saving marcado: não produz custo evitado nem receita', () => {
    const g = paraGanhosProjeto({ categorias: ['saving_efetivado'], savingEfetivado: SAVING });
    expect(g.custoEvitado).toBeUndefined();
    expect(g.receita).toBeUndefined();
  });

  it('só saving marcado: o impacto bate com o do bloco ISOLADO', () => {
    const g = paraGanhosProjeto({ categorias: ['saving_efetivado'], savingEfetivado: SAVING });
    const isolado = { savingEfetivado: { valor: SAVING.valor, frequencia: SAVING.frequencia } };
    expect(impactoBruto(g)).toBeCloseTo(impactoBruto(isolado), 6);
    expect(impactoLiquido(g)).toBeCloseTo(impactoLiquido(isolado), 6);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(impactoLiquidoMensal(isolado), 6);
    expect(impactoLiquido(g)).toBeCloseTo(PESO_SAVING * SAVING.valor, 6);
  });

  // Quem manda é a SELEÇÃO. Trocar de categoria no meio do formulário deixa o bloco antigo
  // preenchido no estado; ele não pode voltar à conta pelas costas.
  it('bloco preenchido de categoria NÃO marcada é ignorado', () => {
    const comSobra: GanhosDeclarados = {
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING,
      custoEvitado: CUSTO_EVITADO,
      receitaIncremental: RECEITA,
    };
    const soSaving = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING,
    });
    expect(impactoLiquido(paraGanhosProjeto(comSobra))).toBeCloseTo(impactoLiquido(soSaving), 6);
    expect(impactoLiquidoMensal(paraGanhosProjeto(comSobra))).toBeCloseTo(
      impactoLiquidoMensal(soSaving),
      6,
    );
  });

  it('as 3 mensuráveis marcadas somam com os pesos da fonte única', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      savingEfetivado: SAVING,
      custoEvitado: CUSTO_EVITADO,
      receitaIncremental: RECEITA,
    });
    const esperado =
      PESO_SAVING * SAVING.valor +
      PESO_CUSTO_EVITADO * (CUSTO_EVITADO.valorHoras + CUSTO_EVITADO.naoContratado) +
      PESO_RECEITA * RECEITA.valor;
    expect(impactoLiquido(g)).toBeCloseTo(esperado, 6);
  });
});

describe('paraGanhosProjeto — RF-219: imensurável fica FORA de toda conta', () => {
  it('imensurável com racional preenchido dá ZERO nas 3 contas', () => {
    const g = paraGanhosProjeto({ categorias: ['imensuravel'], imensuravel: IMENSURAVEL });
    expect(impactoBruto(g)).toBeCloseTo(0, 8);
    expect(impactoLiquido(g)).toBeCloseTo(0, 8);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(0, 8);
  });

  // Quem marcou imensurável não tem número: qualquer bloco financeiro sobrando no estado é
  // resíduo da seleção anterior (RF-202 garante que os dois não coexistem).
  it('imensurável com bloco financeiro sobrando no estado ainda dá ZERO', () => {
    const g = paraGanhosProjeto({
      categorias: ['imensuravel'],
      imensuravel: IMENSURAVEL,
      savingEfetivado: SAVING,
      custoEvitado: CUSTO_EVITADO,
      receitaIncremental: RECEITA,
    });
    expect(impactoBruto(g)).toBeCloseTo(0, 8);
    expect(impactoLiquido(g)).toBeCloseTo(0, 8);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(0, 8);
  });
});

describe('paraGanhosProjeto — custo evitado: os DOIS braços somam antes do peso', () => {
  it('CE = valorHoras + naoContratado, com a frequência do BLOCO', () => {
    const g = paraGanhosProjeto({ categorias: ['custo_evitado'], custoEvitado: CUSTO_EVITADO });
    const soma = CUSTO_EVITADO.valorHoras + CUSTO_EVITADO.naoContratado;
    expect(impactoBruto(g)).toBeCloseTo(soma, 6);
    expect(impactoLiquido(g)).toBeCloseTo(PESO_CUSTO_EVITADO * soma, 6);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(
      (PESO_CUSTO_EVITADO * soma) / DIVISOR_FREQUENCIA[CUSTO_EVITADO.frequencia],
      6,
    );
  });

  it('a divisão entre os braços não altera o resultado (só a soma importa)', () => {
    const base = { ...CUSTO_EVITADO, frequencia: 'mensal' as Frequencia };
    const soHoras = paraGanhosProjeto({
      categorias: ['custo_evitado'],
      custoEvitado: { ...base, valorHoras: 10000, naoContratado: 0 },
    });
    const soNaoContratado = paraGanhosProjeto({
      categorias: ['custo_evitado'],
      custoEvitado: { ...base, valorHoras: 0, naoContratado: 10000 },
    });
    const meioAMeio = paraGanhosProjeto({
      categorias: ['custo_evitado'],
      custoEvitado: { ...base, valorHoras: 5000, naoContratado: 5000 },
    });
    expect(impactoLiquido(soHoras)).toBeCloseTo(impactoLiquido(meioAMeio), 6);
    expect(impactoLiquido(soNaoContratado)).toBeCloseTo(impactoLiquido(meioAMeio), 6);
    expect(impactoLiquidoMensal(soHoras)).toBeCloseTo(impactoLiquidoMensal(meioAMeio), 6);
  });

  it('um braço zerado não anula o outro', () => {
    const g = paraGanhosProjeto({
      categorias: ['custo_evitado'],
      custoEvitado: { ...CUSTO_EVITADO, valorHoras: 0, naoContratado: 2400 },
    });
    expect(impactoBruto(g)).toBeCloseTo(2400, 6);
    expect(impactoLiquido(g)).toBeCloseTo(PESO_CUSTO_EVITADO * 2400, 6);
  });
});

describe('paraGanhosProjeto — frequências MISTAS: cada bloco pela frequência DELE', () => {
  it('saving mensal + receita pontual: não existe divisor único do projeto', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado', 'receita_incremental'],
      savingEfetivado: { ...SAVING, valor: 3000, frequencia: 'mensal' },
      receitaIncremental: { ...RECEITA, valor: 40000, frequencia: 'pontual' },
    });
    const esperado =
      (PESO_SAVING * 3000) / DIVISOR_FREQUENCIA.mensal +
      (PESO_RECEITA * 40000) / DIVISOR_FREQUENCIA.pontual;
    expect(impactoLiquidoMensal(g)).toBeCloseTo(esperado, 6);
    // um divisor único para o projeto daria outra coisa — e é o erro a evitar
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(3000 + 0.1 * 40000, 6);
  });

  it('as 3 mensuráveis em 3 frequências diferentes', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      savingEfetivado: SAVING, // mensal
      custoEvitado: CUSTO_EVITADO, // trimestral
      receitaIncremental: RECEITA, // pontual
    });
    const esperado =
      (PESO_SAVING * SAVING.valor) / DIVISOR_FREQUENCIA[SAVING.frequencia] +
      (PESO_CUSTO_EVITADO * (CUSTO_EVITADO.valorHoras + CUSTO_EVITADO.naoContratado)) /
        DIVISOR_FREQUENCIA[CUSTO_EVITADO.frequencia] +
      (PESO_RECEITA * RECEITA.valor) / DIVISOR_FREQUENCIA[RECEITA.frequencia];
    expect(impactoLiquidoMensal(g)).toBeCloseTo(esperado, 6);
  });
});

describe('paraGanhosProjeto — custoRodar é LISTA, cada item na frequência dele', () => {
  it('a lista inteira é mapeada (nenhum item se perde)', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING,
      custoRodar: CUSTO_RODAR,
    });
    const somaCrua = CUSTO_RODAR.reduce((t, i) => t + i.valor, 0);
    expect(impactoLiquido(g)).toBeCloseTo(PESO_SAVING * SAVING.valor - somaCrua, 6);
  });

  it('no mensal, cada item mensaliza pela frequência DELE', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING,
      custoRodar: CUSTO_RODAR,
    });
    const custoMensal = CUSTO_RODAR.reduce(
      (t, i) => t + i.valor / DIVISOR_FREQUENCIA[i.frequencia],
      0,
    );
    const esperado =
      (PESO_SAVING * SAVING.valor) / DIVISOR_FREQUENCIA[SAVING.frequencia] - custoMensal;
    expect(impactoLiquidoMensal(g)).toBeCloseTo(esperado, 6);
    // e NÃO uma soma crua mensalizada por um divisor único
    const somaCrua = CUSTO_RODAR.reduce((t, i) => t + i.valor, 0);
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(SAVING.valor - somaCrua, 6);
  });

  it('lista ausente e lista vazia dão o mesmo resultado (custo 0)', () => {
    const semLista = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING,
    });
    const listaVazia = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: SAVING,
      custoRodar: [],
    });
    expect(impactoLiquido(listaVazia)).toBeCloseTo(impactoLiquido(semLista), 6);
    expect(impactoLiquidoMensal(listaVazia)).toBeCloseTo(impactoLiquidoMensal(semLista), 6);
  });
});

describe('a amarra da fonte única: a frequência/divisor vem de @/lib/impacto', () => {
  // Uma cópia do divisor dentro de `ganhos.ts` (ou um `?? 1`) passaria por um teste com
  // literais. Aqui as 4 frequências são varridas a partir das CHAVES de DIVISOR_FREQUENCIA.
  const frequencias = Object.keys(DIVISOR_FREQUENCIA) as Frequencia[];

  for (const f of frequencias) {
    it(`saving em "${f}" mensaliza por DIVISOR_FREQUENCIA.${f}`, () => {
      const g = paraGanhosProjeto({
        categorias: ['saving_efetivado'],
        savingEfetivado: { ...SAVING, valor: 12000, frequencia: f },
      });
      expect(impactoLiquidoMensal(g)).toBeCloseTo(
        (PESO_SAVING * 12000) / DIVISOR_FREQUENCIA[f],
        6,
      );
    });
  }

  it('PONTUAL segue a régua da v2 (divisor de DIVISOR_FREQUENCIA, não valor cheio)', () => {
    const g = paraGanhosProjeto({
      categorias: ['saving_efetivado'],
      savingEfetivado: { ...SAVING, valor: 4000, frequencia: 'pontual' },
    });
    expect(impactoLiquidoMensal(g)).toBeCloseTo(4000 / DIVISOR_FREQUENCIA.pontual, 6);
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(4000, 6);
  });

  it('as 4 frequências atravessam a ponte sem lançar', () => {
    for (const f of frequencias) {
      expect(() =>
        paraGanhosProjeto({
          categorias: ['custo_evitado'],
          custoEvitado: { ...CUSTO_EVITADO, frequencia: f },
        }),
      ).not.toThrow();
    }
  });
});

describe('paraGanhosProjeto — pureza (não muta o que o formulário entregou)', () => {
  it('o objeto declarado sai igual ao que entrou', () => {
    const declarado: GanhosDeclarados = {
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      savingEfetivado: SAVING,
      custoEvitado: CUSTO_EVITADO,
      receitaIncremental: RECEITA,
      custoRodar: CUSTO_RODAR,
    };
    const antes = JSON.parse(JSON.stringify(declarado));
    paraGanhosProjeto(declarado);
    expect(declarado).toEqual(antes);
  });

  it('chamadas repetidas devolvem o mesmo impacto', () => {
    const declarado: GanhosDeclarados = {
      categorias: ['receita_incremental'],
      receitaIncremental: RECEITA,
    };
    expect(impactoLiquidoMensal(paraGanhosProjeto(declarado))).toBeCloseTo(
      impactoLiquidoMensal(paraGanhosProjeto(declarado)),
      8,
    );
  });
});
