/**
 * Gate determinístico — GANHO REAL × GANHO PROJETADO.
 *
 * A premissa nº 1 do formulário é a pergunta da Etapa 1: **"Este projeto já está em
 * produção?"** — quem responde "ainda está sendo desenvolvido" ou "está pronto, mas ainda
 * não é utilizado" não passa da Etapa 1 (`validarEtapa1`, `submeter/constants.ts`). Logo,
 * todo projeto que chega ao chat DECLAROU que já roda. O memorial financeiro tem de
 * respeitar isso: o ganho documentado é o que JÁ ACONTECEU e FOI MEDIDO, nunca a
 * expectativa do que a solução deve trazer quando estiver pronta.
 *
 * Origem (projeto `a2172a9ff26a…` / "Automação cadastro de novos cliente", Eduardo
 * Santana, 28/07/2026 — R$ 10.000/mês de receita incremental): o agente desconfiou e
 * perguntou DUAS vezes qual dado sustentava a conversão de 1% usada na conta. O autor
 * respondeu com total honestidade: *"é uma premissa conservadora, **não um número medido**
 * — **ainda não temos histórico** de checkout self-service porque ele é justamente o que o
 * projeto habilita"*. Segundos depois o agente gerou o preview e **copiou a confissão para
 * dentro do memorial** ("A taxa de 1% não é histórico medido; é uma premissa de piso"),
 * que foi aprovado e gravado como ganho realizado. A doc aprovada no mesmo projeto dizia
 * que o endpoint que gera a receita ainda precisava ser implementado.
 *
 * Duas falhas distintas, as duas cobertas aqui:
 *   1. `buildReceitaPrompt` NÃO tinha o portão "real × projetado" que o saving e o custo
 *      evitado já tinham — só duas linhas genéricas ("não projeções otimistas"). Corrigido
 *      com a fonte única `blocoGanhoRealProjetado()` em `orchestrator.ts`.
 *   2. Prompt sozinho não segura — mesma lição do Gostream (gate ≥44h) e do custo evitado
 *      puro: o LLM percebe, avisa, e completa igual. Daí este gate DETERMINÍSTICO.
 *
 * ⚠️ ANTI-LOOP — este repo já queimou duas vezes (o gate [1.4] com 38 perguntas em prod e
 * o forçamento do carga×escala, removido em 03/07/2026 por gerar loop na edição). As
 * mesmas quatro travas do gate de sobreposição, por construção:
 *   (a) NO MÁXIMO 2 perguntas: 'pendente' → ambíguo → 'reperguntado' → qualquer resposta
 *       cai em estado TERMINAL. Nunca uma terceira.
 *   (b) Estados terminais são ABSORVENTES — nenhum ramo volta a null/'pendente'.
 *   (c) A saída é por CLIQUE (opção), não por juízo do LLM sobre texto livre.
 *   (d) Quem consome isto DEVE ler o estado VIVO, nunca o snapshot do topo do turno.
 *
 * ⚠️ 'projetado' é o ÚNICO estado que segue bloqueando o preview depois de resolvido — é
 * exatamente o que o gate existe para fazer. Não é um beco sem saída: a pessoa sai pelo
 * formulário determinístico da fase financeira (reenviar o form chama `iniciarSaving`/
 * `iniciarReceita`, que apaga as mensagens da fase e zera este estado) ou marcando o
 * projeto como ESPECIAL na Etapa 2 — os dois caminhos que a mensagem de bloqueio oferece.
 */

import type { ReceitaColetada, SavingColetado } from './types'

/** Estado do gate. `null` = nunca avaliado. Os três últimos são TERMINAIS. */
export type EstadoGanhoReal =
  | 'pendente'
  | 'reperguntado'
  /** Confirmado: já acontece e foi medido → libera para sempre. */
  | 'real'
  /** Confirmado: ainda é expectativa → BLOQUEIA o preview para sempre (ver nota acima). */
  | 'projetado'
  /** Perguntado 2× sem escolha clara → libera, mas marca o memorial para a triagem. */
  | 'nao_respondido'

/** Estados a partir dos quais o gate NUNCA mais pergunta. */
export const ESTADOS_TERMINAIS_GANHO_REAL: readonly EstadoGanhoReal[] = [
  'real',
  'projetado',
  'nao_respondido',
]

export function ganhoRealResolvido(estado: EstadoGanhoReal | null | undefined): boolean {
  return estado != null && ESTADOS_TERMINAIS_GANHO_REAL.includes(estado)
}

/** minúsculas + sem acento — as pistas são escritas todas sem acento. */
export function normalizarTexto(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * PISTAS DE PROJEÇÃO — lista DECLARADA (fonte única). Cada entrada tem um rótulo curto que
 * vai para o log e para os testes, então dá para saber QUAL pista armou o gate.
 *
 * ⚠️ Critério de inclusão: a frase tem de apontar para o GANHO não ter acontecido/ não ter
 * sido medido. Deliberadamente FORA da lista:
 *   - "estimativa"/"estimo" soltos — é a palavra do saving CONTRAFACTUAL legítimo (ninguém
 *     fazia; o "antes" é o equivalente manual estimado). Armaria o gate no caso mais comum.
 *   - futuro genérico ("deve validar", "vai rodar") — só entra colado a VERBO DE GANHO
 *     (gerar/render/economizar…), senão qualquer frase técnica da doc dispararia.
 *
 * Um falso positivo custa UMA pergunta com dois botões (a pessoa responde "já acontece e
 * foi medido" e nunca mais é perguntada), então a lista pode ser generosa — mas não vaga.
 */
/**
 * Pistas cujo GATILHO E UMA PALAVRA AFIRMATIVA ("projecao", "expectativa", "premissa",
 * "potencial") precisam checar o que vem ANTES: "nao e projecao, ja aconteceu" afirma
 * exatamente o contrario e nao pode armar o gate. Marcadas com `negavel: true`.
 *
 * ATENCAO - encontrado no pre-flight sobre os cenarios E2E reais: o briefing do
 * `custo-evitado-puro` diz "ja foi cancelado na pratica (nao e projecao, ja aconteceu)" e
 * armava o gate. As pistas que JA SAO negacoes ('nao-e-medido', 'sem-historico',
 * 'ainda-nao') NAO levam o flag - nelas a negacao e o proprio sinal.
 */
const NEGACAO_ANTES =
  /(?:\bnao (?:e|era|se trata de)|\bnao ha|\bnem |\bsem |\bdeixou de ser )[^.;]{0,24}$/

export const PISTAS_PROJECAO: readonly { marca: string; re: RegExp; negavel?: boolean }[] = [
  // A confissão literal do caso de origem: "não é um número medido", "não é histórico medido".
  {
    marca: 'nao-e-medido',
    re: /\bnao (?:e|era|foi|sao|eram|foram) (?:um |uma |o |a )?(?:numero |numeros |dado |dados |valor |valores |historico |taxa )?(?:medid[oa]s?|mensurad[oa]s?|apurad[oa]s?|real|reais)\b/,
  },
  // "não temos histórico", "não há medição", "não existe base histórica".
  {
    marca: 'sem-historico',
    re: /\bnao (?:temos|tenho|ha|havia|existe|existem|houve) (?:ainda )?(?:historico|serie historica|base historica|medicao|medicoes|dado real|dados reais|numero real|numeros reais|como medir)\b/,
  },
  // "ainda não temos/roda/entrou/foi medido…" — a negação vem antes do verbo.
  {
    marca: 'ainda-nao',
    re: /\bainda nao (?:temos|tenho|ha|existe|foi|esta|estao|rodou|roda|entrou|comecou|aconteceu|medimos|medi|fechou)\b/,
  },
  // "não foi medido", "não está em produção", "não está rodando".
  {
    marca: 'nao-medido-nao-produzido',
    re: /\bnao (?:foi|fui|esta|estao|foram) (?:ainda )?(?:medid|mensurad|validad|apurad|em producao|no ar|rodando|em uso)/,
  },
  // "premissa conservadora", "premissa de piso", "hipótese inicial".
  {
    marca: 'premissa',
    re: /\b(?:premissa|hipotese|suposicao)(?:s)? (?:conservadora|conservadoras|de piso|otimista|inicial|iniciais|de trabalho|teorica)\b/,
    negavel: true,
  },
  // "projeção", "projetado", "projetada".
  { marca: 'projecao', re: /\b(?:projecao|projecoes|projetad[oa]s?)\b/, negavel: true },
  // "a expectativa é", "expectativa de ganho".
  { marca: 'expectativa', re: /\bexpectativa\b/, negavel: true },
  // "quando estiver rodando", "quando entrar em produção".
  { marca: 'quando-estiver', re: /\bquando (?:estiver|entrar|comecar|passar|for|migrarmos|tivermos)\b/ },
  // Futuro colado a VERBO DE GANHO (nunca futuro genérico — ver nota acima).
  {
    marca: 'ganho-no-futuro',
    re: /\b(?:vai|vao|ira|irao|deve|devem|devera|deverao|pretende|pretendemos|planejamos|espero|esperamos) (?:gerar|trazer|render|faturar|vender|aumentar|reduzir|economizar|poupar|cair|passar a)\b/,
  },
  // "a validar com os primeiros meses", "vamos recalibrar".
  {
    marca: 'a-validar',
    re: /\b(?:a validar|recalibrar|calibrar (?:depois|dep|no futuro)|validar (?:com|nos|apos) (?:os )?primeiros)\b/,
  },
  // "potencial de receita", "ganho potencial".
  { marca: 'potencial', re: /\b(?:potencial de (?:receita|ganho|economia)|ganho potencial|receita potencial)\b/, negavel: true },
  // "vamos cancelar/encerrar/migrar" — o sinal clássico do custo evitado projetado.
  { marca: 'vamos-fazer', re: /\bvamos (?:cancelar|encerrar|migrar|lancar|implementar|desligar|substituir)\b/ },
  // "em testes", "em homologação", "em piloto", "prova de conceito".
  {
    marca: 'em-teste',
    re: /\bem (?:testes|teste|homologacao|piloto|fase de teste|fase de testes|poc|prova de conceito)\b/,
  },
  // "está em desenvolvimento", "ainda sendo construído".
  {
    marca: 'em-desenvolvimento',
    re: /\b(?:em desenvolvimento|sendo (?:desenvolvid|construid|implementad|finalizad)|nao (?:esta )?(?:pronto|concluido|finalizado))\b/,
  },
]

export type ProjecaoDetectada = {
  /** Rótulos das pistas que casaram (para log/teste). */
  marcas: string[]
  /** Primeiro trecho que casou, recortado — entra na pergunta para a pessoa se reconhecer. */
  trecho: string
}

/**
 * Varre os textos (memorial + falas do usuário na fase + racional do formulário) em busca
 * de linguagem de ganho PROJETADO. Devolve `null` quando não há pista — o gate só arma com
 * evidência textual, nunca "por precaução".
 */
export function detectarGanhoProjetado(
  textos: readonly (string | null | undefined)[],
): ProjecaoDetectada | null {
  const marcas: string[] = []
  let trecho = ''
  for (const bruto of textos) {
    const t = normalizarTexto(bruto ?? '')
    if (!t) continue
    for (const pista of PISTAS_PROJECAO) {
      const m = pista.re.exec(t)
      if (!m) continue
      // Palavra afirmativa dentro de uma negacao ("nao e projecao, ja aconteceu") NAO conta.
      if (pista.negavel && NEGACAO_ANTES.test(t.slice(Math.max(0, m.index - 40), m.index))) continue
      if (!marcas.includes(pista.marca)) marcas.push(pista.marca)
      if (!trecho) trecho = recortarTrecho(t, m.index, m[0].length)
    }
  }
  if (marcas.length === 0) return null
  return { marcas, trecho }
}

/** Recorta ~90 chars ao redor do match, para citar de volta sem despejar o texto todo. */
function recortarTrecho(texto: string, indice: number, tamanho: number): string {
  const inicio = Math.max(0, indice - 30)
  const fim = Math.min(texto.length, indice + tamanho + 60)
  return (inicio > 0 ? '…' : '') + texto.slice(inicio, fim).trim() + (fim < texto.length ? '…' : '')
}

// ── Pergunta e interpretação ────────────────────────────────────────────────

/** Ordem FIXA: o índice do clique é a interpretação (1 = real, 2 = projetado). */
export const OPCOES_GANHO_REAL = [
  'Já acontece hoje e o ganho foi medido',
  'Ainda é expectativa — não foi medido',
]

/**
 * 1ª pergunta. Ancora na premissa da Etapa 1 ("você declarou que já está em produção") e
 * exige uma escolha — não é um aviso que se atravessa reafirmando o número.
 */
export function perguntaGanhoReal(det: ProjecaoDetectada, modo: 'saving' | 'receita'): string {
  const oQue =
    modo === 'receita'
      ? 'essa receita já está entrando'
      : 'essa economia já está acontecendo'
  return (
    `Preciso confirmar um ponto antes de fechar o memorial. Na Etapa 1 você declarou que o ` +
    `projeto **já está em produção e sendo utilizado** — e o GoDocs registra apenas ganhos ` +
    `**já realizados e medidos**, não o que a solução deve trazer quando estiver rodando.\n\n` +
    `O que você descreveu tem linguagem de ganho previsto ("${det.trecho}").\n\n` +
    `${oQue.charAt(0).toUpperCase()}${oQue.slice(1)} no dia a dia, com número apurado, ou ainda é ` +
    `uma expectativa?`
  )
}

/**
 * 2ª e ÚLTIMA pergunta (só quando a 1ª veio ambígua). Deixa explícito que é a última vez;
 * depois desta o gate encerra de qualquer jeito ('nao_respondido' libera com marca).
 */
export function perguntaGanhoRealFirme(modo: 'saving' | 'receita'): string {
  const oQue = modo === 'receita' ? 'a receita' : 'a economia de horas'
  return (
    `Preciso de uma escolha para seguir: ${oQue} que está no memorial **já foi medida na ` +
    `prática** (o projeto roda e alguém apurou o número), ou é o resultado esperado quando ` +
    `ele estiver operando por completo? Se já foi medida, escolha a primeira opção e me diga ` +
    `em uma frase há quanto tempo roda e como o número foi apurado.`
  )
}

/**
 * Interpreta a resposta. Clique (índice 1/2) vence; texto cai no fallback por regex.
 * `null` = ambíguo — o chamador re-pergunta UMA vez e depois encerra.
 */
export function interpretarGanhoReal(
  texto: string | null | undefined,
  selectedOption: number | null,
): 'real' | 'projetado' | null {
  if (selectedOption === 1) return 'real'
  if (selectedOption === 2) return 'projetado'
  const t = normalizarTexto(texto ?? '')
  if (!t) return null
  // ATENCAO: SEM `\b` NO FIM das alternativas. `\b` em JS e ASCII-only e, colado a um
  // radical ("nao foi medid"), exigiria um NAO-caractere logo depois - "medido" nunca
  // casaria. Mesma armadilha que fez `h[aa]\b` nao casar "nao ha indicador" no gate [1.4].
  // 'projetado' é checado ANTES: "não, ainda não foi medido" contém "medido", e
  // "não é expectativa" contém "expectativa" — a negação tem de vencer a palavra-chave.
  if (
    /\b(?:ainda (?:e|nao)|e (?:so |apenas )?(?:uma )?(?:expectativa|projecao|premissa|estimativa)|nao foi medid|nao medimos|nao temos (?:o )?numero|segunda opcao|opcao 2)/.test(
      t,
    )
  )
    return 'projetado'
  if (
    /\b(?:ja acontece|ja esta acontecendo|ja aconteceu|ja foi medid|ja medimos|foi medid|foi apurad|medido na pratica|roda desde|esta rodando desde|primeira opcao|opcao 1)/.test(
      t,
    )
  )
    return 'real'
  return null
}

// ── Nudges e mensagem de bloqueio ──────────────────────────────────────────

/**
 * Nudge [SISTEMA] do caminho 'real': libera, mas o memorial passa a ter de dizer DESDE
 * QUANDO roda e COMO o número foi apurado — sem isso o "já foi medido" é só uma palavra, e
 * o validador humano não tem o que conferir.
 */
export function nudgeGanhoRealConfirmado(racional: string): string {
  const disse = racional.trim() ? ` O usuário disse: "${racional.trim()}".` : ''
  return (
    '[SISTEMA] O usuário CONFIRMOU que o ganho já acontece hoje e foi medido na prática.' +
    disse +
    ' Reescreva o memorial em tempo PASSADO/PRESENTE (nunca "a expectativa é", "deve gerar",' +
    ' "quando estiver rodando") e registre, na base de cálculo, HÁ QUANTO TEMPO a solução roda' +
    ' e COMO o número foi apurado (relatório, painel, base). Se ele não tiver dito, pergunte' +
    ' isso UMA vez e siga. NÃO volte a questionar se o ganho é real — a decisão está tomada.'
  )
}

export const NUDGE_GANHO_REAL_SEM_RESPOSTA =
  '[SISTEMA] A dúvida entre ganho já medido e ganho previsto foi apontada duas vezes e não houve ' +
  'escolha clara. SIGA normalmente — não pergunte de novo. Registre no memorial a frase exata: ' +
  '"Não foi confirmado se o ganho já está medido na prática — conferir na triagem." E remova do ' +
  'texto qualquer linguagem de projeção ("a expectativa é", "deve gerar", "quando estiver rodando").'

/**
 * Mensagem de BLOQUEIO ('projetado'). Precisa fazer três coisas ao mesmo tempo: dizer o
 * porquê sem culpar quem foi honesto, deixar claro que não dá para seguir, e oferecer as
 * DUAS saídas reais — senão a pessoa fica presa e o gate vira o bug que ele deveria evitar.
 */
export function mensagemGanhoProjetado(modo: 'saving' | 'receita'): string {
  const oQue = modo === 'receita' ? 'a receita incremental' : 'o saving'
  return (
    `Obrigado pela franqueza — e é justamente por isso que não posso fechar ${oQue} agora. O ` +
    `GoDocs registra apenas ganho **já realizado e medido**: é a premissa da Etapa 1 ("o projeto ` +
    `já está em produção e sendo utilizado"). Um número que ainda vai se confirmar entraria na ` +
    `planilha como resultado apurado, e a gestão soma esses valores como ganho real.\n\n` +
    `Dois caminhos daqui:\n\n` +
    `- **Volte quando houver medição.** Deixe o projeto rodando o tempo necessário, apure o ` +
    `número de verdade e reabra a submissão — a documentação técnica fica salva.\n` +
    `- **Submeta como projeto especial.** Se o impacto é alto mas difícil de medir agora, volte à ` +
    `Etapa 2 e marque o projeto como **especial**: ele vai direto para a validação humana, sem ` +
    `memorial financeiro.\n\n` +
    `Se eu entendi errado e o ganho JÁ foi apurado, me diga há quanto tempo a solução roda e onde ` +
    `esse número é medido — aí eu sigo.`
  )
}

/**
 * Repetição da mensagem de bloqueio, quando a pessoa segue conversando depois de já ter
 * confirmado que o ganho é projetado. Curta de propósito: repetir o texto longo a cada
 * turno LÊ como loop, e o que a pessoa precisa saber é só que a decisão está tomada e
 * qual é a única coisa que a reabre.
 */
export function mensagemGanhoProjetadoRepetida(modo: 'saving' | 'receita'): string {
  const oQue = modo === 'receita' ? 'a receita' : 'o saving'
  return (
    `Sigo sem poder fechar ${oQue} com um número que ainda não foi medido — isso não muda ` +
    `conversando. Para retomar: reabra o formulário desta etapa quando tiver a medição, ou ` +
    `marque o projeto como **especial** na Etapa 2. Se o ganho JÁ foi apurado, me diga há ` +
    `quanto tempo a solução roda e onde o número é medido, e eu sigo daqui.`
  )
}

// ── Decisores puros ─────────────────────────────────────────────────────────

/** O gate se aplica a esta fase? Vale nas duas famílias financeiras. */
export function aplicaGateGanhoProjetado(fase: string): 'saving' | 'receita' | null {
  if (fase === 'saving' || fase === 'saving_preview') return 'saving'
  if (fase === 'receita' || fase === 'receita_preview') return 'receita'
  return null
}

/**
 * PRÉ-EMPÇÃO — o gate assume o turno ANTES de chamar o LLM?
 *
 * ⚠️ Esta função existe por causa de uma falha real encontrada na STAGING (04/08/2026, ver
 * SPEC_CORRECOES): a primeira versão do gate só agia sobre `preview`/`complete`, espelhando
 * o gate de sobreposição. Só que ali o LLM QUER previewar; aqui, com o portão reforçado no
 * prompt, ele passa a RECUSAR — e nunca chega a preview. Resultado observado: o agente
 * negociava com o usuário ~15 turnos seguidos ("escolha: encerrar a submissão ou
 * reclassificar como especial"), oferecendo caminhos que o chat não executa, o histórico
 * crescia de 38 para 56 mensagens e a submissão morria em 500. O gate — que existe
 * justamente para dar um estado TERMINAL a isso — ficava inerte.
 *
 * Então: havendo pista de projeção e estado ainda não avaliado, o backend faz a pergunta
 * ANTES de gastar a chamada de LLM. Uma pergunta, dois botões, estado terminal.
 *
 * Só dispara com `estado == null` — 'pendente'/'reperguntado' são tratados pelo ramo de
 * resposta e os terminais nunca reabrem. Sem pista, não arma (o gate não é uma pergunta de
 * rotina; quem não escreveu linguagem de projeção nunca a vê).
 */
export function devePreemptarPorProjecao(
  estado: EstadoGanhoReal | null | undefined,
  temPista: boolean,
): boolean {
  if (estado != null) return false
  return temPista
}

/**
 * O gate deve BLOQUEAR este resultado do LLM? (backstop pós-orquestrador)
 *
 * Pega o caso que a pré-empção não alcança: a pista aparece SÓ no memorial que o LLM
 * acabou de escrever, no mesmo turno em que ele gera o preview — que é literalmente o
 * caso de origem (a ressalva "não é histórico medido" nasceu dentro do preview).
 *
 * 'projetado' bloqueia SEMPRE (é a função do gate); 'real'/'nao_respondido' liberam para
 * sempre; `null`/'pendente'/'reperguntado' bloqueiam até haver resposta.
 *
 * ⚠️ `estado` tem de ser o valor VIVO (já mesclado neste turno). Ler o snapshot do topo do
 * turno é literalmente o loop de 38 perguntas do gate [1.4].
 */
export function deveBloquearPorProjecao(
  estado: EstadoGanhoReal | null | undefined,
  tipo: string,
): boolean {
  if (tipo !== 'preview' && tipo !== 'complete') return false
  if (estado === 'projetado') return true
  return !ganhoRealResolvido(estado)
}

/** Textos que o detector varre, na fase de saving. */
export function textosParaDeteccaoSaving(
  saving: SavingColetado | undefined,
  falasUsuario: readonly string[],
): (string | null | undefined)[] {
  return [saving?.memorial_calculo, ...falasUsuario]
}

/** Textos que o detector varre, na fase de receita (inclui o racional do formulário). */
export function textosParaDeteccaoReceita(
  receita: ReceitaColetada | undefined,
  falasUsuario: readonly string[],
): (string | null | undefined)[] {
  return [receita?.memorial_calculo, receita?.racional, ...falasUsuario]
}
