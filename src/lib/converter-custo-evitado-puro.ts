/**
 * Conversão de um projeto para CUSTO EVITADO PURO (admin, uma via só).
 *
 * Motivo: acontece de a submissão declarar o MESMO trabalho duas vezes — as horas
 * dos agentes que o contrato pagava E o contrato eliminado. A triagem corrige na
 * PLANILHA (zera "Saving Horas", ajusta "Saving Reais"/"Ganho Total" e reescreve o
 * memorial), mas o sync reverso não cobre nada disso: o SQLite segue com as `linhas`
 * de horas e, como o formulário de edição seeda do banco, **o próximo reenvio
 * REVERTE a correção**.
 *
 * `reconciliarFinanceiroDoSheet` não resolve este caso: ela reconstrói o custo
 * evitado da planilha mas recalcula o total a partir das `linhas` do banco — com as
 * horas ainda lá, ela devolve o número velho (medido no caso de origem: 8.844 →
 * 12.621,74). Esta rotina é o passo que falta: **remove as horas** e deixa o ganho
 * 100% no custo externo eliminado, que é o que `alguem_fazia='externo'` significa.
 *
 * Caso de origem (Portal de Reembolsos / Gobeaute, 25/08/2026): 271h/mês de agentes
 * de CX registradas junto do contrato da terceirizada que pagava exatamente essas
 * horas — R$ 3.777,74 de horas somados a R$ 8.844 de contrato, o mesmo dinheiro dos
 * dois lados.
 *
 * ⚠️ NÃO escreve no Sheets. Nem uma célula — em especial "Atualizado Em" (carimbo de
 * sistema) e "Status"/"Aprovação do Líder", que reabrir aqui faria a triagem e o
 * parecer do líder se perderem por causa de uma correção de dado. A planilha é
 * corrigida à mão pela triagem; esta função só alinha o banco ao que já foi validado.
 *
 * ⚠️ FAIL-CLOSED: sem custo evitado > 0 no estado do saving, converter zeraria o
 * ganho do projeto — aborta em vez de gravar. Idempotente: rodar de novo num projeto
 * já convertido é no-op (nenhuma linha para remover).
 *
 * ⚠️ `dry` é o DEFAULT: gravar exige `{"dry":false}` explícito (mesma trava de
 * `/api/admin/aprovacoes/reabrir`).
 */

import {
  getProjetoById,
  getDocumentacao,
  updateProjeto,
  upsertDocumentacao,
  parseJson,
} from '@/integrations/db/client.server'
import { recomputarSavingFinanceiro, enriquecerMemorial } from '@/lib/agents/saving-calc'
import { ganhoTotalMensal } from '@/lib/reconciliar-financeiro'
import type { SavingColetado, ReceitaColetada } from '@/lib/agents/types'

const round2 = (n: number) => Math.round(n * 100) / 100

export type ResultadoConversao = {
  ok: boolean
  projetoId: string
  nome?: string | null
  motivo?: string
  dry: boolean
  /** Só quando `ok` — o que mudou (ou mudaria, no dry-run). */
  diff?: {
    alguem_fazia: { de: string | null; para: 'externo' }
    linhas_removidas: number
    horas_removidas: number
    saving_horas: { de: number | null; para: number }
    saving_reais: { de: number | null; para: number }
    ganho_total_mensal: { de: number | null; para: number }
    custo_evitado: number
  }
}

/**
 * Constrói o estado de saving convertido — FUNÇÃO PURA, testável sem banco.
 * Remove as `linhas` (e o split carga real × escala, que só existe por causa delas)
 * e recomputa o líquido pela MESMA função do fluxo normal: sem horas, o ganho é
 * custo evitado − custo externo − custo do projeto.
 */
export function converterSavingParaCustoEvitado(
  saving: SavingColetado,
  custoExternoMensal = 0,
): SavingColetado {
  return recomputarSavingFinanceiro(
    {
      ...saving,
      linhas: [],
      economia_horas_mes: 0,
      // O split só descreve horas humanas; sem `linhas` ele não tem referente.
      horas_carga_real: null,
      horas_escala: null,
    },
    custoExternoMensal,
  )
}

/**
 * Converte UM projeto para custo evitado puro no SQLite.
 * `dry` (default) calcula e devolve o diff sem gravar nada.
 */
export async function converterParaCustoEvitadoPuro(
  projetoId: string,
  opts: { dry?: boolean } = {},
): Promise<ResultadoConversao> {
  const dry = opts.dry !== false
  const falha = (motivo: string): ResultadoConversao => ({ ok: false, projetoId, motivo, dry })

  const projeto = await getProjetoById(projetoId)
  if (!projeto) return falha('Projeto não encontrado no SQLite.')

  const docRow = await getDocumentacao(projetoId)
  if (!docRow) return falha('Documentação não encontrada — nada a converter.')
  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<
    string,
    unknown
  >
  const saving = conteudo.saving as SavingColetado | undefined
  if (!saving || typeof saving !== 'object') return falha('Estado de saving ausente na documentação.')
  const receita = conteudo.receita as ReceitaColetada | undefined

  // ── Fail-closed: sem custo evitado, converter apagaria o ganho do projeto ──
  const custoEvitado = round2(Math.max(0, Number(saving.custo_evitado_reais) || 0))
  if (custoEvitado <= 0)
    return falha(
      'Projeto sem custo evitado no estado do saving — converter zeraria o ganho. Cadastre o custo evitado (ou rode /api/admin/reconciliar-financeiro antes) e tente de novo.',
    )

  const linhasAntes = Array.isArray(saving.linhas) ? saving.linhas : []
  const horasAntes = round2(
    linhasAntes.reduce((s, l) => s + (Number(l.economia_horas_mes) || 0), 0),
  )

  const savingNovo = converterSavingParaCustoEvitado(saving, projeto.custo_externo_mensal ?? 0)
  const savingReaisNovo = round2(Number(savingNovo.economia_reais_mes) || 0)
  const receitaValor = Math.max(0, Number(receita?.valor_ganho_mensal) || 0)
  const ganhoNovo = ganhoTotalMensal(savingReaisNovo, receitaValor)

  const diff: NonNullable<ResultadoConversao['diff']> = {
    alguem_fazia: { de: (projeto.alguem_fazia as string) ?? null, para: 'externo' },
    linhas_removidas: linhasAntes.length,
    horas_removidas: horasAntes,
    saving_horas: { de: projeto.saving_horas ?? null, para: 0 },
    saving_reais: { de: projeto.saving_reais ?? null, para: savingReaisNovo },
    ganho_total_mensal: { de: projeto.ganho_total_mensal ?? null, para: ganhoNovo },
    custo_evitado: custoEvitado,
  }

  if (dry) return { ok: true, projetoId, nome: projeto.nome, dry, diff }

  const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto as string) ?? []
  conteudo.saving = savingNovo
  await upsertDocumentacao(projetoId, conteudo)
  await updateProjeto(projetoId, {
    alguem_fazia: 'externo',
    saving_horas: 0,
    saving_reais: savingReaisNovo,
    ganho_total_mensal: ganhoNovo > 0 ? ganhoNovo : null,
    memorial_calculo: enriquecerMemorial(savingNovo, receita, tiposProjeto),
  })

  return { ok: true, projetoId, nome: projeto.nome, dry: false, diff }
}
