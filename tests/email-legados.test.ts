// Cobrança de legados por e-mail — render do template (placeholders/escape) e a
// montagem da lista de destinatários (filtro de pendentes + dedup por pessoa).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/db/client.server', () => ({
  getLegadosRows: vi.fn(),
  getConfiguracao: vi.fn(),
  upsertConfiguracao: vi.fn(),
  insertEmailDisparo: vi.fn(),
  getUltimosDisparosPorEmail: vi.fn(),
  createEmailLote: vi.fn(),
  advanceEmailLote: vi.fn(),
  finalizeEmailLote: vi.fn(),
  getEmailLote: vi.fn(),
  requestCancelEmailLote: vi.fn(),
  // parseJson é puro — mantemos a implementação real no mock.
  parseJson: (raw: string | null | undefined) => {
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
}));

vi.mock('@/lib/google/gmail', () => ({ sendGmail: vi.fn() }));

import {
  getLegadosRows,
  getConfiguracao,
  getUltimosDisparosPorEmail,
  createEmailLote,
  advanceEmailLote,
  finalizeEmailLote,
  getEmailLote,
} from '@/integrations/db/client.server';
import { sendGmail } from '@/lib/google/gmail';
import {
  renderEmailLegado,
  listarLegadosPendentes,
  iniciarDisparoLegados,
  processarChunkLote,
  TEMPLATE_PADRAO,
} from '@/lib/email-legados.functions';

const mRows = getLegadosRows as unknown as ReturnType<typeof vi.fn>;
const mConfig = getConfiguracao as unknown as ReturnType<typeof vi.fn>;
const mDisparos = getUltimosDisparosPorEmail as unknown as ReturnType<typeof vi.fn>;
const mSend = sendGmail as unknown as ReturnType<typeof vi.fn>;
const mCreate = createEmailLote as unknown as ReturnType<typeof vi.fn>;
const mAdvance = advanceEmailLote as unknown as ReturnType<typeof vi.fn>;
const mFinalize = finalizeEmailLote as unknown as ReturnType<typeof vi.fn>;
const mGetLote = getEmailLote as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mRows.mockReset();
  mConfig.mockReset().mockResolvedValue(undefined); // sem template salvo → usa o padrão
  mDisparos.mockReset().mockResolvedValue(new Map());
  mSend.mockReset().mockResolvedValue(undefined);
  mCreate.mockReset().mockResolvedValue('lote-x');
  mAdvance.mockReset();
  mFinalize.mockReset();
  mGetLote.mockReset().mockResolvedValue(undefined);
});

describe('renderEmailLegado', () => {
  const template = {
    assunto: 'Regularize até {{prazo}}, {{nome}}',
    corpo: 'Olá {{nome}}!\n{{projetos}}\nPrazo: {{prazo}}\n{{link}}',
  };
  const recipient = {
    nome: 'Maria',
    projetos: [
      { id: 'legado-1', nome: 'Projeto A' },
      { id: 'legado-2', nome: 'Projeto B' },
    ],
  };

  it('substitui placeholders no assunto e no corpo', () => {
    const { assunto, html } = renderEmailLegado(template, recipient);
    expect(assunto).toBe('Regularize até 30/06/2026, Maria');
    expect(html).toContain('Olá Maria!');
    expect(html).toContain('Prazo: 30/06/2026');
    // {{projetos}} vira lista só com o NOME (o id "legado-1" não vai no e-mail)
    expect(html).toContain('Projeto A');
    expect(html).not.toContain('legado-1');
    expect(html).toContain('<ul');
    // {{link}} vira âncora para Meus Projetos
    expect(html).toContain('Acessar Meus Projetos');
    expect(html).toContain('/meus-projetos');
    // nenhum placeholder remanescente
    expect(html).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('escapa HTML no nome e no nome do projeto (anti-injeção)', () => {
    const { html } = renderEmailLegado(template, {
      nome: '<script>x</script>',
      projetos: [{ id: 'legado-9', nome: '<b>oi</b>' }],
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;oi&lt;/b&gt;');
  });

  it('usa o template padrão quando o corpo vem vazio', () => {
    const { html } = renderEmailLegado({ assunto: '', corpo: '' }, recipient);
    expect(TEMPLATE_PADRAO.corpo).toContain('{{projetos}}');
    expect(html).toContain('Acessar Meus Projetos'); // {{link}} do padrão resolvido
  });
});

describe('listarLegadosPendentes', () => {
  it('exclui legados já atualizados (com data em Atualizado Em)', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'Pendente', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
      { id: 'legado-2', nome: 'Já feito', responsavel_nome: 'Bia', responsavel_email: 'bia@x.com', atualizado_em: '2026-06-20' },
      { id: 'legado-3', nome: 'Traço', responsavel_nome: 'Caio', responsavel_email: 'caio@x.com', atualizado_em: '—' },
    ]);
    const { recipients, totalPessoas, totalProjetos } = await listarLegadosPendentes();
    const emails = recipients.map((r) => r.email).sort();
    expect(emails).toEqual(['ana@x.com', 'caio@x.com']); // bia (atualizada) fora
    expect(totalPessoas).toBe(2);
    expect(totalProjetos).toBe(2);
  });

  it('deduplica por pessoa (case-insensitive) agregando os projetos', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
      { id: 'legado-2', nome: 'P2', responsavel_nome: 'Ana', responsavel_email: 'ANA@x.com', atualizado_em: '' },
    ]);
    const { recipients, totalPessoas, totalProjetos } = await listarLegadosPendentes();
    expect(totalPessoas).toBe(1);
    expect(totalProjetos).toBe(2);
    expect(recipients[0].projetos.map((p) => p.id).sort()).toEqual(['legado-1', 'legado-2']);
  });

  it('ignora pendentes sem e-mail do dono', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Sem', responsavel_email: '', atualizado_em: null },
    ]);
    const { totalPessoas, totalProjetos } = await listarLegadosPendentes();
    expect(totalPessoas).toBe(0);
    expect(totalProjetos).toBe(0);
  });

  it('anexa o último disparo (selo "já enviado")', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
    ]);
    mDisparos.mockResolvedValue(
      new Map([['ana@x.com', { created_at: '2026-06-24T10:00:00Z', status: 'sucesso' }]]),
    );
    const { recipients } = await listarLegadosPendentes();
    expect(recipients[0].ultimoEnvio).toEqual({ data: '2026-06-24T10:00:00Z', status: 'sucesso' });
  });
});

const ROWS_2 = [
  { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
  { id: 'legado-2', nome: 'P2', responsavel_nome: 'Bia', responsavel_email: 'bia@x.com', atualizado_em: null },
];

describe('iniciarDisparoLegados', () => {
  it('congela os alvos filtrados pela seleção e cria o lote', async () => {
    mRows.mockResolvedValue(ROWS_2);
    const r = await iniciarDisparoLegados('admin@x.com', ['bia@x.com']);
    expect(mCreate).toHaveBeenCalledWith(1, 'admin@x.com', ['bia@x.com']);
    expect(r).toEqual({ loteId: 'lote-x', total: 1 });
  });

  it('sem seleção, alvos = todos os pendentes', async () => {
    mRows.mockResolvedValue(ROWS_2);
    await iniciarDisparoLegados('admin@x.com');
    expect(mCreate).toHaveBeenCalledWith(2, 'admin@x.com', ['ana@x.com', 'bia@x.com']);
  });
});

describe('processarChunkLote', () => {
  const lote = (over: Record<string, unknown> = {}) => ({
    id: 'lote-1',
    total: 2,
    processados: 0,
    enviados: 0,
    falhas: 0,
    alvos: JSON.stringify(['ana@x.com', 'bia@x.com']),
    status: 'enviando',
    ...over,
  });

  it('envia o chunk, avança o cursor e finaliza ao chegar no total', async () => {
    mRows.mockResolvedValue(ROWS_2);
    // 1ª leitura: início; 2ª leitura (re-read pós-chunk): cursor já no total.
    mGetLote
      .mockResolvedValueOnce(lote())
      .mockResolvedValueOnce(lote({ processados: 2, enviados: 2 }));
    const p = await processarChunkLote('admin@x.com', 'lote-1');
    expect(mSend).toHaveBeenCalledTimes(2);
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1, enviados: 1 });
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'concluido');
    expect(p?.status).toBe('concluido');
  });

  it('conta falha e ainda avança o cursor', async () => {
    mRows.mockResolvedValue(ROWS_2);
    mSend.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    mGetLote
      .mockResolvedValueOnce(lote())
      .mockResolvedValueOnce(lote({ processados: 2, enviados: 1, falhas: 1 }));
    await processarChunkLote('admin@x.com', 'lote-1');
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1, falhas: 1 });
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1, enviados: 1 });
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'concluido');
  });

  it('se já foi pedido cancelamento, finaliza como cancelado sem enviar', async () => {
    mRows.mockResolvedValue(ROWS_2);
    mGetLote.mockResolvedValueOnce(lote({ status: 'cancelando' }));
    const p = await processarChunkLote('admin@x.com', 'lote-1');
    expect(mSend).not.toHaveBeenCalled();
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'cancelado');
    expect(p?.status).toBe('cancelado');
  });

  it('pula alvo que não está mais pendente (editou nesse meio tempo)', async () => {
    // alvos tem ana e bia, mas só bia segue pendente.
    mRows.mockResolvedValue([ROWS_2[1]]);
    mGetLote
      .mockResolvedValueOnce(lote())
      .mockResolvedValueOnce(lote({ processados: 2, enviados: 1 }));
    await processarChunkLote('admin@x.com', 'lote-1');
    expect(mSend).toHaveBeenCalledTimes(1);
    expect(mSend).toHaveBeenCalledWith('bia@x.com', expect.any(String), expect.any(String));
    // ana (não pendente) só avança o cursor, sem enviados/falhas.
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1 });
  });
});
