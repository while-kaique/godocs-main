// Lista incremental de itens (nome · valor · frequência · o que é) — módulo PURO.
//
// A UI dessa lista existe DUAS vezes hoje, byte a byte igual salvo 12 detalhes de texto:
// `custoEvitadoItensUI` (`step3-chat.tsx:1253`) e o bloco inline do custo do projeto
// (`:1845`). Aqui fica o COMPORTAMENTO (adicionar/remover/atualizar/validar), uma vez só;
// o `lista-itens.tsx` desenha e recebe os 12 rótulos por prop.
//
// ⚠️ Na v2 a lista serve ao **custo para rodar** (D3: a fusão de `custo_externo_mensal`
// com `custo_projeto_itens`, que economicamente sempre foram a mesma coisa), e por isso
// oferece as **4** frequências de `impacto.ts` — não as 2 (`mensal`/`pontual`) da v1.
//
// ⚠️ Valor é STRING aqui de propósito (é o que o `<input>` com máscara BR devolve); o
// número só nasce na conversão para o tipo da T3, e é lá que a régua fail-closed age.
import { parseMoedaBR } from './constants'
import type { Frequencia } from '@/lib/impacto'
import type { CustoRodarItem } from '@/lib/ganhos'

/** Um item como o formulário o carrega (tudo string, menos a frequência já escolhida). */
export type ItemLista = {
  nome: string
  valor: string
  frequencia: Frequencia | ''
  descricao: string
}

export function itemVazio(): ItemLista {
  return { nome: '', valor: '', frequencia: '', descricao: '' }
}

/** Garante ao menos uma linha na tela (lista vazia → uma linha em branco). */
export function comAoMenosUm(itens: ItemLista[]): ItemLista[] {
  const lista = itens ?? []
  return lista.length === 0 ? [itemVazio()] : lista
}

export function adicionarItem(itens: ItemLista[]): ItemLista[] {
  return [...(itens ?? []), itemVazio()]
}

/**
 * Remove o item `i`. ⚠️ Remover o ÚLTIMO devolve uma lista com uma linha em BRANCO, não
 * uma lista vazia: a tela nunca pode ficar sem linha (era o que o botão de remover
 * escondido no `length === 1` da v1 garantia por acidente, e por acidente não é
 * garantia — quem chamasse a remoção por teclado ou por outro caminho esvaziava a tela).
 */
export function removerItem(itens: ItemLista[], i: number): ItemLista[] {
  const lista = itens ?? []
  if (i < 0 || i >= lista.length) return lista
  return comAoMenosUm(lista.filter((_, idx) => idx !== i))
}

/** Aplica um patch no item `i`. Índice fora da lista devolve a lista intacta. */
export function atualizarItem(
  itens: ItemLista[],
  i: number,
  patch: Partial<ItemLista>,
): ItemLista[] {
  const lista = itens ?? []
  if (i < 0 || i >= lista.length) return lista
  return lista.map((item, idx) => (idx === i ? { ...item, ...patch } : item))
}

/** Item cujo preenchimento acabou (os 4 campos válidos). */
export function itemCompleto(item: ItemLista): boolean {
  if (!item) return false
  return (
    item.nome.trim() !== '' &&
    parseMoedaBR(item.valor) > 0 &&
    item.frequencia !== '' &&
    item.descricao.trim() !== ''
  )
}

/** Um campo qualquer com conteúdo? (o oposto de "linha em branco".) */
function itemEmBranco(item: ItemLista): boolean {
  return (
    item.nome.trim() === '' &&
    item.valor.trim() === '' &&
    item.frequencia === '' &&
    item.descricao.trim() === ''
  )
}

/** Lista com nada declarado: vazia, ou só linhas totalmente em branco. */
export function listaVazia(itens: ItemLista[]): boolean {
  return (itens ?? []).every(itemEmBranco)
}

/**
 * Erros por campo, com as chaves POSICIONAIS que a tela consome (`${prefixo}${i}nome`,
 * `…valor`, `…frequencia`, `…descricao`). As 4 mensagens são as da v1, preservadas.
 */
export function validarItens(
  itens: ItemLista[],
  prefixo: string,
): Record<string, string> {
  const erros: Record<string, string> = {}
  ;(itens ?? []).forEach((item, i) => {
    if (item.nome.trim() === '') erros[`${prefixo}${i}nome`] = 'Informe o nome'
    if (parseMoedaBR(item.valor) <= 0) erros[`${prefixo}${i}valor`] = 'Informe o valor'
    if (item.frequencia === '') erros[`${prefixo}${i}frequencia`] = 'Selecione'
    if (item.descricao.trim() === '') {
      erros[`${prefixo}${i}descricao`] = 'Informe a justificativa'
    }
  })
  return erros
}

/**
 * Converte para o tipo da T3. FAIL-CLOSED: frequência em branco lança com o campo
 * nomeado, porque `serializarCustoRodar` descartaria o item na leitura — e custo que
 * desaparece INFLA o impacto (a direção gameável que `impacto.ts` blinda com
 * `Math.max(0, …)`).
 *
 * ⚠️ Linha totalmente em BRANCO é ignorada, não lançada: a tela sempre mantém uma linha
 * na tela, então "não declarei custo nenhum" chega aqui como uma linha vazia — tratá-la
 * como erro impediria de submeter projeto sem custo para rodar.
 */
export function itensParaCustoRodar(itens: ItemLista[]): CustoRodarItem[] {
  const convertidos: CustoRodarItem[] = []
  ;(itens ?? []).forEach((item, i) => {
    if (itemEmBranco(item)) return
    if (item.frequencia === '') {
      throw new Error(
        `[itens-lista] itens[${i}].frequencia não foi escolhida. Sem ela o item é ` +
          `DESCARTADO na leitura da coluna, e custo que desaparece infla o impacto.`,
      )
    }
    convertidos.push({
      nome: item.nome,
      valor: parseMoedaBR(item.valor),
      frequencia: item.frequencia,
      oQueE: item.descricao,
    })
  })
  return convertidos
}
