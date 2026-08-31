// Fatia C — wiring de INTEGRAÇÃO do fluxo reordenado (Critério de aceitação #1).
// Prova executável (SQLite :memory: + LLM mockado) de que:
//   1. iniciarSubmissao (REORDER_DOC_FINAL=1) NÃO abre a fase doc: dispara a compilação em
//      background e devolve `reorder_doc_final`, gravando o `coletado_inicial` DURÁVEL no blob.
//   2. iniciarRefinoDoc (o 1º turno do refino) roda a fase `doc` com o coletado vindo do BLOB
//      (a fase doc não rodou antes) e persiste — é o "refino da doc por último".
import { describe, it, expect, beforeAll, vi } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { GoDeployDB } from '@/integrations/db/db-adapter';
import {
  setDb,
  insertProjeto,
  updateProjeto,
  upsertDocumentacao,
  getDocumentacao,
  insertChatMessage,
} from '@/integrations/db/client.server';
import { documentacaoVazia, savingVazio, receitaVazia } from '@/lib/agents/types';

// O extrator, o compilador e a extração de texto são LLM/IO — mockados. O orquestrador é mockado
// só para o refino, preservando o resto do módulo (proximaFase etc.) via importOriginal.
vi.mock('@/lib/agents/extractor', () => ({ extrairCamposDocumentacao: vi.fn() }));
vi.mock('@/lib/agents/doc-compiler', () => ({ compilarDocumentacao: vi.fn() }));
vi.mock('@/lib/extract-text.server', () => ({
  extractTextFromMultipleFiles: vi.fn().mockResolvedValue(''),
}));
vi.mock('@/lib/agents/orchestrator', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/agents/orchestrator')>();
  return { ...orig, runOrchestrator: vi.fn() };
});

const DOC_MINIMO = [{ base64: 'YWJj', filename: 'x.txt' }];

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

describe('fatia C — wiring de integração do fluxo reordenado', () => {
  // Schema inicializado UMA vez (o initSchema tem guard de módulo: recriar o :memory: por teste
  // pularia a criação das tabelas). Cada teste cria projetos com ids próprios — sem colisão.
  beforeAll(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    await setDb(asyncAdapter(db));
  });

  it('iniciarSubmissao (reorder): devolve reorder_doc_final e grava coletado_inicial DURÁVEL no blob', async () => {
    process.env.REORDER_DOC_FINAL = '1';
    const { extrairCamposDocumentacao } = await import('@/lib/agents/extractor');
    vi.mocked(extrairCamposDocumentacao).mockResolvedValue({
      ...documentacaoVazia(),
      nome_projeto: 'Projeto P',
      o_que_faz: 'automatiza o faturamento',
    });
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockResolvedValue({ titulo: 'Projeto P' } as never);

    const { iniciarSubmissao } = await import('@/lib/chat.functions');
    const res = (await iniciarSubmissao({
      responsavel_nome: 'Autor',
      responsavel_email: 'autor@gocase.com',
      ferramenta: 'n8n',
      nome_projeto: 'Projeto P',
      data_criacao: '2026-01-01',
      descricao_breve: 'automatiza o faturamento',
      membros: [],
      docs: DOC_MINIMO,
    })) as { projeto_id: string; reorder_doc_final?: boolean; response?: unknown };

    // NÃO abriu a fase doc E retorna NA HORA (extrator + compilação vão para background): sem
    // `response`, só o sinal de reordenação.
    expect(res.reorder_doc_final).toBe(true);
    expect(res.response).toBeUndefined();

    // O extrator+compilação rodam em background (extrairCompilarPersistir). Deixa o pipeline
    // terminar (mocks instantâneos) e confere que o coletado_inicial DURÁVEL sobreviveu ao merge
    // da compilação — é o que o preview financeiro relê para o memorial não sair em branco.
    await new Promise((r) => setTimeout(r, 50));
    const docRow = await getDocumentacao(res.projeto_id);
    expect(docRow).toBeTruthy();
    const conteudo = JSON.parse((docRow as { conteudo: string }).conteudo);
    expect(conteudo.coletado_inicial?.o_que_faz).toBe('automatiza o faturamento');
  });

  it('iniciarSubmissao (flag OFF): mantém o comportamento de hoje (abre a fase doc)', async () => {
    delete process.env.REORDER_DOC_FINAL;
    const { extrairCamposDocumentacao } = await import('@/lib/agents/extractor');
    vi.mocked(extrairCamposDocumentacao).mockResolvedValue({ ...documentacaoVazia(), nome_projeto: 'P' });
    const { runOrchestrator } = await import('@/lib/agents/orchestrator');
    vi.mocked(runOrchestrator).mockResolvedValue({
      type: 'question', fase: 'doc', content: 'primeira pergunta',
      coletado: documentacaoVazia(), saving: savingVazio(), receita: receitaVazia(),
    } as never);

    const { iniciarSubmissao } = await import('@/lib/chat.functions');
    const res = (await iniciarSubmissao({
      responsavel_nome: 'A', responsavel_email: 'a@gocase.com', ferramenta: 'n8n',
      nome_projeto: 'P', data_criacao: '2026-01-01', descricao_breve: 'faz X', membros: [], docs: DOC_MINIMO,
    })) as { projeto_id: string; reorder_doc_final?: boolean; response?: { fase?: string } };

    expect(res.reorder_doc_final).toBeUndefined();
    expect(res.response?.fase).toBe('doc');
  });

  it('iniciarRefinoDoc: roda a fase doc com o coletado do BLOB e persiste a mensagem', async () => {
    // Projeto com o coletado_inicial no blob (como iniciarSubmissao reorder o deixaria) e SEM
    // mensagem de fase doc no chat (a fase doc não rodou).
    const projeto = await insertProjeto({
      responsavel_nome: 'Autor', responsavel_email: 'autor@gocase.com',
      ferramenta: 'n8n', nome: 'Projeto P', membros: [], status: 'rascunho',
    });
    await updateProjeto(projeto.id, { tipos_projeto: ['saving'] });
    await upsertDocumentacao(projeto.id, {
      compilacao_pendente: true,
      coletado_inicial: { ...documentacaoVazia(), nome_projeto: 'Projeto P', o_que_faz: 'automatiza o faturamento' },
    });

    const { runOrchestrator } = await import('@/lib/agents/orchestrator');
    vi.mocked(runOrchestrator).mockClear(); // ignora chamadas dos testes anteriores (DB compartilhado)
    vi.mocked(runOrchestrator).mockResolvedValue({
      type: 'preview', fase: 'doc_preview', content: 'PREVIEW DA DOC',
      coletado: { ...documentacaoVazia(), nome_projeto: 'Projeto P', o_que_faz: 'automatiza o faturamento' },
      saving: savingVazio(), receita: receitaVazia(),
    } as never);

    const { iniciarRefinoDoc } = await import('@/lib/chat.functions');
    const res = (await iniciarRefinoDoc({ projeto_id: projeto.id })) as { fase?: string; content?: string };

    // Rodou a fase `doc` com o coletado vindo do blob (não vazio).
    const call = vi.mocked(runOrchestrator).mock.calls.at(-1)!;
    expect(call[2]).toBe('doc'); // 3º arg = fase
    expect((call[3] as { o_que_faz?: string }).o_que_faz).toBe('automatiza o faturamento'); // 4º = coletado do blob
    expect(res.fase).toBe('doc_preview');
  });

  // Bloco de recompile no doc_preview→completo do refino: só recompila se o refino MUDOU o coletado.
  async function montarRefinoNoDocPreview(coletadoInicial: { o_que_faz: string }) {
    const p = await insertProjeto({
      responsavel_nome: 'Autor', responsavel_email: 'autor@gocase.com',
      ferramenta: 'n8n', nome: 'P recompile', membros: [], status: 'rascunho',
    });
    await updateProjeto(p.id, { tipos_projeto: ['saving'] });
    await upsertDocumentacao(p.id, {
      compilacao_pendente: false,
      coletado_inicial: { ...documentacaoVazia(), nome_projeto: 'P', ...coletadoInicial },
    });
    // Estado do chat na fase doc_preview (o refino mostrou o preview e a pessoa vai aprovar).
    await insertChatMessage({
      projeto_id: p.id, role: 'assistant',
      content: JSON.stringify({
        type: 'preview', fase: 'doc_preview',
        coletado: { ...documentacaoVazia(), nome_projeto: 'P', ...coletadoInicial },
        saving: savingVazio(), receita: receitaVazia(),
      }),
    });
    return p.id;
  }

  it('recompile: refino MUDOU o coletado → recompila a doc em background', async () => {
    process.env.REORDER_DOC_FINAL = '1';
    const projetoId = await montarRefinoNoDocPreview({ o_que_faz: 'versão A' });
    const { runOrchestrator } = await import('@/lib/agents/orchestrator');
    vi.mocked(runOrchestrator).mockResolvedValue({
      type: 'complete', fase: 'completo', content: 'MEMORIAL',
      coletado: { ...documentacaoVazia(), nome_projeto: 'P', o_que_faz: 'versão B (mudou)' },
      saving: savingVazio(), receita: receitaVazia(),
    } as never);
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockClear();
    vi.mocked(compilarDocumentacao).mockResolvedValue({ titulo: 'P' } as never);

    const { enviarMensagem } = await import('@/lib/chat.functions');
    await enviarMensagem({ projeto_id: projetoId, content: 'aprovar' });
    await new Promise((r) => setTimeout(r, 0)); // deixa o runBackground arrancar

    expect(vi.mocked(compilarDocumentacao)).toHaveBeenCalled();
  });

  it('recompile: refino NÃO mudou o coletado → NÃO recompila (economiza os ~64s)', async () => {
    process.env.REORDER_DOC_FINAL = '1';
    const projetoId = await montarRefinoNoDocPreview({ o_que_faz: 'igual' });
    const { runOrchestrator } = await import('@/lib/agents/orchestrator');
    vi.mocked(runOrchestrator).mockResolvedValue({
      type: 'complete', fase: 'completo', content: 'MEMORIAL',
      coletado: { ...documentacaoVazia(), nome_projeto: 'P', o_que_faz: 'igual' },
      saving: savingVazio(), receita: receitaVazia(),
    } as never);
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockClear();
    vi.mocked(compilarDocumentacao).mockResolvedValue({ titulo: 'P' } as never);

    const { enviarMensagem } = await import('@/lib/chat.functions');
    await enviarMensagem({ projeto_id: projetoId, content: 'aprovar' });
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(compilarDocumentacao)).not.toHaveBeenCalled();
  });
});
