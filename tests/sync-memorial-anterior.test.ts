// "Memorial anterior" no Sheets: escrito SÓ na edição (memorial pré-edição);
// em submissão nova não entra. Isola syncSubmitToGoogle mockando sheets + chat.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn().mockResolvedValue(undefined),
  updateRowByProjectId: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/google/chat', () => ({
  sendChatNotification: vi.fn().mockResolvedValue(undefined),
  buildSubmitMessage: vi.fn().mockReturnValue({}),
  buildUpdateMessage: vi.fn().mockReturnValue({}),
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
  projetoId: 'p1', projeto: baseProjeto, conteudo: {}, saving: { economia_horas_mes: 10, economia_reais_mes: 100, linhas: [] },
  receita: null, membros: [], tiposProjeto: ['saving'], status: 'Pendente' as const,
  area: 'LOJAS', memorialLimpo: 'memo novo', receitaMemorialLimpo: '—', ganhoTotalMensal: 100,
};

describe('Memorial anterior no sync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('EDIÇÃO: grava o memorial pré-edição na coluna "Memorial anterior"', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao', memorialAnterior: 'memo da versão anterior' });
    expect(updateRowByProjectId).toHaveBeenCalledTimes(1);
    const row = (updateRowByProjectId as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(row['Memorial anterior']).toBe('memo da versão anterior');
  });

  it('SUBMISSÃO NOVA: não inclui "Memorial anterior"', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'novo', memorialAnterior: null });
    expect(appendRow).toHaveBeenCalledTimes(1);
    const row = (appendRow as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('Memorial anterior' in row).toBe(false);
  });

  it('EDIÇÃO sem anterior: não escreve "Memorial anterior" (não sobrescreve célula manual)', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao', memorialAnterior: null });
    const row = (updateRowByProjectId as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect('Memorial anterior' in row).toBe(false);
  });
});
