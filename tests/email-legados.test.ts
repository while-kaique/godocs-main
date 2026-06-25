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
  setEmailLoteTotal: vi.fn(),
  bumpEmailLote: vi.fn(),
  finalizeEmailLote: vi.fn(),
  getEmailLote: vi.fn(),
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
  setEmailLoteTotal,
  bumpEmailLote,
  finalizeEmailLote,
} from '@/integrations/db/client.server';
import { sendGmail } from '@/lib/google/gmail';
import {
  renderEmailLegado,
  listarLegadosPendentes,
  enviarLoteLegados,
  TEMPLATE_PADRAO,
} from '@/lib/email-legados.functions';

const mRows = getLegadosRows as unknown as ReturnType<typeof vi.fn>;
const mConfig = getConfiguracao as unknown as ReturnType<typeof vi.fn>;
const mDisparos = getUltimosDisparosPorEmail as unknown as ReturnType<typeof vi.fn>;
const mSend = sendGmail as unknown as ReturnType<typeof vi.fn>;
const mBump = bumpEmailLote as unknown as ReturnType<typeof vi.fn>;
const mTotal = setEmailLoteTotal as unknown as ReturnType<typeof vi.fn>;
const mFinalize = finalizeEmailLote as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mRows.mockReset();
  mConfig.mockReset().mockResolvedValue(undefined); // sem template salvo → usa o padrão
  mDisparos.mockReset().mockResolvedValue(new Map());
  mSend.mockReset().mockResolvedValue(undefined);
  mBump.mockReset();
  mTotal.mockReset();
  mFinalize.mockReset();
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
    // {{projetos}} vira lista com nome + id
    expect(html).toContain('Projeto A');
    expect(html).toContain('legado-1');
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

describe('enviarLoteLegados (progresso)', () => {
  it('envia a cada destinatário, incrementa o lote e finaliza', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
      { id: 'legado-2', nome: 'P2', responsavel_nome: 'Bia', responsavel_email: 'bia@x.com', atualizado_em: null },
    ]);
    const r = await enviarLoteLegados('admin@x.com', 'lote-1');
    expect(mSend).toHaveBeenCalledTimes(2);
    expect(mTotal).toHaveBeenCalledWith('lote-1', 2);
    expect(mBump).toHaveBeenCalledTimes(2);
    expect(mBump).toHaveBeenCalledWith('lote-1', 'enviados');
    expect(mFinalize).toHaveBeenCalledWith('lote-1', 'concluido');
    expect(r).toEqual({ enviados: 2, falhas: 0 });
  });

  it('conta falha quando o envio lança e segue para o próximo', async () => {
    mRows.mockResolvedValue([
      { id: 'legado-1', nome: 'P1', responsavel_nome: 'Ana', responsavel_email: 'ana@x.com', atualizado_em: null },
      { id: 'legado-2', nome: 'P2', responsavel_nome: 'Bia', responsavel_email: 'bia@x.com', atualizado_em: null },
    ]);
    mSend.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const r = await enviarLoteLegados('admin@x.com', 'lote-2');
    expect(r).toEqual({ enviados: 1, falhas: 1 });
    expect(mBump).toHaveBeenCalledWith('lote-2', 'falhas');
    expect(mBump).toHaveBeenCalledWith('lote-2', 'enviados');
    expect(mFinalize).toHaveBeenCalledWith('lote-2', 'concluido');
  });
});
