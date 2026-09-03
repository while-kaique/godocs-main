import { describe, expect, it } from 'vitest'
import {
  passosCustoEvitado,
  passosReceita,
  passosSaving,
  respostaCustoRodarInicial,
} from '@/lib/submeter/revelacao'
import { linhaHorasVazia } from '@/lib/submeter/horas'
import { itemVazio } from '@/lib/submeter/itens-lista'

// A revelação progressiva é a do formulário da v1, que o Luis pediu de volta: cada
// resposta abre a próxima pergunta. O que estes testes travam é a ORDEM (a cadência vem
// antes do número) e a régua "respondeu?" em vez de "respondeu bem?" — revelar só com
// valor válido esconderia a pergunta seguinte no meio da digitação.

describe('passosSaving', () => {
  const zerado = { savingFrequencia: '', savingValorAntes: '', savingValorAgora: '' }

  it('sem frequência, nada além dela aparece', () => {
    expect(passosSaving(zerado)).toEqual({ valores: false, evidencia: false })
  })

  it('frequência escolhida revela o PAR antes/agora, e só ele', () => {
    const p = passosSaving({ ...zerado, savingFrequencia: 'mensal' })
    expect(p.valores).toBe(true)
    expect(p.evidencia).toBe(false)
  })

  // ⚠️ As duas pontas são uma comparação: a evidência só aparece quando AS DUAS estão
  // preenchidas, senão o "quanto era" sozinho parece ser o ganho.
  it('só o "antes" preenchido NÃO revela a evidência', () => {
    const p = passosSaving({ ...zerado, savingFrequencia: 'mensal', savingValorAntes: '20.000' })
    expect(p.evidencia).toBe(false)
  })

  it('as duas pontas preenchidas revelam a evidência (mesmo com "agora" = 0)', () => {
    const p = passosSaving({
      savingFrequencia: 'pontual',
      savingValorAntes: '1.200,00',
      savingValorAgora: '0',
    })
    expect(p).toEqual({ valores: true, evidencia: true })
  })

  it('só espaços não conta como resposta', () => {
    const p = passosSaving({
      savingFrequencia: 'mensal',
      savingValorAntes: '20.000',
      savingValorAgora: '   ',
    })
    expect(p.evidencia).toBe(false)
  })

  it('valores sem frequência NÃO pulam a ordem', () => {
    const p = passosSaving({
      savingFrequencia: '',
      savingValorAntes: '900,00',
      savingValorAgora: '0',
    })
    expect(p).toEqual({ valores: false, evidencia: false })
  })
})

describe('passosCustoEvitado', () => {
  const zerado = { ceFrequencia: '', ceLinhas: [linhaHorasVazia()], ceNaoContratado: '' }

  it('sem frequência, os braços ficam escondidos', () => {
    expect(passosCustoEvitado(zerado)).toEqual({ bracos: false, racional: false })
  })

  it('frequência revela os DOIS braços de uma vez (eles somam)', () => {
    const p = passosCustoEvitado({ ...zerado, ceFrequencia: 'mensal' })
    expect(p.bracos).toBe(true)
    expect(p.racional).toBe(false)
  })

  it('só o braço de HORAS já revela o racional', () => {
    const p = passosCustoEvitado({
      ceFrequencia: 'mensal',
      ceLinhas: [{ ...linhaHorasVazia(), horasAntes: '10' }],
      ceNaoContratado: '',
    })
    expect(p.racional).toBe(true)
  })

  it('só o braço de VALOR já revela o racional', () => {
    const p = passosCustoEvitado({ ...zerado, ceFrequencia: 'mensal', ceNaoContratado: '4.000,00' })
    expect(p.racional).toBe(true)
  })

  it('tabela em branco + valor em branco mantém o racional escondido', () => {
    const p = passosCustoEvitado({
      ceFrequencia: 'trimestral',
      ceLinhas: [linhaHorasVazia(), linhaHorasVazia()],
      ceNaoContratado: '',
    })
    expect(p.racional).toBe(false)
  })
})

// ⚠️ São 3 perguntas, as da PROD: frequência → valor → racional. O passo "de onde vem"
// (lista de tipos de receita) existiu por um dia e saiu — não voltar a testá-lo.
describe('passosReceita', () => {
  const zerado = { receitaFrequencia: '', receitaValor: '' }

  it('a ordem é frequência → valor → racional', () => {
    expect(passosReceita(zerado)).toEqual({ valor: false, racional: false })
    expect(passosReceita({ ...zerado, receitaFrequencia: 'mensal' })).toEqual({
      valor: true,
      racional: false,
    })
    expect(passosReceita({ receitaFrequencia: 'mensal', receitaValor: '10.000,00' })).toEqual({
      valor: true,
      racional: true,
    })
  })

  it('valor sem frequência não pula a ordem', () => {
    expect(passosReceita({ receitaFrequencia: '', receitaValor: '10.000,00' })).toEqual({
      valor: false,
      racional: false,
    })
  })
})

describe('respostaCustoRodarInicial', () => {
  it('lista em branco nasce SEM resposta (a pergunta aparece limpa)', () => {
    expect(respostaCustoRodarInicial([itemVazio()])).toBe('')
    expect(respostaCustoRodarInicial([])).toBe('')
  })

  it('quem já digitou um item volta com "sim" e a lista aberta', () => {
    expect(respostaCustoRodarInicial([{ ...itemVazio(), nome: 'OpenAI API' }])).toBe('sim')
  })

  it('item com só o valor também conta como já respondido', () => {
    expect(respostaCustoRodarInicial([{ ...itemVazio(), valor: '99,90' }])).toBe('sim')
  })
})
