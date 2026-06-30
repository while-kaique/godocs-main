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
import { atualizarMetadados, atualizarTipos } from '@/lib/chat.functions';

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

  // Regressão (caso hugo.santana / oscar.filho): editar um projeto ESPECIAL, trocar o
  // tipo para saving/receita e reenviar deve DESMARCAR especial — antes a flag era
  // sticky de mão única (atualizarTipos não a tocava e atualizarMetadados re-forçava
  // especial pelo estado do banco), e a edição subia "Especial?"=Sim de novo.
  it('atualizarTipos com tipo financeiro zera a flag especial (especial → saving)', async () => {
    const projeto = await insertProjeto({
      responsavel_nome: 'Hugo',
      responsavel_email: 'hugo.santana@gobeaute.com.br',
      ferramenta: 'n8n',
      nome: 'Projeto que era especial (Hugo)',
      membros: [],
      status: 'rascunho',
      especial: true,
      contexto_especial: 'contexto antigo de especial',
    });
    expect((await getProjetoById(projeto.id))?.especial).toBe(1); // pré-condição

    await atualizarTipos({ projeto_id: projeto.id, tipos_projeto: ['saving'] });

    const depois = await getProjetoById(projeto.id);
    expect(depois?.especial).toBe(0);
    expect(depois?.tipo_projeto).toBe('saving');
    expect(JSON.parse(depois?.tipos_projeto as string)).toEqual(['saving']);
  });

  it('atualizarMetadados com especial:false converte especial → normal (não reconstrói doc especial)', async () => {
    const projeto = await insertProjeto({
      responsavel_nome: 'Oscar',
      responsavel_email: 'oscar.filho@gocase.com',
      ferramenta: 'n8n',
      nome: 'Projeto especial do Oscar',
      membros: [],
      status: 'rascunho',
      especial: true,
    });
    expect((await getProjetoById(projeto.id))?.especial).toBe(1); // pré-condição

    // Conversão: o cliente manda especial:false EXPLÍCITO (sem docs/reset). Deve quebrar
    // a stickiness (ctxData.especial===1), zerar a flag e NÃO entrar no ramo especial.
    const res = await atualizarMetadados({
      projeto_id: projeto.id,
      nome_projeto: 'Projeto especial do Oscar',
      especial: false,
    });

    expect((await getProjetoById(projeto.id))?.especial).toBe(0);
    // reset:false = caminho normal (sem reconstrução da doc especial / sem return especial).
    expect((res as { reset: boolean }).reset).toBe(false);
  });
});
