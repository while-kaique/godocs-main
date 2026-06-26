// Disparo de e-mails do admin (por segmento): render do template (placeholders/escape +
// motivo no reenvio), montagem da lista de destinatários por público (legado/reenvio/todos)
// e o envio em lote com payload congelado.
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
vi.mock('@/lib/google/sheets', () => ({ readAllRows: vi.fn() }));

import {
  getLegadosRows,
  getConfiguracao,
  getUltimosDisparosPorEmail,
  createEmailLote,
  advanceEmailLote,
  finalizeEmailLote,
  getEmailLote,
  insertEmailDisparo,
} from '@/integrations/db/client.server';
import { sendGmail } from '@/lib/google/gmail';
import { readAllRows } from '@/lib/google/sheets';
import {
  renderEmailDisparo,
  listarDestinatarios,
  iniciarDisparo,
  processarChunkLote,
  normalizarAudiencia,
  TEMPLATES_PADRAO,
} from '@/lib/email-legados.functions';

const mRows = getLegadosRows as unknown as ReturnType<typeof vi.fn>;
const mConfig = getConfiguracao as unknown as ReturnType<typeof vi.fn>;
const mDisparos = getUltimosDisparosPorEmail as unknown as ReturnType<typeof vi.fn>;
const mSend = sendGmail as unknown as ReturnType<typeof vi.fn>;
const mReadAll = readAllRows as unknown as ReturnType<typeof vi.fn>;
const mCreate = createEmailLote as unknown as ReturnType<typeof vi.fn>;
const mAdvance = advanceEmailLote as unknown as ReturnType<typeof vi.fn>;
const mFinalize = finalizeEmailLote as unknown as ReturnType<typeof vi.fn>;
const mGetLote = getEmailLote as unknown as ReturnType<typeof vi.fn>;
const mInsert = insertEmailDisparo as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mRows.mockReset();
  mConfig.mockReset().mockResolvedValue(undefined); // sem template salvo → usa o padrão
  mDisparos.mockReset().mockResolvedValue(new Map());
  mSend.mockReset().mockResolvedValue(undefined);
  mReadAll.mockReset().mockResolvedValue([]);
  mCreate.mockReset().mockResolvedValue('lote-x');
  mAdvance.mockReset();
  mFinalize.mockReset();
  mGetLote.mockReset().mockResolvedValue(undefined);
  mInsert.mockReset();
});

describe('normalizarAudiencia', () => {
  it('aceita reenvio/todos e cai em legado p/ o resto', () => {
    expect(normalizarAudiencia('reenvio')).toBe('reenvio');
    expect(normalizarAudiencia('todos')).toBe('todos');
    expect(normalizarAudiencia('legado')).toBe('legado');
    expect(normalizarAudiencia('xpto')).toBe('legado');
    expect(normalizarAudiencia(null)).toBe('legado');
  });
});

describe('renderEmailDisparo', () => {
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

  it('substitui placeholders no assunto e no corpo (legado)', () => {
    const { assunto, html } = renderEmailDisparo(template, recipient, 'legado');
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
    const { html } = renderEmailDisparo(
      template,
      { nome: '<script>x</script>', projetos: [{ id: 'legado-9', nome: '<b>oi</b>' }] },
      'legado',
    );
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;oi&lt;/b&gt;');
  });

  it('usa o template padrão do segmento quando o corpo vem vazio', () => {
    const { html } = renderEmailDisparo({ assunto: '', corpo: '' }, recipient, 'legado');
    expect(TEMPLATES_PADRAO.legado.corpo).toContain('{{projetos}}');
    expect(html).toContain('Acessar Meus Projetos'); // {{link}} do padrão resolvido
  });

  it('no reenvio inclui o MOTIVO por projeto (escapado)', () => {
    const { html } = renderEmailDisparo(
      { assunto: 'Ajuste, {{nome}}', corpo: '{{projetos}}' },
      { nome: 'Ana', projetos: [{ id: 'p1', nome: 'Proj 1', motivo: 'faltou <b>X</b>' }] },
      'reenvio',
    );
    expect(html).toContain('Motivo:');
    expect(html).toContain('faltou &lt;b&gt;X&lt;/b&gt;'); // motivo escapado
  });

  it('fora do reenvio NÃO renderiza motivo, mesmo se vier no dado', () => {
    const { html } = renderEmailDisparo(
      { assunto: 'x', corpo: '{{projetos}}' },
      { nome: 'Ana', projetos: [{ id: 'p1', nome: 'Proj 1', motivo: 'nao deve aparecer' }] },
      'todos',
    );
    expect(html).not.toContain('Motivo:');
    expect(html).not.toContain('nao deve aparecer');
  });
});

describe("listarDestinatarios('legado')", () => {
  it('exclui legados já atualizados (com data em Atualizado Em)', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'Pendente', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
      { id: 'legado-2', nome: 'Já feito', responsavel_nome: 'Bia', responsavel_email: 'bia@x.com', atualizado_em: '2026-06-20' },
      { id: 'legado-3', nome: 'Traço', responsavel_nome: 'Caio', responsavel_email: 'caio@x.com', atualizado_em: '—' },
    ]);
    const { recipients, totalPessoas, totalProjetos } = await listarDestinatarios('legado');
    const emails = recipients.map((r) => r.email).sort();
    expect(emails).toEqual(['ana@x.com', 'caio@x.com']); // bia (atualizada) fora
    expect(totalPessoas).toBe(2);
    expect(totalProjetos).toBe(2);
    // o selo "já enviado" é escopado pelo segmento
    expect(mDisparos).toHaveBeenCalledWith('legado');
  });

  it('deduplica por pessoa (case-insensitive) agregando os projetos', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
      { id: 'legado-2', nome: 'P2', responsavel_nome: 'Ana', responsavel_email: 'ANA@x.com', atualizado_em: '' },
    ]);
    const { recipients, totalPessoas, totalProjetos } = await listarDestinatarios('legado');
    expect(totalPessoas).toBe(1);
    expect(totalProjetos).toBe(2);
    expect(recipients[0].projetos.map((p) => p.id).sort()).toEqual(['legado-1', 'legado-2']);
  });

  it('ignora pendentes sem e-mail do dono', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Sem', responsavel_email: '', atualizado_em: null },
    ]);
    const { totalPessoas, totalProjetos } = await listarDestinatarios('legado');
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
    const { recipients } = await listarDestinatarios('legado');
    expect(recipients[0].ultimoEnvio).toEqual({ data: '2026-06-24T10:00:00Z', status: 'sucesso' });
  });
});

describe("listarDestinatarios('reenvio')", () => {
  it('pega só linhas com Status reenvio/rejeitado, agrupa e traz o motivo', async () => {
    mReadAll.mockResolvedValue([
      { Status: 'Reenvio Pendente', Email: 'ana@x.com', 'Nome Completo': 'Ana', 'ID Projeto': 'p1', Projeto: 'Proj 1', Observações: 'faltou a composição' },
      { Status: 'Pendente', Email: 'ze@x.com', 'Nome Completo': 'Zé', 'ID Projeto': 'p9', Projeto: 'Proj 9' }, // fora
      { Status: 'rejeitado', Email: 'ANA@x.com', 'Nome Completo': 'Ana', 'ID Projeto': 'p2', Projeto: 'Proj 2', Observações: 'corrigir Y' }, // mesma pessoa
    ]);
    const { recipients, totalPessoas, totalProjetos } = await listarDestinatarios('reenvio');
    expect(totalPessoas).toBe(1);
    expect(totalProjetos).toBe(2);
    expect(recipients[0].email).toBe('ana@x.com');
    expect(recipients[0].projetos.map((p) => p.motivo)).toEqual(['faltou a composição', 'corrigir Y']);
    expect(mReadAll).toHaveBeenCalled();
    expect(mRows).not.toHaveBeenCalled(); // não toca no SQLite de legados
  });
});

describe("listarDestinatarios('todos')", () => {
  it('agrupa todos os donos com e-mail (ignora linha sem e-mail)', async () => {
    mReadAll.mockResolvedValue([
      { Email: 'a@x.com', 'Nome Completo': 'A', 'ID Projeto': 'p1', Projeto: 'P1', Status: 'Pendente' },
      { Email: 'b@x.com', 'ID Projeto': 'p2', Projeto: 'P2' },
      { Email: '', 'ID Projeto': 'p3', Projeto: 'P3' }, // sem e-mail → fora
    ]);
    const { totalPessoas, totalProjetos } = await listarDestinatarios('todos');
    expect(totalPessoas).toBe(2);
    expect(totalProjetos).toBe(2);
  });
});

describe('iniciarDisparo', () => {
  const ROWS_2 = [
    { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
    { id: 'legado-2', nome: 'P2', responsavel_nome: 'Bia', responsavel_email: 'bia@x.com', atualizado_em: null },
  ];

  it('congela alvos + payload (destinatários + template) e o segmento', async () => {
    mRows.mockResolvedValue(ROWS_2);
    const r = await iniciarDisparo('admin@x.com', 'legado', ['bia@x.com']);
    expect(r).toEqual({ loteId: 'lote-x', total: 1 });
    // createEmailLote(total, admin, alvos, audiencia, payload)
    const [total, admin, alvos, audiencia, payload] = mCreate.mock.calls[0];
    expect(total).toBe(1);
    expect(admin).toBe('admin@x.com');
    expect(alvos).toEqual(['bia@x.com']);
    expect(audiencia).toBe('legado');
    expect(payload.recipients.map((x: { email: string }) => x.email)).toEqual(['bia@x.com']);
    expect(payload.template.corpo).toBeTruthy();
  });

  it('sem seleção, alvos = todos os destinatários do segmento', async () => {
    mRows.mockResolvedValue(ROWS_2);
    await iniciarDisparo('admin@x.com', 'legado');
    const [total, , alvos] = mCreate.mock.calls[0];
    expect(total).toBe(2);
    expect(alvos).toEqual(['ana@x.com', 'bia@x.com']);
  });
});

describe('processarChunkLote (payload congelado)', () => {
  const payload = {
    recipients: [
      { email: 'ana@x.com', nome: 'Ana', projetos: [{ id: 'p1', nome: 'Proj 1', motivo: 'faltou X' }], ultimoEnvio: null },
      { email: 'bia@x.com', nome: 'Bia', projetos: [{ id: 'p2', nome: 'Proj 2', motivo: 'corrigir Y' }], ultimoEnvio: null },
    ],
    template: { assunto: 'Ajuste {{nome}}', corpo: '{{projetos}}' },
  };
  const lote = (over: Record<string, unknown> = {}) => ({
    id: 'lote-1',
    total: 2,
    processados: 0,
    enviados: 0,
    falhas: 0,
    alvos: JSON.stringify(['ana@x.com', 'bia@x.com']),
    audiencia: 'reenvio',
    payload: JSON.stringify(payload),
    status: 'enviando',
    ...over,
  });

  it('envia do payload, registra com a audiência e finaliza no total', async () => {
    mGetLote
      .mockResolvedValueOnce(lote())
      .mockResolvedValueOnce(lote({ processados: 2, enviados: 2 }));
    const p = await processarChunkLote('admin@x.com', 'lote-1');
    expect(mSend).toHaveBeenCalledTimes(2);
    expect(mSend).toHaveBeenCalledWith('ana@x.com', expect.any(String), expect.any(String));
    // o motivo do reenvio chega no HTML
    const htmlAna = mSend.mock.calls[0][2] as string;
    expect(htmlAna).toContain('Motivo:');
    expect(htmlAna).toContain('faltou X');
    // o disparo é logado com o segmento
    expect(mInsert).toHaveBeenCalledWith(expect.objectContaining({ audiencia: 'reenvio', status: 'sucesso' }));
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1, enviados: 1 });
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'concluido');
    expect(p?.status).toBe('concluido');
    // NÃO relê o Sheets/SQLite (lê do payload congelado)
    expect(mReadAll).not.toHaveBeenCalled();
    expect(mRows).not.toHaveBeenCalled();
  });

  it('conta falha e ainda avança o cursor', async () => {
    mSend.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    mGetLote
      .mockResolvedValueOnce(lote())
      .mockResolvedValueOnce(lote({ processados: 2, enviados: 1, falhas: 1 }));
    await processarChunkLote('admin@x.com', 'lote-1');
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1, falhas: 1 });
    expect(mAdvance).toHaveBeenCalledWith('lote-1', { processados: 1, enviados: 1 });
    expect(mInsert).toHaveBeenCalledWith(expect.objectContaining({ audiencia: 'reenvio', status: 'falha' }));
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'concluido');
  });

  it('se já foi pedido cancelamento, finaliza como cancelado sem enviar', async () => {
    mGetLote.mockResolvedValueOnce(lote({ status: 'cancelando' }));
    const p = await processarChunkLote('admin@x.com', 'lote-1');
    expect(mSend).not.toHaveBeenCalled();
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'cancelado');
    expect(p?.status).toBe('cancelado');
  });
});
