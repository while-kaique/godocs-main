// Aviso ao grupo do Chat disparado PELA pré-aprovação do líder.
//
// A mensagem não existe mais na submissão (o projeto ainda está esperando parecer); ela
// nasce quando o líder pré-aprova. Como o turno da submissão já acabou, o payload é
// REMONTADO do banco (projeto + documentação, para saving/receita).
//
// Invariantes: nunca lança (um aviso não pode derrubar a decisão do líder), projeto de
// teste `[E2E-…]` segue mudo e projeto inexistente não vira mensagem nem exceção.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

// `ehProjetoTesteE2E` e `buildSubmitMessage` ficam REAIS (é o texto que queremos ver);
// só o envio é stub, para não pingar o espaço do Chat.
vi.mock('@/lib/google/chat', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/google/chat')>();
  return { ...actual, sendChatNotification: vi.fn().mockResolvedValue(true) };
});
// A planilha não é chamada aqui; o mock existe só para nenhuma rede escapar.
vi.mock('@/lib/google/sheets', () => ({
  appendRow: vi.fn(async () => undefined),
  updateRowByProjectId: vi.fn(async () => true),
  readAllRows: vi.fn(async () => []),
}));

import { setDb, insertProjetoRaw, upsertDocumentacao } from '@/integrations/db/client.server';
import { sendChatNotification } from '@/lib/google/chat';
import { notificarChatPreAprovacao } from '@/lib/notificacao-projeto.functions';

const mockChat = sendChatNotification as unknown as ReturnType<typeof vi.fn>;

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

const PARECER = { por: 'Lucas Gonçalves Queiroz', em: '11/08/2026 14:32' };

let seq = 0;
async function criarProjeto(nome = 'Automação de Faturamento'): Promise<string> {
  const id = `np-${++seq}`;
  await insertProjetoRaw({
    id,
    nome,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'luis.albuquerque@gocase.com',
    ferramenta: 'n8n',
    escopo: 'interno',
    descricao_breve: 'Automatiza o faturamento mensal.',
    area: 'RPA',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    saving_horas: 120,
    saving_reais: 5000,
    tipo_saving: 'mensal',
  });
  await upsertDocumentacao(id, {
    saving: { economia_horas_mes: 120, economia_reais_mes: 5000, tipo_saving: 'mensal' },
    receita: null,
  });
  return id;
}

describe('notificarChatPreAprovacao', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockChat.mockResolvedValue(true);
  });

  it('envia UMA mensagem com os dados do projeto e devolve true', async () => {
    const id = await criarProjeto();

    const enviou = await notificarChatPreAprovacao(id, PARECER);

    expect(enviou).toBe(true);
    expect(mockChat).toHaveBeenCalledTimes(1);
    const texto = String(mockChat.mock.calls[0][0]);
    expect(texto).toContain('Automação de Faturamento');
    expect(texto).toContain('Luis Albuquerque');
    // Remontado do banco: o saving da documentação entra na mensagem.
    expect(texto).toMatch(/120/);
  });

  it('a mensagem assina quem pré-aprovou e quando', async () => {
    const id = await criarProjeto();

    await notificarChatPreAprovacao(id, PARECER);

    const texto = String(mockChat.mock.calls[0][0]);
    expect(texto).toMatch(/pré-aprova/i);
    expect(texto).toContain(PARECER.por);
    expect(texto).toContain(PARECER.em);
  });

  it('projeto `[E2E-…]` NÃO envia nada e devolve false', async () => {
    const id = await criarProjeto('[E2E-abc123] Automação de teste');

    const enviou = await notificarChatPreAprovacao(id, PARECER);

    expect(enviou).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('projeto inexistente: devolve false, sem enviar e sem lançar', async () => {
    const enviou = await notificarChatPreAprovacao('nao-existe-999', PARECER);

    expect(enviou).toBe(false);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('falha no envio não vira exceção: devolve false', async () => {
    const id = await criarProjeto();
    mockChat.mockRejectedValueOnce(new Error('webhook fora do ar'));

    await expect(notificarChatPreAprovacao(id, PARECER)).resolves.toBe(false);
  });
});
