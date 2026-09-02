// Como as 4 categorias de ganho são NOMEADAS e EXPLICADAS — módulo PURO, FONTE ÚNICA.
//
// Consumido pelos cards da Etapa 2, pelos títulos do acordeão da Etapa 3 e (T6) pela
// ficha e pela planilha. Existe separado de `ganhos.ts` porque aquele é o MODELO e a
// RÉGUA (tipos, exclusividade, serialização) e não deve carregar copy; e separado de
// `projeto-rotulos.ts` porque aquele descreve os números da v1 (`tipo_saving`,
// `tipos_projeto`), que a v2 substitui.
//
// ⚠️ A `descricao` de cada card é a régua D1 dita em uma frase — é ela que decide onde a
// pessoa põe o número, e é o erro mais caro do formulário: "esse dinheiro estava saindo
// do caixa antes desta solução?". Sim, e parou → saving efetivado. Não, ia começar a
// sair → custo evitado. Reescrever essa frase para "ficar mais curta" desfaz a única
// coisa que separa as duas categorias na cabeça de quem preenche.
//
// ⚠️ Sem travessão nem hífen decorativo no texto visível (pedido do plano). Acentuação
// obrigatória (regra 4 do CLAUDE.md).
import { GANHO_CATEGORIAS, type GanhoCategoria } from './ganhos'
import type { Frequencia } from './impacto'

export type RotuloGanho = {
  /** Nome curto, usado em título de bloco, chip e coluna. */
  titulo: string
  /** A régua em uma frase: o que entra AQUI e não na categoria vizinha. */
  descricao: string
  /** Uma linha de exemplo concreto, para quem ainda hesita entre duas. */
  exemplo: string
}

export const GANHO_ROTULOS: Record<GanhoCategoria, RotuloGanho> = {
  saving_efetivado: {
    titulo: 'Saving efetivado',
    descricao:
      'Havia uma despesa saindo do caixa e ela parou. Dá para comprovar num extrato, ' +
      'numa fatura ou num contrato encerrado.',
    exemplo: 'Contrato cancelado, licença que ninguém paga mais, multa que parou.',
  },
  custo_evitado: {
    titulo: 'Custo evitado',
    descricao:
      'A despesa nunca nasceu. Não existe extrato porque não há linha que sumiu: o que ' +
      'aconteceu foi a empresa deixar de precisar contratar.',
    exemplo:
      'Vaga que não foi aberta, consultoria não contratada, horas liberadas de quem ' +
      'continua na equipe.',
  },
  receita_incremental: {
    titulo: 'Receita incremental',
    descricao: 'Dinheiro novo entrando, que não entraria sem esta solução.',
    exemplo: 'Vendas que a automação viabilizou, cobrança que passou a ser recuperada.',
  },
  imensuravel: {
    titulo: 'Ganho imensurável',
    descricao:
      'O ganho é real mas não tem número: o valor está no risco que deixou de existir, ' +
      'na decisão que ficou possível ou na qualidade que subiu.',
    exemplo: 'Risco de multa eliminado, decisão que antes ninguém conseguia tomar.',
  },
}

/** O rótulo curto de uma categoria (fallback no próprio código, nunca em branco). */
export function tituloGanho(categoria: GanhoCategoria | string): string {
  return GANHO_ROTULOS[categoria as GanhoCategoria]?.titulo ?? String(categoria)
}

/**
 * As opções dos cards da Etapa 2, na ordem CANÔNICA.
 *
 * ⚠️ O imensurável vem por ÚLTIMO de propósito: ele é exclusivo dos outros três, e
 * oferecê-lo antes convida a marcar "não tenho número" antes de olhar se tem.
 */
export const GANHO_OPCOES: {
  value: GanhoCategoria
  title: string
  desc: string
}[] = GANHO_CATEGORIAS.map((c) => ({
  value: c,
  title: GANHO_ROTULOS[c].titulo,
  desc: `${GANHO_ROTULOS[c].descricao} ${GANHO_ROTULOS[c].exemplo}`,
}))

/**
 * De onde vem a receita incremental (coluna "Tipo de Receita").
 *
 * ⚠️ DECISÃO A CONFIRMAR: o plano lista "tipo de receita" como campo do bloco, mas não
 * enumera os valores — e na v1 aquela coluna guardava, na prática, a RECORRÊNCIA
 * (`tipo_saving`), que na v2 já é a frequência do bloco. Esta lista é curta e declarada
 * de propósito (em vez de texto livre) porque a coluna vai a relatório: texto livre em
 * campo agregável vira 40 grafias do mesmo conceito, que foi o que a canonicalização das
 * áreas do rollup teve de consertar depois.
 *
 * ⚠️ `retencao` é a fronteira delicada: receita que deixou de ser perdida PARECE custo
 * evitado. A régua é a mesma D1 aplicada à receita — se o dinheiro ENTRA (o cliente
 * segue pagando), é receita; se o que aconteceu foi uma despesa não nascer, é custo
 * evitado.
 */
export const TIPOS_RECEITA: { value: string; label: string }[] = [
  { value: 'nova_venda', label: 'Venda nova que não existiria' },
  { value: 'recuperacao', label: 'Receita recuperada (cobrança, carrinho, inadimplência)' },
  { value: 'expansao', label: 'Mais receita do mesmo cliente (upsell, cross-sell)' },
  { value: 'retencao', label: 'Receita que deixou de ser perdida (churn evitado)' },
  { value: 'outro', label: 'Outro' },
]

/**
 * As 4 frequências como ABAS lado a lado — rótulo CURTO, ordem por CADÊNCIA.
 *
 * ⚠️ Rótulo curto de propósito: `TIPO_SAVING_LABEL` (`projeto-rotulos.ts`) segue sendo o
 * nome longo do valor onde há espaço para ele (ficha, planilha, resumo do bloco); em 4
 * controles lado a lado, "Recorrente (mensal)" e "A cada trimestre" quebram em duas
 * linhas e a fileira deixa de ser legível de relance. As duas listas descrevem o MESMO
 * enum — ao acrescentar frequência, as duas mudam.
 *
 * ⚠️ A ordem é a da v1 (mensal, trimestral, semestral, pontual): a cadência crescente,
 * com o "uma vez" no fim. Não é a ordem do `DIVISOR_FREQUENCIA` nem alfabética.
 */
export const FREQUENCIA_ABAS: { value: Frequencia; label: string }[] = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'pontual', label: 'Pontual' },
]
