// RED (GGSD) — histórico de rodadas ACUMULA no upsertDeliberacao.
// Encoda o comportamento que o plano descreve: com `apendarHistorico:true`, cada
// rodada do cron ANEXA sua entrada ao histórico já gravado (sem perder as anteriores),
// e cada entrada carrega `confianca`. Sem o flag (rodada 1 / abrir), substitui como hoje.
import { describe, it, expect, beforeAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';
import { upsertDeliberacao, getDeliberacao } from '@/integrations/db/client.server';

const PROJETO = 'proj-delib-append';

describe('upsertDeliberacao — histórico acumula com apendarHistorico', () => {
  let db: BetterSqlite3.Database;

  beforeAll(async () => {
    db = await criarDbMemoria();
  });

  it('rodada 1 abre (substitui) e rodadas 2..3 anexam — 3 entradas, rodada 1 preservada, cada uma com confianca', async () => {
    // Rodada 1 — abre a deliberação (sem append): grava a 1ª entrada.
    await upsertDeliberacao({
      projeto_id: PROJETO,
      estado: 'deliberando',
      rodada: 1,
      veredito: 'em_validacao',
      confianca: 0.5,
      grau: 'baixa',
      encerrada: false,
      motivo: 'rodada 1',
      historico: JSON.stringify([{ rodada: 1, confianca: 0.5, motivo: 'abertura' }]),
      origem: 'teste',
    });

    // Rodada 2 — o cron avança e ANEXA a entrada da rodada 2.
    await upsertDeliberacao({
      projeto_id: PROJETO,
      estado: 'deliberando',
      rodada: 2,
      veredito: 'em_validacao',
      confianca: 0.55,
      grau: 'baixa',
      encerrada: false,
      motivo: 'rodada 2',
      historico: JSON.stringify([{ rodada: 2, confianca: 0.55, motivo: 'nova rodada' }]),
      origem: 'teste',
      apendarHistorico: true,
    });

    // Rodada 3 — anexa a entrada da rodada 3.
    await upsertDeliberacao({
      projeto_id: PROJETO,
      estado: 'deliberando',
      rodada: 3,
      veredito: 'em_validacao',
      confianca: 0.58,
      grau: 'baixa',
      encerrada: false,
      motivo: 'rodada 3',
      historico: JSON.stringify([{ rodada: 3, confianca: 0.58, motivo: 'nova rodada' }]),
      origem: 'teste',
      apendarHistorico: true,
    });

    const row = await getDeliberacao(PROJETO);
    expect(row).not.toBeNull();

    const historico = JSON.parse(row!.historico ?? '[]') as Array<{
      rodada: number;
      confianca: number;
      motivo: string;
    }>;

    // Acumulou as 3 rodadas, em ordem, sem perder a rodada 1.
    expect(historico).toHaveLength(3);
    expect(historico.map((h) => h.rodada)).toEqual([1, 2, 3]);

    // Cada entrada carrega a confiança daquela rodada.
    for (const entrada of historico) {
      expect(entrada).toHaveProperty('confianca');
      expect(typeof entrada.confianca).toBe('number');
    }
  });
});
