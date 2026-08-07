// Colunas do líder no UPDATE da ANÁLISE (`syncUpdateToGoogle`).
//
// Quando o analisador reprova por critério (`claro_nao`), ele dispensa a fila e precisa
// refletir isso nas 2 colunas do líder no MESMO update que grava Status/Classificação —
// senão a planilha seguiria dizendo "Pré-pendente" para um projeto que o sistema já
// recusou (e o relatório de espera por líder contaria um projeto morto).
//
// ⚠️ A régua de 06/08/2026 vale AQUI também: `undefined` = "não sei, não encoste" e a
// coluna é OMITIDA do update — uma análise que NÃO dispensou (o caso comum) não pode
// zerar o parecer que o líder já deu. `null` = "não se aplica" → "—".
// O caminho do SUBMIT já está preso em `tests/sync-aprovacao-lider-colunas.test.ts`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn().mockResolvedValue(undefined),
  updateRowByProjectId: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/google/chat', () => ({
  sendChatNotification: vi.fn().mockResolvedValue(undefined),
  buildSubmitMessage: vi.fn().mockReturnValue({}),
  buildUpdateMessage: vi.fn().mockReturnValue({}),
  ehProjetoTesteE2E: vi.fn().mockReturnValue(false),
}));

import { syncUpdateToGoogle } from '@/lib/google/sync';
import { updateRowByProjectId } from '@/lib/google/sheets';

const ESTADO = 'Aprovação do Líder';
const JUSTIFICATIVA = 'Justificativa Aprovação do Líder';

const baseParams = {
  projetoId: 'p-analise',
  projectName: 'Projeto analisado',
  complexidade: 'Média',
  observacoes: 'Parecer do analisador',
  status: 'Reprovado',
};

const cellsDoUpdate = () =>
  (updateRowByProjectId as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;

describe('update da análise — colunas da pré-aprovação do líder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('REPROVOU e dispensou a fila: grava "Dispensado" + a justificativa do sistema', async () => {
    await syncUpdateToGoogle({
      ...baseParams,
      classificacao: 'claro_nao',
      motivoReprovacao: 'Sem recorrência nem ponteiro.',
      aprovacaoLider: 'Dispensado',
      justificativaAprovacaoLider:
        'Fila dispensada: o projeto foi reprovado pela análise automática de critério.',
    } as never);

    expect(cellsDoUpdate()[ESTADO]).toBe('Dispensado');
    expect(String(cellsDoUpdate()[JUSTIFICATIVA])).toContain('reprovado pela análise automática');
  });

  it('análise que NÃO dispensou (undefined): NÃO encosta nas 2 colunas', async () => {
    // O caso comum (claro_sim / zona_cinzenta). Escrever aqui apagaria o parecer do líder.
    await syncUpdateToGoogle({ ...baseParams, status: 'Pendente', classificacao: 'claro_sim' } as never);

    expect(ESTADO in cellsDoUpdate()).toBe(false);
    expect(JUSTIFICATIVA in cellsDoUpdate()).toBe(false);
  });

  it('null ("não se aplica"): a célula recebe "—", nunca fica vazia', async () => {
    await syncUpdateToGoogle({
      ...baseParams,
      aprovacaoLider: null,
      justificativaAprovacaoLider: null,
    } as never);

    expect(cellsDoUpdate()[ESTADO]).toBe('—');
    expect(cellsDoUpdate()[JUSTIFICATIVA]).toBe('—');
  });
});
