// Gate de notificação no sync: quem decide se o grupo do Chat é avisado é o CHAMADOR.
//
// A submissão deixou de avisar o grupo por conta própria: `syncSubmitToGoogle` só dispara
// o Chat quando recebe `notificarChat: true`. Com `false`, a planilha é gravada
// normalmente e ninguém é notificado (é o caso da submissão que entra em fila de
// pré-aprovação e o do `resyncGoogle`, que é reparo administrativo).
//
// E o `syncUpdateToGoogle` (a "Análise Pendente" que saía depois do analisador) não avisa
// mais NADA, em nenhuma circunstância.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn().mockResolvedValue(undefined),
  updateRowByProjectId: vi.fn().mockResolvedValue(true),
}));
// `ehProjetoTesteE2E` fica REAL (o mute de `[E2E-` é regra de negócio a exercitar);
// só o envio e o builder são stub.
vi.mock('@/lib/google/chat', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/chat')>();
  return {
    ...actual,
    sendChatNotification: vi.fn().mockResolvedValue(true),
    buildSubmitMessage: vi.fn().mockReturnValue('MENSAGEM'),
  };
});

import { syncSubmitToGoogle, syncUpdateToGoogle } from '@/lib/google/sync';
import { appendRow, updateRowByProjectId } from '@/lib/google/sheets';
import { sendChatNotification, buildSubmitMessage } from '@/lib/google/chat';

const mockChat = sendChatNotification as unknown as ReturnType<typeof vi.fn>;
const mockBuild = buildSubmitMessage as unknown as ReturnType<typeof vi.fn>;

const projetoRow = (nome = 'Projeto P') =>
  ({
    nome,
    responsavel_nome: 'X',
    responsavel_email: 'x@y.com',
    ferramenta: 'n8n',
    escopo: 'interno',
    descricao_breve: 'd',
    alguem_fazia: 'sim',
    custo_externo_mensal: 0,
    contexto_especial: null,
    especial: 0,
    custo_evitado: 'nao',
    custo_evitado_justificativa: null,
    custo_evitado_itens: null,
    arquivos_links: null,
    data_criacao_projeto: '2026-01-01',
    memorial_calculo: 'NOVO',
    complexidade: null,
    observacoes: null,
  }) as never;

const baseParams = {
  projetoId: 'p1',
  modo: 'novo' as const,
  projeto: projetoRow(),
  conteudo: {},
  saving: { economia_horas_mes: 10, economia_reais_mes: 100, linhas: [] },
  receita: null,
  membros: [],
  tiposProjeto: ['saving'],
  status: 'Pendente' as const,
  area: 'LOJAS',
  memorialLimpo: 'memo',
  receitaMemorialLimpo: '—',
  ganhoTotalMensal: 100,
};

describe('syncSubmitToGoogle — gate `notificarChat`', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    mockChat.mockResolvedValue(true);
    mockBuild.mockReturnValue('MENSAGEM');
  });

  it('notificarChat: false → grava na planilha e NÃO avisa o grupo', async () => {
    await syncSubmitToGoogle({ ...baseParams, notificarChat: false });
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('notificarChat: true → avisa o grupo uma vez', async () => {
    await syncSubmitToGoogle({ ...baseParams, notificarChat: true });
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it('EDIÇÃO com notificarChat: false também não avisa (reenvio não faz barulho)', async () => {
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao', notificarChat: false });
    expect(updateRowByProjectId).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('a nota da pré-aprovação é repassada ao builder da mensagem', async () => {
    const nota = 'Sem pré-aprovação: o autor é liderança.';
    await syncSubmitToGoogle({ ...baseParams, notificarChat: true, notaPreAprovacao: nota });
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild.mock.calls[0][0]).toMatchObject({ notaPreAprovacao: nota });
  });

  it('projeto `[E2E-` segue MUDO mesmo com notificarChat: true', async () => {
    await syncSubmitToGoogle({
      ...baseParams,
      projeto: projetoRow('[E2E-abc123] Projeto de teste'),
      notificarChat: true,
    });
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();
  });
});

describe('syncUpdateToGoogle — o analisador não fala mais no grupo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    mockChat.mockResolvedValue(true);
  });

  it('grava a análise na planilha e NÃO envia nada ao Chat', async () => {
    await syncUpdateToGoogle({
      projetoId: 'p1',
      projectName: 'Projeto P',
      complexidade: 'media',
      observacoes: 'ok',
      status: 'Pendente',
    });
    expect(updateRowByProjectId).toHaveBeenCalledTimes(1);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('nem quando a análise reprova (era a mensagem de "Análise Pendente")', async () => {
    await syncUpdateToGoogle({
      projetoId: 'p1',
      projectName: 'Projeto P',
      complexidade: 'alta',
      observacoes: 'reprovado por critério',
      status: 'Reprovado',
      classificacao: 'claro_nao',
      motivoReprovacao: 'não é projeto',
    });
    expect(mockChat).not.toHaveBeenCalled();
  });
});
