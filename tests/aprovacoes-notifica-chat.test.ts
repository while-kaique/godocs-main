// A decisão do líder é o GATILHO do aviso no grupo do Chat.
//
// Pré-aprovou → o grupo recebe a mensagem do projeto (é o único momento em que ela sai,
// para projetos que entram em fila). Pediu ajuste ou reprovou → silêncio: o projeto ainda
// não está liberado e avisar seria ruído para a triagem.
//
// ⚠️ O aviso é acessório: ele nunca pode derrubar a decisão do líder (mesma régua do D3).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

vi.mock('@/lib/areas/teamguide.server', () => ({
  ehLideranca: vi.fn(),
  getLideresDe: vi.fn(),
  getLideradosDe: vi.fn(),
}));
vi.mock('@/lib/google/sheets', () => ({
  updateRowByProjectId: vi.fn(async () => true),
  readAllRows: vi.fn(async () => []),
}));
// O envio em si tem teste próprio (tests/notificacao-projeto-pre-aprovacao.test.ts);
// aqui interessa só QUEM dispara e QUANDO.
vi.mock('@/lib/notificacao-projeto.functions', () => ({
  notificarChatPreAprovacao: vi.fn(async () => true),
}));

import { ehLideranca, getLideresDe, getLideradosDe } from '@/lib/areas/teamguide.server';
import { setDb, insertProjetoRaw } from '@/integrations/db/client.server';
import { abrirPreAprovacao, decidirAprovacao } from '@/lib/aprovacoes.functions';
import { notificarChatPreAprovacao } from '@/lib/notificacao-projeto.functions';

const mockLideranca = ehLideranca as unknown as ReturnType<typeof vi.fn>;
const mockLideres = getLideresDe as unknown as ReturnType<typeof vi.fn>;
const mockLiderados = getLideradosDe as unknown as ReturnType<typeof vi.fn>;
const mockNotifica = notificarChatPreAprovacao as unknown as ReturnType<typeof vi.fn>;

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

const RESP_OK = { move_kpi: 'sim', sente_falta: 'sim', saving_coerente: 'sim' } as const;
const LUCAS = { nome: 'Lucas Gonçalves Queiroz', email: 'lucas.queiroz@gocase.com' };

let seq = 0;
async function criarProjetoEmFila(): Promise<string> {
  const id = `nc-${++seq}`;
  await insertProjetoRaw({
    id,
    nome: `Projeto ${id}`,
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'luis.albuquerque@gocase.com',
    ferramenta: 'n8n',
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
    tipos_projeto: JSON.stringify(['saving']),
    area: 'RPA',
  });
  await abrirPreAprovacao(id);
  return id;
}

describe('decidirAprovacao — gatilho do aviso no grupo do Chat', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLideranca.mockResolvedValue(false);
    mockLideres.mockResolvedValue([LUCAS]);
    mockLiderados.mockResolvedValue([]);
    mockNotifica.mockResolvedValue(true);
  });

  it('PRÉ-APROVADO dispara o aviso, com o projeto e a assinatura de quem decidiu', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'aprovado',
      respostas: RESP_OK,
    });

    expect(mockNotifica).toHaveBeenCalledTimes(1);
    const [projetoId, parecer] = mockNotifica.mock.calls[0] as [string, { por: string; em: string }];
    expect(projetoId).toBe(id);
    expect(String(parecer.por)).toMatch(/lucas/i);
    expect(String(parecer.em ?? '').trim().length).toBeGreaterThan(0);
  });

  it('AJUSTE não avisa ninguém', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'ajuste',
      comentario: 'Reveja a frequência das horas.',
      respostas: RESP_OK,
    });

    expect(mockNotifica).not.toHaveBeenCalled();
  });

  it('REPROVADO não avisa ninguém', async () => {
    const id = await criarProjetoEmFila();

    await decidirAprovacao(LUCAS.email, {
      projeto_id: id,
      veredito: 'reprovado',
      comentario: 'Não é projeto: rotina pontual.',
      respostas: RESP_OK,
    });

    expect(mockNotifica).not.toHaveBeenCalled();
  });

  it('falha do aviso NÃO derruba a decisão do líder', async () => {
    const id = await criarProjetoEmFila();
    mockNotifica.mockRejectedValueOnce(new Error('Chat fora do ar'));

    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: RESP_OK,
      }),
    ).resolves.toMatchObject({ ok: true, veredito: 'aprovado' });
  });

  it('aviso que LANÇA de forma síncrona também não derruba a decisão', async () => {
    const id = await criarProjetoEmFila();
    mockNotifica.mockImplementationOnce(() => {
      throw new Error('explodiu antes da promise');
    });

    await expect(
      decidirAprovacao(LUCAS.email, {
        projeto_id: id,
        veredito: 'aprovado',
        respostas: RESP_OK,
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
