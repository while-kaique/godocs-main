// As 4 CATEGORIAS DE GANHO do GoDocs v2 — módulo PURO: o modelo declarado pelo
// FORMULÁRIO e a PONTE até o núcleo do impacto (`src/lib/impacto.ts`).
//
// T3 do plano `docs/plans/godocs-v2-submissao-deterministica.md`. Divisão de trabalho
// entre os dois módulos, para não nascerem duas cabeças:
//
//   impacto.ts  →  a FÓRMULA (pesos, divisores, as 3 contas). Fonte única.
//   ganhos.ts   →  o MODELO (o que a pessoa marca e digita) + a régua da seleção,
//                  e a tradução de um para o outro (`paraGanhosProjeto`).
//
// ⚠️ `Frequencia` e o divisor vêm de `./impacto` por IMPORT, nunca redeclarados aqui:
// uma cópia do enum ou um `?? 1` local passaria por qualquer teste com literais e
// devolveria a fórmula ao estado da v1, redigitada em 5 lugares. É a amarra registrada
// no handoff da T2.
//
// ⚠️ A régua que separa as duas primeiras categorias é UMA pergunta: **esse dinheiro
// estava saindo do caixa antes desta solução?**
//   Sim, e parou            → SAVING EFETIVADO. Comprovável em extrato/fatura/contrato
//                             encerrado, por isso pede EVIDÊNCIA e pesa 100%.
//   Não, ia começar a sair  → CUSTO EVITADO. A despesa nunca nasceu, não existe extrato
//                             de algo que não aconteceu, por isso NÃO pede evidência e
//                             pesa 50%.
// Corolário que o produto fechou (D1): hora liberada de quem continua na folha **não é
// dinheiro no bolso**, é capacidade que se deixou de comprar — logo é custo evitado, e
// é por isso que a tabela de horas antes/depois vive naquele bloco, não no saving.
//
// ⚠️ O GANHO IMENSURÁVEL é EXCLUSIVO das outras três (RF-202) e fica FORA de toda conta
// (RF-219). Não é "zero por enquanto": é um projeto cuja relevância se expressa pela
// ESTRELA, não por R$. Deixar as duas coisas coexistirem devolveria a ambiguidade que a
// v2 existe para separar.

// ─────────────────────── DECISÕES DESTA FATIA (T3), REGISTRADAS ───────────────────────
//
// 1. ⚠️ **A T3 do plano diz "Tipos em `agents/types.ts`/`submeter/constants.ts`", e este
//    módulo é um TERCEIRO endereço.** A troca foi autorizada explicitamente (Luis,
//    02/09/2026) por três razões: `agents/types.ts` é o arquivo que a **T9 demole**, ele
//    mistura o financeiro com 8 estados de gate de CONVERSA (que a v2 não tem) e é
//    importado por 26 arquivos. **Não "conserte" movendo estes tipos para lá** — a letra
//    do plano é anterior à decisão.
//
// 2. **`categoriasValidas` é um superconjunto do que o plano especificou.** O plano pede
//    "imensurável XOR o resto"; ela também recusa lista VAZIA e entrada com categoria
//    desconhecida ou duplicada. É fail-closed deliberado: a função é portão de submissão,
//    e portão não deve dar "válido" para lista que não reconhece. Não é gate de conversa
//    (a Fronteira do plano proíbe esses) — é validação de formulário, pura e sem estado.
//
// 3. **A régua da Etapa 2 tem 2 endereços até a T5.** O "ao menos um tipo" e a
//    exclusividade da v1 vivem INLINE e duplicados em `routes/submeter.tsx` (:1611,
//    :2109, :1556) sobre o vocabulário ANTIGO (`saving`/`receita_incremental` + flag
//    `especial`), em código que a T5 remove por escrito. ⚠️ A T5 tem de apagar aquele par
//    inline no MESMO commit em que ligar `categoriasValidas`, senão a régua nasce com
//    duas cabeças.
//
// 4. **De onde sai `custoEvitado.valorHoras` ainda NÃO está decidido.** Ele entra aqui
//    como número pronto. O canônico que converte hora em R$ é `CARGOS`
//    (`agents/types.ts`, label + `valor_hora`) resolvido por `resolverValorHora`
//    (`agents/saving-calc.ts`, que já carrega o fix do falso-zero e o piso conservador).
//    ⚠️ A T4/T5 deve REUSAR aquele caminho — escrever uma segunda tabela de valor/hora é
//    a doença ("fórmula em 5 lugares") que esta frente existe para curar.
//
// 5. **As 3 colunas `impacto_*` são escopo emprestado da T6.** São derivadas e nada as
//    escreve ainda; existem para a planilha/rollup/telas lerem sem recalcular, e o
//    cabeçalho proposto da T6 já as lista. Sempre gravadas a partir de `impacto.ts`.
//
// 6. **Um `tipos_projeto` da v1 lido como `ganho_categorias` devolveria lista PARCIAL**
//    (`'saving'` é descartado, `'receita_incremental'` sobrevive, e `categoriasValidas`
//    aprova o que sobrou), porque o literal `receita_incremental` é compartilhado pelos
//    dois vocabulários. Não é tratado aqui de propósito: o descarte-e-sobrevive é o
//    contrato testado, a v2 nasce ZERADA e sem migração, e nenhum caminho liga as duas
//    gerações. ⚠️ Se a T6 algum dia ler dado da v1 nestas colunas, isto vira defeito.
//
import { DIVISOR_FREQUENCIA } from './impacto'
import type { Frequencia, GanhosProjeto } from './impacto'

/**
 * As 4 categorias, na ORDEM CANÔNICA.
 *
 * ⚠️ Esta ordem é a de serialização e a de exibição — mexer nela muda a string gravada.
 * Ela existe justamente para a string NÃO depender da ordem dos cliques: o
 * `metaChanged` do wizard compara o que foi gravado, e ordem por clique faz a MESMA
 * escolha parecer mudança (o defeito já documentado em `serializarFerramentas`).
 */
export const GANHO_CATEGORIAS = [
  'saving_efetivado',
  'custo_evitado',
  'receita_incremental',
  'imensuravel',
] as const

export type GanhoCategoria = (typeof GANHO_CATEGORIAS)[number]

/** A categoria sem número. Nomeada para o código não redigitar a literal. */
export const CATEGORIA_IMENSURAVEL: GanhoCategoria = 'imensuravel'

/** As que têm número e, por isso, entram na fórmula. Combinam livremente entre si. */
export const CATEGORIAS_MENSURAVEIS: readonly GanhoCategoria[] = GANHO_CATEGORIAS.filter(
  (c): c is GanhoCategoria => c !== CATEGORIA_IMENSURAVEL,
)

// ─── os blocos, como o formulário da Etapa 3 os entrega ─────────────────────────

/**
 * Saving efetivado: a linha de custo existia e PAROU.
 *
 * `evidencia` é o texto obrigatório que amarra o número a ESTA solução (RF-208: anexo
 * sem texto é recusado — a prova sozinha não diz por que o ganho é desta automação), e
 * `desde` é a data em que o ganho passou a valer (RF-209).
 */
export type SavingEfetivado = {
  valor: number
  frequencia: Frequencia
  evidencia: string
  desde: string
}

/**
 * Uma linha da tabela de horas antes/depois, por função.
 *
 * `funcaoDescricao` só existe quando a função é "Outro" (RF-211).
 */
export type CustoEvitadoLinhaHoras = {
  funcao: string
  funcaoDescricao?: string
  horasAntes: number
  horasDepois: number
}

/**
 * Custo evitado: a despesa NUNCA nasceu.
 *
 * Tem **dois braços** que somam ANTES do peso de 50%: as horas liberadas (a tabela
 * antes/depois, cujo R$ derivado é `valorHoras`) e o que não chegou a ser contratado.
 * ⚠️ A frequência é do BLOCO, não de cada braço — não existe "horas trimestrais + não
 * contratado mensal" no mesmo bloco.
 */
export type CustoEvitado = {
  frequencia: Frequencia
  linhasHoras: CustoEvitadoLinhaHoras[]
  valorHoras: number
  naoContratado: number
  racional: string
}

/** Receita incremental: dinheiro NOVO entrando. Pesa 10%. */
export type ReceitaIncremental = {
  valor: number
  frequencia: Frequencia
  racional: string
  tipo: string
}

/** Ganho imensurável: só o racional. Sem número, por definição. */
export type GanhoImensuravel = {
  racional: string
}

/** Um item do custo para rodar. `oQueE` é o "o que é isso" que a pessoa escreve. */
export type CustoRodarItem = {
  nome: string
  valor: number
  frequencia: Frequencia
  oQueE: string
}

/**
 * A lista incremental do custo para rodar — a FUSÃO das duas linhas de custo da v1
 * (`custo_externo_mensal` e `custo_projeto_itens`), que economicamente sempre foram a
 * mesma coisa e que ninguém distinguia (D3).
 */
export type CustoRodar = CustoRodarItem[]

/**
 * O ganho de um projeto como o formulário o declara.
 *
 * ⚠️ Quem manda é **`categorias`**, não a presença do bloco: trocar de categoria no meio
 * do preenchimento deixa o bloco antigo preenchido no estado, e ele não pode voltar à
 * conta pelas costas. `paraGanhosProjeto` só olha o que está MARCADO.
 */
export type GanhosDeclarados = {
  categorias: GanhoCategoria[]
  savingEfetivado?: SavingEfetivado
  custoEvitado?: CustoEvitado
  receitaIncremental?: ReceitaIncremental
  imensuravel?: GanhoImensuravel
  custoRodar?: CustoRodar
}

// ─── a régua da seleção (RF-202) ────────────────────────────────────────────────

/** Só as categorias conhecidas, na ordem canônica, sem duplicata. */
function canonizar(categorias: readonly GanhoCategoria[]): GanhoCategoria[] {
  const marcadas = new Set(categorias ?? [])
  return GANHO_CATEGORIAS.filter((c) => marcadas.has(c))
}

/**
 * A seleção é válida? (RF-202 + "ao menos uma")
 *
 * Recusa a lista vazia (todo projeto declara algum ganho) e recusa a MISTURA do
 * imensurável com qualquer mensurável — o caso que a régua existe para barrar: número e
 * "não tem número" no mesmo projeto. As 3 mensuráveis combinam livremente.
 *
 * ⚠️ Também recusa entrada com categoria desconhecida ou duplicada (fail-closed): a
 * função é usada como portão de submissão, e portão não deve dar "válido" para lista
 * que ele não reconhece.
 */
export function categoriasValidas(categorias: GanhoCategoria[]): boolean {
  const lista = categorias ?? []
  if (lista.length === 0) return false
  const canonica = canonizar(lista)
  // desconhecida ou duplicada: o canônico não bate com o que veio
  if (canonica.length !== lista.length) return false
  const temImensuravel = canonica.includes(CATEGORIA_IMENSURAVEL)
  const temMensuravel = canonica.some((c) => c !== CATEGORIA_IMENSURAVEL)
  return !(temImensuravel && temMensuravel)
}

/**
 * A mensagem de erro da seleção — FONTE ÚNICA do texto que o usuário lê.
 *
 * Nasceu porque as duas frases estavam digitadas em DOIS lugares (o portão da tela de
 * seleção e a rede do envio, `validarEtapa3`): régua compartilhada com texto duplicado é
 * como a v1 acabou com a mesma frase em 3 arquivos. Quem decide "é válido?" continua
 * sendo `categoriasValidas` — aqui só se escolhe QUAL das duas falhas explicar.
 *
 * Devolve `undefined` quando a seleção está válida (mesma forma de um `FieldErrors`).
 */
export function erroCategorias(categorias: GanhoCategoria[]): string | undefined {
  const lista = categorias ?? []
  if (categoriasValidas(lista)) return undefined
  return lista.length === 0
    ? 'Selecione ao menos um tipo de ganho'
    : 'Ganho imensurável não combina com os outros tipos: ou o ganho tem número, ou não tem'
}

/**
 * O clique num checkbox de categoria — com a exclusividade aplicada nos DOIS sentidos.
 *
 * É **toggle**: clicar numa já marcada desmarca. Marcar o imensurável deixa só ele;
 * marcar qualquer mensurável tira o imensurável. O resultado sai sempre na ordem
 * canônica e sem duplicata, e a lista recebida nunca é mutada.
 *
 * ⚠️ A exclusividade mora AQUI, no clique, e não só na validação do envio: deixar a
 * tela mostrar "imensurável + saving marcados" e só reclamar no fim é pedir para a
 * pessoa preencher dois blocos e perder um.
 */
export function alternarCategoria(
  atuais: GanhoCategoria[],
  alvo: GanhoCategoria,
): GanhoCategoria[] {
  const marcadas = canonizar(atuais ?? [])
  if (marcadas.includes(alvo)) {
    return marcadas.filter((c) => c !== alvo)
  }
  if (alvo === CATEGORIA_IMENSURAVEL) return [CATEGORIA_IMENSURAVEL]
  return canonizar([...marcadas.filter((c) => c !== CATEGORIA_IMENSURAVEL), alvo])
}

// ─── serialização (a coluna `projetos.ganho_categorias`) ────────────────────────

/**
 * A seleção como JSON array, na ordem CANÔNICA.
 *
 * JSON (e não a string com separador de `serializarFerramentas`) porque este é o
 * mesmo formato do `tipos_projeto` da v1 — o campo que esta coluna substitui — e
 * porque o vocabulário é fechado, sem "Outros: <texto>" para acomodar.
 */
export function serializarCategorias(categorias: GanhoCategoria[]): string {
  return JSON.stringify(canonizar(categorias ?? []))
}

/**
 * O inverso: reabre a seleção gravada, na ordem canônica.
 *
 * ⚠️ NUNCA lança e NUNCA inventa categoria. Entrada nula/vazia, JSON inválido, JSON que
 * não é array, e itens desconhecidos ou não-string são simplesmente DESCARTADOS — o que
 * sobra são as categorias conhecidas. O motivo é o caminho da falha: esta função roda ao
 * reabrir um projeto para edição, e um throw aqui derrubaria a tela inteira por causa de
 * uma célula digitada à mão na planilha.
 */
export function desserializarCategorias(
  bruto: string | null | undefined,
): GanhoCategoria[] {
  const conhecidas = lerArrayJson(bruto).filter(
    (item): item is GanhoCategoria =>
      typeof item === 'string' && (GANHO_CATEGORIAS as readonly string[]).includes(item),
  )
  return canonizar(conhecidas)
}

// ─── serialização dos 2 shapes JSON (as colunas `_horas_linhas` e `custo_rodar_itens`) ───

/**
 * ⚠️ A coluna guarda **snake_case** e o tipo TS é **camelCase**, e são estes 4 pares que
 * fazem a tradução — não deixe nenhum consumidor fazer `JSON.parse` direto no valor da
 * coluna.
 *
 * O motivo é o modo de falha: `JSON.parse` de uma chave trocada não dá erro, devolve
 * `undefined`. Sem estes pares, `funcao_descricao` lido como `funcaoDescricao` apagaria em
 * SILÊNCIO a descrição do "Outro" (RF-211), e `o_que_e` lido como `oQueE` apagaria o "o
 * que é" de cada item de custo. Cada lado mantém a convenção da sua casa: toda coluna
 * deste banco é snake_case, todo campo TS do repo é camelCase.
 */
type LinhaHorasGravada = {
  funcao: string
  funcao_descricao?: string
  horas_antes: number
  horas_depois: number
}

type CustoRodarItemGravado = {
  nome: string
  valor: number
  frequencia: Frequencia
  o_que_e: string
}

/** Texto não-vazio? (chave ausente, `null`, número e string em branco reprovam.) */
function textoPreenchido(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

/** Número que dá para somar? (`null`, `undefined`, `NaN`, `Infinity` e string reprovam.) */
function numeroUtil(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Uma das 4 frequências do enum de `impacto.ts`? */
function frequenciaConhecida(v: unknown): v is Frequencia {
  return typeof v === 'string' && (GANHO_FREQUENCIAS as readonly string[]).includes(v)
}

/**
 * As 4 frequências, derivadas do `DIVISOR_FREQUENCIA` de `impacto.ts` — NÃO redigitadas.
 *
 * ⚠️ É a única forma de a validação daqui não virar uma segunda lista para manter em
 * sincronia: frequência nova na fórmula passa a ser aceita aqui sozinha.
 */
const GANHO_FREQUENCIAS: readonly string[] = Object.keys(DIVISOR_FREQUENCIA)

/**
 * As linhas de horas para a coluna, em snake_case.
 *
 * ⚠️ Este lado (linhas de HORAS) **não valida**, é tradutor puro — diferente do
 * `serializarCustoRodar`, que valida. A régua que separa os dois é o que o dado custa
 * quando desaparece: linha de horas é ILUSTRATIVA (o R$ do braço mora na coluna
 * `custo_evitado_horas_valor`, à parte), enquanto item de custo é a única parcela
 * NEGATIVA da fórmula, e perdê-lo INFLA o impacto.
 *
 * ⚠️ **Não confie na assimetria para preservar dado torto — ela NÃO preserva.** O efeito
 * combinado é pior que um throw: `horasAntes: NaN` é gravado como `"horas_antes": null`
 * (`JSON.stringify` faz isso) e, na volta, `desserializarLinhasHoras` **descarta a linha
 * inteira**; um item de custo com `frequencia: 'anual'` é descartado igual. Ou seja, hoje
 * o round-trip só é fiel para dado BEM-FORMADO, e o malformado desaparece calado.
 *
 * ⚠️ E não é o rascunho que está em jogo: o rascunho da submissão vive em `localStorage`
 * (`submeter/draft-storage.ts`) — esta coluna só é escrita no SUBMIT. Logo não existe o
 * caminho "formulário meio preenchido" que justificaria tolerar valor não finito aqui.
 * **Decisão para a T5, quando o formulário passar a escrever de verdade:** ou a validação
 * da Etapa 3 garante o bem-formado antes de chegar aqui, ou estes dois `serializar*`
 * passam a chamar o `valorFinito` e falham no submit com erro nomeado — o que é melhor
 * que perder uma linha de horas em silêncio.
 */
export function serializarLinhasHoras(linhas: CustoEvitadoLinhaHoras[]): string {
  const gravadas: LinhaHorasGravada[] = (linhas ?? []).map((linha) => {
    const gravada: LinhaHorasGravada = {
      funcao: linha.funcao,
      horas_antes: linha.horasAntes,
      horas_depois: linha.horasDepois,
    }
    // Só entra quando há texto: chave presente valendo `undefined` faria a comparação da
    // edição acusar mudança onde ninguém mexeu.
    if (textoPreenchido(linha.funcaoDescricao)) {
      gravada.funcao_descricao = linha.funcaoDescricao
    }
    return gravada
  })
  return JSON.stringify(gravadas)
}

/**
 * A volta: lê a coluna e devolve o tipo camelCase.
 *
 * ⚠️ NUNCA lança (roda ao abrir a tela de edição) e **DESCARTA** a linha que não dá para
 * usar — sem `funcao`, ou com horas que não são número finito. Descartar é o que impede
 * um `NaN` de entrar na fórmula: `NaN` num `reduce` de rollup zera o total da área, e
 * `JSON.stringify(NaN)` vira `null`, então o campo de dinheiro chegaria nulo ao Gomoon em
 * vez de dar erro. É a mesma disciplina do `divisorDe` ("não adivinha") com o custo
 * pago em silêncio, e é aceitável porque **o único escritor desta coluna é o
 * `serializarLinhasHoras` acima** — linha malformada aqui significa banco editado à mão
 * ou bug, não dado legítimo de usuário.
 */
export function desserializarLinhasHoras(
  bruto: string | null | undefined,
): CustoEvitadoLinhaHoras[] {
  const itens = lerArrayJson(bruto)
  const linhas: CustoEvitadoLinhaHoras[] = []
  for (const item of itens) {
    if (!item || typeof item !== 'object') continue
    const cru = item as Record<string, unknown>
    if (!textoPreenchido(cru.funcao)) continue
    if (!numeroUtil(cru.horas_antes) || !numeroUtil(cru.horas_depois)) continue
    const linha: CustoEvitadoLinhaHoras = {
      funcao: cru.funcao,
      horasAntes: cru.horas_antes,
      horasDepois: cru.horas_depois,
    }
    if (textoPreenchido(cru.funcao_descricao)) {
      linha.funcaoDescricao = cru.funcao_descricao
    }
    linhas.push(linha)
  }
  return linhas
}

/**
 * Os itens do custo para rodar para a coluna, em snake_case.
 *
 * ⚠️ Este lado **VALIDA**, ao contrário do `serializarLinhasHoras` — e a diferença não é
 * inconsistência, é a natureza do dado. O custo para rodar é a **única parcela NEGATIVA**
 * da fórmula, e o descarte silencioso do lado da leitura tem direção **gameável**: um item
 * que evapora deixa de subtrair e o impacto líquido sobe. É a mesma direção que o
 * `Math.max(0, …)` de `impacto.ts` blinda de propósito. Linha de horas descartada custa
 * uma explicação incompleta; item de custo descartado custa dinheiro a mais no relatório.
 *
 * Como o único escritor desta coluna é esta função, validar aqui é o que torna verdadeiro
 * o "o item malformado só pode vir de banco editado à mão" que a leitura assume. Falha no
 * SUBMIT, com o campo nomeado — melhor que um custo desaparecer calado.
 */
export function serializarCustoRodar(itens: CustoRodar): string {
  const gravados: CustoRodarItemGravado[] = (itens ?? []).map((item, i) => {
    if (!frequenciaConhecida(item.frequencia)) {
      throw new Error(
        `[ganhos] custoRodar[${i}].frequencia desconhecida: ${JSON.stringify(item.frequencia)}. ` +
          `Esperado uma de ${GANHO_FREQUENCIAS.join(' · ')}. Gravar assim faria o item ` +
          `ser DESCARTADO na leitura, e custo que desaparece INFLA o impacto.`,
      )
    }
    return {
      nome: item.nome,
      valor: valorFinito(item.valor, `custoRodar[${i}].valor`),
      frequencia: item.frequencia,
      o_que_e: item.oQueE,
    }
  })
  return JSON.stringify(gravados)
}

/**
 * A volta dos itens de custo. NUNCA lança e **DESCARTA** o item inutilizável: sem `nome`,
 * com `valor` não finito, ou com `frequencia` fora das 4 do enum.
 *
 * ⚠️ A checagem da frequência aqui não é redundante com o `divisorDe`: o vocabulário das
 * fontes da v1 é MAIOR que o enum (`custoPeriodicidade` tem `'anual'` e `''`), e sem o
 * descarte um `'anual'` gravado atravessaria a leitura e só explodiria muito depois,
 * dentro da fórmula, longe de onde o dado entrou.
 */
export function desserializarCustoRodar(bruto: string | null | undefined): CustoRodar {
  const itens = lerArrayJson(bruto)
  const lista: CustoRodar = []
  for (const item of itens) {
    if (!item || typeof item !== 'object') continue
    const cru = item as Record<string, unknown>
    if (!textoPreenchido(cru.nome)) continue
    if (!numeroUtil(cru.valor)) continue
    if (!frequenciaConhecida(cru.frequencia)) continue
    lista.push({
      nome: cru.nome,
      valor: cru.valor,
      frequencia: cru.frequencia,
      oQueE: textoPreenchido(cru.o_que_e) ? cru.o_que_e : '',
    })
  }
  return lista
}

/** JSON que deveria ser array → array de itens crus. Nunca lança; nunca inventa. */
function lerArrayJson(bruto: string | null | undefined): unknown[] {
  if (typeof bruto !== 'string' || bruto.trim() === '') return []
  try {
    const cru: unknown = JSON.parse(bruto)
    return Array.isArray(cru) ? cru : []
  } catch {
    return []
  }
}

// ─── a ponte com a fórmula (T2) ─────────────────────────────────────────────────

/**
 * Guarda FAIL-CLOSED do valor, irmã do `divisorDe` de `impacto.ts`.
 *
 * ⚠️ `impacto.ts` blinda a metade "frequência" de cada bloco e explica o porquê no topo
 * do arquivo; a metade "valor" atravessava sem checagem nenhuma, e o sintoma medido é o
 * pior possível: o MESMO input com `valor: undefined` dava **líquido 0 e mensal NaN** —
 * uma tela mostrando o líquido pareceria sã enquanto o número empurrado ao Gomoon ia como
 * `null` (`JSON.stringify(NaN)`), e um `NaN` num `reduce` de rollup zera o total da área.
 *
 * A entrada real destes campos é o SQLite (`number | null` em `ProjetoRow`) e o
 * formulário, não um literal bem tipado — o TypeScript não protege essa borda.
 *
 * ⚠️ `0` e valores NEGATIVOS passam de propósito: zero é valor legítimo (um braço do
 * custo evitado zerado é caso normal) e o clamp do custo negativo é de `impacto.ts`, que
 * já o faz onde o sinal importa. Só o **não-finito** lança.
 */
function valorFinito(valor: number, campo: string): number {
  if (!Number.isFinite(valor)) {
    throw new Error(
      `[ganhos] ${campo} não é um número utilizável: ${JSON.stringify(valor)}. ` +
        `Um valor não finito viraria NaN na fórmula e null no JSON de dinheiro.`,
    )
  }
  return valor
}


/**
 * Traduz o ganho DECLARADO para o `GanhosProjeto` que `impacto.ts` consome.
 *
 * Esta função existe para que nenhum consumidor (formulário, sync, rollup, analisador)
 * monte esse mapeamento à mão — foi exatamente assim que a v1 acabou com a fórmula
 * replicada em 5 lugares. Quem quer o impacto chama daqui e passa a `impacto.ts`.
 *
 * Duas regras que a tradução carrega:
 *
 *  - **RF-218 — bloco não marcado entra como ZERO.** Só o que está em `categorias`
 *    atravessa; bloco preenchido de categoria desmarcada é resíduo de troca de seleção
 *    e é ignorado, sem apagar o dado do formulário.
 *  - **RF-219 — imensurável fica FORA de toda conta.** Projeto imensurável devolve
 *    impacto ZERO nas três contas. ⚠️ Inclusive o **custo para rodar** é deixado de
 *    fora: ele é perguntado a todo mundo (RF-214), e subtraí-lo de um ganho que não
 *    existe daria impacto NEGATIVO, jogando o imensurável abaixo de um projeto sem
 *    nenhum ganho — o oposto de "não entra na conta".
 */
export function paraGanhosProjeto(g: GanhosDeclarados): GanhosProjeto {
  const marcadas = canonizar(g.categorias ?? [])

  if (marcadas.includes(CATEGORIA_IMENSURAVEL)) {
    return { imensuravel: true }
  }

  const projeto: GanhosProjeto = {}

  if (marcadas.includes('saving_efetivado') && g.savingEfetivado) {
    projeto.savingEfetivado = {
      valor: valorFinito(g.savingEfetivado.valor, 'savingEfetivado.valor'),
      frequencia: g.savingEfetivado.frequencia,
    }
  }

  if (marcadas.includes('custo_evitado') && g.custoEvitado) {
    // Os dois braços somam ANTES do peso; a frequência é a do BLOCO.
    projeto.custoEvitado = {
      horas: valorFinito(g.custoEvitado.valorHoras, 'custoEvitado.valorHoras'),
      naoContratado: valorFinito(
        g.custoEvitado.naoContratado,
        'custoEvitado.naoContratado',
      ),
      frequencia: g.custoEvitado.frequencia,
    }
  }

  if (marcadas.includes('receita_incremental') && g.receitaIncremental) {
    projeto.receita = {
      valor: valorFinito(g.receitaIncremental.valor, 'receitaIncremental.valor'),
      frequencia: g.receitaIncremental.frequencia,
    }
  }

  // O custo para rodar é perguntado independentemente da categoria (fora do acordeão).
  if (g.custoRodar && g.custoRodar.length > 0) {
    projeto.custoRodar = g.custoRodar.map((item, i) => ({
      valor: valorFinito(item.valor, `custoRodar[${i}].valor`),
      frequencia: item.frequencia,
    }))
  }

  return projeto
}
