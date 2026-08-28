import { describe, it, expect } from 'vitest';
import { avaliarCetico } from '@/lib/agents/cetico-avaliacao';

// Helpers para montar entradas "folgadas" (sem sinais) e adaptáveis.
const fteFolgado = { implausivel: false, fte: 0.5, pessoas: 1 };
const financeiroOk = { veredito: 'ok' as const, confianca: 0.9 };
const ragForte = { apoio: true, confianca: 0.9, vizinhos: 8, topSimilaridade: 0.9 };

describe('avaliarCetico — anti-bajulação (nunca desafia o que não é aprovação)', () => {
  it("em_validacao NUNCA refuta e devolve estado neutro", () => {
    const r = avaliarCetico({
      agregadoVeredito: 'em_validacao',
      fte: fteFolgado,
      financeiro: financeiroOk,
      rag: ragForte,
    });
    expect(r.refuta).toBe(false);
    expect(r.confianca).toBe(1);
    expect(r.motivo).toBeNull();
    expect(r.sinais).toEqual([]);
  });

  it("isento NUNCA refuta e devolve estado neutro", () => {
    const r = avaliarCetico({
      agregadoVeredito: 'isento',
      // até com entradas ruins, isento é intocável
      fte: { implausivel: false, fte: 5, pessoas: 1 },
      financeiro: { veredito: 'inconclusivo', confianca: 0.1 },
      rag: { apoio: true, vizinhos: 1, topSimilaridade: 0.1, confianca: 0.2 },
    });
    expect(r.refuta).toBe(false);
    expect(r.confianca).toBe(1);
    expect(r.motivo).toBeNull();
    expect(r.sinais).toEqual([]);
  });
});

describe('avaliarCetico — aprovação sem condição-limite não é refutada', () => {
  it('FTE folgado + financeiro ok + RAG forte → não refuta', () => {
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: fteFolgado,
      financeiro: financeiroOk,
      rag: ragForte,
    });
    expect(r.refuta).toBe(false);
    expect(r.confianca).toBe(0);
    expect(r.motivo).toBeNull();
    expect(r.sinais).toEqual([]);
  });
});

describe('avaliarCetico — condições-limite geram sinais e refutam', () => {
  it('FTE raspando o teto (fte > pessoas*fator*0.8) → 1 sinal, refuta', () => {
    // fte=2.0, pessoas=1, fator default 1.5 → teto=1.5, 0.8*teto=1.2, 2.0>1.2
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: { implausivel: false, fte: 2.0, pessoas: 1 },
      financeiro: financeiroOk,
      rag: ragForte,
    });
    expect(r.refuta).toBe(true);
    expect(r.sinais.length).toBe(1);
    expect(r.confianca).toBeGreaterThan(0);
    expect(r.confianca).toBeLessThanOrEqual(0.6);
    expect(typeof r.motivo).toBe('string');
    expect((r.motivo ?? '').length).toBeGreaterThan(0);
  });

  it('financeiro inconclusivo → sinal, refuta', () => {
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: fteFolgado,
      financeiro: { veredito: 'inconclusivo', confianca: 0.3 },
      rag: ragForte,
    });
    expect(r.refuta).toBe(true);
    expect(r.sinais.length).toBe(1);
    expect(r.confianca).toBeGreaterThan(0);
    expect(r.confianca).toBeLessThanOrEqual(0.6);
    expect(r.motivo).not.toBeNull();
  });

  it('RAG marginal por poucos vizinhos (<= minVizinhos) → sinal, refuta', () => {
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: fteFolgado,
      financeiro: financeiroOk,
      // apoio true mas só 2 vizinhos (minVizinhos default 2 → <=2)
      rag: { apoio: true, vizinhos: 2, topSimilaridade: 0.9, confianca: 0.9 },
    });
    expect(r.refuta).toBe(true);
    expect(r.sinais.length).toBe(1);
  });

  it('RAG marginal por similaridade baixa (< pisoApoio+0.1) → sinal, refuta', () => {
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: fteFolgado,
      financeiro: financeiroOk,
      // pisoApoio default 0.5 → limiar 0.6; 0.55 < 0.6
      rag: { apoio: true, vizinhos: 8, topSimilaridade: 0.55, confianca: 0.9 },
    });
    expect(r.refuta).toBe(true);
    expect(r.sinais.length).toBe(1);
  });

  it('três condições-limite juntas → 3 sinais, confianca >= 0.6, <= 1', () => {
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: { implausivel: false, fte: 2.0, pessoas: 1 },
      financeiro: { veredito: 'inconclusivo', confianca: 0.2 },
      rag: { apoio: true, vizinhos: 1, topSimilaridade: 0.2, confianca: 0.3 },
    });
    expect(r.refuta).toBe(true);
    expect(r.sinais.length).toBe(3);
    expect(r.confianca).toBeGreaterThanOrEqual(0.6);
    expect(r.confianca).toBeLessThanOrEqual(1);
  });
});

describe('avaliarCetico — parametrização de defaults', () => {
  it('fator custom relaxa o teto de FTE (sem sinal quando folgado)', () => {
    // fte=2.0, pessoas=1, fator=3 → teto=3, 0.8*teto=2.4, 2.0 < 2.4 → sem sinal de FTE
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: { implausivel: false, fte: 2.0, pessoas: 1 },
      financeiro: financeiroOk,
      rag: ragForte,
      fator: 3,
    });
    expect(r.sinais.length).toBe(0);
    expect(r.refuta).toBe(false);
  });

  it('confianca sempre dentro de [0,1]', () => {
    const r = avaliarCetico({
      agregadoVeredito: 'aprovar',
      fte: { implausivel: false, fte: 10, pessoas: 1 },
      financeiro: { veredito: 'inconclusivo', confianca: 0 },
      rag: { apoio: true, vizinhos: 0, topSimilaridade: 0, confianca: 0 },
    });
    expect(r.confianca).toBeGreaterThanOrEqual(0);
    expect(r.confianca).toBeLessThanOrEqual(1);
  });
});
