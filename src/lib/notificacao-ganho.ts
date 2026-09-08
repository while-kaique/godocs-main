// O GANHO de um projeto como o alerta do Google Chat o mostra — módulo PURO, FONTE ÚNICA.
//
// Existe porque o card do grupo "Alerta de Automações" anunciava **R$ 0,00 e 0 horas** em
// todo projeto da **v2** (08/09/2026). A causa não é o card: é que `buildSubmitMessage`
// nasceu lendo as colunas da v1 (`saving_horas`/`saving_reais`/`tipo_saving` e a receita do
// blob `documentacao.conteudo.receita`), e o formulário determinístico da v2 **nunca** as
// escreve — ele grava `ganho_categorias` + os 4 blocos + os 3 `impacto_*`
// (`montarPatchGanhos`, `ganhos.ts`). Ou seja: os campos não estavam zerados, estavam
// sendo lidos do lugar errado. Pela mesma razão a linha "Tipos" saía "—": ela lia
// `tipos_projeto`, que é vocabulário da v1 (`saving`/`receita_incremental`/`especial`) e
// que o cliente da v2 não manda mais.
//
// A régua deste módulo é a MESMA de `celulasGanhoV2` (`google/sync.ts`): o discriminador é
// `ganho_categorias` — com ela, é v2; sem ela, é v1. Não há migração entre as gerações
// (Fronteira do plano da v2), há esta bifurcação, e ela é por PROJETO, não por ambiente.
//
// ⚠️ **Nenhum número é recalculado aqui.** Os 3 impactos vêm MATERIALIZADOS das colunas
// `impacto_*`, gravadas no MESMO `UPDATE` do ganho (contrato de invalidação em
// `schema.ts`). Recalcular criaria a 2ª cabeça que a v2 existe para desfazer — e o card
// passaria a poder discordar da planilha, que lê as mesmas colunas.
//
// ⚠️ Os dois totais que ESTE módulo compõe (horas liberadas e custo para rodar) saem de
// `totalHorasLiberadas`/`totalCustoRodar` (`ganhos.ts`), as mesmas que a planilha usa —
// não somar aqui à mão.

import {
  desserializarCategorias,
  desserializarCustoRodar,
  desserializarLinhasHoras,
  savingLiquido,
  totalCustoRodar,
  totalHorasLiberadas,
} from './ganhos'
import { rotuloFrequencia, tituloGanho } from './ganhos-rotulos'
import { ROTULO_TIPO, type TipoProjeto } from './categoria-projeto'
import { fmtSimNao, fmtTiposProjeto, TIPOS_PROJETO_LABEL } from './projeto-rotulos'
import { chaveColuna } from './coluna-chave'
// ⚠️ O parser numérico é o MESMO da listagem do /dashboard (`dashboard-resumo.ts`), de
// propósito: o card tem de interpretar a célula exatamente como a tela interpreta.
import { numero } from './dashboard-resumo'

/** Uma linha "rótulo: valor" do card. `nota` é o rodapé pequeno (opcional). */
export type LinhaGanho = { rotulo: string; valor: string; nota?: string }

/** Um texto longo do ganho (evidência, racional) — vai atrás do "exibir mais". */
export type TextoGanho = { rotulo: string; texto: string }

/**
 * O ganho pronto para o card, na MESMA forma para v1 e v2.
 *
 * É o que permite ao `buildSubmitMessage` não saber de geração alguma: ele desenha
 * `destaque` em cima, `detalhe` na seção de números e `textos` na colapsável.
 */
export type ResumoGanho = {
  /** Geração de onde os números saíram — vira uma linha do card, para a triagem saber. */
  geracao: 'planilha' | 'v1' | 'v2'
  /** "Saving efetivado · Custo evitado". Nunca vazio: sem categoria vira "—". */
  categorias: string
  /** O número que a triagem olha primeiro. `null` quando o projeto não tem número. */
  destaque: LinhaGanho | null
  /** Um bloco por linha (saving, custo evitado, receita, custo para rodar). */
  detalhe: LinhaGanho[]
  /** Evidência e racionais — texto longo, colapsável. */
  textos: TextoGanho[]
  /** `true` quando NADA de número foi declarado (só imensurável, ou v1 sem valores). */
  semNumero: boolean
}

/** As colunas de `projetos` que este módulo lê. Estrutural de propósito: nada de servidor. */
export type ProjetoParaResumo = {
  ganho_categorias?: string | null
  saving_efetivado_valor_antes?: number | null
  saving_efetivado_valor_agora?: number | null
  saving_efetivado_frequencia?: string | null
  saving_efetivado_evidencia?: string | null
  custo_evitado_frequencia?: string | null
  custo_evitado_horas_linhas?: string | null
  custo_evitado_horas_valor?: number | null
  custo_evitado_nao_contratado?: number | null
  custo_evitado_racional?: string | null
  receita_incremental_valor?: number | null
  receita_incremental_frequencia?: string | null
  receita_incremental_racional?: string | null
  ganho_imensuravel_racional?: string | null
  custo_rodar_itens?: string | null
  impacto_bruto?: number | null
  impacto_liquido?: number | null
  impacto_liquido_mensal?: number | null
  categoria_projeto?: string | null
}

// ─── formatação ─────────────────────────────────────────────────────────────────

/**
 * Dinheiro no card: **com centavos**, sempre.
 *
 * ⚠️ Diferente do `fmtReais` de `projeto-rotulos.ts`, que arredonda para o inteiro porque
 * a fila do líder é para DECIDIR. Aqui é a triagem conferindo contra a planilha, e a
 * planilha guarda centavos — um card dizendo "R$ 5.900" ao lado de uma célula
 * "5.899,74" faz quem confere duvidar dos dois.
 */
function reais(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function horas(valor: number): string {
  const n = valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  return `${n} ${valor === 1 ? 'hora' : 'horas'}`
}

/** Número útil (finito e > 0). `0` e `null` contam como "não declarado". */
function positivo(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Texto limpo — e **o travessão conta como vazio**, como em todo o resto do repo (`ouTraco`,
 * `texto` do dossiê, o `vazio()` do cron da complexidade).
 *
 * ⚠️ Sem isso, a linha "Tipo: —" aparecia no card do Chat: a coluna `Tipo de Projeto` da planilha
 * nunca está AUSENTE (o analisador grava `—`), então o "ausente omite a linha" nunca disparava e
 * o `—` seguia como se fosse valor. A linha em si foi removida, mas a régua vale para os outros
 * campos que passam por aqui (evidência do saving efetivado, racionais) — um `—` gravado ali
 * viraria texto no card do mesmo jeito.
 */
function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  return t === '' || t === '—' || t === '-' ? null : t
}

/**
 * O eixo TIPO da categorização ("Automação", "Agente"…) — o que substituiu, no card, a
 * linha "Tipos" que lia `tipos_projeto`.
 *
 * ⚠️ Ausente → `null`, e o card OMITE a linha. Antes ela saía "—", que ocupa espaço para
 * dizer nada: o tipo é escrito pelo ANALISADOR (depois da submissão), então na hora do
 * alerta ele legitimamente ainda não existe.
 */
export function rotuloTipoProjeto(valor: string | null | undefined): string | null {
  const chave = texto(valor)?.toLowerCase()
  if (!chave) return null
  return (ROTULO_TIPO as Record<string, string>)[chave as TipoProjeto] ?? chave
}

// ─── v2 ─────────────────────────────────────────────────────────────────────────

/**
 * O ganho de um projeto da **v2**, ou `null` quando o projeto não é v2.
 *
 * O discriminador é `ganho_categorias` (só `salvarGanhos` a escreve), exatamente como em
 * `celulasGanhoV2`. Devolver `null` é o que faz o chamador cair no resumo da v1 sem
 * precisar saber qual é qual.
 */
export function resumirGanhoV2(projeto: ProjetoParaResumo): ResumoGanho | null {
  const categorias = desserializarCategorias(projeto.ganho_categorias)
  if (categorias.length === 0) return null

  const detalhe: LinhaGanho[] = []
  const textos: TextoGanho[] = []

  // Saving efetivado: as DUAS pontas; o ganho é a DIFERENÇA (não há coluna para ela).
  if (categorias.includes('saving_efetivado')) {
    const antes = Number(projeto.saving_efetivado_valor_antes) || 0
    const agora = Number(projeto.saving_efetivado_valor_agora) || 0
    const liquido = savingLiquido(antes, agora)
    detalhe.push({
      rotulo: `Saving efetivado (${rotuloFrequencia(projeto.saving_efetivado_frequencia)})`,
      valor: reais(liquido),
      nota: `Saía ${reais(antes)} · sai ${reais(agora)}`,
    })
    const evidencia = texto(projeto.saving_efetivado_evidencia)
    if (evidencia) textos.push({ rotulo: 'Evidência do saving', texto: evidencia })
  }

  // Custo evitado: os dois braços, com a frequência do BLOCO (não de cada braço).
  if (categorias.includes('custo_evitado')) {
    const freq = rotuloFrequencia(projeto.custo_evitado_frequencia)
    const horasLiberadas = totalHorasLiberadas(
      desserializarLinhasHoras(projeto.custo_evitado_horas_linhas),
    )
    const valorHoras = Number(projeto.custo_evitado_horas_valor) || 0
    const naoContratado = Number(projeto.custo_evitado_nao_contratado) || 0
    detalhe.push({
      rotulo: `Custo evitado (${freq})`,
      valor: reais(valorHoras + naoContratado),
      nota: `${horas(horasLiberadas)} liberadas = ${reais(valorHoras)} · não contratado ${reais(naoContratado)}`,
    })
    const racional = texto(projeto.custo_evitado_racional)
    if (racional) textos.push({ rotulo: 'Racional do custo evitado', texto: racional })
  }

  if (categorias.includes('receita_incremental')) {
    detalhe.push({
      rotulo: `Receita incremental (${rotuloFrequencia(projeto.receita_incremental_frequencia)})`,
      valor: reais(Number(projeto.receita_incremental_valor) || 0),
    })
    const racional = texto(projeto.receita_incremental_racional)
    if (racional) textos.push({ rotulo: 'Racional da receita', texto: racional })
  }

  // Imensurável: fica FORA de toda conta de impacto (é o que a estrela representa), mas o
  // racional é o insumo do classificador — e é a única coisa que o card tem a mostrar.
  if (categorias.includes('imensuravel')) {
    const racional = texto(projeto.ganho_imensuravel_racional)
    if (racional) textos.push({ rotulo: 'Ganho imensurável', texto: racional })
  }

  // Custo para rodar: perguntado a TODO MUNDO, fora do acordeão — não tem categoria que o
  // marque, quem decide é a lista. Só entra no card quando há item.
  const itensCusto = desserializarCustoRodar(projeto.custo_rodar_itens)
  if (itensCusto.length > 0) {
    detalhe.push({
      rotulo: 'Custo para rodar',
      valor: `- ${reais(totalCustoRodar(itensCusto))}`,
      nota: itensCusto
        .map((i) => `${i.nome} ${reais(Math.max(0, i.valor))} (${rotuloFrequencia(i.frequencia)})`)
        .join(' · '),
    })
  }

  // O destaque é o líquido MENSAL: é o número do rollup e o que o Gomoon recebe.
  const mensal = positivo(projeto.impacto_liquido_mensal)
  const bruto = positivo(projeto.impacto_bruto)
  const liquido = positivo(projeto.impacto_liquido)
  const destaque: LinhaGanho | null = mensal
    ? {
        rotulo: 'Impacto líquido mensal',
        valor: reais(mensal),
        // ⚠️ O líquido do PERÍODO só entra quando difere do mensal. Em projeto mensal os
        // dois são o MESMO número, e repeti-lo faz a nota parecer que há duas medidas
        // diferentes do mesmo ganho — ruído justamente na linha de destaque.
        nota: [
          bruto && bruto !== mensal ? `bruto ${reais(bruto)}` : null,
          liquido && liquido !== mensal ? `líquido no período ${reais(liquido)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      }
    : null

  return {
    geracao: 'v2',
    categorias: categorias.map((c) => tituloGanho(c)).join(' · '),
    destaque,
    detalhe,
    textos,
    // Só imensurável (ou impacto zerado) → o card DIZ que não há número, em vez de
    // exibir "R$ 0,00", que se lê como erro de sistema.
    semNumero: destaque === null && detalhe.length === 0,
  }
}

// ─── v1 ─────────────────────────────────────────────────────────────────────────

/** O que a v1 tem a dizer sobre o ganho (colunas de `projetos` + a receita do blob). */
export type GanhoV1 = {
  tiposProjeto?: unknown
  savingHoras?: number | null
  savingReais?: number | null
  tipoSaving?: string | null
  receitaValor?: number | null
  tipoReceita?: string | null
}

/**
 * O ganho de um projeto da **v1** (os 578 legados e tudo que foi submetido antes da v2).
 *
 * ⚠️ Aqui o destaque é o **saving em R$**, não um "impacto líquido": a v1 não materializa
 * impacto nenhum em coluna, e a soma saving + receita/10 é regra de negócio que vive em
 * outro lugar (`ganhoTotalMensal`). Somar aqui seria a 2ª cabeça de novo — o card mostra
 * as parcelas que existem e deixa a conta para quem a tem.
 */
export function resumirGanhoV1(g: GanhoV1): ResumoGanho {
  const detalhe: LinhaGanho[] = []

  const savingReais = positivo(g.savingReais)
  const savingHoras = positivo(g.savingHoras)
  if (savingReais || savingHoras) {
    detalhe.push({
      rotulo: `Saving (${rotuloFrequencia(g.tipoSaving) || '—'})`,
      valor: savingReais ? reais(savingReais) : '—',
      nota: savingHoras ? `${horas(savingHoras)} economizadas` : undefined,
    })
  }

  const receita = positivo(g.receitaValor)
  if (receita) {
    detalhe.push({
      rotulo: `Receita incremental (${rotuloFrequencia(g.tipoReceita) || '—'})`,
      valor: reais(receita),
    })
  }

  const destaque = savingReais
    ? {
        rotulo: 'Saving',
        valor: reais(savingReais),
        nota: savingHoras ? `${horas(savingHoras)} economizadas` : '',
      }
    : receita
      ? { rotulo: 'Receita incremental', valor: reais(receita), nota: '' }
      : null

  return {
    geracao: 'v1',
    categorias: fmtTiposProjeto(g.tiposProjeto) ?? '—',
    destaque,
    detalhe,
    textos: [],
    semNumero: destaque === null && detalhe.length === 0,
  }
}

/**
 * O resumo do ganho, decidindo a geração sozinho — é o que os call sites chamam.
 *
 * ⚠️ v2 vence sempre que `ganho_categorias` existe. Nenhum projeto tem as duas gerações
 * preenchidas (o banco da v2 nasce zerado), mas se um dia tiver, o número CERTO é o da
 * v2: é o que a planilha grava e o que o rollup soma.
 */
export function resumirGanho(projeto: ProjetoParaResumo, v1: GanhoV1): ResumoGanho {
  return resumirGanhoV2(projeto) ?? resumirGanhoV1(v1)
}

// ─── a PLANILHA como fonte (o caminho preferido) ────────────────────────────
//
// ⚠️ **Por que o card lê o ESPELHO e não as colunas do SQLite (08/09/2026).** A primeira
// versão deste módulo bifurcava v1/v2 sobre `projetos`, e o resultado em produção foi um
// card de projeto v1 anunciando só "Saving R$ X" — com a seção "Números do ganho"
// repetindo a MESMA linha. Duas descobertas explicam e corrigem isso:
//
//  1. **A base de produção é 100% v1** (739 projetos; a última submissão é de 02/09, antes
//     da pausa). Ou seja, o caminho que eu tratei como "fallback de legado" é o caminho de
//     TODOS os cards de hoje — e era o que estava mais pobre.
//  2. **A PLANILHA já está no vocabulário da v2 para a base inteira.** A régua D1 renomeou
//     as colunas *in-place* (o `Custo Evitado` da v1 é o SAVING EFETIVADO da v2; o saving
//     por HORAS da v1 é o CUSTO EVITADO da v2) e o retroativo de impacto recalculou os 3
//     `Impacto *`. Medido: **667 de 739 (90%) têm impacto na planilha**; os 71 sem número
//     são os especiais (por definição) e sobram 5 não-especiais.
//
// Então o número que a triagem quer ver JÁ EXISTE para v1 — só não em `projetos`, onde
// `impacto_*` é `NULL` fora da v2 (só `salvarGanhos` escreve). Ler o espelho resolve três
// coisas de uma vez: **(a)** v1 e v2 pelo mesmo caminho, sem bifurcação; **(b)** o card
// não pode discordar da ficha do `/dashboard`, porque é a mesma fonte, e discordar da
// célula ao lado foi o defeito de origem; **(c)** as parcelas ficam ricas, o que mata a
// redundância entre destaque e detalhe.
//
// ⚠️ O espelho é SQLite local (a ficha já o lê assim) — **nada de `readAllRows`/Sheets em
// request**, a cota é compartilhada com prod. E é a linha COMPLETA (`lerLinhaEspelho`),
// não o `linha_resumo`: aqui é UM projeto, não a listagem.
//
// ⚠️ Espelho ausente devolve `null` e o chamador cai no resumo derivado do banco. Degrada,
// não mente.

/** Só as colunas que este resumo lê. Estrutural: o espelho entrega um mapa nome→texto. */
export type LinhaPlanilha = Record<string, string | undefined>

/**
 * Casamento de coluna TOLERANTE a acento/caixa/espaço, a mesma disciplina do
 * `resolverColunaLetra` do Sheets: o cabeçalho real é digitado à mão e já tem
 * `Justificativa Aprovação do **Lider**` sem acento. Exato primeiro, normalizado depois.
 */
function celula(linha: LinhaPlanilha, nome: string): string | undefined {
  const exato = preenchida(linha[nome])
  if (exato) return exato
  const alvo = chaveColuna(nome)
  for (const [k, v] of Object.entries(linha)) {
    const val = preenchida(v)
    if (!val) continue
    if (chaveColuna(k) === alvo) return val
  }
  return undefined
}

/**
 * Célula com conteúdo de verdade, ou `undefined`.
 *
 * ⚠️ **"—" conta como VAZIA**, e é aqui que isso tem de ser tratado: o `padronizarLinha`
 * do sync grava o traço em TODA célula de texto em branco (padrão do repo), então sem este
 * descarte a evidência e os racionais ausentes chegariam como "—" e virariam um parágrafo
 * inteiro no card dizendo nada. Centralizado na porta de entrada porque os três leitores
 * (`celula`, `numeroCelula`, `textoCelula`) dependem disso.
 */
function preenchida(valor: string | undefined): string | undefined {
  if (valor == null) return undefined
  const s = String(valor).trim()
  if (s === '' || s === '—' || s === '-') return undefined
  return s
}

/** O número de uma célula, ou `null` quando vazia/"—"/zero. */
function numeroCelula(linha: LinhaPlanilha, nome: string): number | null {
  const n = numero(celula(linha, nome))
  return n != null && n > 0 ? n : null
}

/** O texto de uma célula, descartando o "—" que o `padronizarLinha` grava. */
function textoCelula(linha: LinhaPlanilha, nome: string): string | null {
  return texto(celula(linha, nome))
}

/**
 * Rótulos legíveis para a coluna "Tipos de Ganho", que carrega **os dois vocabulários**:
 * slugs da v1 (`saving`, `receita_incremental`, `especial`) nas 739 linhas antigas e os
 * títulos da v2 (`Saving efetivado`…) no que o formulário novo grava. Token desconhecido
 * volta como veio — mostra o que existe em vez de esconder o que não reconhece.
 */
export function rotularCategoriasGanho(bruto: string | null | undefined): string | null {
  // ⚠️ Descarta o "—" aqui TAMBÉM, e não só no `celula()`: esta função é exportada e é a
  // fonte única do rótulo, então quem a chamar com a célula crua não pode receber um
  // traço rotulado como se fosse uma categoria.
  const t = preenchida(texto(bruto) ?? undefined)
  if (!t) return null
  const nomes = t
    .split(/[,·]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => TIPOS_PROJETO_LABEL[p] ?? tituloGanho(p))
  return nomes.length > 0 ? nomes.join(' · ') : null
}

/**
 * O ganho de um projeto a partir da LINHA da planilha (espelho). `null` quando não há
 * linha ou quando ela não tem número nenhum — aí o chamador cai no resumo do banco.
 *
 * ⚠️ O destaque aceita **duas** colunas, e o rótulo SEGUE o campo: `Impacto Líquido
 * Mensal` quando existe, senão `Impacto Líquido`. Não é preciosismo — no caminho v1 o
 * `syncSubmitToGoogle` escreve `Impacto Líquido` (que ali JÁ é o ganho total mensal) e
 * **não** escreve `Impacto Líquido Mensal`, que veio do retroativo; na v2 o `Impacto
 * Líquido` é o líquido do PERÍODO, não o mensal. Chamar o segundo de "mensal" seria
 * afirmar uma cadência que o número não tem.
 *
 * ⚠️ O valor é reformatado a partir do `numero()` de `dashboard-resumo.ts` — o MESMO
 * parser da listagem, então o card interpreta a célula como o `/dashboard` interpreta. A
 * reformatação é só apresentação: a própria planilha mistura `"5.000,00"` e `"5819,35"`, e
 * exibir cru poria os dois formatos lado a lado no mesmo card.
 */
export function resumirGanhoDaPlanilha(linha: LinhaPlanilha | null | undefined): ResumoGanho | null {
  if (!linha) return null

  const detalhe: LinhaGanho[] = []
  const textos: TextoGanho[] = []

  const freq = (nome: string) => {
    const f = textoCelula(linha, nome)
    return f ? rotuloFrequencia(f) : null
  }
  const comFreq = (rotulo: string, nomeFreq: string) => {
    const f = freq(nomeFreq)
    return f ? `${rotulo} (${f})` : rotulo
  }

  // Saving efetivado — na v1 esta célula é o CUSTO EVITADO (gasto externo que parou), que
  // pela régua D1 é exatamente o saving efetivado da v2. Mesma célula, mesmo sentido.
  const savingEfetivado = numeroCelula(linha, 'Saving Efetivado')
  if (savingEfetivado) {
    const agora = numeroCelula(linha, 'Saving Efetivado Agora')
    detalhe.push({
      rotulo: comFreq('Saving efetivado', 'Freq. Saving Efetivado'),
      valor: reais(agora ? Math.max(0, savingEfetivado - agora) : savingEfetivado),
      nota: agora ? `Saía ${reais(savingEfetivado)} · sai ${reais(agora)}` : undefined,
    })
    const evidencia = textoCelula(linha, 'Evidência Saving Efetivado')
    if (evidencia) textos.push({ rotulo: 'Evidência do saving', texto: evidencia })
  }

  // Custo evitado — na v1 é o saving por HORAS (as horas que ninguém gasta mais).
  const horasLiberadas = numeroCelula(linha, 'Custo Evitado Horas')
  const horasReais = numeroCelula(linha, 'Custo Evitado Horas Reais')
  const naoContratado = numeroCelula(linha, 'Custo Evitado Não Contratado')
  if (horasLiberadas || horasReais || naoContratado) {
    detalhe.push({
      rotulo: comFreq('Custo evitado', 'Freq. Custo Evitado'),
      valor: reais((horasReais ?? 0) + (naoContratado ?? 0)),
      nota: [
        horasLiberadas ? `${horas(horasLiberadas)} liberadas` : null,
        naoContratado ? `não contratado ${reais(naoContratado)}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })
    const racional = textoCelula(linha, 'Racional Custo Evitado')
    if (racional) textos.push({ rotulo: 'Racional do custo evitado', texto: racional })
  }

  const receita = numeroCelula(linha, 'Receita Incremental')
  if (receita) {
    detalhe.push({ rotulo: comFreq('Receita incremental', 'Freq. Receita'), valor: reais(receita) })
    const racional = textoCelula(linha, 'Racional Receita')
    if (racional) textos.push({ rotulo: 'Racional da receita', texto: racional })
  }

  const custoRodar = numeroCelula(linha, 'Custo para Rodar')
  if (custoRodar) {
    detalhe.push({
      rotulo: comFreq('Custo para rodar', 'Freq. Custo para Rodar'),
      valor: `- ${reais(custoRodar)}`,
      nota: textoCelula(linha, 'Justificativa Custo para Rodar') ?? undefined,
    })
  }

  // Split carga real × ganho por escala: transparência, não parcela (o TOTAL não muda).
  // Entra como UMA linha só quando há algo a dizer — parte do ganho vem de volume que só
  // a automação cobre, e é o tipo de coisa que o líder pergunta e o card não respondia.
  const horasReal = numeroCelula(linha, 'Saving Horas Real')
  const horasEscala = numeroCelula(linha, 'Saving Horas Escalado')
  if (horasReal || horasEscala) {
    detalhe.push({
      rotulo: 'Origem das horas',
      valor: `${horas(horasReal ?? 0)} de carga real · ${horas(horasEscala ?? 0)} de escala`,
      nota: 'Carga real = trabalho humano que acontecia. Escala = volume que só a automação cobre.',
    })
  }

  const alguemFazia = textoCelula(linha, 'Alguém Fazia?')
  if (alguemFazia) {
    detalhe.push({ rotulo: 'Alguém já fazia?', valor: fmtSimNao(alguemFazia) ?? alguemFazia })
  }

  // ⚠️ "Ganho Imensurável" fica FORA de propósito: na v1 essa célula carrega o
  // `contexto_especial` ("por que é especial"), que o card do especial já mostra na seção
  // própria — incluí-la aqui duplicaria o texto e, num projeto padrão, rotularia o
  // contexto como se fosse racional de ganho sem número.

  const mensal = numeroCelula(linha, 'Impacto Líquido Mensal')
  const liquido = numeroCelula(linha, 'Impacto Líquido')
  const bruto = numeroCelula(linha, 'Impacto Bruto')
  const alvo = mensal ?? liquido
  const destaque: LinhaGanho | null = alvo
    ? {
        rotulo: mensal ? 'Impacto líquido mensal' : 'Impacto líquido',
        valor: reais(alvo),
        nota: bruto && bruto !== alvo ? `bruto ${reais(bruto)}` : '',
      }
    : null

  // Sem número E sem parcela → não há o que a planilha adicione; o chamador decide.
  if (!destaque && detalhe.length === 0 && textos.length === 0) return null

  return {
    geracao: 'planilha',
    categorias: rotularCategoriasGanho(celula(linha, 'Tipos de Ganho')) ?? '—',
    destaque,
    detalhe,
    textos,
    semNumero: destaque === null && detalhe.length === 0,
  }
}
