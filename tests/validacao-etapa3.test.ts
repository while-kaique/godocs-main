// Validação da ETAPA 3 (os blocos de ganho da v2) — `src/lib/submeter/validacao-etapa3.ts`.
//
// Na v1 isto era um `validate()` de 23 checagens DENTRO do `SavingForm` (`step3-chat.tsx`),
// inalcançável por teste (o Vitest deste repo roda `environment: 'node'` e só inclui
// `tests/**/*.test.ts`). O plano `docs/plans/godocs-v2-submissao-deterministica.md` (T5) manda
// extrair para módulo PURO — este arquivo é a rede que a extração precisa ter.
//
// O risco que estes casos guardam:
//
// 1. **Quem manda é `categorias`, não a presença de dado no bloco** (RF-218). Trocar de
//    categoria no meio do preenchimento deixa o bloco antigo preenchido no estado, de
//    propósito; ele não pode voltar à validação nem à conta pelas costas.
// 2. **O custo evitado tem DOIS braços que somam antes do peso de 50%** (D1/D2): a tabela de
//    horas e o que não foi contratado. Exigir os dois transformaria o caso normal ("só um
//    braço") em erro; não exigir nenhum deixaria passar bloco sem ganho algum.
// 3. **RF-208 — anexo sem texto é RECUSADO.** A imagem sozinha não diz por que o número é
//    desta automação, e é essa amarração que a triagem lê. Vale no saving e no imensurável.
// 4. **RF-209 — ganho é passado, nunca futuro.** O GoDocs só documenta ganho já realizado.
// 5. **`custoEvitado.valorHoras` sai ZERO do cliente.** O R$ da hora é derivado no BACKEND
//    (`resolverValorHora`, `saving-calc.ts`), único lugar onde o valor por cargo existe;
//    preenchê-lo aqui exporia valor/hora ao submissor.
//
// ⚠️ As réguas de componente NÃO são redigitadas aqui: evidência vem de `@/lib/submeter/evidencia`
// (`EVIDENCIA_MIN`), linhas de horas de `@/lib/submeter/horas`, itens de
// `@/lib/submeter/itens-lista`, seleção de `@/lib/ganhos` (`categoriasValidas`) e o piso do
// racional do próprio `RACIONAL_MIN`. Nenhum literal 20 nos esperados.
//
// ⚠️ CONTRATO DAS CHAVES DE ERRO que este teste fixa (a tela consome estas chaves):
//   saving          → `savingValor` · `savingFrequencia` · `savingEvidencia` · `savingDesde`
//   custo evitado   → `ceFrequencia` · `ceBracos` (nenhum dos 2 braços) · `ceRacional`
//                     + as posicionais da tabela de horas (`h0funcao`, `h0antes`, `h0depois`,
//                       `h0descricao`), vindas de `validarLinhasHoras`
//   receita         → `receitaValor` · `receitaFrequencia` · `receitaRacional` · `receitaTipo`
//   imensurável     → `imensuravelRacional`
//   custo para rodar→ prefixo `cr` (`cr0nome`, `cr0valor`, `cr0frequencia`, `cr0descricao`)
//   seleção         → `ganhoCategorias`
import { describe, it, expect } from 'vitest'
import {
  RACIONAL_MIN,
  type GanhosFormData,
  validarBloco,
  blocoCompleto,
  resumoBloco,
  validarCustoRodar,
  validarEtapa3,
  paraGanhosDeclarados,
  ganhosFormVazio,
} from '@/lib/submeter/validacao-etapa3'
import { CATEGORIA_IMENSURAVEL, type GanhoCategoria } from '@/lib/ganhos'
import { EVIDENCIA_MIN } from '@/lib/submeter/evidencia'
import { linhaHorasVazia, FUNCAO_OUTRO } from '@/lib/submeter/horas'
import { itemVazio } from '@/lib/submeter/itens-lista'

// ─────────────────────────── fixtures ───────────────────────────

const HOJE = '2026-09-02'
const OPTS = { hojeISO: HOJE }

/** Texto no piso EXATO do racional (derivado da constante, nunca do literal 20). */
const RACIONAL_NO_PISO = 'r'.repeat(RACIONAL_MIN)
/** Texto abaixo do piso por 1 caractere. */
const RACIONAL_CURTO = 'r'.repeat(RACIONAL_MIN - 1)
/** Evidência no piso EXATO (a régua é a de `evidencia.ts`, não a do racional). */
const EVIDENCIA_NO_PISO = 'e'.repeat(EVIDENCIA_MIN)

const ANEXO = { base64: 'QUJD', filename: 'extrato.png' }

/** Formulário inteiramente em branco, montado à mão (não depende de `ganhosFormVazio`). */
function formEmBranco(): GanhosFormData {
  return {
    savingValor: '',
    savingFrequencia: '',
    savingEvidencia: '',
    savingAnexos: [],
    savingDesde: '',

    ceFrequencia: '',
    ceLinhas: [linhaHorasVazia()],
    ceNaoContratado: '',
    ceRacional: '',

    receitaValor: '',
    receitaFrequencia: '',
    receitaRacional: '',
    receitaTipo: '',

    imensuravelRacional: '',
    imensuravelAnexos: [],

    custoRodar: [itemVazio()],
  }
}

function comSavingCompleto(base = formEmBranco()): GanhosFormData {
  return {
    ...base,
    savingValor: '1.200,00',
    savingFrequencia: 'mensal',
    savingEvidencia: 'Contrato da terceirizada encerrado em julho, confere na fatura.',
    savingAnexos: [ANEXO],
    savingDesde: '2026-07-01',
  }
}

/** Custo evitado com o braço das HORAS (tabela preenchida), sem valor não contratado. */
function comCustoEvitadoHoras(base = formEmBranco()): GanhosFormData {
  return {
    ...base,
    ceFrequencia: 'mensal',
    ceLinhas: [
      { funcao: 'Analista', funcaoDescricao: '', horasAntes: '40', horasDepois: '10' },
    ],
    ceNaoContratado: '',
    ceRacional: 'Sem o robô precisaríamos abrir uma vaga de analista.',
  }
}

/** Custo evitado com o braço do NÃO CONTRATADO, tabela de horas em branco. */
function comCustoEvitadoNaoContratado(base = formEmBranco()): GanhosFormData {
  return {
    ...base,
    ceFrequencia: 'mensal',
    ceLinhas: [linhaHorasVazia()],
    ceNaoContratado: '3.000,00',
    ceRacional: 'A consultoria orçada em 3 mil por mês nunca chegou a ser contratada.',
  }
}

function comReceitaCompleta(base = formEmBranco()): GanhosFormData {
  return {
    ...base,
    receitaValor: '5.000,00',
    receitaFrequencia: 'mensal',
    receitaRacional: 'Conversão nova medida no relatório de vendas do mês.',
    receitaTipo: 'recorrente',
  }
}

function comImensuravelCompleto(base = formEmBranco()): GanhosFormData {
  return {
    ...base,
    imensuravelRacional: 'Reduz o risco de multa fiscal ao conferir cada nota emitida.',
    imensuravelAnexos: [],
  }
}

function comCustoRodarCompleto(base = formEmBranco()): GanhosFormData {
  return {
    ...base,
    custoRodar: [
      {
        nome: 'API OpenAI',
        valor: '400,00',
        frequencia: 'mensal',
        descricao: 'Chamadas de IA que o robô faz para classificar as notas.',
      },
    ],
  }
}

/** As chaves de erro que começam com um prefixo (para provar ausência de família inteira). */
function chavesCom(erros: Record<string, string>, prefixo: string): string[] {
  return Object.keys(erros).filter((k) => k.startsWith(prefixo))
}

// ─────────────────────────── ganhosFormVazio ───────────────────────────

describe('ganhosFormVazio', () => {
  it('devolve tudo em branco', () => {
    const vazio = ganhosFormVazio()
    expect(vazio.savingValor).toBe('')
    expect(vazio.savingFrequencia).toBe('')
    expect(vazio.savingEvidencia).toBe('')
    expect(vazio.savingAnexos).toEqual([])
    expect(vazio.savingDesde).toBe('')
    expect(vazio.ceFrequencia).toBe('')
    expect(vazio.ceNaoContratado).toBe('')
    expect(vazio.ceRacional).toBe('')
    expect(vazio.receitaValor).toBe('')
    expect(vazio.receitaFrequencia).toBe('')
    expect(vazio.receitaRacional).toBe('')
    expect(vazio.receitaTipo).toBe('')
    expect(vazio.imensuravelRacional).toBe('')
    expect(vazio.imensuravelAnexos).toEqual([])
  })

  it('nasce com UMA linha em branco em cada lista — a tela nunca fica sem linha', () => {
    const vazio = ganhosFormVazio()
    expect(vazio.ceLinhas).toEqual([linhaHorasVazia()])
    expect(vazio.custoRodar).toEqual([itemVazio()])
  })

  it('o formulário vazio não gera erro de bloco nenhum antes de a pessoa marcar categoria', () => {
    // Nada marcado = nada validado; quem reclama da seleção é `validarEtapa3`.
    expect(validarCustoRodar(ganhosFormVazio())).toEqual({})
  })
})

// ─────────────────────────── saving efetivado ───────────────────────────

describe('validarBloco — saving efetivado (a linha de custo que PAROU)', () => {
  it('bloco vazio acusa valor, frequência, evidência e desde quando, cada um na sua chave', () => {
    const erros = validarBloco('saving_efetivado', formEmBranco(), OPTS)
    expect(Object.keys(erros).sort()).toEqual(
      ['savingDesde', 'savingEvidencia', 'savingFrequencia', 'savingValor'].sort(),
    )
  })

  it('valor que parseia para zero ou menos é erro (a régua de moeda é de centavos)', () => {
    const dados = { ...comSavingCompleto(), savingValor: '0,00' }
    expect(validarBloco('saving_efetivado', dados, OPTS)).toHaveProperty('savingValor')
  })

  it('anexo sem texto continua RECUSADO — a prova não substitui a explicação (RF-208)', () => {
    const dados = { ...comSavingCompleto(), savingEvidencia: '', savingAnexos: [ANEXO] }
    const erros = validarBloco('saving_efetivado', dados, OPTS)
    expect(erros).toHaveProperty('savingEvidencia')
  })

  it('evidência abaixo do piso de EVIDENCIA_MIN é erro; no piso exato passa', () => {
    const curta = {
      ...comSavingCompleto(),
      savingEvidencia: 'e'.repeat(EVIDENCIA_MIN - 1),
    }
    expect(validarBloco('saving_efetivado', curta, OPTS)).toHaveProperty(
      'savingEvidencia',
    )

    const noPiso = { ...comSavingCompleto(), savingEvidencia: EVIDENCIA_NO_PISO }
    expect(validarBloco('saving_efetivado', noPiso, OPTS)).toEqual({})
  })

  it('"desde quando" no FUTURO é erro — o GoDocs só documenta ganho já realizado', () => {
    const amanha = { ...comSavingCompleto(), savingDesde: '2026-09-03' }
    const erros = validarBloco('saving_efetivado', amanha, OPTS)
    expect(erros).toHaveProperty('savingDesde')
  })

  it('"desde quando" igual a hoje é ACEITO (a fronteira do dia é inclusiva)', () => {
    const hoje = { ...comSavingCompleto(), savingDesde: HOJE }
    expect(validarBloco('saving_efetivado', hoje, OPTS)).toEqual({})
  })

  it('bloco completo não gera erro nenhum', () => {
    expect(validarBloco('saving_efetivado', comSavingCompleto(), OPTS)).toEqual({})
  })
})

// ─────────────────────────── custo evitado ───────────────────────────

describe('validarBloco — custo evitado (a despesa que NUNCA nasceu)', () => {
  it('exige a frequência do bloco', () => {
    const dados = { ...comCustoEvitadoHoras(), ceFrequencia: '' as const }
    expect(validarBloco('custo_evitado', dados, OPTS)).toHaveProperty('ceFrequencia')
  })

  it('com os DOIS braços vazios acusa que falta declarar ao menos um', () => {
    const dados: GanhosFormData = {
      ...formEmBranco(),
      ceFrequencia: 'mensal',
      ceRacional: 'Racional escrito, mas nenhum dos dois braços foi declarado.',
    }
    const erros = validarBloco('custo_evitado', dados, OPTS)
    expect(erros).toHaveProperty('ceBracos')
  })

  it('só a tabela de horas preenchida NÃO é erro de braço (é caso normal)', () => {
    const erros = validarBloco('custo_evitado', comCustoEvitadoHoras(), OPTS)
    expect(erros).not.toHaveProperty('ceBracos')
    expect(erros).toEqual({})
  })

  it('só o valor não contratado NÃO é erro de braço (é caso normal)', () => {
    const erros = validarBloco('custo_evitado', comCustoEvitadoNaoContratado(), OPTS)
    expect(erros).not.toHaveProperty('ceBracos')
    expect(erros).toEqual({})
  })

  it('linha de horas com função "Outro" sem descrição acusa na chave da régua de horas', () => {
    const dados: GanhosFormData = {
      ...comCustoEvitadoHoras(),
      ceLinhas: [
        {
          funcao: FUNCAO_OUTRO,
          funcaoDescricao: '',
          horasAntes: '40',
          horasDepois: '10',
        },
      ],
    }
    expect(validarBloco('custo_evitado', dados, OPTS)).toHaveProperty('h0descricao')
  })

  it('horas depois maiores que as horas antes acusam na chave da régua de horas', () => {
    const dados: GanhosFormData = {
      ...comCustoEvitadoHoras(),
      ceLinhas: [
        { funcao: 'Analista', funcaoDescricao: '', horasAntes: '10', horasDepois: '40' },
      ],
    }
    expect(validarBloco('custo_evitado', dados, OPTS)).toHaveProperty('h0depois')
  })

  it('linha começada sem função acusa na chave da régua de horas', () => {
    const dados: GanhosFormData = {
      ...comCustoEvitadoHoras(),
      ceLinhas: [
        { funcao: '', funcaoDescricao: '', horasAntes: '40', horasDepois: '10' },
      ],
    }
    expect(validarBloco('custo_evitado', dados, OPTS)).toHaveProperty('h0funcao')
  })

  it('tabela TOTALMENTE em branco não gera erro de linha quando o outro braço existe', () => {
    const erros = validarBloco('custo_evitado', comCustoEvitadoNaoContratado(), OPTS)
    expect(chavesCom(erros, 'h0')).toEqual([])
  })

  it('exige o racional pelo piso de RACIONAL_MIN (curto reprova, piso exato passa)', () => {
    const curto = { ...comCustoEvitadoHoras(), ceRacional: RACIONAL_CURTO }
    expect(validarBloco('custo_evitado', curto, OPTS)).toHaveProperty('ceRacional')

    const noPiso = { ...comCustoEvitadoHoras(), ceRacional: RACIONAL_NO_PISO }
    expect(validarBloco('custo_evitado', noPiso, OPTS)).toEqual({})
  })

  it('bloco vazio acusa frequência, braços e racional de uma vez', () => {
    const erros = validarBloco('custo_evitado', formEmBranco(), OPTS)
    expect(erros).toHaveProperty('ceFrequencia')
    expect(erros).toHaveProperty('ceBracos')
    expect(erros).toHaveProperty('ceRacional')
  })
})

// ─────────────────────────── receita incremental ───────────────────────────

describe('validarBloco — receita incremental (dinheiro NOVO entrando)', () => {
  it('bloco vazio acusa os 4 campos, cada um na sua chave', () => {
    const erros = validarBloco('receita_incremental', formEmBranco(), OPTS)
    expect(Object.keys(erros).sort()).toEqual(
      ['receitaFrequencia', 'receitaRacional', 'receitaTipo', 'receitaValor'].sort(),
    )
  })

  it('valor que parseia para zero ou menos é erro', () => {
    const dados = { ...comReceitaCompleta(), receitaValor: '0,00' }
    expect(validarBloco('receita_incremental', dados, OPTS)).toHaveProperty(
      'receitaValor',
    )
  })

  it('racional segue o piso de RACIONAL_MIN (curto reprova, piso exato passa)', () => {
    const curto = { ...comReceitaCompleta(), receitaRacional: RACIONAL_CURTO }
    expect(validarBloco('receita_incremental', curto, OPTS)).toHaveProperty(
      'receitaRacional',
    )

    const noPiso = { ...comReceitaCompleta(), receitaRacional: RACIONAL_NO_PISO }
    expect(validarBloco('receita_incremental', noPiso, OPTS)).toEqual({})
  })

  it('bloco completo não gera erro nenhum', () => {
    expect(validarBloco('receita_incremental', comReceitaCompleta(), OPTS)).toEqual({})
  })
})

// ─────────────────────────── ganho imensurável ───────────────────────────

describe('validarBloco — ganho imensurável (só o racional, pelo componente de evidência)', () => {
  it('racional ausente acusa em chave própria', () => {
    const erros = validarBloco(CATEGORIA_IMENSURAVEL, formEmBranco(), OPTS)
    expect(erros).toHaveProperty('imensuravelRacional')
  })

  it('anexo sem texto é RECUSADO aqui também (RF-208)', () => {
    const dados: GanhosFormData = {
      ...formEmBranco(),
      imensuravelRacional: '',
      imensuravelAnexos: [ANEXO],
    }
    expect(validarBloco(CATEGORIA_IMENSURAVEL, dados, OPTS)).toHaveProperty(
      'imensuravelRacional',
    )
  })

  it('NÃO exige valor nem frequência — a categoria não tem número por definição', () => {
    // Todo o resto do formulário em branco: só o racional foi escrito.
    const erros = validarBloco(CATEGORIA_IMENSURAVEL, comImensuravelCompleto(), OPTS)
    expect(erros).toEqual({})
  })

  it('anexo é OPCIONAL: racional válido sozinho basta', () => {
    const dados = { ...comImensuravelCompleto(), imensuravelAnexos: [] }
    expect(validarBloco(CATEGORIA_IMENSURAVEL, dados, OPTS)).toEqual({})
  })
})

// ─────────────────────────── custo para rodar ───────────────────────────

describe('validarCustoRodar', () => {
  it('lista só com linha em branco NÃO gera erro — projeto sem custo para rodar é legítimo', () => {
    expect(validarCustoRodar(formEmBranco())).toEqual({})
  })

  it('linha COMEÇADA tem de ser terminada (só o nome digitado acusa os outros 3)', () => {
    const dados: GanhosFormData = {
      ...formEmBranco(),
      custoRodar: [{ ...itemVazio(), nome: 'API OpenAI' }],
    }
    const erros = validarCustoRodar(dados)
    expect(erros).toHaveProperty('cr0valor')
    expect(erros).toHaveProperty('cr0frequencia')
    expect(erros).toHaveProperty('cr0descricao')
    expect(erros).not.toHaveProperty('cr0nome')
  })

  it('item completo não gera erro', () => {
    expect(validarCustoRodar(comCustoRodarCompleto())).toEqual({})
  })
})

// ─────────────────────────── validarEtapa3 ───────────────────────────

describe('validarEtapa3', () => {
  it('valida SÓ as categorias marcadas — bloco de saving em branco não conta se não foi marcado', () => {
    const erros = validarEtapa3(['receita_incremental'], comReceitaCompleta(), OPTS)
    expect(chavesCom(erros, 'saving')).toEqual([])
    expect(erros).toEqual({})
  })

  it('bloco preenchido de categoria DESMARCADA não é validado (resíduo de troca de seleção)', () => {
    // Saving preenchido com data no FUTURO — inválido —, mas a categoria marcada é outra.
    const dados = comReceitaCompleta(comSavingCompleto())
    const comFuturo = { ...dados, savingDesde: '2026-12-31' }
    expect(validarEtapa3(['receita_incremental'], comFuturo, OPTS)).toEqual({})
  })

  it('acusa o bloco marcado que está incompleto', () => {
    const erros = validarEtapa3(['saving_efetivado'], formEmBranco(), OPTS)
    expect(erros).toHaveProperty('savingValor')
    expect(erros).toHaveProperty('savingFrequencia')
  })

  it('inclui os erros do custo para rodar', () => {
    const dados: GanhosFormData = {
      ...comReceitaCompleta(),
      custoRodar: [{ ...itemVazio(), nome: 'API OpenAI' }],
    }
    const erros = validarEtapa3(['receita_incremental'], dados, OPTS)
    expect(erros).toHaveProperty('cr0valor')
  })

  it('seleção VAZIA é erro próprio em ganhoCategorias', () => {
    const erros = validarEtapa3([], comReceitaCompleta(), OPTS)
    expect(erros).toHaveProperty('ganhoCategorias')
  })

  it('MISTURA de imensurável com mensurável é erro próprio em ganhoCategorias', () => {
    const dados = comImensuravelCompleto(comSavingCompleto())
    const erros = validarEtapa3(
      [CATEGORIA_IMENSURAVEL, 'saving_efetivado'],
      dados,
      OPTS,
    )
    expect(erros).toHaveProperty('ganhoCategorias')
  })

  it('seleção válida com blocos completos devolve {}', () => {
    const dados = comCustoRodarCompleto(
      comCustoEvitadoHoras(comReceitaCompleta(comSavingCompleto())),
    )
    const erros = validarEtapa3(
      ['saving_efetivado', 'custo_evitado', 'receita_incremental'],
      dados,
      OPTS,
    )
    expect(erros).toEqual({})
  })

  it('imensurável sozinho, com todo o resto em branco, devolve {}', () => {
    expect(validarEtapa3([CATEGORIA_IMENSURAVEL], comImensuravelCompleto(), OPTS)).toEqual(
      {},
    )
  })
})

// ─────────────────────────── blocoCompleto / resumoBloco ───────────────────────────

describe('blocoCompleto', () => {
  const casos: Array<[GanhoCategoria, GanhosFormData, GanhosFormData]> = [
    ['saving_efetivado', formEmBranco(), comSavingCompleto()],
    ['custo_evitado', formEmBranco(), comCustoEvitadoHoras()],
    ['receita_incremental', formEmBranco(), comReceitaCompleta()],
    [CATEGORIA_IMENSURAVEL, formEmBranco(), comImensuravelCompleto()],
  ]

  it.each(casos)(
    'é true exatamente quando validarBloco devolve {} (%s)',
    (categoria, vazio, cheio) => {
      expect(blocoCompleto(categoria, vazio, OPTS)).toBe(
        Object.keys(validarBloco(categoria, vazio, OPTS)).length === 0,
      )
      expect(blocoCompleto(categoria, vazio, OPTS)).toBe(false)

      expect(blocoCompleto(categoria, cheio, OPTS)).toBe(
        Object.keys(validarBloco(categoria, cheio, OPTS)).length === 0,
      )
      expect(blocoCompleto(categoria, cheio, OPTS)).toBe(true)
    },
  )
})

describe('resumoBloco (a linha que o acordeão mostra com o bloco FECHADO)', () => {
  it('bloco vazio devolve string vazia', () => {
    const vazio = formEmBranco()
    expect(resumoBloco('saving_efetivado', vazio)).toBe('')
    expect(resumoBloco('custo_evitado', vazio)).toBe('')
    expect(resumoBloco('receita_incremental', vazio)).toBe('')
    expect(resumoBloco(CATEGORIA_IMENSURAVEL, vazio)).toBe('')
  })

  it('saving preenchido resume mencionando o valor declarado', () => {
    const resumo = resumoBloco('saving_efetivado', comSavingCompleto())
    expect(resumo).not.toBe('')
    expect(resumo).toMatch(/1\.?200/)
  })

  it('receita preenchida resume mencionando o valor declarado', () => {
    const resumo = resumoBloco('receita_incremental', comReceitaCompleta())
    expect(resumo).not.toBe('')
    expect(resumo).toMatch(/5\.?000/)
  })

  it('custo evitado preenchido resume sem ficar vazio', () => {
    expect(resumoBloco('custo_evitado', comCustoEvitadoNaoContratado())).not.toBe('')
    expect(resumoBloco('custo_evitado', comCustoEvitadoHoras())).not.toBe('')
  })

  it('imensurável preenchido resume sem ficar vazio', () => {
    expect(resumoBloco(CATEGORIA_IMENSURAVEL, comImensuravelCompleto())).not.toBe('')
  })
})

// ─────────────────────────── paraGanhosDeclarados ───────────────────────────

describe('paraGanhosDeclarados', () => {
  it('só o que está MARCADO atravessa — bloco desmarcado é resíduo e fica de fora', () => {
    const dados = comReceitaCompleta(comSavingCompleto())
    const declarados = paraGanhosDeclarados(['receita_incremental'], dados)

    expect(declarados.categorias).toEqual(['receita_incremental'])
    expect(declarados.savingEfetivado).toBeUndefined()
    expect(declarados.receitaIncremental).toBeDefined()
  })

  it('o saving marcado atravessa com valor numérico, frequência do enum e a data', () => {
    const declarados = paraGanhosDeclarados(['saving_efetivado'], comSavingCompleto())
    expect(declarados.savingEfetivado).toMatchObject({
      valor: 1200,
      frequencia: 'mensal',
      desde: '2026-07-01',
    })
  })

  it('no custo evitado, valorHoras sai ZERO — o R$ da hora é derivado no BACKEND', () => {
    const declarados = paraGanhosDeclarados(['custo_evitado'], comCustoEvitadoHoras())
    const ce = declarados.custoEvitado

    expect(ce).toBeDefined()
    // As linhas FORAM convertidas (as horas viraram número)…
    expect(ce?.linhasHoras).toEqual([
      { funcao: 'Analista', horasAntes: 40, horasDepois: 10 },
    ])
    // …e mesmo assim o R$ das horas sai zero daqui.
    expect(ce?.valorHoras).toBe(0)
  })

  it('no custo evitado, o braço do não contratado atravessa como número', () => {
    const declarados = paraGanhosDeclarados(
      ['custo_evitado'],
      comCustoEvitadoNaoContratado(),
    )
    expect(declarados.custoEvitado).toMatchObject({
      frequencia: 'mensal',
      naoContratado: 3000,
      valorHoras: 0,
    })
    expect(declarados.custoEvitado?.linhasHoras).toEqual([])
  })

  it('as frequências atravessam como as do enum de impacto (trimestral/semestral/pontual)', () => {
    const dados: GanhosFormData = {
      ...comSavingCompleto(comReceitaCompleta()),
      savingFrequencia: 'trimestral',
      receitaFrequencia: 'pontual',
    }
    const declarados = paraGanhosDeclarados(
      ['saving_efetivado', 'receita_incremental'],
      { ...dados, ceFrequencia: 'semestral' },
    )
    expect(declarados.savingEfetivado?.frequencia).toBe('trimestral')
    expect(declarados.receitaIncremental?.frequencia).toBe('pontual')
  })

  it('a receita marcada atravessa com valor, racional e tipo', () => {
    const declarados = paraGanhosDeclarados(
      ['receita_incremental'],
      comReceitaCompleta(),
    )
    expect(declarados.receitaIncremental).toMatchObject({
      valor: 5000,
      frequencia: 'mensal',
      tipo: 'recorrente',
    })
  })

  it('o imensurável marcado atravessa só com o racional', () => {
    const declarados = paraGanhosDeclarados(
      [CATEGORIA_IMENSURAVEL],
      comImensuravelCompleto(),
    )
    expect(declarados.imensuravel?.racional).toBe(
      'Reduz o risco de multa fiscal ao conferir cada nota emitida.',
    )
    expect(declarados.savingEfetivado).toBeUndefined()
    expect(declarados.custoEvitado).toBeUndefined()
    expect(declarados.receitaIncremental).toBeUndefined()
  })

  it('o custo para rodar atravessa independentemente da categoria, ignorando linha em branco', () => {
    const comBranco: GanhosFormData = {
      ...comCustoRodarCompleto(comReceitaCompleta()),
      custoRodar: [
        {
          nome: 'API OpenAI',
          valor: '400,00',
          frequencia: 'mensal',
          descricao: 'Chamadas de IA do robô.',
        },
        itemVazio(),
      ],
    }

    const naReceita = paraGanhosDeclarados(['receita_incremental'], comBranco)
    expect(naReceita.custoRodar).toEqual([
      {
        nome: 'API OpenAI',
        valor: 400,
        frequencia: 'mensal',
        oQueE: 'Chamadas de IA do robô.',
      },
    ])

    const noImensuravel = paraGanhosDeclarados(
      [CATEGORIA_IMENSURAVEL],
      comImensuravelCompleto(comBranco),
    )
    expect(noImensuravel.custoRodar).toEqual(naReceita.custoRodar)
  })
})

// ─────────────────────────── bordas combinadas ───────────────────────────

describe('bordas', () => {
  it('a data de "desde" na fronteira: hoje entra, amanhã não', () => {
    const hoje = { ...comSavingCompleto(), savingDesde: HOJE }
    const amanha = { ...comSavingCompleto(), savingDesde: '2026-09-03' }

    expect(blocoCompleto('saving_efetivado', hoje, OPTS)).toBe(true)
    expect(blocoCompleto('saving_efetivado', amanha, OPTS)).toBe(false)
  })

  it('racional com exatamente RACIONAL_MIN caracteres é aceito nos dois blocos que o pedem', () => {
    const ce = { ...comCustoEvitadoHoras(), ceRacional: RACIONAL_NO_PISO }
    const receita = { ...comReceitaCompleta(), receitaRacional: RACIONAL_NO_PISO }

    expect(blocoCompleto('custo_evitado', ce, OPTS)).toBe(true)
    expect(blocoCompleto('receita_incremental', receita, OPTS)).toBe(true)
  })

  it('troca de seleção: dois blocos preenchidos, só um marcado — valida e converte só o marcado', () => {
    const dados = comCustoRodarCompleto(comSavingCompleto(comReceitaCompleta()))

    // O saving preenchido fica inválido, mas não está marcado: a Etapa 3 passa.
    const comSavingQuebrado = { ...dados, savingValor: '0,00' }
    expect(validarEtapa3(['receita_incremental'], comSavingQuebrado, OPTS)).toEqual({})

    const declarados = paraGanhosDeclarados(['receita_incremental'], comSavingQuebrado)
    expect(declarados.savingEfetivado).toBeUndefined()
    expect(declarados.receitaIncremental?.valor).toBe(5000)
    expect(declarados.custoRodar).toHaveLength(1)
  })
})
