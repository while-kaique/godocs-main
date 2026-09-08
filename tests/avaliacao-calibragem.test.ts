/**
 * T10/T11 — a confiança exibida passa a ser frequência MEDIDA por faixa (INV-18 / RF-239, RF-240)
 * e a concordância implícita só conta com PROVA DE OLHADA (D2 / RF-238).
 */
import { describe, it, expect } from 'vitest';
import {
  agruparCalibragem,
  calibragemVazia,
  classificarConcordanciaImplicita,
  contarConcordancia,
  descreverFaixaMedida,
  taxaEmDez,
  MARCO_CONCORDANCIA_IMPLICITA,
  MIN_AMOSTRA_FAIXA,
  FAIXAS_CONFIANCA,
} from '@/lib/avaliacao-calibragem';

const repetir = (n: number, grau: string, resultado: string) =>
  Array.from({ length: n }, () => ({ grau, resultado }));

describe('agruparCalibragem — acerto por FAIXA, que é o que a coluna `grau` nunca respondia', () => {
  it('agrupa por faixa e conta cada balde do comparador', () => {
    const c = agruparCalibragem([
      ...repetir(15, 'alta', 'acerto'),
      ...repetir(5, 'alta', 'conservador'),
      ...repetir(2, 'alta', 'erro_grave'),
      ...repetir(3, 'alta', 'sem_base'),
      ...repetir(4, 'media', 'acerto'),
      ...repetir(1, 'baixa', 'reprovacao_indevida'),
    ]);
    expect(c.alta.total).toBe(25);
    expect(c.alta.acerto).toBe(15);
    expect(c.alta.conservador).toBe(5);
    expect(c.alta.erro_grave).toBe(2);
    expect(c.alta.sem_base).toBe(3);
    // `comparaveis` desconta quem não tem gabarito humano.
    expect(c.alta.comparaveis).toBe(22);
    expect(c.baixa.reprovacao_indevida).toBe(1);
  });

  it('respeita o `n` das linhas agregadas do SQL (GROUP BY devolve contagem, não uma linha por caso)', () => {
    const c = agruparCalibragem([
      { grau: 'alta', resultado: 'acerto', n: 24 },
      { grau: 'alta', resultado: 'conservador', n: 6 },
    ]);
    expect(c.alta.comparaveis).toBe(30);
    expect(c.alta.taxa_acerto).toBeCloseTo(0.8, 5);
  });

  it('faixa com amostra suficiente tem taxa; abaixo do mínimo a taxa é NULL, nunca 0', () => {
    const suficiente = agruparCalibragem(repetir(MIN_AMOSTRA_FAIXA, 'alta', 'acerto'));
    expect(suficiente.alta.suficiente).toBe(true);
    expect(suficiente.alta.taxa_acerto).toBe(1);

    const curta = agruparCalibragem(repetir(MIN_AMOSTRA_FAIXA - 1, 'alta', 'conservador'));
    expect(curta.alta.suficiente).toBe(false);
    // ⚠️ o ponto do teste: 19 erros seguidos NÃO viram "0%" na tela.
    expect(curta.alta.taxa_acerto).toBeNull();
  });

  it('faixa com n=0 não vira 0% — fica null e sem amostra', () => {
    const vazia = calibragemVazia();
    for (const f of FAIXAS_CONFIANCA) {
      expect(vazia[f].taxa_acerto).toBeNull();
      expect(vazia[f].suficiente).toBe(false);
      expect(vazia[f].comparaveis).toBe(0);
    }
    const c = agruparCalibragem(repetir(30, 'alta', 'acerto'));
    expect(c.baixa.taxa_acerto).toBeNull();
  });

  it('grau desconhecido/ausente cai em `sem_grau` em vez de sumir da conta', () => {
    const c = agruparCalibragem([
      { grau: null, resultado: 'acerto' },
      { grau: 'ALTA', resultado: 'acerto' },
      { grau: 'inventado', resultado: 'acerto' },
      { grau: 'media', resultado: 'balde_novo_que_ninguem_conhece' },
    ]);
    expect(c.sem_grau.total).toBe(2);
    expect(c.alta.total).toBe(1); // normaliza a caixa
    // resultado desconhecido é tratado como sem gabarito, não como acerto.
    expect(c.media.sem_base).toBe(1);
    expect(c.media.acerto).toBe(0);
  });
});

describe('descreverFaixaMedida — a frase é FONTE ÚNICA e não exibe percentual', () => {
  it('com amostra: diz a taxa em 10 e o tamanho da amostra', () => {
    const c = agruparCalibragem([
      { grau: 'alta', resultado: 'acerto', n: 24 },
      { grau: 'alta', resultado: 'conservador', n: 6 },
    ]);
    const frase = descreverFaixaMedida(c.alta);
    expect(frase).toBe('bate com a triagem em 8 de 10 (30 casos medidos)');
    expect(frase).not.toMatch(/%/);
  });

  it('sem amostra (e sem faixa nenhuma): diz que não há medição', () => {
    expect(descreverFaixaMedida(calibragemVazia().alta)).toBe('ainda sem medição');
    expect(descreverFaixaMedida(null)).toBe('ainda sem medição');
    expect(descreverFaixaMedida(undefined)).toBe('ainda sem medição');
  });

  it('taxaEmDez arredonda e nunca sai da faixa 0..10', () => {
    expect(taxaEmDez(0.84)).toBe(8);
    expect(taxaEmDez(0.85)).toBe(9);
    expect(taxaEmDez(-1)).toBe(0);
    expect(taxaEmDez(5)).toBe(10);
  });
});

describe('concordância implícita (D2/RF-238) — só conta com PROVA DE OLHADA', () => {
  const depois = '2026-09-10T10:00:00Z';
  const olhadaDepois = '2026-09-10T12:00:00Z';

  it('avaliado depois do marco + triagem gravou DEPOIS + sem 👎 → concordância', () => {
    expect(
      classificarConcordanciaImplicita({
        avaliadoEm: depois,
        olhadaEm: olhadaDepois,
        discordou: false,
      }),
    ).toBe('concordancia');
  });

  it('ninguém abriu (sem Status nem estrelas gravados) → FORA da conta, não acerto de graça', () => {
    expect(
      classificarConcordanciaImplicita({ avaliadoEm: depois, olhadaEm: null, discordou: false }),
    ).toBe('fora');
  });

  it('olhada ANTES da avaliação não é prova: ninguém leu o que não existia', () => {
    expect(
      classificarConcordanciaImplicita({
        avaliadoEm: depois,
        olhadaEm: '2026-09-09T23:00:00Z',
        discordou: false,
      }),
    ).toBe('fora');
  });

  it('a base PASSADA (antes do marco) não conta como concordância', () => {
    expect(
      classificarConcordanciaImplicita({
        avaliadoEm: '2026-08-01T10:00:00Z',
        olhadaEm: '2026-08-02T10:00:00Z',
        discordou: false,
      }),
    ).toBe('fora');
    expect(MARCO_CONCORDANCIA_IMPLICITA).toBe('2026-09-08T00:00:00Z');
  });

  it('o 👎 conta RETROATIVAMENTE — vale antes do marco e sem prova de olhada', () => {
    expect(
      classificarConcordanciaImplicita({
        avaliadoEm: '2026-07-01T10:00:00Z',
        olhadaEm: null,
        discordou: true,
      }),
    ).toBe('discordancia');
  });

  it('data ilegível não inventa concordância', () => {
    expect(
      classificarConcordanciaImplicita({ avaliadoEm: 'ontem', olhadaEm: 'hoje', discordou: false }),
    ).toBe('fora');
  });

  it('contarConcordancia soma os três sinais', () => {
    expect(
      contarConcordancia(['concordancia', 'concordancia', 'discordancia', 'fora']),
    ).toEqual({ concordancia: 2, discordancia: 1, fora: 1 });
  });
});
