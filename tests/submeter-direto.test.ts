import { describe, it, expect } from 'vitest'
import { memorialDiretoSaving, memorialDiretoReceita } from '@/lib/submeter-direto'
import type { ReceitaColetada, SavingColetado } from '@/lib/agents/types'

// Fluxo DIRETO de liderança: o memorial é montado DETERMINISTICAMENTE do formulário
// (sem chat, sem gates). Estes testes travam duas garantias do produto:
//  (1) o memorial VISÍVEL nunca traz R$ (o valor/hora por cargo é escondido do usuário;
//      o R$ é injetado depois por enriquecerMemorial em memorial_calculo);
//  (2) a prosa reflete só o que a pessoa preencheu (cargos/horas, custo evitado, receita).

function savingBase(over: Partial<SavingColetado> = {}): SavingColetado {
  return {
    linhas: [
      {
        cargo: 'Analista',
        horas_antes: 40,
        horas_depois: 10,
        valor_hora: 50,
        economia_horas_mes: 30,
        economia_reais_mes: 1500,
      },
    ],
    economia_horas_mes: 30,
    economia_reais_mes: 1500,
    tipo_saving: 'mensal',
    memorial_calculo: null,
    valor_ganho_mensal: null,
    custo_evitado_reais: null,
    custo_evitado_tipo: null,
    custo_evitado_descricao: null,
    custo_externo_mensal: null,
    custo_projeto_reais: null,
    custo_projeto_tipo: null,
    custo_projeto_descricao: null,
    ...over,
  }
}

describe('memorialDiretoSaving', () => {
  it('quebra o saving por cargo com horas antes→depois e o total', () => {
    const m = memorialDiretoSaving(savingBase(), 'Automação de conciliação')
    expect(m).toContain('### Contexto')
    expect(m).toContain('Automação de conciliação')
    expect(m).toContain('Analista')
    expect(m).toContain('40 → 10 h/mês')
    expect(m).toContain('economia de 30 h/mês')
    expect(m).toContain('Total de horas economizadas:** 30 h/mês')
  })

  it('NUNCA expõe R$ — nem valor/hora, nem economia em reais', () => {
    const m = memorialDiretoSaving(savingBase(), 'x')
    expect(m).not.toContain('R$')
    expect(m).not.toContain('50')
    expect(m).not.toContain('1500')
  })

  it('usa a unidade da cadência (trimestre/semestre/pontual)', () => {
    expect(memorialDiretoSaving(savingBase({ tipo_saving: 'trimestral' }), 'x')).toContain('h/trimestre')
    expect(memorialDiretoSaving(savingBase({ tipo_saving: 'semestral' }), 'x')).toContain('h/semestre')
    expect(memorialDiretoSaving(savingBase({ tipo_saving: 'pontual' }), 'x')).toContain('h (total)')
    expect(memorialDiretoSaving(savingBase({ tipo_saving: 'mensal' }), 'x')).toContain('Recorrente (mensal)')
  })

  it('inclui custo evitado e custo do projeto quando descritos', () => {
    const m = memorialDiretoSaving(
      savingBase({
        custo_evitado_descricao: '• Licença X — R$ 500,00 (mensal). contrato encerrado',
        custo_projeto_descricao: '• API Y — R$ 30,00 (mensal). uso por chamada',
      }),
      'x',
    )
    expect(m).toContain('### Contratos/Serviços Evitados')
    expect(m).toContain('Licença X')
    expect(m).toContain('### Custo da Automação')
    expect(m).toContain('API Y')
  })

  it('sem descrição, usa um contexto padrão (não quebra)', () => {
    const m = memorialDiretoSaving(savingBase(), '')
    expect(m).toContain('### Contexto')
    expect(m).toContain('fluxo direto')
  })

  it('custo evitado PURO (sem linhas) monta o memorial sem a seção de pessoas', () => {
    const m = memorialDiretoSaving(
      savingBase({
        linhas: [],
        economia_horas_mes: 0,
        custo_evitado_descricao: '• Serviço Z — R$ 1.000,00 (mensal). terceiro dispensado',
      }),
      'Robô que substituiu serviço externo',
    )
    expect(m).not.toContain('### Saving de Pessoas')
    expect(m).toContain('### Contratos/Serviços Evitados')
    expect(m).not.toContain('R$')
  })
})

describe('memorialDiretoReceita', () => {
  function receitaBase(over: Partial<ReceitaColetada> = {}): ReceitaColetada {
    return {
      tipo_saving: 'mensal',
      valor_ganho_mensal: 10000,
      memorial_calculo: null,
      racional: 'estampas geradas por IA vendem esse valor por mês',
      ...over,
    }
  }

  it('monta o memorial de receita com o racional e SEM R$', () => {
    const m = memorialDiretoReceita(receitaBase(), 'Gerador de estampas')
    expect(m).toContain('### Receita Incremental')
    expect(m).toContain('Gerador de estampas')
    expect(m).toContain('### De onde vem a receita')
    expect(m).toContain('estampas geradas por IA')
    expect(m).not.toContain('R$')
    expect(m).not.toContain('10000')
  })

  it('sem racional, ainda monta o memorial (contexto padrão)', () => {
    const m = memorialDiretoReceita(receitaBase({ racional: null }), '')
    expect(m).toContain('### Receita Incremental')
    expect(m).not.toContain('### De onde vem a receita')
  })
})
