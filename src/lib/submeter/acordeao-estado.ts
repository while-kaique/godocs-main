// Máquina de estado do ACORDEÃO da Etapa 3 (v2) — módulo PURO.
//
// A Etapa 3 mostra um bloco por categoria de ganho MARCADA, o primeiro aberto; ao
// completar um bloco ele fecha e o próximo PENDENTE abre. Um só aberto por vez.
//
// Por que a régua mora aqui e não no componente: "qual abre agora" é a única parte do
// acordeão que tem comportamento, e componente não é testável neste repo (o Vitest roda
// `environment: 'node'` e só inclui `tests/**/*.test.ts`). O `.tsx` fica burro de
// propósito — ele desenha o que esta função decidir.
import { GANHO_CATEGORIAS, type GanhoCategoria } from '@/lib/ganhos'

export type BlocoId = string

/** As categorias marcadas na ordem CANÔNICA de `GANHO_CATEGORIAS` (nunca a de clique). */
export function ordemBlocos(categorias: GanhoCategoria[]): GanhoCategoria[] {
  const marcadas = new Set(categorias ?? [])
  return GANHO_CATEGORIAS.filter((c) => marcadas.has(c))
}

/** Qual bloco nasce aberto: o primeiro da ordem. Lista vazia → `null`. */
export function blocoInicial(blocos: BlocoId[]): BlocoId | null {
  return (blocos ?? [])[0] ?? null
}

/**
 * O próximo bloco PENDENTE a partir de `depoisDe` (exclusive), circulando.
 * `depoisDe: null` — ou um id que não está na lista — procura do começo.
 * Nenhum pendente → `null`.
 */
export function proximoPendente(
  blocos: BlocoId[],
  completos: BlocoId[],
  depoisDe: BlocoId | null,
): BlocoId | null {
  const lista = blocos ?? []
  if (lista.length === 0) return null
  const feitos = new Set(completos ?? [])
  // `indexOf` devolve -1 para id ausente, e -1 + 1 = 0 faz a varredura começar do
  // início — o comportamento que se quer para "não sei de onde partir".
  const inicio = depoisDe === null ? -1 : lista.indexOf(depoisDe)
  for (let passo = 1; passo <= lista.length; passo++) {
    const candidato = lista[(inicio + passo + lista.length) % lista.length]
    if (!feitos.has(candidato)) return candidato
  }
  return null
}

/**
 * Completar `atual` fecha-o e devolve qual abre em seguida (o próximo pendente).
 *
 * ⚠️ Trata `atual` como completo mesmo que o chamador ainda não o tenha posto em
 * `completos` — na tela as duas coisas acontecem no MESMO evento, e depender da ordem
 * dessas duas atualizações de estado reabriria o bloco que a pessoa acabou de fechar.
 */
export function aoCompletar(
  blocos: BlocoId[],
  completos: BlocoId[],
  atual: BlocoId,
): BlocoId | null {
  return proximoPendente(blocos, [...(completos ?? []), atual], atual)
}

/** Clique no cabeçalho: abre o alvo, ou fecha se já era o aberto. Um só por vez. */
export function alternarAberto(aberto: BlocoId | null, alvo: BlocoId): BlocoId | null {
  return aberto === alvo ? null : alvo
}

/**
 * Todos os blocos da lista estão completos?
 *
 * ⚠️ Lista vazia → `false` de propósito: não existe "tudo completo" sem bloco nenhum, e
 * quem consome isto para liberar o envio leria a ausência de blocos como permissão.
 */
export function todosCompletos(blocos: BlocoId[], completos: BlocoId[]): boolean {
  const lista = blocos ?? []
  if (lista.length === 0) return false
  const feitos = new Set(completos ?? [])
  return lista.every((b) => feitos.has(b))
}
