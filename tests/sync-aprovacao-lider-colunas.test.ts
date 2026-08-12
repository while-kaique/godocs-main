// Colunas "Aprovação do Líder" (AE) e "Justificativa Aprovação do Líder" (AF) no Sheets.
//
// Duas invariantes que já se quebraram em produção:
//  1. A célula NUNCA nasce em branco. Toda submissão nova (e todo append de RECUPERAÇÃO)
//     grava o ESTADO da fila — "Pré-pendente" quando ela abre — e, sem informação de
//     texto, o "—" do padrão da planilha. Célula vazia foi o sintoma reportado em
//     06/08/2026, quando um deploy do `main` (sem a feature) reassumiu a produção.
//  2. Quem NÃO conhece o estado da fila não encosta na coluna. O `resyncGoogle` roda sem
//     passar por `abrirPreAprovacao`: mandando `undefined`, o `ouTraco` gravava "—" e
//     APAGAVA o parecer que o líder já tinha dado. `undefined` agora OMITE a coluna do
//     update; `null` segue significando "não se aplica" → "—".
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

const ESTADO = 'Aprovação do Líder';
const JUSTIFICATIVA = 'Justificativa Aprovação do Líder';

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

describe('Sheets — colunas da pré-aprovação do líder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  });

  it('SUBMISSÃO NOVA com fila aberta: grava "Pré-pendente" + a justificativa', async () => {
    await syncSubmitToGoogle({
      ...baseParams,
      modo: 'novo',
      aprovacaoLider: 'Pré-pendente',
      justificativaAprovacaoLider: 'Aguardando Fulano',
    });
    expect(rowDoAppend()[ESTADO]).toBe('Pré-pendente');
    expect(rowDoAppend()[JUSTIFICATIVA]).toBe('Aguardando Fulano');
  });

  it('SUBMISSÃO NOVA sem estado nenhum: a célula NASCE com "—", nunca vazia', async () => {
    // Sem a feature no ar (ou com a fila isenta), o append ainda tem de padronizar.
    await syncSubmitToGoogle({ ...baseParams, modo: 'novo' });
    expect(rowDoAppend()[ESTADO]).toBe('—');
    expect(rowDoAppend()[JUSTIFICATIVA]).toBe('—');
  });

  it('SUBMISSÃO NOVA com null (isento): "—" nas duas — nunca célula em branco', async () => {
    await syncSubmitToGoogle({
      ...baseParams, modo: 'novo', aprovacaoLider: null, justificativaAprovacaoLider: null,
    });
    expect(rowDoAppend()[ESTADO]).toBe('—');
    expect(rowDoAppend()[JUSTIFICATIVA]).toBe('—');
  });

  it('EDIÇÃO (reenvio) reabre a fila: regrava "Pré-pendente"', async () => {
    await syncSubmitToGoogle({
      ...baseParams,
      modo: 'edicao',
      aprovacaoLider: 'Pré-pendente',
      justificativaAprovacaoLider: 'Aguardando Fulano',
    });
    expect(rowDoUpdate()[ESTADO]).toBe('Pré-pendente');
    expect(rowDoUpdate()[JUSTIFICATIVA]).toBe('Aguardando Fulano');
  });

  it('RE-SYNC (não sabe o estado → undefined): NÃO toca as colunas', async () => {
    // Regressão: com `ouTraco(undefined)` isto gravava "—" por cima do parecer do líder.
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao' });
    expect(ESTADO in rowDoUpdate()).toBe(false);
    expect(JUSTIFICATIVA in rowDoUpdate()).toBe(false);
  });

  it('RECUPERAÇÃO (linha ausente → append): a linha nasce com as 2 células preenchidas', async () => {
    (updateRowByProjectId as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await syncSubmitToGoogle({ ...baseParams, modo: 'edicao' });
    expect(appendRow).toHaveBeenCalledTimes(1);
    expect(rowDoAppend()[ESTADO]).toBe('—');
    expect(rowDoAppend()[JUSTIFICATIVA]).toBe('—');
  });
});
