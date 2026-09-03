// REVELAÇÃO PROGRESSIVA dos blocos de ganho — módulo PURO.
//
// É o padrão da v1 (`step3-chat.tsx`, os gates `mostrarSecaoSaving`,
// `mostrarEliminaGastoExterno`, `mostrarCustoProjeto`…): como TODAS as respostas são
// obrigatórias, cada pergunta só aparece quando a anterior foi respondida, guiando a
// pessoa um passo por vez em vez de despejar 5 campos de uma vez. O Luis pediu
// explicitamente que a v2 mantivesse isso (02/09/2026) — a v2 tinha nascido com os campos
// todos visíveis de saída.
//
// ⚠️ Mora FORA do `.tsx` porque neste repo o Vitest roda `environment: 'node'` e só inclui
// `tests/**/*.test.ts`: gate dentro do componente é gate sem teste. Mesma razão de
// `acordeao-estado.ts` (que decide qual BLOCO abre) — este decide, dentro de um bloco,
// qual PERGUNTA já pode aparecer.
//
// ⚠️ A régua é "respondeu?", não "respondeu BEM?". Revelar só com valor válido esconderia
// a pergunta seguinte no meio da digitação (digitar "1" de "1.200" já revela). Quem julga
// se a resposta serve é `validacao-etapa3.ts`, no envio.
import { tabelaVazia, type LinhaHorasInput } from './horas'
import { listaVazia, type ItemLista } from './itens-lista'

/** Respondida = tem texto (depois de tirar espaços). */
function respondido(valor: string): boolean {
  return valor.trim() !== ''
}

export type PassosSaving = {
  /** O PAR "quanto era / quanto é agora" — depois da frequência. */
  valores: boolean
  /** "Como se comprova" — depois de as duas pontas estarem preenchidas. */
  evidencia: boolean
}

/**
 * ⚠️ As duas pontas aparecem JUNTAS: elas são uma comparação, e revelar o "agora" só
 * depois do "antes" esconderia metade da pergunta que dá sentido à outra metade.
 */
export function passosSaving(d: {
  savingFrequencia: string
  savingValorAntes: string
  savingValorAgora: string
}): PassosSaving {
  const valores = respondido(d.savingFrequencia)
  const evidencia =
    valores && respondido(d.savingValorAntes) && respondido(d.savingValorAgora)
  return { valores, evidencia }
}

export type PassosCustoEvitado = {
  /** Os 2 braços (horas liberadas · valor não contratado) — depois da frequência. */
  bracos: boolean
  /** "Por que essa despesa não aconteceu" — depois de ao menos UM braço ter conteúdo. */
  racional: boolean
}

/**
 * ⚠️ Os dois braços aparecem JUNTOS de propósito: eles somam, ter só um é o caso normal,
 * e revelar o segundo só depois do primeiro sugeriria que os dois são obrigatórios.
 */
export function passosCustoEvitado(d: {
  ceFrequencia: string
  ceLinhas: LinhaHorasInput[]
  ceNaoContratado: string
}): PassosCustoEvitado {
  const bracos = respondido(d.ceFrequencia)
  const racional =
    bracos && (!tabelaVazia(d.ceLinhas) || respondido(d.ceNaoContratado))
  return { bracos, racional }
}

export type PassosReceita = {
  valor: boolean
  racional: boolean
}

/**
 * ⚠️ São 3 perguntas, como na v1: frequência → valor → racional. O "de onde vem" (a lista
 * `TIPOS_RECEITA` que eu havia inventado) saiu em 02/09/2026 — não recriar o passo.
 */
export function passosReceita(d: {
  receitaFrequencia: string
  receitaValor: string
}): PassosReceita {
  const valor = respondido(d.receitaFrequencia)
  const racional = valor && respondido(d.receitaValor)
  return { valor, racional }
}

/**
 * "Esta solução tem custo para rodar?" — a resposta que revela a lista.
 *
 * ⚠️ Não é campo do modelo: "não tem" é lista VAZIA (`GanhosDeclarados.custoRodar`), e é
 * por isso que a resposta inicial é DERIVADA do que já está preenchido — quem volta ao
 * bloco com itens digitados vê "sim" marcado e a lista aberta, sem ter de responder de
 * novo. Era a pergunta que a v1 fazia antes de mostrar a lista (`temCustoProjeto`), e
 * sem ela a v2 abria uma linha em branco de custo para TODO projeto.
 */
export type RespostaCustoRodar = 'sim' | 'nao' | ''

export function respostaCustoRodarInicial(itens: ItemLista[]): RespostaCustoRodar {
  return listaVazia(itens) ? '' : 'sim'
}
