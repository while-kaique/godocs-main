// Validação da ETAPA 3 (os blocos de ganho) — módulo PURO.
//
// Na v1 isto era um `validate()` de 23 checagens DENTRO do `SavingForm`
// (`step3-chat.tsx:1169`), inalcançável por teste: o Vitest deste repo roda
// `environment: 'node'` e só inclui `tests/**/*.test.ts`, então validação dentro do
// componente é validação sem rede. O plano manda extrair, e é isto.
//
// ⚠️ Quem manda é `categorias`, NÃO a presença de dado no bloco. Trocar de categoria no
// meio do preenchimento deixa o bloco antigo preenchido no estado (de propósito — para a
// pessoa não perder o que digitou se voltar atrás), e ele não pode voltar à validação
// nem à conta pelas costas. É a mesma regra que `paraGanhosProjeto` aplica na fórmula.
import type { Frequencia } from '@/lib/impacto'
import {
  CATEGORIA_IMENSURAVEL,
  type GanhoCategoria,
  type GanhosDeclarados,
} from '@/lib/ganhos'
import { TIPO_SAVING_LABEL, unidadeHoras } from '@/lib/projeto-rotulos'
import { erroCategorias, savingLiquido } from '@/lib/ganhos'
import { numeroParaMoedaBR, parseMoedaBR, type FieldErrors } from './constants'
import { erroEvidencia, type AnexoEvidencia } from './evidencia'
import {
  linhaHorasVazia,
  linhasParaCustoEvitado,
  tabelaVazia,
  totalHorasLiberadas,
  validarLinhasHoras,
  type LinhaHorasInput,
} from './horas'
import {
  itemVazio,
  itensParaCustoRodar,
  listaVazia,
  validarItens,
  type ItemLista,
} from './itens-lista'

/** Piso do texto que justifica um número. Irmão do `EVIDENCIA_MIN`. */
export const RACIONAL_MIN = 20

/**
 * O estado da Etapa 3 como o formulário o carrega.
 *
 * Tudo string porque é o que os inputs devolvem (valores com máscara de moeda BR, horas
 * em texto): o número só nasce na conversão, que é onde a régua fail-closed age.
 */
export type GanhosFormData = {
  // ── Saving efetivado (o par antes/agora: o saving é a DIFERENÇA) ──
  /** Quanto saía do caixa ANTES, no período da frequência. */
  savingValorAntes: string
  /** Quanto sai AGORA. "0" quando a despesa acabou de vez. */
  savingValorAgora: string
  savingFrequencia: Frequencia | ''
  savingEvidencia: string
  savingAnexos: AnexoEvidencia[]

  // ── Custo evitado (os 2 braços somam antes do peso de 50%) ──
  ceFrequencia: Frequencia | ''
  ceLinhas: LinhaHorasInput[]
  ceNaoContratado: string
  ceRacional: string

  // ── Receita incremental ──
  receitaValor: string
  receitaFrequencia: Frequencia | ''
  receitaRacional: string
  /** O racional aceita print/anexo, como o campo de evidência dos outros blocos. */
  receitaAnexos: AnexoEvidencia[]

  // ── Ganho imensurável ──
  imensuravelRacional: string
  imensuravelAnexos: AnexoEvidencia[]

  // ── Custo para rodar (perguntado a TODOS, fora do acordeão) ──
  custoRodar: ItemLista[]
}


/** Uma linha/item sozinho está totalmente em branco? (reusa a régua de cada lista.) */
function itemEmBranco(item: ItemLista): boolean {
  return listaVazia([item])
}
function linhaEmBranco(linha: LinhaHorasInput): boolean {
  return tabelaVazia([linha])
}

/**
 * Erros de uma lista, IGNORANDO as linhas em branco.
 *
 * ⚠️ A tela sempre mantém uma linha visível (`removerItem` devolve uma em branco no lugar
 * da última), então "não declarei nada" chega aqui como uma linha vazia. Cobrar dela os 4
 * campos impediria de submeter projeto sem custo para rodar, que é caso normal. Mas linha
 * COMEÇADA tem de ser terminada: item pela metade é descartado na leitura da coluna, e
 * custo que desaparece INFLA o impacto.
 */
function errosDeLinhasPreenchidas<T>(
  itens: T[],
  emBranco: (item: T) => boolean,
  validar: (itens: T[]) => Record<string, string>,
  chaveDoIndice: (i: number) => string,
): FieldErrors {
  const todos = validar(itens)
  const ignorados = (itens ?? [])
    .map((item, i) => (emBranco(item) ? chaveDoIndice(i) : null))
    .filter((p): p is string => p !== null)
  const erros: FieldErrors = {}
  for (const [chave, msg] of Object.entries(todos)) {
    if (!ignorados.some((prefixo) => chave.startsWith(prefixo))) erros[chave] = msg
  }
  return erros
}

/** Texto com substância? (o piso vale para os racionais que justificam um número.) */
function racionalCurto(texto: string): boolean {
  return (texto ?? '').trim().length < RACIONAL_MIN
}

const MSG_RACIONAL = `Explique em pelo menos ${RACIONAL_MIN} caracteres`

/** Erros do bloco de UMA categoria. Categoria desconhecida devolve `{}`. */
export function validarBloco(
  categoria: GanhoCategoria,
  dados: GanhosFormData,
  opts: { hojeISO: string },
): FieldErrors {
  const errs: FieldErrors = {}

  if (categoria === 'saving_efetivado') {
    // ⚠️ O par antes/agora: o saving é a DIFERENÇA. "Agora" pode legitimamente ser 0 (a
    // despesa acabou), então o campo é cobrado por ESTAR PREENCHIDO, não por ser > 0 — e
    // um "agora" ≥ "antes" é erro NO CAMPO, porque aí não houve saving nenhum.
    const antes = parseMoedaBR(dados.savingValorAntes)
    const agoraPreenchido = (dados.savingValorAgora ?? '').trim() !== ''
    const agora = parseMoedaBR(dados.savingValorAgora)
    if (antes <= 0) {
      errs.savingValorAntes = 'Informe quanto a empresa pagava antes'
    }
    if (!agoraPreenchido) {
      errs.savingValorAgora = 'Informe quanto paga agora (0 se parou de pagar)'
    } else if (antes > 0 && agora >= antes) {
      errs.savingValorAgora = 'O valor de agora tem de ser MENOR que o de antes'
    }
    if (!dados.savingFrequencia) errs.savingFrequencia = 'Selecione a frequência'
    const erroEv = erroEvidencia(dados.savingEvidencia, dados.savingAnexos)
    if (erroEv) errs.savingEvidencia = erroEv
    return errs
  }

  if (categoria === 'custo_evitado') {
    if (!dados.ceFrequencia) errs.ceFrequencia = 'Selecione a frequência'

    // ⚠️ Ao menos UM dos dois braços. Os dois somam antes do peso de 50%, e ter só um é
    // caso normal (horas liberadas sem contratação evitada, ou o contrário).
    const temHoras = !tabelaVazia(dados.ceLinhas)
    const temNaoContratado = parseMoedaBR(dados.ceNaoContratado) > 0
    if (!temHoras && !temNaoContratado) {
      errs.ceBracos =
        'Informe as horas liberadas ou o valor que não chegou a ser contratado'
    }

    if (temHoras) {
      Object.assign(
        errs,
        errosDeLinhasPreenchidas(
          dados.ceLinhas,
          linhaEmBranco,
          validarLinhasHoras,
          (i) => `h${i}`,
        ),
      )
    }

    if (racionalCurto(dados.ceRacional)) errs.ceRacional = MSG_RACIONAL
    return errs
  }

  if (categoria === 'receita_incremental') {
    if (parseMoedaBR(dados.receitaValor) <= 0) {
      errs.receitaValor = 'Informe o valor da receita'
    }
    if (!dados.receitaFrequencia) errs.receitaFrequencia = 'Selecione a frequência'
    // O racional da receita usa a MESMA régua dos outros campos com prova (texto com
    // substância; anexo não substitui texto), porque ele também aceita print.
    const erroRac = erroEvidencia(dados.receitaRacional, dados.receitaAnexos)
    if (erroRac) errs.receitaRacional = erroRac
    return errs
  }

  if (categoria === CATEGORIA_IMENSURAVEL) {
    // ⚠️ Sem valor e sem frequência: a categoria não tem número por definição, e o que a
    // representa é a estrela (D5/D8). Cobrar número aqui negaria a própria categoria.
    const erroEv = erroEvidencia(dados.imensuravelRacional, dados.imensuravelAnexos)
    if (erroEv) errs.imensuravelRacional = erroEv
    return errs
  }

  return errs
}

/** O bloco está pronto? (é o que fecha o bloco e abre o próximo no acordeão). */
export function blocoCompleto(
  categoria: GanhoCategoria,
  dados: GanhosFormData,
  opts: { hojeISO: string },
): boolean {
  return Object.keys(validarBloco(categoria, dados, opts)).length === 0
}

/** A linha de resumo que o acordeão mostra com o bloco FECHADO. Vazio → `''`. */
export function resumoBloco(categoria: GanhoCategoria, dados: GanhosFormData): string {
  const freq = (f: string) => (f ? (TIPO_SAVING_LABEL[f] ?? f) : '')
  const juntar = (partes: (string | null)[]) =>
    partes.filter((p): p is string => !!p && p.trim() !== '').join(' · ')

  if (categoria === 'saving_efetivado') {
    // O resumo mostra o SAVING (a diferença), que é o número do projeto — não a ponta
    // "antes", que sozinha exagera o ganho quando a despesa só encolheu.
    const economia = savingLiquido(
      parseMoedaBR(dados.savingValorAntes),
      parseMoedaBR(dados.savingValorAgora),
    )
    if (economia <= 0) return ''
    return juntar([
      `R$ ${numeroParaMoedaBR(economia)}`,
      freq(dados.savingFrequencia),
    ])
  }

  if (categoria === 'custo_evitado') {
    const horas = totalHorasLiberadas(dados.ceLinhas)
    const naoContratado = parseMoedaBR(dados.ceNaoContratado)
    if (horas <= 0 && naoContratado <= 0) return ''
    const unidade = unidadeHoras(dados.ceFrequencia || 'mensal')
    return juntar([
      horas > 0
        ? `${horas.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unidade}`
        : null,
      naoContratado > 0 ? `R$ ${dados.ceNaoContratado} não contratado` : null,
      freq(dados.ceFrequencia),
    ])
  }

  if (categoria === 'receita_incremental') {
    if (parseMoedaBR(dados.receitaValor) <= 0) return ''
    return juntar([`R$ ${dados.receitaValor}`, freq(dados.receitaFrequencia)])
  }

  if (categoria === CATEGORIA_IMENSURAVEL) {
    const texto = (dados.imensuravelRacional ?? '').trim()
    if (texto === '') return ''
    return texto.length > 70 ? `${texto.slice(0, 70)}...` : texto
  }

  return ''
}

/** Erros do custo para rodar — opcional, mas linha começada tem de ser terminada. */
export function validarCustoRodar(dados: GanhosFormData): FieldErrors {
  return errosDeLinhasPreenchidas(
    dados.custoRodar,
    itemEmBranco,
    (itens) => validarItens(itens, 'cr'),
    (i) => `cr${i}`,
  )
}

/**
 * Toda a Etapa 3: as categorias MARCADAS + o custo para rodar.
 *
 * Seleção inválida (vazia, ou imensurável misturado com mensurável) é erro próprio em
 * `ganhoCategorias` — a régua é `categoriasValidas`, não redigitada aqui.
 */
export function validarEtapa3(
  categorias: GanhoCategoria[],
  dados: GanhosFormData,
  opts: { hojeISO: string },
): FieldErrors {
  const errs: FieldErrors = {}

  // ⚠️ A MENSAGEM sai de `erroCategorias` (`@/lib/ganhos`), fonte única com o portão da
  // Etapa 2: as duas frases estavam digitadas nos dois lugares.
  const erroSelecao = erroCategorias(categorias)
  if (erroSelecao) errs.ganhoCategorias = erroSelecao

  for (const categoria of categorias ?? []) {
    Object.assign(errs, validarBloco(categoria, dados, opts))
  }

  Object.assign(errs, validarCustoRodar(dados))
  return errs
}

/**
 * O estado do formulário traduzido para o modelo da T3 (`GanhosDeclarados`), que é o que
 * `paraGanhosProjeto` consome para chegar na fórmula.
 *
 * ⚠️ `custoEvitado.valorHoras` sai ZERO aqui de propósito: o R$ da hora é derivado no
 * BACKEND (`resolverValorHora`, `saving-calc.ts`), o único lugar onde o valor por cargo
 * existe. Preencher isto no cliente exporia valor/hora ao submissor — decisão da v1 que
 * a v2 mantém.
 *
 * ⚠️ Só o que está MARCADO atravessa (RF-218): bloco preenchido de categoria desmarcada é
 * resíduo de troca de seleção. O dado FICA no formulário (para a pessoa não perdê-lo se
 * voltar atrás), mas não volta à conta pelas costas.
 */
export function paraGanhosDeclarados(
  categorias: GanhoCategoria[],
  dados: GanhosFormData,
): GanhosDeclarados {
  const marcadas = categorias ?? []
  const declarado: GanhosDeclarados = { categorias: [...marcadas] }

  if (marcadas.includes('saving_efetivado')) {
    declarado.savingEfetivado = {
      valorAntes: parseMoedaBR(dados.savingValorAntes),
      valorAgora: parseMoedaBR(dados.savingValorAgora),
      frequencia: (dados.savingFrequencia || 'mensal') as Frequencia,
      evidencia: dados.savingEvidencia,
    }
  }

  if (marcadas.includes('custo_evitado')) {
    declarado.custoEvitado = {
      frequencia: (dados.ceFrequencia || 'mensal') as Frequencia,
      linhasHoras: linhasParaCustoEvitado(dados.ceLinhas),
      valorHoras: 0,
      naoContratado: parseMoedaBR(dados.ceNaoContratado),
      racional: dados.ceRacional,
    }
  }

  if (marcadas.includes('receita_incremental')) {
    declarado.receitaIncremental = {
      valor: parseMoedaBR(dados.receitaValor),
      frequencia: (dados.receitaFrequencia || 'mensal') as Frequencia,
      racional: dados.receitaRacional,
    }
  }

  if (marcadas.includes(CATEGORIA_IMENSURAVEL)) {
    declarado.imensuravel = { racional: dados.imensuravelRacional }
  }

  // Perguntado a TODOS, independentemente da categoria (fora do acordeão).
  declarado.custoRodar = itensParaCustoRodar(dados.custoRodar)

  return declarado
}

/** Estado inicial: uma linha em branco em cada lista, para a tela ter o que mostrar. */
export function ganhosFormVazio(): GanhosFormData {
  return {
    savingValorAntes: '',
    savingValorAgora: '',
    savingFrequencia: '',
    savingEvidencia: '',
    savingAnexos: [],
    ceFrequencia: '',
    ceLinhas: [linhaHorasVazia()],
    ceNaoContratado: '',
    ceRacional: '',
    receitaValor: '',
    receitaFrequencia: '',
    receitaRacional: '',
    receitaAnexos: [],
    imensuravelRacional: '',
    imensuravelAnexos: [],
    custoRodar: [itemVazio()],
  }
}

export { CATEGORIA_IMENSURAVEL }
