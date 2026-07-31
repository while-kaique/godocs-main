import { describe, expect, it } from 'vitest'
import { decidirReconciliacaoPlanilha } from '@/lib/chat.functions'

/**
 * Invariante de CONVERGÊNCIA do cron `reanalisar-pendentes`.
 *
 * O bug de origem (30/07/2026): com a coluna "Classificação" nova, todo projeto ANTIGO
 * (Complexidade na planilha, Classificação vazia, nada de classificação no SQLite) era
 * reprocessado a cada minuto — o cron escrevia só a Complexidade, a Classificação
 * continuava vazia, e ele voltava. 109 projetos × 1 leitura de cabeçalho por minuto
 * contra a cota de 60/min do Sheets = cota estourada, appends de submissões novas
 * falhando com 429 e projeto purgado do SQLite após a carência de 1h.
 */
describe('decidirReconciliacaoPlanilha — convergência do cron', () => {
  it('NÃO reprocessa o projeto antigo que não tem classificação para receber (o loop)', () => {
    expect(
      decidirReconciliacaoPlanilha({
        comp: 'automacao', // já preenchida na planilha
        classif: '', // coluna nova, vazia
        compSqlite: 'automacao',
        classifSqlite: '', // o SQLite não tem o que repor
      }),
    ).toEqual({ acao: 'nada', colunas: [] })
  })

  it('trata "—" como vazio (é o que o sync grava quando não há dado)', () => {
    expect(
      decidirReconciliacaoPlanilha({
        comp: 'autonomia',
        classif: '—',
        compSqlite: 'autonomia',
        classifSqlite: '',
      }),
    ).toEqual({ acao: 'nada', colunas: [] })
  })

  it('repõe SÓ a Classificação quando a Complexidade já está na planilha', () => {
    expect(
      decidirReconciliacaoPlanilha({
        comp: 'automacao',
        classif: '',
        compSqlite: 'automacao',
        classifSqlite: 'zona_cinzenta',
      }),
    ).toEqual({ acao: 'resync', colunas: ['classificacao'] })
  })

  it('repõe as duas colunas quando a planilha está vazia nas duas e o SQLite tem ambas', () => {
    const r = decidirReconciliacaoPlanilha({
      comp: '',
      classif: '',
      compSqlite: 'autonomia',
      classifSqlite: 'claro_nao',
    })
    expect(r.acao).toBe('resync')
    expect(r.colunas.sort()).toEqual(['classificacao', 'complexidade'])
  })

  it('NÃO reescreve coluna que já está preenchida na planilha (leitura/escrita à toa)', () => {
    expect(
      decidirReconciliacaoPlanilha({
        comp: 'automacao',
        classif: 'Zona cinzenta — justificativa',
        compSqlite: 'automacao',
        classifSqlite: 'zona_cinzenta',
      }),
    ).toEqual({ acao: 'nada', colunas: [] })
  })

  it('re-analisa quando a análise nunca concluiu (SQLite vazio nas duas pontas)', () => {
    expect(
      decidirReconciliacaoPlanilha({
        comp: '',
        classif: '',
        compSqlite: '',
        classifSqlite: '',
      }),
    ).toEqual({ acao: 'reanalisar', colunas: [] })
  })

  it('não toca em projeto que nem está na planilha (append é da IDA)', () => {
    expect(
      decidirReconciliacaoPlanilha({
        comp: undefined,
        classif: undefined,
        compSqlite: 'automacao',
        classifSqlite: 'claro_sim',
      }),
    ).toEqual({ acao: 'nada', colunas: [] })
  })

  it('é estável: aplicar o resultado do resync faz a 2ª passada devolver "nada"', () => {
    const antes = { comp: '', classif: '', compSqlite: 'automacao', classifSqlite: 'claro_sim' }
    expect(decidirReconciliacaoPlanilha(antes).acao).toBe('resync')
    // depois de gravar, a planilha passa a ter as duas células preenchidas
    expect(
      decidirReconciliacaoPlanilha({
        ...antes,
        comp: 'automacao',
        classif: 'Claro sim — justificativa',
      }),
    ).toEqual({ acao: 'nada', colunas: [] })
  })
})
