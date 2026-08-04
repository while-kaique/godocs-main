/**
 * Reconciliação financeira PLANILHA → SQLITE (uma via só).
 *
 * Motivo: correções de triagem acontecem NA PLANILHA (é onde a gestão trabalha),
 * mas o sync reverso só cobre `SAFE_UPDATE_FIELDS` — as colunas financeiras e o
 * JSON `custo_evitado_itens` ficam de fora. O SQLite seguia com o valor antigo e,
 * como o formulário de edição seeda dele, **o próximo reenvio revertia a correção**.
 *
 * Caso de origem (Sucesso.AI / Maria Ponciano, 29/07/2026): dois componentes de
 * RECEITA ("Ressarcimento das transportadoras" R$ 55.864,38 e "Receita retida em
 * reenvio" R$ 106.049,40) foram declarados como itens de CUSTO EVITADO no saving e,
 * no reenvio seguinte, declarados DE NOVO como receita incremental — o mesmo
 * dinheiro dos dois lados. A planilha foi corrigida à mão em 31/07; o SQLite não.
 *
 * ⚠️ NÃO escreve no Sheets. Nem uma célula — em especial "Atualizado Em", que é
 * carimbo de sistema (regulariza legado) e não pode ser mexido por rotina de
 * correção. Esta função só puxa o estado já validado pela triagem para o banco.
 *
 * ⚠️ FAIL-CLOSED: os itens são reconstruídos do texto de "Justificativa Custo
 * Evitado" (formato gerado pelo próprio app). Se a soma dos itens reconstruídos
 * não bater com a célula de total, a função ABORTA em vez de adivinhar — um
 * palpite aqui grava número errado no banco de gestão.
 */

import {
  getProjetoById,
  getDocumentacao,
  updateProjeto,
  upsertDocumentacao,
  parseJson,
} from '@/integrations/db/client.server'
import { readAllRows } from '@/lib/google/sheets'
import { recomputarSavingFinanceiro, enriquecerMemorial } from '@/lib/agents/saving-calc'
import type { SavingColetado, ReceitaColetada } from '@/lib/agents/types'

const round2 = (n: number) => Math.round(n * 100) / 100

export type CustoItem = {
  nome: string
  valor: number
  recorrencia: 'mensal' | 'pontual'
  justificativa: string
}

/** "1.234,56" | "1234,56" | "1234.56" → number. Espelha o parseValorBR do
 *  `retroativoCustosPontuais`: vírgula presente ⇒ pt-BR (ponto é milhar). */
export function parseValorBR(texto: string): number {
  const t = String(texto ?? '').trim()
  if (!t) return NaN
  return t.includes(',')
    ? parseFloat(t.replace(/\./g, '').replace(',', '.'))
    : parseFloat(t.replace(/\./g, ''))
}

/**
 * Reconstrói os itens a partir da justificativa concatenada.
 * Formato gerado em `chat.functions.ts`:
 *   `• {nome} — R$ {valor} ({mensal|pontual}).{ justificativa}`
 * Uma linha por item. Linha que não casa o padrão → devolve `null` (fail-closed:
 * texto editado à mão fora do formato não pode virar item por adivinhação).
 */
export function parseItensDaJustificativa(just: string | null | undefined): CustoItem[] | null {
  const texto = String(just ?? '').trim()
  if (!texto || texto === '—') return []
  const linhas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const itens: CustoItem[] = []
  for (const linha of linhas) {
    // O travessão do gerador é "—"; aceita "-" para texto reeditado à mão.
    const m = /^[•*-]\s*(.+?)\s+[—-]\s*R\$\s*([\d.,]+)\s*\((pontual|mensal)\)\.?\s*(.*)$/i.exec(linha)
    if (!m) return null
    const valor = parseValorBR(m[2])
    if (!isFinite(valor) || valor < 0) return null
    itens.push({
      nome: m[1].trim(),
      valor: round2(valor),
      recorrencia: m[3].toLowerCase() === 'pontual' ? 'pontual' : 'mensal',
      justificativa: m[4].trim(),
    })
  }
  return itens
}

/** Soma dos itens pelo valor CHEIO (pontual e mensal, sem ÷12 — regra de 01/07/2026). */
export function somarItens(itens: CustoItem[]): number {
  return round2(itens.reduce((s, it) => s + Math.max(0, it.valor), 0))
}

/**
 * Ganho total mensal — MESMA fórmula de `submeterParaValidacao`/`resyncGoogle`.
 * ⚠️ Receita entra com **÷10** ("fator de equivalência", `docs/business-rules.md`).
 * NÃO é a soma simples e NÃO é bug — não "corrigir" aqui.
 */
export function ganhoTotalMensal(savingReais: number, receitaValor: number): number {
  const total = savingReais + receitaValor / 10
  return total > 0 ? round2(total) : 0
}

export type ResultadoReconciliacao = {
  ok: boolean
  projetoId: string
  nome?: string | null
  motivo?: string
  dry: boolean
  /** Só quando `ok` — o que mudou (ou mudaria, no dry-run). */
  diff?: {
    custo_evitado: { de: number; para: number }
    custo_projeto: { de: number; para: number }
    itens_custo_evitado: { de: number; para: number }
    saving_reais: { de: number | null; para: number }
    ganho_total_mensal: { de: number | null; para: number }
    receita_mensal: number
  }
}

/**
 * Puxa os números já validados na planilha para o SQLite de UM projeto.
 * `dry: true` calcula e devolve o diff sem gravar nada.
 */
export async function reconciliarFinanceiroDoSheet(
  projetoId: string,
  opts: { dry?: boolean } = {},
): Promise<ResultadoReconciliacao> {
  const dry = opts.dry === true
  const falha = (motivo: string): ResultadoReconciliacao => ({ ok: false, projetoId, motivo, dry })

  const projeto = await getProjetoById(projetoId)
  if (!projeto) return falha('Projeto não encontrado no SQLite.')

  const rows = await readAllRows()
  const row = rows.find(
    (r) => String(r['ID Projeto'] ?? '').trim().toLowerCase() === projetoId.trim().toLowerCase(),
  )
  if (!row) return falha('Projeto não encontrado na planilha (nada a reconciliar).')

  // ── Itens reconstruídos × total da célula: têm de fechar, senão aborta ──
  const itensEvitado = parseItensDaJustificativa(row['Justificativa Custo Evitado'] as string)
  if (itensEvitado === null)
    return falha(
      'Não foi possível reconstruir os itens de "Justificativa Custo Evitado" (texto fora do formato gerado pelo app). Reconciliação abortada para não gravar palpite.',
    )
  const itensProjeto = parseItensDaJustificativa(row['Justificativa Custo do Projeto'] as string)
  if (itensProjeto === null)
    return falha(
      'Não foi possível reconstruir os itens de "Justificativa Custo do Projeto" (texto fora do formato gerado pelo app). Reconciliação abortada.',
    )

  const totalEvitadoSheet = round2(Math.max(0, parseValorBR(String(row['Custo Evitado'] ?? '0')) || 0))
  const totalProjetoSheet = round2(Math.max(0, parseValorBR(String(row['Custo do Projeto'] ?? '0')) || 0))
  const somaEvitado = somarItens(itensEvitado)
  const somaProjeto = somarItens(itensProjeto)

  if (Math.abs(somaEvitado - totalEvitadoSheet) > 0.01)
    return falha(
      `Divergência na planilha: "Custo Evitado" = ${totalEvitadoSheet}, mas os itens da justificativa somam ${somaEvitado}. Corrija a planilha antes de reconciliar.`,
    )
  if (Math.abs(somaProjeto - totalProjetoSheet) > 0.01)
    return falha(
      `Divergência na planilha: "Custo do Projeto" = ${totalProjetoSheet}, mas os itens da justificativa somam ${somaProjeto}. Corrija a planilha antes de reconciliar.`,
    )

  const docRow = await getDocumentacao(projetoId)
  if (!docRow) return falha('Documentação não encontrada — nada a recomputar.')
  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>
  const saving = conteudo.saving as SavingColetado | undefined
  if (!saving || typeof saving !== 'object') return falha('Estado de saving ausente na documentação.')
  const receita = conteudo.receita as ReceitaColetada | undefined

  // ── Recomputa com a MESMA função do fluxo normal (horas = fonte de verdade) ──
  const savingRecalc = recomputarSavingFinanceiro(
    {
      ...saving,
      custo_evitado_reais: somaEvitado > 0 ? somaEvitado : null,
      custo_projeto_reais: somaProjeto > 0 ? somaProjeto : null,
    },
    projeto.custo_externo_mensal ?? 0,
  )
  const savingReaisNovo = round2(Number(savingRecalc.economia_reais_mes) || 0)
  const receitaValor = Math.max(0, Number(receita?.valor_ganho_mensal) || 0)
  const ganhoNovo = ganhoTotalMensal(savingReaisNovo, receitaValor)

  const diff: NonNullable<ResultadoReconciliacao['diff']> = {
    custo_evitado: { de: round2(Number(saving.custo_evitado_reais) || 0), para: somaEvitado },
    custo_projeto: { de: round2(Number(saving.custo_projeto_reais) || 0), para: somaProjeto },
    itens_custo_evitado: {
      de: (parseJson<unknown[]>(projeto.custo_evitado_itens as string) ?? []).length,
      para: itensEvitado.length,
    },
    saving_reais: { de: projeto.saving_reais ?? null, para: savingReaisNovo },
    ganho_total_mensal: { de: projeto.ganho_total_mensal ?? null, para: ganhoNovo },
    receita_mensal: receitaValor,
  }

  if (dry) return { ok: true, projetoId, nome: projeto.nome, dry, diff }

  const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto as string) ?? []
  conteudo.saving = savingRecalc
  await upsertDocumentacao(projetoId, conteudo)
  await updateProjeto(projetoId, {
    custo_evitado: itensEvitado.length > 0 ? 'sim' : 'nao',
    custo_evitado_justificativa: (row['Justificativa Custo Evitado'] as string) || null,
    custo_evitado_itens: JSON.stringify(itensEvitado),
    custo_projeto: itensProjeto.length > 0 ? 'sim' : 'nao',
    custo_projeto_justificativa: (row['Justificativa Custo do Projeto'] as string) || null,
    custo_projeto_itens: JSON.stringify(itensProjeto),
    saving_reais: savingReaisNovo,
    ganho_total_mensal: ganhoNovo > 0 ? ganhoNovo : null,
    memorial_calculo: enriquecerMemorial(savingRecalc, receita, tiposProjeto),
  })

  return { ok: true, projetoId, nome: projeto.nome, dry: false, diff }
}
