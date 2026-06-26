// Widget de Ajuda — schema zod, helpers de DB e o fluxo de criarChamadoAjuda.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// Mocka Drive (upload) e o ENVIO ao Chat ANTES de importar ajuda.functions.
// buildAjudaMessage continua real (importActual); só sendChatNotification é stub,
// para não disparar rede/ping real no espaço do Chat durante os testes.
vi.mock('@/lib/google/auth', () => ({ getDriveAccessToken: vi.fn().mockResolvedValue('tok') }));
vi.mock('@/lib/google/drive', () => ({ uploadFileToDrive: vi.fn() }));
vi.mock('@/lib/google/chat', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/chat')>();
  return { ...actual, sendChatNotification: vi.fn().mockResolvedValue(true) };
});

import {
  setDb,
  insertAjudaChamado,
  getAjudaChamados,
  marcarChatStatusAjuda,
} from '@/integrations/db/client.server';
import { ajudaSchema, criarChamadoAjuda } from '@/lib/ajuda.functions';
import { uploadFileToDrive } from '@/lib/google/drive';
import { sendChatNotification } from '@/lib/google/chat';

function asyncAdapter(db: BetterSqlite3.Database): GoDeployDB {
  return {
    async query(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => columns.map((c) => r[c])), rowsRead: rows.length };
    },
    async exec(sql: string, params: unknown[] = []) {
      if (params.length > 0) {
        const r = db.prepare(sql).run(...params);
        return { rowsWritten: r.changes };
      }
      db.exec(sql);
      return { rowsWritten: 0 };
    },
  };
}

// UM banco compartilhado para o arquivo: setDb() só roda initSchema na 1ª chamada
// (_schemaReady é singleton de módulo), então criar um DB por describe deixaria o
// segundo sem tabelas.
beforeAll(async () => {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  await setDb(asyncAdapter(db));
});

describe('ajudaSchema', () => {
  it('rejeita mensagem vazia/só espaços', () => {
    expect(ajudaSchema.safeParse({ tipo: 'duvida', mensagem: '   ' }).success).toBe(false);
  });
  it('rejeita tipo inválido', () => {
    expect(ajudaSchema.safeParse({ tipo: 'bug', mensagem: 'oi' }).success).toBe(false);
  });
  it('aceita sem print', () => {
    expect(ajudaSchema.safeParse({ tipo: 'duvida', mensagem: 'oi' }).success).toBe(true);
  });
  it('aceita print opcional', () => {
    const r = ajudaSchema.safeParse({
      tipo: 'problema',
      mensagem: 'erro',
      print: { base64: 'AAAA', filename: 'shot.png' },
    });
    expect(r.success).toBe(true);
  });
});

describe('ajuda_chamados (DB async)', () => {
  it('insertAjudaChamado insere e lê de volta (chat_status pendente por padrão)', async () => {
    const c = await insertAjudaChamado({
      usuario_email: 'a@gocase.com',
      usuario_nome: 'A',
      tipo: 'duvida',
      mensagem: 'oi',
    });
    expect(c.id).toBeTruthy();
    expect(c.chat_status).toBe('pendente');
    const lista = await getAjudaChamados(50);
    expect(lista.some((x) => x.id === c.id)).toBe(true);
  });

  it('marcarChatStatusAjuda atualiza o resultado do envio', async () => {
    const c = await insertAjudaChamado({ usuario_email: 'b@gocase.com', tipo: 'problema', mensagem: 'erro' });
    await marcarChatStatusAjuda(c.id, 'enviado');
    const row = (await getAjudaChamados(50)).find((x) => x.id === c.id);
    expect(row?.chat_status).toBe('enviado');
  });
});

describe('criarChamadoAjuda', () => {
  const ORIG_AJUDA = process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA; // padrão: não configurado
  });
  afterAll(() => {
    if (ORIG_AJUDA === undefined) delete process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
    else process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA = ORIG_AJUDA;
  });

  it('persiste o chamado com o link do print e retorna { id, ok }', async () => {
    (uploadFileToDrive as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'd1', link: 'https://drive/d1' });
    const r = await criarChamadoAjuda('user@gocase.com', {
      tipo: 'problema',
      mensagem: 'deu ruim ao salvar',
      pagina_url: '/submeter',
      print: { base64: 'AAAA', filename: 'shot.png' },
    });
    expect(r.ok).toBe(true);
    expect(r.id).toBeTruthy();
    const row = (await getAjudaChamados(50)).find((x) => x.id === r.id)!;
    expect(row.tipo).toBe('problema');
    expect(row.usuario_email).toBe('user@gocase.com');
    expect(row.pagina_url).toBe('/submeter');
    expect(row.print_link).toBe('https://drive/d1');
    expect(row.print_filename).toBe('shot.png');
  });

  it('falha no upload do print NÃO derruba o chamado (print_link fica null)', async () => {
    (uploadFileToDrive as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('403 sem acesso'));
    const r = await criarChamadoAjuda('u2@gocase.com', {
      tipo: 'duvida',
      mensagem: 'segue sem print',
      print: { base64: 'AAAA', filename: 'shot.png' },
    });
    expect(r.ok).toBe(true);
    const row = (await getAjudaChamados(50)).find((x) => x.id === r.id)!;
    expect(row.print_link).toBeNull();
    expect(row.mensagem).toBe('segue sem print');
  });

  it('body inválido → erro 400', async () => {
    await expect(criarChamadoAjuda('u@gocase.com', { tipo: 'duvida', mensagem: '' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('com webhook de ajuda configurado, notifica ESSE espaço (e não o de projetos)', async () => {
    process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA = 'https://hook/ajuda';
    await criarChamadoAjuda('u@gocase.com', { tipo: 'duvida', mensagem: 'oi' });
    // sendChatNotification é chamado SÍNCRONO ao montar a promise do runBackground.
    expect(sendChatNotification).toHaveBeenCalledTimes(1);
    expect((sendChatNotification as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      webhookUrl: 'https://hook/ajuda',
    });
  });

  it('SEM webhook de ajuda, NÃO notifica (não cai no grupo de projetos)', async () => {
    // beforeEach já removeu o env.
    await criarChamadoAjuda('u@gocase.com', { tipo: 'duvida', mensagem: 'oi' });
    expect(sendChatNotification).not.toHaveBeenCalled();
  });
});
