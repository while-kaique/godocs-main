// Padronização da planilha: coluna numérica vazia → 0; texto vazio → "—".
import { describe, it, expect } from 'vitest';
import { padronizarLinha, derivarSplitHorasSheet } from '@/lib/google/sync';

describe('padronizarLinha', () => {
  it('texto vazio/null/"-"/"—" vira "—"', () => {
    const r = padronizarLinha({
      'Projeto': '', 'Descrição': null, 'Observações': '-', 'Tipo de Saving': '—', 'Participantes': undefined,
    });
    expect(r['Projeto']).toBe('—');
    expect(r['Descrição']).toBe('—');
    expect(r['Observações']).toBe('—');
    expect(r['Tipo de Saving']).toBe('—');
    expect(r['Participantes']).toBe('—');
  });

  it('texto preenchido é preservado', () => {
    const r = padronizarLinha({ 'Projeto': 'Resumo NFS', 'Complexidade': 'automacao' });
    expect(r['Projeto']).toBe('Resumo NFS');
    expect(r['Complexidade']).toBe('automacao');
  });

  it('coluna numérica vazia/inválida vira 0', () => {
    const r = padronizarLinha({
      'Saving Reais': null, 'Custo Evitado': '', 'Receita Mensal': '—', 'Ganho Total': undefined, 'Horas em Reais': 'abc',
    });
    expect(r['Saving Reais']).toBe(0);
    expect(r['Custo Evitado']).toBe(0);
    expect(r['Receita Mensal']).toBe(0);
    expect(r['Ganho Total']).toBe(0);
    expect(r['Horas em Reais']).toBe(0);
  });

  it('coluna numérica com valor (número ou string pt-BR) é preservada', () => {
    const r = padronizarLinha({ 'Saving Reais': 418.2, 'Custo Externo Mensal': '1.234,56', 'Saving Horas': 30 });
    expect(r['Saving Reais']).toBe(418.2);
    expect(r['Custo Externo Mensal']).toBeCloseTo(1234.56, 2);
    expect(r['Saving Horas']).toBe(30);
  });

  // F4 — split carga real × escala: colunas NUMÉRICAS (horas). Número quando há split;
  // quando não se aplica, 0 (regra: número vazio → 0, NUNCA "—").
  it('"Saving Horas Real"/"Saving Horas Escalado" são numéricas: número quando há, 0 quando não', () => {
    const comSplit = padronizarLinha({ 'Saving Horas Real': 24, 'Saving Horas Escalado': 108 });
    expect(comSplit['Saving Horas Real']).toBe(24);
    expect(comSplit['Saving Horas Escalado']).toBe(108);
    const semSplit = padronizarLinha({ 'Saving Horas Real': '—', 'Saving Horas Escalado': '' });
    expect(semSplit['Saving Horas Real']).toBe(0);
    expect(semSplit['Saving Horas Escalado']).toBe(0);
  });

  // F5 (precursor) — "Análise Antiagente" é TEXTO: vazio → "—".
  it('"Análise Antiagente" (texto) vazio vira "—"', () => {
    expect(padronizarLinha({ 'Análise Antiagente': '' })['Análise Antiagente']).toBe('—');
    expect(padronizarLinha({ 'Análise Antiagente': 'Sem ressalvas.' })['Análise Antiagente']).toBe('Sem ressalvas.');
  });
});

// Derivação das colunas "Saving Horas Real"/"Saving Horas Escalado" a partir de
// "Alguém Fazia?" + total de horas. 'nao' (contrafactual) = 100% escala (decisão 29/06/2026).
describe('derivarSplitHorasSheet', () => {
  it("'sim' com split capturado usa carga real × escala", () => {
    const r = derivarSplitHorasSheet('sim', { horas_carga_real: 24, horas_escala: 108, economia_horas_mes: 132 });
    expect(r).toEqual({ real: 24, escalado: 108 });
  });

  it("'sim' SEM split capturado (legado/pré-feature) → 0/0 (não inventa)", () => {
    const r = derivarSplitHorasSheet('sim', { horas_carga_real: null, horas_escala: null, economia_horas_mes: 132 });
    expect(r).toEqual({ real: 0, escalado: 0 });
  });

  it("'nao' (contrafactual) → Real=0, Escalado=total (100% escala)", () => {
    expect(derivarSplitHorasSheet('nao', { economia_horas_mes: 140 })).toEqual({ real: 0, escalado: 140 });
    // ignora qualquer horas_carga_real/escala que o LLM tenha deixado: o total manda.
    const r = derivarSplitHorasSheet('nao', { horas_carga_real: 5, horas_escala: 10, economia_horas_mes: 40 });
    expect(r).toEqual({ real: 0, escalado: 40 });
  });

  it("'nao' sem horas (total 0) → 0/0", () => {
    expect(derivarSplitHorasSheet('nao', { economia_horas_mes: 0 })).toEqual({ real: 0, escalado: 0 });
  });

  it("'externo' (custo evitado puro) e alguemFazia ausente → 0/0", () => {
    expect(derivarSplitHorasSheet('externo', { economia_horas_mes: 0 })).toEqual({ real: 0, escalado: 0 });
    expect(derivarSplitHorasSheet(null, { economia_horas_mes: 50 })).toEqual({ real: 0, escalado: 0 });
    expect(derivarSplitHorasSheet(undefined, undefined)).toEqual({ real: 0, escalado: 0 });
  });
});
