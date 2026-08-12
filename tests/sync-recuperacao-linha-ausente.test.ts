// Recuperação da IDA quando a linha do projeto NÃO existe mais na planilha:
// na edição, o UPDATE in-place não tem onde aterrissar e a submissão desaparece
// silenciosamente. Comportamento pedido: o sync cai para `appendRow` (com a
// "Data Submissão" preenchida) — sem NUNCA duplicar quando a linha existe.
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

const mockUpdate = updateRowByProjectId as ReturnType<typeof vi.fn>;
const mockAppend = appendRow as ReturnType<typeof vi.fn>;

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
  area: 'LOJAS', memorialLimpo: 'memo novo', receitaMemorialLimpo: '—', ganhoTotalMensal: 100,
  // Estes testes olham a PLANILHA, não o Chat (que tem arquivo próprio,
  // sync-notificar-chat.test.ts) — daí o gate desligado.
  notificarChat: false,
};

describe('B2 — edição com a linha AUSENTE cai para append (recuperação)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppend.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(false); // a linha não existe mais na planilha
  });

  it('apenda a linha quando o update reporta que não achou o "ID Projeto"', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao', memorialAnterior: 'memo antigo' });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockAppend).toHaveBeenCalledTimes(1);
  });

  it('a linha recuperada inclui "Data Submissão" preenchida', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao', memorialAnterior: null });

    const row = mockAppend.mock.calls[0][0] as Record<string, unknown>;
    expect('Data Submissão' in row).toBe(true);
    expect(String(row['Data Submissão'] ?? '').trim().length).toBeGreaterThan(0);
    expect(row['ID Projeto']).toBe('p1');
  });
});

describe('B3 — nenhuma regressão', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppend.mockResolvedValue(undefined);
  });

  it('edição com a linha PRESENTE não apenda (nunca duplica)', async () => {
    mockUpdate.mockResolvedValue(true);

    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao', memorialAnterior: null });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockAppend).not.toHaveBeenCalled();
  });

  it('submissão nova segue só com appendRow (sem update)', async () => {
    mockUpdate.mockResolvedValue(true);

    await syncSubmitToGoogle({ ...baseParams, modo: 'novo', memorialAnterior: null });

    expect(mockAppend).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
