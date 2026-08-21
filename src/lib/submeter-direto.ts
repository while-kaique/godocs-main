// Fluxo DIRETO de submissão para lideranças (cargo isento de pré-aprovação — a
// MESMA régua de `cargo-lideranca.ts`/`ehLideranca`). Cargos de coordenador para
// cima pulam o agente conversacional e os gates: a documentação é gerada por IA em
// UMA passada (extrator + compilador, sem perguntas) e o memorial financeiro é
// montado DETERMINISTICAMENTE do que a pessoa preencheu no formulário — sem chat,
// sem interrogatório. Decisão do produto (Luis, 21/08/2026): "só pelo fluxo
// determinístico". A validação de qualidade continua sendo humana (equipe RPA).
//
// Módulo PURO (sem rede, sem env, sem banco) — testável isolado e reusável no
// worker. O R$ NUNCA entra aqui (o memorial visível ao usuário é qualitativo; o R$
// é injetado por `enriquecerMemorial` em `memorial_calculo`, igual ao fluxo normal).

import type { ReceitaColetada, SavingColetado } from '@/lib/agents/types'

/** Unidade de horas exibida conforme a cadência (espelha `unidadeHorasDe`). */
function unidadeHoras(tipo: SavingColetado['tipo_saving']): string {
  switch (tipo) {
    case 'trimestral':
      return 'h/trimestre'
    case 'semestral':
      return 'h/semestre'
    case 'pontual':
      return 'h (total)'
    default:
      return 'h/mês'
  }
}

/** Rótulo legível da cadência. */
function rotuloCadencia(tipo: SavingColetado['tipo_saving']): string {
  switch (tipo) {
    case 'trimestral':
      return 'Trimestral'
    case 'semestral':
      return 'Semestral'
    case 'pontual':
      return 'Pontual'
    default:
      return 'Recorrente (mensal)'
  }
}

const num = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')

// Remove o R$ das descrições de itens ("• Nome — R$ 500,00 (mensal). just.") para o
// memorial VISÍVEL: o valor entra só no `memorial_calculo` interno (via
// enriquecerMemorial). Sem isso, o `ocultarReaisSaving` da tela apagaria a LINHA
// inteira (deixando um cabeçalho órfão) — aqui preservamos nome + justificativa.
function semReais(desc: string): string {
  return desc
    .replace(/\s*[—-]\s*R\$\s*[\d.,]+/gi, '')
    .replace(/R\$\s*[\d.,]+/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Memorial DETERMINÍSTICO da fase de saving (sem R$). Monta a prosa só do que a
 * pessoa preencheu: contexto (descrição), quebra por cargo (horas antes→depois),
 * custo evitado e custo do projeto quando houver. É o texto visível ao usuário no
 * card de revisão e o que alimenta `saving.memorial_calculo` (o R$ é apensado por
 * `enriquecerMemorial` na submissão).
 */
export function memorialDiretoSaving(
  saving: SavingColetado,
  descricao?: string | null,
): string {
  const un = unidadeHoras(saving.tipo_saving)
  const partes: string[] = []

  partes.push('### Contexto')
  partes.push(
    descricao?.trim() ||
      'Projeto submetido pela liderança pelo fluxo direto — validação de qualidade pela equipe de RPA.',
  )

  const linhas = saving.linhas ?? []
  if (linhas.length > 0) {
    partes.push('\n### Saving de Pessoas')
    for (const l of linhas) {
      const economia = Math.max(0, l.horas_antes - l.horas_depois)
      partes.push(
        `- **${l.cargo}**: ${num(l.horas_antes)} → ${num(l.horas_depois)} ${un} ` +
          `(economia de ${num(economia)} ${un})`,
      )
    }
    partes.push(`\n**Total de horas economizadas:** ${num(saving.economia_horas_mes ?? 0)} ${un}`)
  }

  if (saving.custo_evitado_descricao?.trim()) {
    partes.push('\n### Contratos/Serviços Evitados')
    partes.push(semReais(saving.custo_evitado_descricao.trim()))
  }

  if (saving.custo_projeto_descricao?.trim()) {
    partes.push('\n### Custo da Automação')
    partes.push(semReais(saving.custo_projeto_descricao.trim()))
  }

  partes.push(`\n**Cadência:** ${rotuloCadencia(saving.tipo_saving)}`)

  return partes.join('\n')
}

/**
 * Memorial DETERMINÍSTICO da fase de receita (sem R$). O valor da receita é
 * escondido do usuário aqui (idem saving); o R$ é apensado por `enriquecerMemorial`.
 */
export function memorialDiretoReceita(
  receita: ReceitaColetada,
  descricao?: string | null,
): string {
  const partes: string[] = []
  partes.push('### Receita Incremental')
  partes.push(
    descricao?.trim() ||
      'Projeto submetido pela liderança pelo fluxo direto — validação de qualidade pela equipe de RPA.',
  )
  if (receita.racional?.trim()) {
    partes.push('\n### De onde vem a receita')
    partes.push(receita.racional.trim())
  }
  partes.push(`\n**Cadência:** ${rotuloCadencia(receita.tipo_saving)}`)
  return partes.join('\n')
}
