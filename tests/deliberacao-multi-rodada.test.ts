// RED (GGSD) — deliberação de até 5 rodadas.
// Encoda o comportamento que o plano descreve: a mesa delibera por até 5 rodadas
// (não 2) antes de declarar `nao_consenso` (→ humano), quando não há consenso.
import { describe, it, expect } from 'vitest';
import {
  MAX_RODADAS_DELIBERACAO,
  avancarDeliberacao,
  type SinaisRodada,
  type ResultadoDeliberacao,
} from '@/lib/deliberacao';

// Sinais SEM consenso: divergência ligada, confiança baixa, veredito não-aprovar.
const SINAIS_SEM_CONSENSO: SinaisRodada = {
  agregadoVeredito: 'em_validacao',
  divergencia: true,
  confianca: 0.5,
  ceticoRefuta: false,
};

describe('deliberação multi-rodada (até 5)', () => {
  it('MAX_RODADAS_DELIBERACAO vale 5', () => {
    expect(MAX_RODADAS_DELIBERACAO).toBe(5);
  });

  it('sem consenso, o cron avança 1 rodada por vez: delibera nas rodadas 1..4 e só encerra em nao_consenso na rodada 5', () => {
    // Simula o cron idempotente: parte de {estado:null, rodada:0} e reencaminha
    // o estado devolvido a cada corrida, com opts DEFAULT (sem maxRodadas).
    let atual: { estado?: ResultadoDeliberacao['estado'] | null; rodada?: number | null } = {
      estado: null,
      rodada: 0,
    };

    const resultados: ResultadoDeliberacao[] = [];
    for (let i = 0; i < 5; i++) {
      const r = avancarDeliberacao(atual, SINAIS_SEM_CONSENSO);
      resultados.push(r);
      atual = { estado: r.estado, rodada: r.rodada };
    }

    // Rodadas 1..4: ainda deliberando, não encerrada.
    for (let i = 0; i < 4; i++) {
      expect(resultados[i].rodada).toBe(i + 1);
      expect(resultados[i].estado).toBe('deliberando');
      expect(resultados[i].encerrada).toBe(false);
    }

    // Rodada 5: encerra sem consenso, à triagem humana.
    const quinta = resultados[4];
    expect(quinta.rodada).toBe(5);
    expect(quinta.estado).toBe('nao_consenso');
    expect(quinta.encerrada).toBe(true);
  });
});
