// Teste de integração da camada de DB com um adapter ASSÍNCRONO.
//
// Regressão crítica: o env.DB do Godeploy é assíncrono (query/exec retornam
// Promise). O client.server precisa dar `await` em tudo — senão um INSERT seguido
// de SELECT retorna undefined e estoura "Cannot read properties of undefined".
// Este teste envolve o better-sqlite3 num wrapper async (igual ao Godeploy real)
// para provar que insertProjeto → getProjetoById funciona ponta a ponta.
import { describe, it, expect, beforeAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';
import {
  setDb,
  insertProjeto,
  getProjetoById,
  insertChatMessage,
  getChatMessages,
  insertArea,
  getAreas,
} from '@/integrations/db/client.server';

// Wrapper ASSÍNCRONO sobre better-sqlite3 — simula o env.DB do Godeploy
// (query/exec retornam Promise; params sempre presentes).
function asyncAdapter(db: BetterSqlite3.Database): GoDeployDB {
  return {
    async query(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...params) as Record<string, unknown>[];
      const columns = rows.length ? Object.keys(rows[0]) : stmt.columns().map((c) => c.name);
      return {
        columns,
        rows: rows.map((r) => columns.map((c) => r[c])),
        rowsRead: rows.length,
      };
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

describe('camada de DB com adapter assíncrono (env.DB do Godeploy)', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db)); // dispara initSchema (async)
  });

  it('insertProjeto retorna a linha recém-criada (INSERT + SELECT async)', async () => {
    const projeto = await insertProjeto({
      responsavel_nome: 'Fulano',
      responsavel_email: 'fulano@gocase.com',
      ferramenta: 'n8n',
      nome: 'Projeto Teste',
      status: 'rascunho',
    });
    expect(projeto).toBeDefined();
    expect(projeto.id).toBeTruthy(); // ← exatamente o que estourava antes
    expect(projeto.nome).toBe('Projeto Teste');

    const lido = await getProjetoById(projeto.id);
    expect(lido?.id).toBe(projeto.id);
  });

  it('persiste e lê chat_messages (FK para projetos)', async () => {
    const projeto = await insertProjeto({
      responsavel_nome: 'Ciclana',
      responsavel_email: 'ciclana@gocase.com',
      ferramenta: 'python',
    });
    await insertChatMessage({ projeto_id: projeto.id, role: 'user', content: 'olá' });
    const msgs = await getChatMessages(projeto.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('olá');
  });

  it('insertArea + getAreas', async () => {
    const area = await insertArea('Marketing');
    expect(area.id).toBeTruthy();
    const areas = await getAreas();
    expect(areas.some((a) => a.nome === 'Marketing')).toBe(true);
  });
});
