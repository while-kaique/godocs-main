// Padronização da planilha: coluna numérica vazia → 0; texto vazio → "—".
import { describe, it, expect } from 'vitest';
import { padronizarLinha } from '@/lib/google/sync';

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

  // F4 — split carga real × escala: colunas de TEXTO (fora de COLUNAS_NUMERICAS) para
  // que o número passe quando há split e "—" quando não há (em vez de virar 0).
  it('"Saving Horas Real"/"Saving Horas Escalado": número quando há split, "—" quando não', () => {
    const comSplit = padronizarLinha({ 'Saving Horas Real': 24, 'Saving Horas Escalado': 108 });
    expect(comSplit['Saving Horas Real']).toBe(24);
    expect(comSplit['Saving Horas Escalado']).toBe(108);
    const semSplit = padronizarLinha({ 'Saving Horas Real': '—', 'Saving Horas Escalado': '—' });
    expect(semSplit['Saving Horas Real']).toBe('—');
    expect(semSplit['Saving Horas Escalado']).toBe('—');
  });
});
