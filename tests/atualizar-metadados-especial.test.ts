// Regressão do caso Ravenna: editar um projeto ESPECIAL (inclusive um legado que NÃO
// tem linha em `documentacao`) e reenviar quebrava com "Documentação ainda não foi
// gerada" — atualizarMetadados rodava o orquestrador (doc normal) e nunca persistia a
// documentacao especial. O fix monta a doc especial sem IA e a persiste, igual ao
// iniciarSubmissao. Aqui provamos que, após atualizarMetadados com especial, existe
// uma linha em `documentacao` (pré-condição que submeterParaValidacao exige).
import { describe, it, expect, beforeAll } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';
import {
  setDb,
  insertProjeto,
  getProjetoById,
  getDocumentacao,
} from '@/integrations/db/client.server';
import { atualizarMetadados } from '@/lib/chat.functions';

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

describe('atualizarMetadados: edição de projeto especial monta a doc sem IA', () => {
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  it('legado sem documentacao + especial → cria a linha em documentacao (submit não quebra)', async () => {
    // Simula um legado: projeto já existente, SEM documentacao, marcado como não-especial.
    const projeto = await insertProjeto({
      responsavel_nome: 'Ravenna',
      responsavel_email: 'ravenna@gocase.com',
      ferramenta: 'n8n',
      nome: 'Projeto Legado da Ravenna',
      membros: [],
      status: 'rascunho',
    });
    expect(await getDocumentacao(projeto.id)).toBeFalsy(); // pré-condição: legado sem doc

    await atualizarMetadados({
      projeto_id: projeto.id,
      nome_projeto: 'Projeto Legado da Ravenna',
      ferramenta: 'n8n',
      membros: [],
      descricao_breve: 'O que o projeto faz.',
      contexto_especial: 'Por que é de alto impacto e difícil mensuração.',
      especial: true,
      reset_doc: true,
    });

    // A doc especial precisa existir — é a pré-condição que submeterParaValidacao exige.
    const docRow = await getDocumentacao(projeto.id);
    expect(docRow).toBeTruthy();
    const conteudo = JSON.parse((docRow as { conteudo: string }).conteudo);
    expect(conteudo.titulo).toBe('Projeto Legado da Ravenna');
    expect(conteudo.o_que_faz).toContain('alto impacto');

    // E o projeto passa a estar marcado como especial (banco coerente com o fluxo novo).
    const atualizado = await getProjetoById(projeto.id);
    expect(atualizado?.especial).toBe(1);
    expect(atualizado?.tipo_projeto).toBe('especial');
  });
});
