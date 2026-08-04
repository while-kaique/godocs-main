/**
 * Gate determinístico — SOBREPOSIÇÃO entre RECEITA INCREMENTAL e CUSTO EVITADO.
 *
 * Origem (Sucesso.AI / Maria Ponciano, 29/07/2026): "Ressarcimento das transportadoras"
 * (R$ 55.864,38) e "Receita retida em reenvio" (R$ 106.049,40) entraram como itens de
 * CUSTO EVITADO no saving e, no reenvio seguinte, DE NOVO como receita incremental
 * (R$ 161.913,78 = exatamente a soma dos dois). O mesmo dinheiro dos dois lados.
 *
 * O agente até estranhou a NATUREZA do valor ("ressarcimento é saving operacional, não
 * receita incremental — confirme se devo excluir"), a autora reafirmou sem explicar e ele
 * aceitou. Duas falhas distintas:
 *   1. ele nunca disse que o valor JÁ ESTAVA CONTABILIZADO — porque a fase de receita não
 *      lê os itens do custo evitado (o anti-dupla-contagem existente só compara
 *      horas × custo evitado);
 *   2. avisar não segurava nada: repetir o valor bastava para passar.
 *
 * Este módulo resolve (1) com detecção NUMÉRICA/TEXTUAL — não depende do LLM perceber
 * (⚠️ "o prompt sozinho NÃO segurava", lição do Gostream) — e (2) com uma pergunta de
 * confirmação EXPLÍCITA que o usuário precisa responder.
 *
 * ⚠️ ANTI-LOOP — este repo já queimou duas vezes (o gate [1.4] com 38 perguntas em prod e
 * o forçamento do carga×escala, removido em 03/07/2026 por gerar loop na edição). As
 * quatro travas, por construção:
 *   (a) NO MÁXIMO 2 perguntas: 'pendente' → ambíguo → 'reperguntado' → qualquer resposta
 *       cai em estado TERMINAL. Nunca uma terceira.
 *   (b) Estados terminais são ABSORVENTES — nenhum ramo volta a null/'pendente'. (É onde o
 *       gate do teto guarda risco: o ramo 'pessoa' faz `teto_pessoa: null` e RE-ARMA.)
 *   (c) A saída é por CLIQUE (opção), não por juízo do LLM sobre texto livre — foi o
 *       juízo-sobre-texto que produziu os dois loops anteriores.
 *   (d) Quem consome isto DEVE ler o estado VIVO, nunca o snapshot do topo do turno.
 */

import type { ReceitaColetada } from './types'

/** Estado do gate. `null` = nunca avaliado. Os três últimos são TERMINAIS. */
export type EstadoSobreposicao =
  | 'pendente'
  | 'reperguntado'
  | 'confirmado'
  | 'ajustar'
  | 'nao_respondido'

/** Estados a partir dos quais o gate NUNCA mais pergunta. */
export const ESTADOS_TERMINAIS_SOBREPOSICAO: readonly EstadoSobreposicao[] = [
  'confirmado',
  'ajustar',
  'nao_respondido',
]

export function sobreposicaoResolvida(estado: EstadoSobreposicao | null | undefined): boolean {
  return estado != null && ESTADOS_TERMINAIS_SOBREPOSICAO.includes(estado)
}

export type ItemCustoEvitado = { nome: string; valor: number }

export type SobreposicaoDetectada = {
  /** Itens do custo evitado que colidem com o dinheiro declarado como receita. */
  itens: ItemCustoEvitado[]
  /** Soma dos itens que colidiram. */
  total: number
  /** Como bateu — só para log/teste; a pergunta é a mesma nos dois casos. */
  via: 'valor' | 'nome' | 'valor+nome'
}

const round2 = (n: number) => Math.round(n * 100) / 100
const quaseIgual = (a: number, b: number) => Math.abs(a - b) <= 0.01

/** minúsculas + sem acento, para casar nome de item dentro do racional. */
export function normalizarTexto(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extrai os valores monetários escritos num texto livre (pt-BR).
 * "…R$ 106.049,40 …e R$ 55.864,38" → [106049.4, 55864.38]
 */
export function extrairValores(texto: string): number[] {
  const out: number[] = []
  const re = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(texto ?? ''))) !== null) {
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
    if (isFinite(v) && v > 0) out.push(round2(v))
  }
  return out
}

/** Aceita o JSON só-banco (string) ou já parseado. Descarta item sem nome/valor. */
export function lerItensCustoEvitado(raw: unknown): ItemCustoEvitado[] {
  let arr: unknown = raw
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map((it) => {
      const o = (it ?? {}) as { nome?: unknown; valor?: unknown }
      return { nome: String(o.nome ?? '').trim(), valor: round2(Number(o.valor) || 0) }
    })
    .filter((it) => it.nome.length > 0 && it.valor > 0)
}

/**
 * Detecta se o dinheiro declarado como RECEITA já está nos itens de CUSTO EVITADO.
 *
 * Casa por VALOR (item bate com o total da receita, ou com um número escrito no racional)
 * ou por NOME (nome do item aparece no racional). Devolve `null` quando não há colisão —
 * o gate só arma com evidência.
 *
 * ⚠️ Nome só conta com ≥ 8 caracteres: nomes curtos ("API", "Frete") apareceriam em
 * qualquer racional e armariam o gate à toa.
 */
export function detectarSobreposicaoReceita(
  itensRaw: unknown,
  receitaValor: number | null | undefined,
  racional: string | null | undefined,
): SobreposicaoDetectada | null {
  const itens = lerItensCustoEvitado(itensRaw)
  if (itens.length === 0) return null

  const valor = Number(receitaValor) || 0
  const racionalNorm = normalizarTexto(racional ?? '')
  const valoresNoRacional = extrairValores(racional ?? '')

  const casados: ItemCustoEvitado[] = []
  let houveValor = false
  let houveNome = false

  for (const item of itens) {
    const porValor =
      (valor > 0 && quaseIgual(item.valor, valor)) ||
      valoresNoRacional.some((v) => quaseIgual(v, item.valor))
    const nomeNorm = normalizarTexto(item.nome)
    const porNome = nomeNorm.length >= 8 && racionalNorm.includes(nomeNorm)
    if (porValor || porNome) {
      casados.push(item)
      if (porValor) houveValor = true
      if (porNome) houveNome = true
    }
  }

  // Rede adicional: a receita é exatamente a SOMA de todos os itens (o padrão do
  // Sucesso.AI), mesmo que nenhum item isolado tenha batido.
  if (casados.length === 0 && valor > 0) {
    const somaTodos = round2(itens.reduce((s, i) => s + i.valor, 0))
    if (quaseIgual(somaTodos, valor)) {
      casados.push(...itens)
      houveValor = true
    }
  }

  if (casados.length === 0) return null
  return {
    itens: casados,
    total: round2(casados.reduce((s, i) => s + i.valor, 0)),
    via: houveValor && houveNome ? 'valor+nome' : houveValor ? 'valor' : 'nome',
  }
}

// ── Pergunta e interpretação ────────────────────────────────────────────────

/** Ordem FIXA: o índice do clique é a interpretação (1 = seguir, 2 = corrigir). */
export const OPCOES_SOBREPOSICAO = [
  'São valores diferentes — pode seguir com a receita',
  'É o mesmo dinheiro — quero corrigir',
]

const moedaBR = (n: number) => {
  const [inteiro, centavos] = n.toFixed(2).split('.')
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`
}

function listarItens(det: SobreposicaoDetectada): string {
  return det.itens.map((i) => `“${i.nome}” (R$ ${moedaBR(i.valor)})`).join(' e ')
}

/**
 * 1ª pergunta. Nomeia a inconsistência (o que parece ser × como está sendo registrado) e
 * exige uma escolha — não é um aviso que se pode atravessar repetindo o valor.
 */
export function perguntaSobreposicao(det: SobreposicaoDetectada): string {
  const plural = det.itens.length > 1
  return (
    `Antes de fechar: ${plural ? 'esses valores já aparecem' : 'esse valor já aparece'} no seu custo evitado — ` +
    `${listarItens(det)}. Custo evitado é dinheiro que a empresa **deixou de gastar**; receita incremental é ` +
    `dinheiro **novo que entrou**. Do jeito que está, ${plural ? 'eles seriam contados' : 'ele seria contado'} ` +
    `duas vezes no ganho do projeto.\n\n` +
    `Você tem certeza de que quer seguir registrando ${plural ? 'esses valores' : 'esse valor'} também como receita?`
  )
}

/**
 * 2ª e ÚLTIMA pergunta (só quando a 1ª veio ambígua). Pede a escolha de novo, deixando
 * explícito que é a última vez. Depois desta, o gate encerra de qualquer jeito.
 */
export function perguntaSobreposicaoFirme(det: SobreposicaoDetectada): string {
  return (
    `Preciso de uma escolha para seguir: ${listarItens(det)} ${det.itens.length > 1 ? 'estão' : 'está'} ` +
    `no custo evitado e também na receita. Se forem coisas diferentes, escolha a primeira opção e me diga ` +
    `em uma frase o que distingue as duas — se for o mesmo dinheiro, escolha a segunda.`
  )
}

/**
 * Interpreta a resposta. Clique (índice 1/2) vence; texto cai no fallback por regex.
 * `null` = ambíguo — o chamador re-pergunta UMA vez e depois encerra.
 */
export function interpretarSobreposicao(
  texto: string | null | undefined,
  selectedOption: number | null,
): 'confirmado' | 'ajustar' | null {
  if (selectedOption === 1) return 'confirmado'
  if (selectedOption === 2) return 'ajustar'
  const t = normalizarTexto(texto ?? '')
  if (!t) return null
  // "é o mesmo dinheiro" / "vou corrigir" / "duplicado" → ajustar (checado ANTES do
  // "diferente", porque "não são diferentes" contém "diferente").
  if (/\b(mesmo dinheiro|mesma coisa|duplicad|contei duas|vou (corrigir|tirar|remover)|corrigir|remover|tirar)\b/.test(t))
    return 'ajustar'
  if (/\b(sao diferentes|e diferente|coisas diferentes|valores diferentes|nao e o mesmo|pode seguir|tenho certeza|sim, ?tenho)\b/.test(t))
    return 'confirmado'
  return null
}

// ── Nudges [SISTEMA] — entram UMA vez, só quando o gate dispara ─────────────

export const NUDGE_SOBREPOSICAO_CONFIRMADO =
  '[SISTEMA] O usuário CONFIRMOU que o valor da receita é dinheiro distinto do que está no custo evitado. ' +
  'Registre no memorial de receita, em UMA frase objetiva, o que distingue os dois (use o que ele acabou de ' +
  'dizer). NÃO volte a questionar isso e NÃO pergunte de novo sobre custo evitado — a decisão está tomada.'

export const NUDGE_SOBREPOSICAO_AJUSTAR =
  '[SISTEMA] O usuário reconheceu que é o MESMO dinheiro já contado no custo evitado. NÃO gere preview de ' +
  'receita agora. Explique em 2 frases que ele precisa voltar à etapa de saving e remover o item duplicado do ' +
  'custo evitado (ou zerar a receita, se preferir mantê-lo lá) — e pare por aí, sem repetir a pergunta.'

export const NUDGE_SOBREPOSICAO_SEM_RESPOSTA =
  '[SISTEMA] A sobreposição entre receita e custo evitado foi apontada duas vezes e não houve escolha clara. ' +
  'SIGA normalmente — não pergunte de novo. Registre no memorial de receita a frase exata: ' +
  '"Sobreposição com o custo evitado apontada e não confirmada pelo autor — conferir na triagem."'

/**
 * O gate deve BLOQUEAR este resultado do LLM?
 * Só bloqueia preview/complete — pergunta intermediária do agente passa direto.
 *
 * ⚠️ `estado` tem de ser o valor VIVO (já mesclado neste turno). Ler o snapshot do topo
 * do turno é literalmente o loop de 38 perguntas do gate [1.4].
 */
export function deveBloquearPorSobreposicao(
  estado: EstadoSobreposicao | null | undefined,
  tipo: string,
): boolean {
  if (tipo !== 'preview' && tipo !== 'complete') return false
  return !sobreposicaoResolvida(estado)
}

/** Só faz sentido perguntar na fase de receita e com receita já declarada. */
export function aplicaGateSobreposicao(
  receita: ReceitaColetada | undefined,
  fase: string,
): boolean {
  if (fase !== 'receita' && fase !== 'receita_preview') return false
  return (Number(receita?.valor_ganho_mensal) || 0) > 0
}
