// Núcleo do IMPACTO do GoDocs v2 — módulo PURO, FONTE ÚNICA da fórmula.
//
// Decisão D2 do plano `docs/plans/godocs-v2-submissao-deterministica.md`:
//
//   CE = CE_horas + CE_naocontratado                (os dois braços do custo evitado)
//
//   Impacto Bruto           =     S  +     CE  +     R
//   Impacto Líquido         = 1,0·S  + 0,5·CE  + 0,1·R  − C
//   Impacto Líquido Mensal  = 1,0·m(S) + 0,5·m(CE) + 0,1·m(R) − m(C)
//
//   m(x) = x ÷ { pontual 4 · mensal 1 · trimestral 3 · semestral 6 }
//
// Por que existe: na v1 a fórmula do ganho está REPLICADA em 5 lugares
// (`chat.functions.ts` ×3, `reconciliar-financeiro.ts`, `avaliacao-normais.functions.ts`).
// Aqui ela é uma só, e é o que a T6 do plano manda todos passarem a chamar.
//
// ⚠️ Três decisões que NÃO podem ser "corrigidas" por engano (todas travadas em
// `tests/impacto.test.ts`, com o porquê no próprio teste):
//
//  1. **PONTUAL divide por 4** (a validade padrão do projeto). Isso INVERTE de
//     propósito a decisão de 01/07/2026 — "pontual entra pelo valor cheio" —, que
//     segue valendo na v1. Não é bug, é a régua nova.
//  2. **Cada bloco é mensalizado pela frequência DELE**, nunca por um divisor do
//     projeto: dá para ter saving mensal e receita pontual no mesmo projeto.
//  3. **O custo para rodar subtrai com peso 100%**, enquanto o custo evitado entra
//     com 50%. A assimetria é intencional: custo para rodar é caixa SAINDO, com a
//     mesma certeza do saving efetivado — descontar custo certo por menos de 100%
//     infla o projeto. Já o custo evitado é despesa que nunca nasceu (não há
//     extrato), e por isso vale metade.
//
// ⚠️ Sem arredondamento de propósito: arredondar para centavos quebraria os valores
// periódicos, que são dízimas legítimas (10000 ÷ 3). Quem exibe formata; o núcleo
// devolve o número.
//   ⚠️ Isso NÃO significa que o retorno é exato em binário — `0,1 × R` deixa resíduo
//   em cerca de 19% dos inteiros (ex.: `0.1 * 81923 = 8192.300000000001`). O resíduo
//   fica na ordem de 1e-12, muito abaixo do centavo, então é inofensivo para dinheiro
//   — **mas nunca compare este retorno com `===`**. A convenção do repo para conferir
//   dinheiro é epsilon (`Math.abs(a - b) > 0.01`, ver `reconciliar-financeiro.ts`).
//
// ⚠️ O **ganho imensurável fica FORA de toda conta** — ele não tem número, e o que
// o representa é a estrela (D5/D8 do plano). O campo existe na entrada só para que
// o chamador possa passar o projeto inteiro sem filtrar nada.

export type Frequencia = 'pontual' | 'mensal' | 'trimestral' | 'semestral'

/** Divisor de mensalização por frequência. ⚠️ `pontual: 4` — ver nota 1 no topo. */
export const DIVISOR_FREQUENCIA: Record<Frequencia, number> = {
  pontual: 4,
  mensal: 1,
  trimestral: 3,
  semestral: 6,
}

/** Saving efetivado: linha de custo que existia e PAROU. Comprovável em extrato → 100%. */
export const PESO_SAVING = 1
/** Custo evitado: despesa que nunca nasceu, sem extrato que comprove → 50%. */
export const PESO_CUSTO_EVITADO = 0.5
/**
 * Receita incremental → 10%.
 *
 * ⚠️ Este NÃO é peso novo: é a **mesma** regra de negócio do `÷10` da v1
 * (`reconciliar-financeiro.ts`, `chat.functions.ts`), só com outro nome. Ou seja, o
 * fator vive hoje em DUAS réguas independentes — mudá-lo exige tocar os dois lados,
 * e o lado da v1 tem um "não corrigir aqui" que ninguém vai ligar a este arquivo.
 */
export const PESO_RECEITA = 0.1

/** Um valor com a frequência DELE. */
export type BlocoValor = { valor: number; frequencia: Frequencia }

export type GanhosProjeto = {
  savingEfetivado?: BlocoValor
  /** Os dois braços SOMAM antes do peso: horas liberadas + o que não foi contratado. */
  custoEvitado?: { horas: number; naoContratado: number; frequencia: Frequencia }
  receita?: BlocoValor
  /** Lista incremental — cada item mensaliza pela frequência dele. */
  custoRodar?: BlocoValor[]
  /** Categoria sem número: IGNORADA nas 3 contas (ver nota no topo). */
  imensuravel?: boolean
}

/**
 * Divisor da frequência, FAIL-CLOSED.
 *
 * ⚠️ Lança em chave desconhecida de propósito. O TypeScript protege o chamador
 * bem tipado, mas não o valor que vem do SQLite ou do formulário — e o vocabulário
 * das fontes da v1 é MAIOR que este enum: `custoPeriodicidade` tem `'anual'` e `''`
 * (`submeter/constants.ts`), `recorrencia` tem `''`, `tipo_saving` pode ser `null`.
 * Sem esta guarda, `valor / undefined` = **`NaN`**, e o caminho da falha é o pior
 * possível: `JSON.stringify(NaN)` vira **`null`**, então o campo de DINHEIRO chegaria
 * ao Gomoon como nulo em vez de erro, e um `NaN` num `reduce` de rollup zera o total
 * da área inteira. ⚠️ Nunca trocar por `?? 1` — converteria valor anual em mensal
 * calado. Mesma disciplina de `reconciliar-financeiro.ts` ("não adivinha → aborta").
 */
export function divisorDe(frequencia: Frequencia): number {
  const divisor = DIVISOR_FREQUENCIA[frequencia]
  if (typeof divisor !== 'number') {
    throw new Error(
      `[impacto] frequência desconhecida: ${JSON.stringify(frequencia)}. ` +
        `Esperado uma de ${Object.keys(DIVISOR_FREQUENCIA).join(' · ')}.`,
    )
  }
  return divisor
}

/** Traz um valor para a régua mensal, pela frequência dele. */
export function mensalizar(valor: number, frequencia: Frequencia): number {
  return valor / divisorDe(frequencia)
}

/**
 * Custo nunca é negativo — clampa em 0, como os canônicos da v1 já fazem
 * (`somarItens` em `reconciliar-financeiro.ts`, `custoProjetoMensalFromItens` em
 * `saving-calc.ts`). ⚠️ Sem isto, um item com valor negativo **AUMENTA** o impacto,
 * que é a direção gameável: quem digita `-500` num custo ganha meio milhar de
 * impacto. Vale só para o custo; nos blocos de ganho o sinal é do chamador.
 */
function valorDeCusto(item: BlocoValor): number {
  return Math.max(0, item.valor)
}

/** `CE = horas + naoContratado`. Bloco ausente é zero. */
function valorCustoEvitado(g: GanhosProjeto): number {
  const ce = g.custoEvitado
  return ce ? ce.horas + ce.naoContratado : 0
}

/** Idem, já na régua mensal (a frequência é do BLOCO, não de cada braço). */
function custoEvitadoMensal(g: GanhosProjeto): number {
  const ce = g.custoEvitado
  return ce ? mensalizar(ce.horas + ce.naoContratado, ce.frequencia) : 0
}

/**
 * Soma CRUA do que o projeto gera: `S + CE + R`.
 *
 * ⚠️ Sem pesos, sem mensalizar e **sem subtrair o custo para rodar** — é o número
 * "de fachada", para leitura. Quem decide é o líquido.
 */
export function impactoBruto(g: GanhosProjeto): number {
  return (g.savingEfetivado?.valor ?? 0) + valorCustoEvitado(g) + (g.receita?.valor ?? 0)
}

/** `1,0·S + 0,5·CE + 0,1·R − C`, nos valores declarados (sem mensalizar). */
export function impactoLiquido(g: GanhosProjeto): number {
  const custo = (g.custoRodar ?? []).reduce((total, item) => total + valorDeCusto(item), 0)
  return (
    PESO_SAVING * (g.savingEfetivado?.valor ?? 0) +
    PESO_CUSTO_EVITADO * valorCustoEvitado(g) +
    PESO_RECEITA * (g.receita?.valor ?? 0) -
    custo
  )
}

/**
 * `1,0·m(S) + 0,5·m(CE) + 0,1·m(R) − m(C)` — cada bloco pela frequência DELE
 * (ver nota 2 no topo), incluindo cada item do custo para rodar.
 *
 * É este o número que vai para o Gomoon.
 */
export function impactoLiquidoMensal(g: GanhosProjeto): number {
  const custoMensal = (g.custoRodar ?? []).reduce(
    (total, item) => total + mensalizar(valorDeCusto(item), item.frequencia),
    0,
  )
  const saving = g.savingEfetivado
  const receita = g.receita
  return (
    PESO_SAVING * (saving ? mensalizar(saving.valor, saving.frequencia) : 0) +
    PESO_CUSTO_EVITADO * custoEvitadoMensal(g) +
    PESO_RECEITA * (receita ? mensalizar(receita.valor, receita.frequencia) : 0) -
    custoMensal
  )
}
