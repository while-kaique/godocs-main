/**
 * T6 (UI: rodadas na ficha) — o mapper `montarAvaliacaoSombra` deixa de DESCARTAR o histórico da
 * deliberação e o expõe tipado. `parseHistoricoDeliberacao` é fail-soft (JSON ruim → []).
 */
import { describe, it, expect } from 'vitest';
import {
  parseHistoricoDeliberacao,
  montarAvaliacaoSombra,
} from '@/lib/dashboard-admin.functions';

describe('parseHistoricoDeliberacao', () => {
  it('parseia as rodadas gravadas (rodada/estado/confianca/motivo)', () => {
    const raw = JSON.stringify([
      { rodada: 1, estado: 'deliberando', confianca: 0.5, motivo: 'sem consenso' },
      { rodada: 2, estado: 'consenso', confianca: 0.82, motivo: 'a mesa concordou' },
    ]);
    expect(parseHistoricoDeliberacao(raw)).toEqual([
      { rodada: 1, estado: 'deliberando', confianca: 0.5, motivo: 'sem consenso' },
      { rodada: 2, estado: 'consenso', confianca: 0.82, motivo: 'a mesa concordou' },
    ]);
  });

  it('fail-soft: null/JSON inválido/não-array → []', () => {
    expect(parseHistoricoDeliberacao(null)).toEqual([]);
    expect(parseHistoricoDeliberacao(undefined)).toEqual([]);
    expect(parseHistoricoDeliberacao('{ not json')).toEqual([]);
    expect(parseHistoricoDeliberacao('{"rodada":1}')).toEqual([]); // objeto, não array
  });

  it('descarta entradas não-objeto e normaliza campos ausentes', () => {
    const raw = JSON.stringify([42, null, { rodada: 3 }]);
    expect(parseHistoricoDeliberacao(raw)).toEqual([
      { rodada: 3, estado: null, confianca: null, motivo: null },
    ]);
  });
});

describe('montarAvaliacaoSombra — expõe o histórico da deliberação', () => {
  const delib = {
    estado: 'consenso',
    rodada: 2,
    grau: 'alta',
    motivo: 'motivo corrente',
    historico: JSON.stringify([
      { rodada: 1, estado: 'deliberando', confianca: 0.4, motivo: 'r1' },
      { rodada: 2, estado: 'consenso', confianca: 0.85, motivo: 'r2' },
    ]),
  };

  it('a ficha individual (com historico) traz as rodadas', () => {
    const sombra = montarAvaliacaoSombra(null, delib, null);
    expect(sombra?.deliberacao?.historico).toHaveLength(2);
    expect(sombra?.deliberacao?.historico[1]).toMatchObject({ rodada: 2, motivo: 'r2' });
  });

  it('o lote (sem historico) devolve [] — não seleciona historico em lote (32 MiB RPC)', () => {
    const { historico: _omit, ...semHistorico } = delib;
    void _omit;
    const sombra = montarAvaliacaoSombra(null, semHistorico, null);
    expect(sombra?.deliberacao?.historico).toEqual([]);
  });
});
