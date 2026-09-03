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
import {
  atualizarMetadados,
  atualizarTipos,
  deveLimparContextoEspecialOrfao,
} from '@/lib/chat.functions';

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
    // Não é mais especial → o contexto especial é limpo (coluna "Contexto do Projeto
    // Especial" vira "—" no sync). Edição fidedigna ao novo tipo.
    expect(depois?.contexto_especial == null || depois?.contexto_especial === '').toBe(true);
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
      contexto_especial: 'contexto antigo do Oscar (alto impacto)',
    });
    expect((await getProjetoById(projeto.id))?.especial).toBe(1); // pré-condição

    // Conversão: o cliente manda especial:false EXPLÍCITO (sem docs/reset). Deve quebrar
    // a stickiness (ctxData.especial===1), zerar a flag e NÃO entrar no ramo especial.
    const res = await atualizarMetadados({
      projeto_id: projeto.id,
      nome_projeto: 'Projeto especial do Oscar',
      especial: false,
    });

    const depois = await getProjetoById(projeto.id);
    expect(depois?.especial).toBe(0);
    // Contexto especial limpo na conversão (coluna "Ganho Imensurável" → "—").
    expect(depois?.contexto_especial == null || depois?.contexto_especial === '').toBe(true);
    // reset:false = caminho normal (sem reconstrução da doc especial / sem return especial).
    expect((res as { reset: boolean }).reset).toBe(false);
  });
  // Regressão (casos "Farol de Ciência do Código de Conduta" e "GoStream - Checklist
  // Proposta", ago/2026): na ORDEM REAL do formulário (submeter.tsx) o `atualizarTipos`
  // roda ANTES do `atualizarMetadados`. O primeiro zerava a flag; quando o segundo
  // chegava, o guard exigia `especial === 1` no banco, não disparava — e o passo de
  // persistência REGRAVAVA o `contexto_especial` que o form ainda carregava. Resultado:
  // flag zerada, texto órfão no SQLite e na coluna "Ganho Imensurável".
  it('ordem real do form (tipos → metadados) não deixa contexto especial órfão', async () => {
    const projeto = await insertProjeto({
      responsavel_nome: 'Izadora',
      responsavel_email: 'izadora.gomes@gocase.com',
      ferramenta: 'Outros: Antigravity',
      nome: 'Farol de Ciência do Código de Conduta',
      membros: [],
      status: 'rascunho',
      especial: true,
      contexto_especial: 'O valor central do Farol é consolidar a cultura de integridade.',
    });

    // 1º: a troca de tipo (já zera especial + contexto).
    await atualizarTipos({ projeto_id: projeto.id, tipos_projeto: ['saving'] });
    // 2º: os metadados, ainda carregando o contexto especial no payload do form.
    await atualizarMetadados({
      projeto_id: projeto.id,
      nome_projeto: 'Farol de Ciência do Código de Conduta',
      contexto_especial: 'O valor central do Farol é consolidar a cultura de integridade.',
      especial: false,
    });

    const depois = await getProjetoById(projeto.id);
    expect(depois?.especial).toBe(0);
    expect(depois?.contexto_especial == null || depois?.contexto_especial === '').toBe(true);
  });

  // Rede final do submit: independe da ordem em que o formulário chamou as rotas.
  it('deveLimparContextoEspecialOrfao: só limpa texto real de projeto não-especial', () => {
    expect(deveLimparContextoEspecialOrfao(0, 'texto que sobrou')).toBe(true);
    expect(deveLimparContextoEspecialOrfao(null, 'texto que sobrou')).toBe(true);
    // Projeto especial de verdade: o contexto é legítimo, não se toca.
    expect(deveLimparContextoEspecialOrfao(1, 'porque é especial')).toBe(false);
    // Nada a limpar (idempotente — não gera UPDATE a cada reenvio).
    expect(deveLimparContextoEspecialOrfao(0, null)).toBe(false);
    expect(deveLimparContextoEspecialOrfao(0, '   ')).toBe(false);
  });
});
