/**
 * T12/T13 — o gabarito do retroativo DESCONGELA (RF-241) e a política de liberação passa a
 * receber acurácia MEDIDA (RF-242).
 *
 * ⚠️ O achado que estes dois testes protegem: `getIdsRetroativos` devolvia "todos os medidos" e o
 * retroativo os pulava para sempre, então os 137 projetos que viraram `Aprovado → Reprovado` em
 * 04/09/2026 seguiam medidos contra a verdade antiga; e `politicaDeLiberacao` recebia `null`
 * LITERAL, então o time estava em sombra por argumento hardcoded, não por medição.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  medicoes: [] as { projeto_id: string; veredito_humano: string | null }[],
  calibragem: [] as { grau: string | null; resultado: string | null; n: number }[],
  upserts: [] as Record<string, unknown>[],
}));

vi.mock('@/integrations/db/client.server', () => ({
  getMedicoesRetroativas: vi.fn(async () => db.medicoes),
  getCalibragemRetroativa: vi.fn(async () => db.calibragem),
  upsertAvaliacaoRetroativa: vi.fn(async (d: Record<string, unknown>) => {
    db.upserts.push(d);
  }),
}));

const espelho = vi.hoisted(() => ({ linhas: [] as Record<string, string>[] }));
vi.mock('@/lib/sheet-espelho', () => ({
  lerResumosEspelho: vi.fn(async () => ({ linhas: espelho.linhas, lidoEmMs: Date.now() })),
}));

const mesa = vi.hoisted(() => ({
  ligada: true,
  veredito: 'aprovar' as string,
  vistos: [] as string[],
}));
vi.mock('@/lib/avaliacao-normais.functions', () => ({
  avaliacaoNormaisLigada: vi.fn(() => mesa.ligada),
  carregarContextoPainel: vi.fn(async () => ({ ctx: {} })),
  computarVotosDoProjeto: vi.fn(async (id: string) => {
    mesa.vistos.push(id);
    return { conciliado: { veredito: mesa.veredito, confianca: 0.9, grau: 'alta', motivos: [] } };
  }),
}));

vi.mock('@/lib/dashboard-resumo', async (orig) => await orig<object>());

import { avaliarRetroativo } from '@/lib/avaliacao-retroativa.functions';
import { carregarAcuraciaMedida, carregarCalibragem } from '@/lib/avaliacao-calibragem.functions';
import { politicaDeLiberacao, METAS_LIBERACAO } from '@/lib/avaliacao/consenso';

/** Uma linha de espelho mínima que o `mapResumo` aceita. */
function linha(id: string, nome: string, status: string): Record<string, string> {
  return { 'ID Projeto': id, Projeto: nome, Status: status, 'Especial?': 'Não' };
}

beforeEach(() => {
  db.medicoes = [];
  db.calibragem = [];
  db.upserts = [];
  espelho.linhas = [];
  mesa.ligada = true;
  mesa.veredito = 'aprovar';
  mesa.vistos = [];
});

describe('T12 — gabarito vivo: quem mudou de Status volta à fila de medição', () => {
  it('projeto medido contra "aprovado" que virou "Reprovado" É remedido', () => {
    espelho.linhas = [linha('p1', 'Mudou de veredito', 'Reprovado')];
    db.medicoes = [{ projeto_id: 'p1', veredito_humano: 'aprovado' }];
    return avaliarRetroativo({ dry: true }).then((r) => {
      expect(r.candidatos).toBe(1);
      expect(mesa.vistos).toEqual(['p1']);
      // e o erro que estava escondido aparece: a mesa aprovaria o que o humano reprovou.
      expect(r.acuracia.erro_grave).toBe(1);
    });
  });

  it('projeto com o MESMO Status de antes NÃO volta', async () => {
    espelho.linhas = [linha('p1', 'Não mudou', 'Aprovado')];
    db.medicoes = [{ projeto_id: 'p1', veredito_humano: 'aprovado' }];
    const r = await avaliarRetroativo({ dry: true });
    expect(r.candidatos).toBe(0);
    expect(mesa.vistos).toEqual([]);
  });

  it('a comparação do Status é tolerante a caixa (o id legado vem em MAIÚSCULA)', async () => {
    espelho.linhas = [linha('LEGADO-057', 'Meta Base - Estoque', 'Reprovado')];
    db.medicoes = [{ projeto_id: 'legado-057', veredito_humano: 'Reprovado' }];
    const r = await avaliarRetroativo({ dry: true });
    expect(r.candidatos).toBe(0);
  });

  it('projeto nunca medido entra normalmente', async () => {
    espelho.linhas = [linha('novo', 'Nunca medido', 'Aprovado')];
    const r = await avaliarRetroativo({ dry: true });
    expect(r.candidatos).toBe(1);
  });

  it('T16: a mesa aprovando um canário marca a corrida como SUSPEITA', async () => {
    espelho.linhas = [linha('LEGADO-057', 'Meta Base - Estoque', 'Reprovado')];
    const r = await avaliarRetroativo({ dry: true });
    expect(r.canarios.avaliados).toBe(1);
    expect(r.canarios.suspeito).toBe(true);
    expect(r.canarios.alerta).toMatch(/SUSPEITO/);
  });

  it('e a mesa mandando o canário ao humano não marca nada', async () => {
    espelho.linhas = [linha('LEGADO-057', 'Meta Base - Estoque', 'Reprovado')];
    mesa.veredito = 'em_validacao';
    const r = await avaliarRetroativo({ dry: true });
    expect(r.canarios.suspeito).toBe(false);
  });
});

describe('T13 — a política de liberação recebe acurácia MEDIDA', () => {
  it('sem medição nenhuma devolve null, e a política diz "sem medição"', async () => {
    expect(await carregarAcuraciaMedida()).toBeNull();
    const l = politicaDeLiberacao(await carregarAcuraciaMedida(), {
      liberarAprovar: true,
      liberarAjuste: true,
    });
    expect(l.aprovar).toBe(false);
    expect(l.motivos.join(' ')).toMatch(/sem medi/i);
  });

  it('com medição, a acurácia é a taxa real e a política nomeia a meta que faltou', async () => {
    db.medicoes = [{ projeto_id: 'p1', veredito_humano: 'aprovado' }];
    db.calibragem = [
      { grau: 'alta', resultado: 'acerto', n: 30 },
      { grau: 'alta', resultado: 'conservador', n: 10 },
      { grau: 'media', resultado: 'erro_grave', n: 2 },
    ];
    const a = await carregarAcuraciaMedida();
    expect(a?.aprovar?.n).toBe(42);
    expect(a?.aprovar?.acerto).toBeCloseTo(30 / 42, 5);
    expect(a?.aprovar?.erro_grave).toBe(2);

    const l = politicaDeLiberacao(a, { liberarAprovar: true, liberarAjuste: true });
    // amostra de 42 < 300 → a política diz qual meta faltou, em vez de "sem medição".
    expect(l.aprovar).toBe(false);
    expect(l.motivos.join(' ')).toContain(String(METAS_LIBERACAO.aprovar.n_min));
    expect(l.motivos.join(' ')).not.toMatch(/sem medi/i);
  });

  it('`ajuste` fica AUSENTE — a mesa não tem esse desfecho, e inventar seria mentir medição', async () => {
    db.medicoes = [{ projeto_id: 'p1', veredito_humano: 'aprovado' }];
    db.calibragem = [{ grau: 'alta', resultado: 'acerto', n: 400 }];
    const a = await carregarAcuraciaMedida();
    expect(a?.ajuste).toBeUndefined();
    const l = politicaDeLiberacao(a, { liberarAjuste: true });
    expect(l.ajuste).toBe(false);
    expect(l.motivos.join(' ')).toMatch(/n[ãa]o medido ainda/i);
  });

  it('só medições sem gabarito humano (tudo sem_base) → segue sem medição', async () => {
    db.medicoes = [{ projeto_id: 'p1', veredito_humano: null }];
    db.calibragem = [{ grau: 'alta', resultado: 'sem_base', n: 5 }];
    expect(await carregarAcuraciaMedida()).toBeNull();
  });

  it('carregarCalibragem devolve as faixas prontas para a tela', async () => {
    db.calibragem = [
      { grau: 'alta', resultado: 'acerto', n: 24 },
      { grau: 'alta', resultado: 'conservador', n: 6 },
    ];
    const c = await carregarCalibragem();
    expect(c.alta.suficiente).toBe(true);
    expect(c.alta.taxa_acerto).toBeCloseTo(0.8, 5);
    expect(c.baixa.taxa_acerto).toBeNull();
  });
});
