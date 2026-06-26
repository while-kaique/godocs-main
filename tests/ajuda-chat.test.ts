// Widget de Ajuda — builder da mensagem do Chat + envio com webhook alternativo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAjudaMessage, sendChatNotification } from '@/lib/google/chat';

const okResp = () => ({ ok: true, status: 200, text: async () => '' }) as Response;
const errResp = (status: number) => ({ ok: false, status, text: async () => 'boom' }) as Response;

describe('buildAjudaMessage', () => {
  it('dúvida sem print: cabeçalho de dúvida, dados e SEM linha de print', () => {
    const msg = buildAjudaMessage({
      tipo: 'duvida',
      nome: 'Fulano de Tal',
      email: 'fulano@gocase.com',
      mensagem: 'Como faço para editar um projeto?',
      pagina: '/meus-projetos',
      printLink: null,
      data: '26/06/2026 14:32',
    });
    expect(msg).toContain('Nova DÚVIDA no GoDocs');
    expect(msg).not.toContain('PROBLEMA');
    expect(msg).toContain('Fulano de Tal (fulano@gocase.com)');
    expect(msg).toContain('/meus-projetos');
    expect(msg).toContain('26/06/2026 14:32');
    expect(msg).toContain('Como faço para editar um projeto?');
    expect(msg).not.toContain('Print:');
  });

  it('problema com print: cabeçalho de problema + linha de print com o link', () => {
    const msg = buildAjudaMessage({
      tipo: 'problema',
      nome: 'Ciclana',
      email: 'ciclana@gocase.com',
      mensagem: 'A tela ficou branca ao salvar.',
      pagina: '/submeter',
      printLink: 'https://drive.google.com/file/d/abc/view',
      data: '26/06/2026 15:00',
    });
    expect(msg).toContain('Novo PROBLEMA relatado no GoDocs');
    expect(msg).not.toContain('DÚVIDA');
    expect(msg).toContain('Print:');
    expect(msg).toContain('https://drive.google.com/file/d/abc/view');
  });

  it('página ausente vira travessão', () => {
    const msg = buildAjudaMessage({
      tipo: 'duvida',
      nome: 'n',
      email: 'e@gocase.com',
      mensagem: 'm',
      pagina: null,
      printLink: null,
      data: 'x',
    });
    expect(msg).toContain('*Página:* —');
  });
});

describe('sendChatNotification (webhook alternativo)', () => {
  let orig: string | undefined;
  beforeEach(() => {
    vi.restoreAllMocks();
    orig = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.GOOGLE_CHAT_WEBHOOK_URL;
    else process.env.GOOGLE_CHAT_WEBHOOK_URL = orig;
  });

  it('usa a webhookUrl passada em opts (não o env)', async () => {
    process.env.GOOGLE_CHAT_WEBHOOK_URL = 'https://hook/projetos';
    const fetchMock = vi.fn().mockResolvedValue(okResp());
    vi.stubGlobal('fetch', fetchMock);

    const ok = await sendChatNotification('oi', { webhookUrl: 'https://hook/ajuda' });
    expect(ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://hook/ajuda');
  });

  it('cai no env GOOGLE_CHAT_WEBHOOK_URL quando opts ausente', async () => {
    process.env.GOOGLE_CHAT_WEBHOOK_URL = 'https://hook/projetos';
    const fetchMock = vi.fn().mockResolvedValue(okResp());
    vi.stubGlobal('fetch', fetchMock);

    const ok = await sendChatNotification('oi');
    expect(ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://hook/projetos');
  });

  it('sem URL nenhuma → no-op (não chama fetch, retorna false)', async () => {
    delete process.env.GOOGLE_CHAT_WEBHOOK_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const ok = await sendChatNotification('oi');
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resposta não-ok → retorna false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResp(500)));
    const ok = await sendChatNotification('oi', { webhookUrl: 'https://hook/ajuda' });
    expect(ok).toBe(false);
  });
});
