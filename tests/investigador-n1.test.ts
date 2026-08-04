// Guarda contra a regressão que derrubou o painel Investigador em prod (04/08/2026):
// `getProjetosInvestigador` fazia UM `getChatMessages(id)` por projeto — centenas de
// round-trips sequenciais trazendo o texto completo das mensagens. O endpoint
// `/api/admin/investigador/projetos` nunca completava (`canceled` no Godeploy,
// 500/503 no browser) e o front, com `Promise.allSettled`, exibia lista vazia em
// silêncio: "0 submetidos" e "0 abandonados" convivendo com 289 edições.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProjetosParaInvestigador: vi.fn(),
  getProjetoWithAreaById: vi.fn(),
  getChatMetricsPorProjeto: vi.fn(),
  getChatMessages: vi.fn(),
  getDocumentacao: vi.fn(),
  getApiLogsByProjeto: vi.fn(),
  getApiLogsRecent: vi.fn(),
  getLatestAnalise: vi.fn(),
  getReenvioCounts: vi.fn(),
  getAllReenvios: vi.fn(),
  getVersionsByProjeto: vi.fn(),
  getFormEventsByProjeto: vi.fn(),
}));

vi.mock('@/integrations/db/client.server', () => ({
  ...mocks,
  parseJson: (v: string | null) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  },
}));

import { getProjetosInvestigador, faseAtualDeMetricas } from '@/lib/investigador.functions';

const projeto = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  nome: `Projeto ${id}`,
  responsavel_nome: 'Fulano',
  responsavel_email: 'fulano@x.com',
  area: 'Fiscal',
  area_nome: 'Fiscal',
  ferramenta: 'n8n',
  escopo: 'interno',
  status: 'aprovado',
  tipos_projeto: '["saving"]',
  descricao_breve: null,
  complexidade: 'automacao',
  chat_completo: 1,
  created_at: '2026-08-01 10:00:00',
  updated_at: '2026-08-01 11:00:00',
  submitted_at: '2026-08-01 11:00:00',
  ...over,
});

describe('getProjetosInvestigador — sem N+1 de chat', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.getApiLogsRecent.mockResolvedValue([]);
    mocks.getReenvioCounts.mockResolvedValue(new Map());
    mocks.getChatMetricsPorProjeto.mockResolvedValue([]);
    mocks.getProjetosParaInvestigador.mockResolvedValue([]);
  });

  it('NÃO consulta chat_messages por projeto — uma agregada serve a todos', async () => {
    mocks.getProjetosParaInvestigador.mockResolvedValue([projeto('a'), projeto('b'), projeto('c')]);
    mocks.getChatMetricsPorProjeto.mockResolvedValue([
      { projeto_id: 'a', total: 10, total_user: 4, total_ia: 6, ultima_atividade: '2026-08-01 12:00:00', fase: 'saving' },
    ]);

    await getProjetosInvestigador();

    // O ponto do fix: zero chamadas por projeto, uma só chamada agregada.
    expect(mocks.getChatMessages).not.toHaveBeenCalled();
    expect(mocks.getChatMetricsPorProjeto).toHaveBeenCalledTimes(1);
  });

  it('mapeia as métricas agregadas para cada projeto', async () => {
    mocks.getProjetosParaInvestigador.mockResolvedValue([projeto('a'), projeto('b')]);
    mocks.getChatMetricsPorProjeto.mockResolvedValue([
      { projeto_id: 'a', total: 10, total_user: 4, total_ia: 6, ultima_atividade: '2026-08-01 12:00:00', fase: 'saving_preview' },
    ]);

    const [a, b] = await getProjetosInvestigador();

    expect(a.total_mensagens).toBe(10);
    expect(a.total_mensagens_usuario).toBe(4);
    expect(a.total_mensagens_ia).toBe(6);
    expect(a.ultima_atividade).toBe('2026-08-01 12:00:00');
    expect(a.fase_atual).toBe('saving_preview');

    // Projeto sem nenhuma mensagem: zeros e fallback de atividade no updated_at.
    expect(b.total_mensagens).toBe(0);
    expect(b.fase_atual).toBe('aguardando_inicio');
    expect(b.ultima_atividade).toBe('2026-08-01 11:00:00');
  });

  it('preserva submitted_at — é ele que separa Submetidos de Abandonados na tela', async () => {
    mocks.getProjetosParaInvestigador.mockResolvedValue([
      projeto('sub', { submitted_at: '2026-08-01 11:00:00' }),
      projeto('rasc', { submitted_at: null, status: 'rascunho' }),
    ]);

    const rows = await getProjetosInvestigador();

    expect(rows.filter((p) => p.submitted_at).length).toBe(1);
    expect(rows.filter((p) => !p.submitted_at).length).toBe(1);
  });
});

describe('faseAtualDeMetricas — espelha o inferFaseAtual que varria as mensagens', () => {
  const m = (over: Record<string, unknown> = {}) => ({
    projeto_id: 'x',
    total: 5,
    total_user: 2,
    total_ia: 3,
    ultima_atividade: '2026-08-01 12:00:00',
    fase: null as string | null,
    ...over,
  });

  it('usa a fase da última mensagem do assistente que declara uma', () => {
    expect(faseAtualDeMetricas(m({ fase: 'receita_preview' }))).toBe('receita_preview');
  });

  it('conversa iniciada sem nenhuma fase declarada → doc', () => {
    expect(faseAtualDeMetricas(m({ fase: null }))).toBe('doc');
  });

  it('sem mensagem alguma → aguardando_inicio', () => {
    expect(faseAtualDeMetricas(m({ total: 0 }))).toBe('aguardando_inicio');
    expect(faseAtualDeMetricas(undefined)).toBe('aguardando_inicio');
  });
});
