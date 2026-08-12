// "Motivo Reenvio" no Sheets: o CONTEÚDO é da triagem humana (/dashboard), mas a célula
// não pode NASCER em branco — o padrão da planilha é "texto vazio → —". Então o APPEND
// (submissão nova e append de RECUPERAÇÃO) inicializa com "—" e o UPDATE da edição NUNCA
// toca a coluna (sobrescrever apagaria o motivo escrito pelo admin).
// Isola syncSubmitToGoogle mockando sheets + chat.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn().mockResolvedValue(undefined),
  updateRowByProjectId: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/google/chat', () => ({
  sendChatNotification: vi.fn().mockResolvedValue(undefined),
  buildSubmitMessage: vi.fn().mockReturnValue({}),
  ehProjetoTesteE2E: vi.fn().mockReturnValue(false),
}));

import { syncSubmitToGoogle } from '@/lib/google/sync';
import { appendRow, updateRowByProjectId } from '@/lib/google/sheets';

const baseProjeto = {
  nome: 'P', responsavel_nome: 'X', responsavel_email: 'x@y.com', ferramenta: 'n8n',
  escopo: 'interno', descricao_breve: 'd', alguem_fazia: 'sim', custo_externo_mensal: 0,
  contexto_especial: null, especial: 0, custo_evitado: 'nao', custo_evitado_justificativa: null,
  custo_evitado_itens: null, arquivos_links: null, data_criacao_projeto: '2026-01-01',
  memorial_calculo: 'NOVO', complexidade: null, observacoes: null,
} as never;

const baseParams = {
  projetoId: 'p1', projeto: baseProjeto, conteudo: {},
  saving: { economia_horas_mes: 10, economia_reais_mes: 100, linhas: [] },
  receita: null, membros: [], tiposProjeto: ['saving'], status: 'Pendente' as const,
  area: 'LOJAS', memorialLimpo: 'memo', receitaMemorialLimpo: '—', ganhoTotalMensal: 100,
  // Estes testes olham a PLANILHA, não o Chat (que tem arquivo próprio,
  // sync-notificar-chat.test.ts) — daí o gate desligado.
  notificarChat: false,
};

const rowDoAppend = (i = 0) => (appendRow as ReturnType<typeof vi.fn>).mock.calls[i][0];
const rowDoUpdate = () => (updateRowByProjectId as ReturnType<typeof vi.fn>).mock.calls[0][1];

describe('"Motivo Reenvio" — padrão texto vazio → "—"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('SUBMISSÃO NOVA: inicializa "Motivo Reenvio" com "—" (não deixa a célula em branco)', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'novo' });
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(rowDoAppend()['Motivo Reenvio']).toBe('—');
  });

  it('EDIÇÃO: NÃO toca "Motivo Reenvio" (preserva o motivo escrito pela triagem)', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao' });
    expect(updateRowByProjectId).toHaveBeenCalledTimes(1);
    expect('Motivo Reenvio' in rowDoUpdate()).toBe(false);
  });

  it('RECUPERAÇÃO (linha ausente → append): a linha nasce com "Motivo Reenvio" = "—"', async () => {
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao' });
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(rowDoAppend()['Motivo Reenvio']).toBe('—');
    // A linha nasce agora → "Data Submissão" também entra (comportamento já existente).
    expect('Data Submissão' in rowDoAppend()).toBe(true);
  });

  it('as colunas de DIFF continuam 100% intocadas (append e update)', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'novo' });
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao' });
    for (const row of [rowDoAppend(), rowDoUpdate()]) {
      expect('Diff Horas/Antes' in row).toBe(false);
      expect('Diff Saving/Antes' in row).toBe(false);
    }
  });
});
