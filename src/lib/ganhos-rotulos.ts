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
  /**
   * Emoji do card de seleção — o mesmo idioma dos cards de tipo de projeto da PROD
   * (💰 Saving Operacional · 📈 Receita Incremental), que o Luis pediu para seguir.
   * ⚠️ Só decoração: o estado marcado/não nunca depende dele (o check redondo + a borda
   * é que dizem).
   */
  icone: string
  /** A régua em uma frase: o que entra AQUI e não na categoria vizinha. */
  descricao: string
  /** Uma linha de exemplo concreto, para quem ainda hesita entre duas. */
  exemplo: string
}

export const GANHO_ROTULOS: Record<GanhoCategoria, RotuloGanho> = {
  saving_efetivado: {
    icone: '💰',
    titulo: 'Saving efetivado',
    descricao:
      'Havia uma despesa saindo do caixa e ela parou. Dá para comprovar num extrato, ' +
      'numa fatura ou num contrato encerrado.',
    exemplo: 'Contrato cancelado, licença que ninguém paga mais, multa que parou.',
  },
  custo_evitado: {
    icone: '🛡️',
    titulo: 'Custo evitado',
    descricao:
      'A despesa nunca nasceu. Não existe extrato porque não há linha que sumiu: o que ' +
      'aconteceu foi a empresa deixar de precisar contratar.',
    exemplo:
      'Vaga que não foi aberta, consultoria não contratada, horas liberadas de quem ' +
      'continua na equipe.',
  },
  receita_incremental: {
    icone: '📈',
    titulo: 'Receita incremental',
    descricao: 'Dinheiro novo entrando, que não entraria sem esta solução.',
    exemplo: 'Vendas que a automação viabilizou, cobrança que passou a ser recuperada.',
  },
  imensuravel: {
    icone: '⭐',
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
 * ⚠️ O imensurável vem por ÚLTIMO de propósito: oferecê-lo antes convida a marcar "não
 * tenho número" antes de olhar se tem. (Ele deixou de ser EXCLUSIVO em 02/09/2026 — as 4
 * podem ser marcadas juntas —, mas continua sendo a última da lista.)
 */
export const GANHO_OPCOES: {
  value: GanhoCategoria
  title: string
  desc: string
  icon: string
}[] = GANHO_CATEGORIAS.map((c) => ({
  value: c,
  title: GANHO_ROTULOS[c].titulo,
  desc: `${GANHO_ROTULOS[c].descricao} ${GANHO_ROTULOS[c].exemplo}`,
  icon: GANHO_ROTULOS[c].icone,
}))

// ⚠️ Aqui existia `TIPOS_RECEITA` (5 opções de "de onde vem a receita"), que eu declarei
// sem estar no plano. O Luis removeu o campo em 02/09/2026: o bloco de receita é o da v1
// (frequência · valor · racional), e de onde vem o dinheiro é o que o racional conta em
// uma frase. Não reintroduzir a lista nem a coluna.

export const FREQUENCIA_ABAS: { value: Frequencia; label: string }[] = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'pontual', label: 'Pontual' },
]

/**
 * As abas da RECEITA — só **Mensal** e **Pontual**.
 *
 * ⚠️ Decisão do Luis (02/09/2026), e é a régua da PROD: no bloco de receita a v1 sempre
 * ofereceu 2 cadências, não 4. Receita "a cada trimestre" quase nunca é o que a pessoa
 * quer dizer — ela informa o mês ou o total de uma campanha —, e oferecer 4 convida a
 * escolher errado num campo que multiplica o valor por 3 ou por 6.
 *
 * ⚠️ Deriva de `FREQUENCIA_ABAS` (FILTRA, não redigita): os rótulos e a ordem seguem
 * vindo de um lugar só, e trimestral/semestral continuam VÁLIDOS no modelo
 * (`DIVISOR_FREQUENCIA` os conhece, e o saving/custo evitado os oferecem) — o que muda é
 * o que esta tela apresenta.
 */
export const FREQUENCIA_ABAS_RECEITA = FREQUENCIA_ABAS.filter(
  (a) => a.value === 'mensal' || a.value === 'pontual',
)
