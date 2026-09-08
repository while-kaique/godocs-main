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
import { fmtTiposProjeto } from './projeto-rotulos'

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
  geracao: 'v1' | 'v2'
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

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
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
