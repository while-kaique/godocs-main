// Tabela de HORAS antes/depois por função — módulo PURO.
//
// Vive no bloco de CUSTO EVITADO (D1): hora liberada de gente que continua na folha não
// é dinheiro no bolso, é capacidade que se deixou de comprar. Por isso pesa 50% e não
// pede evidência.
//
// ⚠️ INVARIANTE que este módulo protege: o R$ por hora NUNCA atravessa para o cliente.
// `CARGOS` traz `{label, valor_hora}`; daqui sai **só o label**. O R$ das horas é
// derivado no BACKEND (`resolverValorHora`, `saving-calc.ts`) — importar aquele caminho
// nesta camada exibiria valor/hora ao submissor e induziria manipulação.
import { CARGOS } from '@/lib/agents/types'
import type { CustoEvitadoLinhaHoras } from '@/lib/ganhos'

/** A opção que abre o campo de descrição livre. */
export const FUNCAO_OUTRO = 'Outro'

/** As funções ofertadas: os cargos canônicos (só o rótulo) + "Outro". */
export const FUNCOES_HORAS: readonly string[] = [
  ...CARGOS.map((c) => c.label),
  FUNCAO_OUTRO,
]

/** Uma linha como o formulário a carrega (horas em string — é o que o input devolve). */
export type LinhaHorasInput = {
  funcao: string
  funcaoDescricao: string
  horasAntes: string
  horasDepois: string
}

/**
 * Número de horas em pt-BR. Aceita vírgula E ponto decimal ("12,5" e "12.5"), tolera
 * espaço em volta, e reconhece separador de milhar ("1.200" → 1200, "1.200,5" → 1200.5).
 *
 * Devolve `null` — nunca `NaN` — para vazio, texto, negativo e não finito: `NaN` num
 * `reduce` zera o total e `JSON.stringify(NaN)` vira `null`, então o campo de dinheiro
 * chegaria nulo ao destino em vez de dar erro.
 *
 * ⚠️ Não existia parser numérico não-monetário neste repo. `parseMoedaBR` é de CENTAVOS
 * e leria "12,5" como R$ 0,13 — usá-lo em horas era a armadilha óbvia.
 */
export function parseHorasBR(texto: string): number | null {
  const cru = (texto ?? '').trim()
  if (cru === '') return null

  // Milhar com ponto, decimal com vírgula: "1.200" · "1.200,5". O padrão exige grupos
  // de 3 depois de cada ponto, então "12.5" NÃO casa aqui e segue como decimal.
  const comMilhar = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cru)
  const normalizado = comMilhar
    ? cru.replace(/\./g, '').replace(',', '.')
    : cru.replace(',', '.')

  if (!/^\d+(\.\d+)?$/.test(normalizado)) return null
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

export function linhaHorasVazia(): LinhaHorasInput {
  return { funcao: '', funcaoDescricao: '', horasAntes: '', horasDepois: '' }
}

export function comAoMenosUmaLinha(linhas: LinhaHorasInput[]): LinhaHorasInput[] {
  const lista = linhas ?? []
  return lista.length === 0 ? [linhaHorasVazia()] : lista
}

export function adicionarLinhaHoras(linhas: LinhaHorasInput[]): LinhaHorasInput[] {
  return [...(linhas ?? []), linhaHorasVazia()]
}

/** Remover a última devolve uma linha em BRANCO (a tela nunca fica sem linha). */
export function removerLinhaHoras(
  linhas: LinhaHorasInput[],
  i: number,
): LinhaHorasInput[] {
  const lista = linhas ?? []
  if (i < 0 || i >= lista.length) return lista
  return comAoMenosUmaLinha(lista.filter((_, idx) => idx !== i))
}

export function atualizarLinhaHoras(
  linhas: LinhaHorasInput[],
  i: number,
  patch: Partial<LinhaHorasInput>,
): LinhaHorasInput[] {
  const lista = linhas ?? []
  if (i < 0 || i >= lista.length) return lista
  return lista.map((linha, idx) => (idx === i ? { ...linha, ...patch } : linha))
}

/** A função escolhida exige descrição livre? (só "Outro"). */
export function precisaDescricaoFuncao(funcao: string): boolean {
  return funcao === FUNCAO_OUTRO
}

/**
 * Horas efetivamente liberadas na linha: `antes − depois`, nunca negativo.
 *
 * ⚠️ O clamp em 0 é para o TOTAL não encolher com uma linha invertida; a INVERSÃO em si
 * é erro nomeado em `validarLinhasHoras` — silenciar as duas coisas esconderia o engano
 * de quem trocou as colunas.
 */
export function horasLiberadas(linha: LinhaHorasInput): number {
  const antes = parseHorasBR(linha?.horasAntes ?? '') ?? 0
  const depois = parseHorasBR(linha?.horasDepois ?? '') ?? 0
  return Math.max(0, antes - depois)
}

export function totalHorasLiberadas(linhas: LinhaHorasInput[]): number {
  return (linhas ?? []).reduce((total, linha) => total + horasLiberadas(linha), 0)
}

/** Uma linha sem nada digitado. */
function linhaEmBranco(linha: LinhaHorasInput): boolean {
  return (
    linha.funcao === '' &&
    linha.funcaoDescricao.trim() === '' &&
    linha.horasAntes.trim() === '' &&
    linha.horasDepois.trim() === ''
  )
}

/** Uma única linha totalmente em branco = "não declarei horas". */
export function tabelaVazia(linhas: LinhaHorasInput[]): boolean {
  return (linhas ?? []).every(linhaEmBranco)
}

/**
 * Erros por campo, chaves posicionais (`h${i}funcao`, `h${i}descricao`, `h${i}antes`,
 * `h${i}depois`).
 *
 * ⚠️ Valida TODA linha recebida, inclusive a em branco — quem decide se a tabela é
 * exigida é o chamador, com `tabelaVazia`. Validar "menos" aqui deixaria passar linha
 * pela metade.
 */
export function validarLinhasHoras(linhas: LinhaHorasInput[]): Record<string, string> {
  const erros: Record<string, string> = {}
  ;(linhas ?? []).forEach((linha, i) => {
    if (linha.funcao === '') erros[`h${i}funcao`] = 'Selecione a função'
    if (precisaDescricaoFuncao(linha.funcao) && linha.funcaoDescricao.trim() === '') {
      erros[`h${i}descricao`] = 'Descreva qual era a função'
    }
    const antes = parseHorasBR(linha.horasAntes)
    const depois = parseHorasBR(linha.horasDepois)
    // As duas mensagens dizem QUAIS horas: com as colunas lado a lado, "Informe as
    // horas" no campo errado não ajuda ninguém a achar o que faltou.
    if (antes === null) erros[`h${i}antes`] = 'Informe as horas gastas antes da automação'
    if (depois === null) {
      erros[`h${i}depois`] = 'Informe as horas gastas depois da automação'
    }
    if (antes !== null && depois !== null && depois > antes) {
      erros[`h${i}depois`] = 'As horas depois não podem passar das horas antes'
    }
  })
  return erros
}

/**
 * Converte para o tipo da T3, descartando linha em branco e linha com horas que não
 * parseiam — é o que impede um `NaN` de nascer aqui.
 *
 * ⚠️ A chave `funcaoDescricao` só entra quando há texto: chave presente valendo
 * `undefined` faria a comparação da edição acusar mudança onde ninguém mexeu.
 */
export function linhasParaCustoEvitado(
  linhas: LinhaHorasInput[],
): CustoEvitadoLinhaHoras[] {
  const convertidas: CustoEvitadoLinhaHoras[] = []
  for (const linha of linhas ?? []) {
    if (linhaEmBranco(linha)) continue
    const antes = parseHorasBR(linha.horasAntes)
    const depois = parseHorasBR(linha.horasDepois)
    if (antes === null || depois === null) continue
    const convertida: CustoEvitadoLinhaHoras = {
      funcao: linha.funcao,
      horasAntes: antes,
      horasDepois: depois,
    }
    if (linha.funcaoDescricao.trim() !== '') {
      convertida.funcaoDescricao = linha.funcaoDescricao
    }
    convertidas.push(convertida)
  }
  return convertidas
}
