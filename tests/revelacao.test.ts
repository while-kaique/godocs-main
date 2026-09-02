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
  const zerado = { savingFrequencia: '', savingValor: '', savingDesde: '' }

  it('sem frequência, nada além dela aparece', () => {
    expect(passosSaving(zerado)).toEqual({ valor: false, desde: false, evidencia: false })
  })

  it('frequência escolhida revela o valor, e só ele', () => {
    const p = passosSaving({ ...zerado, savingFrequencia: 'mensal' })
    expect(p.valor).toBe(true)
    expect(p.desde).toBe(false)
    expect(p.evidencia).toBe(false)
  })

  it('valor em digitação já revela o "desde quando" (não espera valor válido)', () => {
    const p = passosSaving({ savingFrequencia: 'mensal', savingValor: '1', savingDesde: '' })
    expect(p.desde).toBe(true)
    expect(p.evidencia).toBe(false)
  })

  it('data preenchida revela a evidência', () => {
    const p = passosSaving({
      savingFrequencia: 'pontual',
      savingValor: '1.200,00',
      savingDesde: '2026-05-01',
    })
    expect(p).toEqual({ valor: true, desde: true, evidencia: true })
  })

  it('só espaços não conta como resposta', () => {
    const p = passosSaving({ savingFrequencia: 'mensal', savingValor: '   ', savingDesde: '' })
    expect(p.desde).toBe(false)
  })

  it('valor sem frequência NÃO pula a ordem', () => {
    const p = passosSaving({ savingFrequencia: '', savingValor: '900,00', savingDesde: '2026-01-01' })
    expect(p).toEqual({ valor: false, desde: false, evidencia: false })
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

describe('passosReceita', () => {
  const zerado = { receitaFrequencia: '', receitaValor: '', receitaTipo: '' }

  it('a ordem é frequência → valor → de onde vem → racional', () => {
    expect(passosReceita(zerado)).toEqual({ valor: false, tipo: false, racional: false })
    expect(passosReceita({ ...zerado, receitaFrequencia: 'mensal' })).toEqual({
      valor: true,
      tipo: false,
      racional: false,
    })
    expect(
      passosReceita({ receitaFrequencia: 'mensal', receitaValor: '10.000,00', receitaTipo: '' }),
    ).toEqual({ valor: true, tipo: true, racional: false })
    expect(
      passosReceita({
        receitaFrequencia: 'mensal',
        receitaValor: '10.000,00',
        receitaTipo: 'nova_venda',
      }),
    ).toEqual({ valor: true, tipo: true, racional: true })
  })

  it('tipo escolhido sem valor não revela o racional', () => {
    const p = passosReceita({ receitaFrequencia: 'mensal', receitaValor: '', receitaTipo: 'expansao' })
    expect(p.racional).toBe(false)
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
