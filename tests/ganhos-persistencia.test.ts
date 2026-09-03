// T6 do plano `docs/plans/godocs-v2-submissao-deterministica.md` — a PONTE entre o ganho
// declarado (o modelo da T3, `src/lib/ganhos.ts`) e as 18 colunas de `projetos` que a
// submissão v2 grava, mais o R$ derivado das horas liberadas.
//
// Duas funções, e cada uma existe por um defeito nomeado:
//
// ─── `derivarValorHorasCustoEvitado` ────────────────────────────────────────────
// A coluna `custo_evitado_horas_valor` guarda o R$ do braço das horas, SEPARADO das
// linhas que o justificam (`custo_evitado_horas_linhas`). Hoje ninguém deriva esse
// número: `paraGanhosProjeto` recebe `custoEvitado.valorHoras` já pronto (nota 4 do topo
// de `ganhos.ts`), e "já pronto" significa que cada call site faria a própria conta —
// que é a doença ("fórmula em 5 lugares") que esta frente cura.
// ⚠️ A conversão hora→R$ entra por INJEÇÃO (`valorHoraDe`), nunca por uma segunda tabela
// de valor/hora: o canônico é `resolverValorHora` (`agents/saving-calc.ts`), que carrega
// o fix do falso-zero. O teste injeta uma tabela de mentira justamente para provar que a
// função não conhece cargo nenhum.
//
// ─── `montarPatchGanhos` ────────────────────────────────────────────────────────
// O patch das colunas + os 3 `impacto_*`. Ele carrega três contratos escritos, cada um
// com o seu modo de falha:
//
//  1. **RF-218 — bloco de categoria DESMARCADA é resíduo.** Trocar de categoria no meio
//     do preenchimento deixa o bloco antigo preenchido no estado do formulário. Se ele
//     vazar para o patch, a planilha ganha um custo evitado que a pessoa desmarcou, e a
//     conta ganha um ganho que ninguém declarou.
//  2. **RF-219 — o imensurável fica FORA de toda conta**, o custo para rodar INCLUÍDO.
//     Subtrair o custo de um ganho que não existe jogaria o projeto imensurável ABAIXO
//     de um projeto sem ganho nenhum — o oposto de "não entra na conta".
//  3. **Tudo-ou-nada dos 3 `impacto_*`** (contrato em `schema.ts:862-873`): `impactoBruto`
//     não usa divisor, mas `impactoLiquidoMensal` passa pelo `divisorDe`, que LANÇA em
//     frequência desconhecida. Materializar o bruto e falhar no mensal deixa derivado
//     PARCIAL — pior que derivado nenhum, porque o relatório soma o que existe.
//
// ⚠️ Dinheiro por `toBeCloseTo`, nunca `===` (nota no topo de `src/lib/impacto.ts`: o
// peso `0,1` deixa resíduo binário em ~19% dos inteiros).
import { describe, it, expect, vi } from 'vitest';
import * as ganhos from '@/lib/ganhos';
import {
  serializarCategorias,
  serializarLinhasHoras,
  serializarCustoRodar,
  savingLiquido,
  paraGanhosProjeto,
  type CustoEvitadoLinhaHoras,
  type CustoRodarItem,
  type GanhosDeclarados,
} from '@/lib/ganhos';
import { impactoBruto, impactoLiquido, impactoLiquidoMensal } from '@/lib/impacto';

// ─── acesso à interface pedida (ainda inexistente) ──────────────────────────────
//
// Pelo NAMESPACE, e não por `import` nomeado: um `import` de export inexistente derruba
// a COLETA do arquivo inteiro e esconderia qual critério ficou de fora. Mesma convenção
// de `tests/ganhos-serial.test.ts`.
function exportado<T>(nome: string): T {
  const fn = (ganhos as unknown as Record<string, unknown>)[nome];
  if (typeof fn !== 'function') {
    throw new Error(
      `@/lib/ganhos não exporta ${nome}() — a ponte da T6 (persistência) falta.`,
    );
  }
  return fn as T;
}

type ValorHoraDe = (funcao: string) => number;

const derivarValorHorasCustoEvitado = (
  linhas: CustoEvitadoLinhaHoras[],
  valorHoraDe: ValorHoraDe,
): number =>
  exportado<(l: CustoEvitadoLinhaHoras[], v: ValorHoraDe) => number>(
    'derivarValorHorasCustoEvitado',
  )(linhas, valorHoraDe);

/** O patch: as colunas snake_case + os 3 impactos calculados por `impacto.ts`. */
type PatchGanhos = {
  colunas: Record<string, unknown>;
  impacto: { bruto: number; liquido: number; liquidoMensal: number };
};

/**
 * ⚠️ Resolvido SEPARADO da chamada de propósito: os testes de tudo-ou-nada abaixo
 * envolvem a chamada num `try/catch` (propagar o throw do `divisorDe` é desfecho
 * legítimo), e um `catch` que engolisse também o "não exporta" deixaria aqueles
 * testes VERDES com a função inexistente — vermelho falso-negativo.
 */
const resolverMontarPatch = () =>
  exportado<(g: GanhosDeclarados) => PatchGanhos>('montarPatchGanhos');

const montarPatchGanhos = (g: GanhosDeclarados): PatchGanhos => resolverMontarPatch()(g);

// ─── as 18 colunas, agrupadas como o formulário as preenche ─────────────────────
//
// ⚠️ Os nomes têm de bater com `src/integrations/db/schema.ts:798-873`. Coluna que o
// patch inventa não existe no banco e some no UPDATE; coluna que ele esquece nasce vazia.
const COLUNAS_SAVING = [
  'saving_efetivado_valor_antes',
  'saving_efetivado_valor_agora',
  'saving_efetivado_frequencia',
  'saving_efetivado_evidencia',
] as const;

const COLUNAS_CUSTO_EVITADO = [
  'custo_evitado_frequencia',
  'custo_evitado_horas_linhas',
  'custo_evitado_horas_valor',
  'custo_evitado_nao_contratado',
  'custo_evitado_racional',
] as const;

const COLUNAS_RECEITA = [
  'receita_incremental_valor',
  'receita_incremental_frequencia',
  'receita_incremental_racional',
] as const;

const COLUNAS_IMENSURAVEL = ['ganho_imensuravel_racional'] as const;

const COLUNAS_IMPACTO = [
  'impacto_bruto',
  'impacto_liquido',
  'impacto_liquido_mensal',
] as const;

const COLUNAS_PATCH = [
  'ganho_categorias',
  ...COLUNAS_SAVING,
  ...COLUNAS_CUSTO_EVITADO,
  ...COLUNAS_RECEITA,
  ...COLUNAS_IMENSURAVEL,
  'custo_rodar_itens',
  ...COLUNAS_IMPACTO,
] as const;

// ─── fixtures ───────────────────────────────────────────────────────────────────

const LINHAS: CustoEvitadoLinhaHoras[] = [
  { funcao: 'Analista Fiscal', horasAntes: 160, horasDepois: 40 },
  {
    funcao: 'Outro',
    funcaoDescricao: 'Conferência de notas de entrada',
    horasAntes: 20,
    horasDepois: 0,
  },
];

const CUSTO_RODAR: CustoRodarItem[] = [
  { nome: 'API de OCR', valor: 500, frequencia: 'mensal', oQueE: 'Leitura das notas.' },
];

/** Um bloco preenchido de cada categoria — a base das combinações abaixo. */
const BLOCOS = {
  savingEfetivado: {
    valorAntes: 20000,
    valorAgora: 5000,
    frequencia: 'mensal',
    evidencia: 'Fatura da terceirizada caiu de 20k para 5k em julho.',
  },
  custoEvitado: {
    frequencia: 'mensal',
    linhasHoras: LINHAS,
    valorHoras: 4000,
    naoContratado: 1000,
    racional: 'A vaga de conferência não foi aberta.',
  },
  receitaIncremental: {
    valor: 30000,
    frequencia: 'mensal',
    racional: 'Recuperação de carrinhos abandonados.',
  },
  imensuravel: { racional: 'Reduz o risco de multa fiscal, sem número.' },
} satisfies Omit<GanhosDeclarados, 'categorias' | 'custoRodar'>;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. derivarValorHorasCustoEvitado — o R$ do braço das horas
// ═══════════════════════════════════════════════════════════════════════════════

describe('derivarValorHorasCustoEvitado — R$ das horas liberadas', () => {
  const TABELA: Record<string, number> = {
    'Analista Fiscal': 50,
    Outro: 30,
    'Analista de Suporte': 33.333,
  };
  const valorHoraDe = (funcao: string) => TABELA[funcao] ?? 0;

  it('soma (horasAntes − horasDepois) × valor/hora de cada linha', () => {
    // (160 − 40) × 50 = 6000 · (20 − 0) × 30 = 600
    expect(derivarValorHorasCustoEvitado(LINHAS, valorHoraDe)).toBeCloseTo(6600, 2);
  });

  it('resolve o valor/hora pela FUNÇÃO de cada linha (nenhuma tabela própria aqui)', () => {
    const espiao = vi.fn(valorHoraDe);
    derivarValorHorasCustoEvitado(LINHAS, espiao);
    expect(espiao).toHaveBeenCalledWith('Analista Fiscal');
    expect(espiao).toHaveBeenCalledWith('Outro');
  });

  it('arredonda a 2 casas — a coluna guarda dinheiro, não dízima', () => {
    // 10h × 33,333 = 333,33 (e não 333.33000000000004)
    const linhas: CustoEvitadoLinhaHoras[] = [
      { funcao: 'Analista de Suporte', horasAntes: 10, horasDepois: 0 },
    ];
    expect(derivarValorHorasCustoEvitado(linhas, valorHoraDe)).toBe(333.33);
  });

  // ⚠️ A régua "depois tem de ser menor que antes" é do formulário, com mensagem no
  // campo. Aqui, na derivação, um par invertido não pode virar valor NEGATIVO — ele
  // abateria o ganho de OUTRA linha e o projeto perderia impacto que de fato existe.
  it('linha com horas invertidas vale ZERO, nunca valor negativo', () => {
    const linhas: CustoEvitadoLinhaHoras[] = [
      { funcao: 'Analista Fiscal', horasAntes: 5, horasDepois: 12 },
    ];
    expect(derivarValorHorasCustoEvitado(linhas, valorHoraDe)).toBe(0);
  });

  it('a linha invertida não abate o ganho das outras linhas', () => {
    const linhas: CustoEvitadoLinhaHoras[] = [
      { funcao: 'Analista Fiscal', horasAntes: 100, horasDepois: 0 }, // 5000
      { funcao: 'Outro', horasAntes: 2, horasDepois: 40 }, // invertida → 0
    ];
    expect(derivarValorHorasCustoEvitado(linhas, valorHoraDe)).toBeCloseTo(5000, 2);
  });

  it('lista vazia é 0 (custo evitado sem braço de horas é caso normal)', () => {
    expect(derivarValorHorasCustoEvitado([], valorHoraDe)).toBe(0);
  });

  it('linha sem ganho de horas (antes = depois) não soma nada', () => {
    const linhas: CustoEvitadoLinhaHoras[] = [
      { funcao: 'Analista Fiscal', horasAntes: 40, horasDepois: 40 },
    ];
    expect(derivarValorHorasCustoEvitado(linhas, valorHoraDe)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. montarPatchGanhos — as colunas
// ═══════════════════════════════════════════════════════════════════════════════

describe('montarPatchGanhos — o patch das colunas de `projetos`', () => {
  it('só emite colunas que existem no schema da v2 (nada inventado, nada camelCase)', () => {
    const { colunas } = montarPatchGanhos({
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      ...BLOCOS,
      custoRodar: CUSTO_RODAR,
    });
    for (const chave of Object.keys(colunas)) {
      expect(COLUNAS_PATCH).toContain(chave);
    }
  });

  it('grava a seleção com `serializarCategorias` (ordem canônica), não a ordem dos cliques', () => {
    const { colunas } = montarPatchGanhos({
      // ordem de clique INVERTIDA de propósito
      categorias: ['receita_incremental', 'saving_efetivado'],
      ...BLOCOS,
    });
    expect(colunas.ganho_categorias).toBe(
      serializarCategorias(['saving_efetivado', 'receita_incremental']),
    );
  });

  // ⚠️ RF-207/D1: o saving é a DIFERENÇA entre as duas pontas, e a diferença NÃO tem
  // coluna — guardá-la ao lado das fontes criaria um terceiro número para divergir.
  // `saving_efetivado_valor` (o valor único da v1) nasceu LEGADO e não é escrita.
  it('guarda as DUAS pontas do saving, e nenhuma coluna para a diferença', () => {
    const { colunas, impacto } = montarPatchGanhos({
      categorias: ['saving_efetivado'],
      savingEfetivado: BLOCOS.savingEfetivado,
    });
    expect(colunas.saving_efetivado_valor_antes).toBe(20000);
    expect(colunas.saving_efetivado_valor_agora).toBe(5000);
    expect(colunas.saving_efetivado_frequencia).toBe('mensal');
    expect(colunas.saving_efetivado_evidencia).toBe(BLOCOS.savingEfetivado.evidencia);
    // a coluna LEGADO do valor único não é tocada
    expect(colunas.saving_efetivado_valor).toBeUndefined();
    // e o ganho é a diferença, derivada
    expect(impacto.bruto).toBeCloseTo(savingLiquido(20000, 5000), 2);
  });

  it('a despesa que ACABOU tem `_valor_agora` = 0, e o saving é o valor inteiro', () => {
    const { colunas, impacto } = montarPatchGanhos({
      categorias: ['saving_efetivado'],
      savingEfetivado: { ...BLOCOS.savingEfetivado, valorAntes: 12000, valorAgora: 0 },
    });
    expect(colunas.saving_efetivado_valor_agora).toBe(0);
    expect(impacto.bruto).toBeCloseTo(12000, 2);
  });
});

// ─── os 3 shapes JSON: snake_case pelos serializadores que já existem ────────────
//
// ⚠️ O modo de falha é MUDO: `JSON.parse` de uma chave trocada não dá erro, devolve
// `undefined`. Um `JSON.stringify` cru do objeto TS gravaria `horasAntes`/`oQueE`, e a
// leitura (`desserializarLinhasHoras`/`desserializarCustoRodar`) DESCARTARIA a linha
// inteira — e item de custo descartado deixa de subtrair, o que INFLA o impacto.
describe('montarPatchGanhos — os 3 shapes JSON usam a serialização de `ganhos.ts`', () => {
  const completo: GanhosDeclarados = {
    categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
    ...BLOCOS,
    custoRodar: CUSTO_RODAR,
  };

  it('`ganho_categorias` = serializarCategorias', () => {
    const { colunas } = montarPatchGanhos(completo);
    expect(colunas.ganho_categorias).toBe(serializarCategorias(completo.categorias));
  });

  it('`custo_evitado_horas_linhas` = serializarLinhasHoras', () => {
    const { colunas } = montarPatchGanhos(completo);
    expect(colunas.custo_evitado_horas_linhas).toBe(serializarLinhasHoras(LINHAS));
  });

  it('`custo_rodar_itens` = serializarCustoRodar', () => {
    const { colunas } = montarPatchGanhos(completo);
    expect(colunas.custo_rodar_itens).toBe(serializarCustoRodar(CUSTO_RODAR));
  });

  it('as linhas de horas gravam snake_case (`horas_antes`/`funcao_descricao`), nunca camelCase', () => {
    const { colunas } = montarPatchGanhos(completo);
    const gravadas = JSON.parse(String(colunas.custo_evitado_horas_linhas)) as Record<
      string,
      unknown
    >[];
    expect(gravadas[0]).toHaveProperty('horas_antes', 160);
    expect(gravadas[0]).toHaveProperty('horas_depois', 40);
    expect(gravadas[0]).not.toHaveProperty('horasAntes');
    expect(gravadas[1]).toHaveProperty('funcao_descricao', LINHAS[1].funcaoDescricao);
    expect(gravadas[1]).not.toHaveProperty('funcaoDescricao');
  });

  it('os itens de custo gravam `o_que_e`, nunca `oQueE`', () => {
    const { colunas } = montarPatchGanhos(completo);
    const gravados = JSON.parse(String(colunas.custo_rodar_itens)) as Record<
      string,
      unknown
    >[];
    expect(gravados[0]).toHaveProperty('o_que_e', CUSTO_RODAR[0].oQueE);
    expect(gravados[0]).not.toHaveProperty('oQueE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. RF-218 — categoria não marcada entra como ZERO e a coluna nasce `null`
// ═══════════════════════════════════════════════════════════════════════════════

describe('montarPatchGanhos — RF-218: bloco de categoria DESMARCADA é resíduo', () => {
  // O estado real do formulário depois de a pessoa marcar tudo e desmarcar quase tudo:
  // os blocos continuam preenchidos, e SÓ `categorias` manda.
  const soSaving: GanhosDeclarados = {
    categorias: ['saving_efetivado'],
    ...BLOCOS,
    custoRodar: CUSTO_RODAR,
  };

  it.each([...COLUNAS_CUSTO_EVITADO, ...COLUNAS_RECEITA, ...COLUNAS_IMENSURAVEL])(
    'a coluna "%s" da categoria desmarcada nasce null',
    (coluna) => {
      const { colunas } = montarPatchGanhos(soSaving);
      expect(colunas[coluna]).toBeNull();
    },
  );

  it('o resíduo não entra na conta: o impacto é só o do saving marcado', () => {
    const { impacto } = montarPatchGanhos(soSaving);
    // S = 20000 − 5000 = 15000 · CE e R fora · custo para rodar 500 (perguntado a todos)
    expect(impacto.bruto).toBeCloseTo(15000, 2);
    expect(impacto.liquido).toBeCloseTo(15000 - 500, 2);
    expect(impacto.liquidoMensal).toBeCloseTo(15000 - 500, 2);
  });

  it('desmarcar o saving zera o lado dele, mesmo com o bloco preenchido', () => {
    const { colunas, impacto } = montarPatchGanhos({
      categorias: ['receita_incremental'],
      ...BLOCOS,
    });
    for (const coluna of COLUNAS_SAVING) expect(colunas[coluna]).toBeNull();
    expect(impacto.bruto).toBeCloseTo(30000, 2);
    expect(impacto.liquido).toBeCloseTo(3000, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. RF-219 — o imensurável fica FORA de toda conta
// ═══════════════════════════════════════════════════════════════════════════════

describe('montarPatchGanhos — RF-219: imensurável', () => {
  const soImensuravel: GanhosDeclarados = {
    categorias: ['imensuravel'],
    imensuravel: BLOCOS.imensuravel,
    custoRodar: CUSTO_RODAR,
  };

  it('como ÚNICA categoria, os TRÊS impactos são 0', () => {
    const { impacto } = montarPatchGanhos(soImensuravel);
    expect(impacto.bruto).toBe(0);
    expect(impacto.liquido).toBe(0);
    expect(impacto.liquidoMensal).toBe(0);
  });

  // ⚠️ O custo para rodar é perguntado a TODO MUNDO (RF-214). Subtraí-lo de um ganho que
  // não existe daria impacto NEGATIVO, jogando o imensurável abaixo de um projeto sem
  // ganho nenhum — o oposto de "não entra na conta".
  it('o custo para rodar NÃO derruba o imensurável para o negativo', () => {
    const { impacto } = montarPatchGanhos(soImensuravel);
    expect(impacto.liquido).not.toBeLessThan(0);
    expect(impacto.liquidoMensal).not.toBeLessThan(0);
  });

  it('mesmo fora da conta, o racional é gravado (é o insumo do agente)', () => {
    const { colunas } = montarPatchGanhos(soImensuravel);
    expect(colunas.ganho_imensuravel_racional).toBe(BLOCOS.imensuravel.racional);
    expect(colunas.ganho_categorias).toBe(serializarCategorias(['imensuravel']));
  });

  // Decisão do Luis (02/09/2026): as 4 combinam. Quem não entra na conta é o BLOCO sem
  // número, não o PROJETO — devolver zero aqui apagaria um saving comprovado.
  it('MISTURADO com uma categoria com número, o projeto tem impacto normal', () => {
    const { colunas, impacto } = montarPatchGanhos({
      categorias: ['saving_efetivado', 'imensuravel'],
      savingEfetivado: { ...BLOCOS.savingEfetivado, valorAntes: 10000, valorAgora: 0 },
      imensuravel: BLOCOS.imensuravel,
      custoRodar: [{ nome: 'API', valor: 1000, frequencia: 'mensal', oQueE: 'x' }],
    });
    expect(impacto.bruto).toBeCloseTo(10000, 2);
    expect(impacto.liquido).toBeCloseTo(9000, 2);
    expect(impacto.liquidoMensal).toBeCloseTo(9000, 2);
    // e as duas colunas convivem
    expect(colunas.ganho_imensuravel_racional).toBe(BLOCOS.imensuravel.racional);
    expect(colunas.saving_efetivado_valor_antes).toBe(10000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Os 3 impactos batem com `impacto.ts` — 1, 2 e 3 categorias
// ═══════════════════════════════════════════════════════════════════════════════
//
// Números LITERAIS (a conta escrita à mão a partir da D2), e não só a comparação com o
// núcleo: um teste que só compara `montarPatchGanhos` com `impacto.ts` passaria mesmo se
// os dois estivessem errados juntos.

describe('montarPatchGanhos — os 3 impactos, por número de categorias', () => {
  it('UMA categoria (custo evitado): CE = horas + não contratado, peso 0,5', () => {
    const { colunas, impacto } = montarPatchGanhos({
      categorias: ['custo_evitado'],
      custoEvitado: BLOCOS.custoEvitado,
    });
    // CE = 4000 + 1000 = 5000 · bruto 5000 · líquido 0,5 × 5000 = 2500 · mensal (÷1) 2500
    expect(impacto.bruto).toBeCloseTo(5000, 2);
    expect(impacto.liquido).toBeCloseTo(2500, 2);
    expect(impacto.liquidoMensal).toBeCloseTo(2500, 2);
    expect(colunas.custo_evitado_horas_valor).toBe(4000);
    expect(colunas.custo_evitado_nao_contratado).toBe(1000);
    expect(colunas.custo_evitado_racional).toBe(BLOCOS.custoEvitado.racional);
  });

  it('DUAS categorias (saving + receita): 1,0·S + 0,1·R', () => {
    const { impacto } = montarPatchGanhos({
      categorias: ['saving_efetivado', 'receita_incremental'],
      savingEfetivado: BLOCOS.savingEfetivado,
      receitaIncremental: BLOCOS.receitaIncremental,
    });
    // S = 15000 · R = 30000 → bruto 45000 · líquido 15000 + 3000 = 18000
    expect(impacto.bruto).toBeCloseTo(45000, 2);
    expect(impacto.liquido).toBeCloseTo(18000, 2);
    expect(impacto.liquidoMensal).toBeCloseTo(18000, 2);
  });

  it('TRÊS categorias + custo para rodar: 1,0·S + 0,5·CE + 0,1·R − C', () => {
    const { impacto } = montarPatchGanhos({
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      ...BLOCOS,
      custoRodar: CUSTO_RODAR,
    });
    // bruto   = 15000 + 5000 + 30000                   = 50000
    // líquido = 15000 + 0,5×5000 + 0,1×30000 − 500     = 20000
    expect(impacto.bruto).toBeCloseTo(50000, 2);
    expect(impacto.liquido).toBeCloseTo(20000, 2);
    expect(impacto.liquidoMensal).toBeCloseTo(20000, 2);
  });

  it('as 3 colunas `impacto_*` gravam exatamente os 3 impactos devolvidos', () => {
    const g: GanhosDeclarados = {
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      ...BLOCOS,
      custoRodar: CUSTO_RODAR,
    };
    const { colunas, impacto } = montarPatchGanhos(g);
    expect(colunas.impacto_bruto).toBe(impacto.bruto);
    expect(colunas.impacto_liquido).toBe(impacto.liquido);
    expect(colunas.impacto_liquido_mensal).toBe(impacto.liquidoMensal);
  });

  // A amarra com a FONTE ÚNICA: nenhuma conta redigitada aqui dentro — se algum dia
  // `montarPatchGanhos` fizer a própria multiplicação, este teste é quem acusa.
  it('não redigita a fórmula: bate com `impacto.ts` via `paraGanhosProjeto`', () => {
    const g: GanhosDeclarados = {
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      ...BLOCOS,
      custoRodar: CUSTO_RODAR,
    };
    const nucleo = paraGanhosProjeto(g);
    const { impacto } = montarPatchGanhos(g);
    expect(impacto.bruto).toBeCloseTo(impactoBruto(nucleo), 6);
    expect(impacto.liquido).toBeCloseTo(impactoLiquido(nucleo), 6);
    expect(impacto.liquidoMensal).toBeCloseTo(impactoLiquidoMensal(nucleo), 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Frequências DIFERENTES entre blocos — mensalização POR BLOCO
// ═══════════════════════════════════════════════════════════════════════════════

describe('montarPatchGanhos — cada bloco mensaliza pela frequência DELE', () => {
  const misto: GanhosDeclarados = {
    categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
    savingEfetivado: {
      valorAntes: 12000,
      valorAgora: 0,
      frequencia: 'trimestral',
      evidencia: 'Contrato encerrado no trimestre.',
    },
    custoEvitado: {
      frequencia: 'semestral',
      linhasHoras: [],
      valorHoras: 6000,
      naoContratado: 0,
      racional: 'Vaga não aberta.',
    },
    receitaIncremental: {
      valor: 8000,
      frequencia: 'pontual',
      racional: 'Campanha única.',
    },
    custoRodar: [{ nome: 'Setup', valor: 400, frequencia: 'pontual', oQueE: 'Instalação.' }],
  };

  it('guarda a frequência de CADA bloco, sem um divisor único de projeto', () => {
    const { colunas } = montarPatchGanhos(misto);
    expect(colunas.saving_efetivado_frequencia).toBe('trimestral');
    expect(colunas.custo_evitado_frequencia).toBe('semestral');
    expect(colunas.receita_incremental_frequencia).toBe('pontual');
  });

  it('bruto e líquido usam os valores DECLARADOS (sem mensalizar)', () => {
    const { impacto } = montarPatchGanhos(misto);
    // bruto   = 12000 + 6000 + 8000                 = 26000
    // líquido = 12000 + 0,5×6000 + 0,1×8000 − 400   = 15400
    expect(impacto.bruto).toBeCloseTo(26000, 2);
    expect(impacto.liquido).toBeCloseTo(15400, 2);
  });

  it('o MENSAL divide cada bloco pelo divisor dele (÷3 · ÷6 · ÷4), custo incluído', () => {
    const { impacto } = montarPatchGanhos(misto);
    // 1,0×(12000÷3) + 0,5×(6000÷6) + 0,1×(8000÷4) − (400÷4)
    //   = 4000 + 500 + 200 − 100 = 4600
    expect(impacto.liquidoMensal).toBeCloseTo(4600, 2);
  });

  it('o mensal NÃO é o líquido dividido por um divisor único do projeto', () => {
    const { impacto } = montarPatchGanhos(misto);
    for (const divisor of [1, 3, 4, 6]) {
      expect(Math.abs(impacto.liquidoMensal - impacto.liquido / divisor)).toBeGreaterThan(
        0.01,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Tudo-ou-nada dos 3 `impacto_*` (contrato de `schema.ts:862-873`)
// ═══════════════════════════════════════════════════════════════════════════════
//
// `impactoBruto` não usa divisor; `impactoLiquidoMensal` passa pelo `divisorDe`, que
// LANÇA em frequência desconhecida. O vocabulário das fontes reais é MAIOR que o enum
// (`'anual'`, `''`, `null`), então a frequência suja não é hipótese de laboratório.
// Derivado PARCIAL é pior que derivado nenhum: o relatório soma o que existe.

describe('montarPatchGanhos — os 3 `impacto_*` são tudo-ou-nada', () => {
  /** Frequência fora do enum, como ela chega do SQLite/planilha da v1. */
  const sujo = (frequencia: string): GanhosDeclarados =>
    ({
      categorias: ['saving_efetivado'],
      savingEfetivado: {
        valorAntes: 12000,
        valorAgora: 0,
        frequencia,
        evidencia: 'Contrato encerrado.',
      },
    }) as unknown as GanhosDeclarados;

  it.each(['anual', '', 'MENSAL', 'quinzenal'])(
    'frequência "%s" nunca produz patch com bruto preenchido e mensal ausente',
    (frequencia) => {
      const montar = resolverMontarPatch(); // existe? (fora do try — ver nota acima)
      let patch: PatchGanhos | undefined;
      try {
        patch = montar(sujo(frequencia));
      } catch {
        // Propagar o throw do `divisorDe` é o desfecho ESPERADO: nada foi materializado.
        return;
      }
      // Não lançou → então os 3 têm de estar lá, coerentes. Meio patch é o defeito.
      const completo = patch as PatchGanhos;
      const presentes = COLUNAS_IMPACTO.filter(
        (c) => completo.colunas[c] != null && Number.isFinite(completo.colunas[c] as number),
      );
      expect(presentes).toHaveLength(COLUNAS_IMPACTO.length);
      expect(Number.isFinite(completo.impacto.liquidoMensal)).toBe(true);
    },
  );

  it('frequência suja no CUSTO PARA RODAR também não deixa derivado pela metade', () => {
    const g = {
      categorias: ['saving_efetivado'],
      savingEfetivado: BLOCOS.savingEfetivado,
      custoRodar: [{ nome: 'Setup', valor: 400, frequencia: 'anual', oQueE: 'x' }],
    } as unknown as GanhosDeclarados;
    const montar = resolverMontarPatch(); // existe? (fora do try — ver nota acima)
    let patch: PatchGanhos | undefined;
    try {
      patch = montar(g);
    } catch {
      return;
    }
    const completo = patch as PatchGanhos;
    for (const coluna of COLUNAS_IMPACTO) {
      expect(completo.colunas[coluna]).toEqual(expect.any(Number));
      expect(Number.isFinite(completo.colunas[coluna] as number)).toBe(true);
    }
  });

  // O corolário do NaN, escrito no topo de `impacto.ts`: `JSON.stringify(NaN)` vira
  // `null`, então um campo de DINHEIRO chegaria nulo ao Gomoon em vez de dar erro.
  it('nenhum dos 3 impactos é NaN num projeto bem-formado', () => {
    const { impacto } = montarPatchGanhos({
      categorias: ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      ...BLOCOS,
      custoRodar: CUSTO_RODAR,
    });
    expect(Number.isFinite(impacto.bruto)).toBe(true);
    expect(Number.isFinite(impacto.liquido)).toBe(true);
    expect(Number.isFinite(impacto.liquidoMensal)).toBe(true);
  });
});
