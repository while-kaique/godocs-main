// GoDocs v2 — T9 (o agente sai do caminho da submissão) + T7 (a doc é invisível,
// roda em background e NUNCA bloqueia). Plano: docs/plans/godocs-v2-submissao-deterministica.md
//
// O que estes testes encodam (comportamento do plano, não o código de hoje):
//
//  T9 — `iniciarSubmissao` de um projeto padrão (SEM `fluxo_direto` no payload, que o
//  cliente v2 não manda mais) não conversa com ninguém: não chama o orquestrador, não
//  grava turno de `assistant` no chat — e mesmo assim deixa a linha de `documentacao`
//  gravada, de modo que `submeterParaValidacao` não recuse com `bloqueioDocAusente`.
//  Idem para `atualizarMetadados` com anexos novos. ⚠️ DESLIGAR ≠ APAGAR: as funções e
//  os gates do agente continuam existindo e exportados (teste-canário no fim).
//
//  T7 — a compilação da doc sai do caminho crítico: a chamada RETORNA sem esperar,
//  deixando o PLACEHOLDER (`precisaCompilarDoc` true) com o `coletado` snapshotado; se a
//  compilação falhar, a submissão não trava (o cron recompila); enquanto a doc está
//  pendente o ANALISADOR não roda (senão dá parecer sobre "(não preenchido)"); e quando o
//  cron recompila com sucesso, a análise daquele projeto é finalmente disparada.
//
// Observação de escrita: nada aqui espia função interna de `chat.functions` — os pontos de
// observação são as FRONTEIRAS (o orquestrador, o compilador de doc, o agente analisador) e
// o que ficou PERSISTIDO no SQLite real (chat_messages / documentacao / projetos).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';

// ── Fronteiras mockadas (nenhuma rede; o resto de cada módulo continua REAL) ──

vi.mock('@/lib/agents/orchestrator', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/orchestrator')>();
  return { ...real, runOrchestrator: vi.fn() };
});

vi.mock('@/lib/agents/doc-compiler', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/doc-compiler')>();
  return { ...real, compilarDocumentacao: vi.fn() };
});

vi.mock('@/lib/agents/extractor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/extractor')>();
  return { ...real, extrairCamposDocumentacao: vi.fn() };
});

vi.mock('@/lib/extract-text.server', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/extract-text.server')>();
  return { ...real, extractTextFromMultipleFiles: vi.fn() };
});

vi.mock('@/lib/agents/analyzer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/analyzer')>();
  return { ...real, analisarProjeto: vi.fn() };
});

vi.mock('@/lib/areas/teamguide.server', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/areas/teamguide.server')>();
  return {
    ...real,
    deriveAreaFromEmail: vi.fn(async () => 'Tecnologia'),
    // Fail-to-false: o autor destes testes NÃO é liderança (senão cairíamos no fluxo
    // direto, que é outra porta e já existe hoje).
    ehLideranca: vi.fn(async () => false),
  };
});

vi.mock('@/lib/google/sync', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/google/sync')>();
  return { ...real, syncSubmitToGoogle: vi.fn(async () => ({})), syncUpdateToGoogle: vi.fn(async () => ({})) };
});

let db: BetterSqlite3.Database;

const DOC_COMPILADA = {
  titulo: 'Robô de conciliação',
  o_que_faz: 'Concilia os lançamentos do dia.',
  execucao: 'Diária, automática.',
  fluxo: [{ etapa: 'Ler', descricao: 'lê o extrato' }],
};

const COLETADO_DO_EXTRATOR = {
  nome_projeto: 'Robô de conciliação',
  o_que_faz: 'Concilia os lançamentos do dia.',
  execucao: null,
  dependencias: null,
  fluxo: null,
  configurar_antes: null,
  atencao: null,
  tem_ia_como_funcionalidade: null,
};

function payloadSubmissao(extra: Record<string, unknown> = {}) {
  return {
    responsavel_nome: 'Luis Albuquerque',
    responsavel_email: 'autor.v2@gocase.com',
    ferramenta: 'Python',
    membros: [],
    nome_projeto: 'Robô de conciliação',
    data_criacao: '2026-08-01',
    tipos_projeto: ['saving'],
    descricao_breve: 'Concilia os lançamentos do dia.',
    docs: [{ base64: 'ZG9j', filename: 'doc.txt' }],
    ...extra,
  };
}

/** Deixa o mock do compilador PENDURADO (nunca resolve) e devolve como soltá-lo. */
function compiladorPendurado(mock: ReturnType<typeof vi.fn>) {
  let soltar: (v: unknown) => void = () => {};
  mock.mockImplementation(() => new Promise((res) => { soltar = res; }));
  return () => soltar(DOC_COMPILADA);
}

/** Falha explícita (em vez de timeout do runner) quando a chamada NÃO retorna sozinha. */
function comPrazo<T>(p: Promise<T>, ms: number, oQue: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`${oQue} não retornou em ${ms}ms (esperou a compilação da doc)`)), ms),
    ),
  ]);
}

async function lerDoc(projetoId: string): Promise<Record<string, unknown> | null> {
  const { getDocumentacao, parseJson } = await import('@/integrations/db/client.server');
  const row = await getDocumentacao(projetoId);
  if (!row) return null;
  return (parseJson<Record<string, unknown>>((row as { conteudo: string }).conteudo) ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  db = await criarDbMemoria();
  db.pragma('foreign_keys = OFF');
  vi.clearAllMocks();
  delete process.env.DOC_COMPILE_ASYNC;

  const { runOrchestrator } = await import('@/lib/agents/orchestrator');
  const { documentacaoVazia, savingVazio, receitaVazia } = await import('@/lib/agents/types');
  // Se ALGUÉM ainda chamar o orquestrador, ele responde algo plausível — o teste falha
  // pela ASSERÇÃO ("não devia ter sido chamado"), não por um crash colateral.
  vi.mocked(runOrchestrator).mockResolvedValue({
    type: 'question',
    content: 'Me conte mais sobre o projeto.',
    fase: 'doc',
    coletado: documentacaoVazia(),
    saving: savingVazio(),
    receita: receitaVazia(),
  } as never);

  const { extrairCamposDocumentacao } = await import('@/lib/agents/extractor');
  vi.mocked(extrairCamposDocumentacao).mockResolvedValue(COLETADO_DO_EXTRATOR as never);

  const { extractTextFromMultipleFiles } = await import('@/lib/extract-text.server');
  vi.mocked(extractTextFromMultipleFiles).mockResolvedValue('Texto do anexo enviado pelo autor.' as never);

  const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
  vi.mocked(compilarDocumentacao).mockResolvedValue(DOC_COMPILADA as never);

  const { analisarProjeto } = await import('@/lib/agents/analyzer');
  vi.mocked(analisarProjeto).mockResolvedValue({
    resultado: 'aprovado',
    pontuacao_total: 10,
    pontuacao_maxima: 13,
    justificativa: 'ok',
    resumo: 'parecer do analisador',
    complexidade: 'automacao',
    criterios_hardcoded: [],
    criterios_dinamicos: [],
    classificacao_avaliacao: 'claro_sim',
    classificacao_justificativa: 'ok',
  } as never);
});

// ─────────────────────────────────────────────────────────────────────────────
// T9 — o agente sai do caminho da submissão
// ─────────────────────────────────────────────────────────────────────────────

describe('T9 — submissão v2 não passa pelo agente conversacional', () => {
  it('iniciarSubmissao sem `fluxo_direto` NÃO chama o orquestrador nem grava turno de assistant', async () => {
    const { iniciarSubmissao } = await import('@/lib/chat.functions');
    const { runOrchestrator } = await import('@/lib/agents/orchestrator');
    const { getChatMessages } = await import('@/integrations/db/client.server');

    const r = (await iniciarSubmissao(payloadSubmissao())) as { projeto_id: string };
    expect(r.projeto_id).toBeTruthy();

    // O cliente v2 não manda mais `fluxo_direto` — e mesmo assim ninguém conversa.
    expect(vi.mocked(runOrchestrator)).not.toHaveBeenCalled();

    const msgs = await getChatMessages(r.projeto_id);
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(0);
  });

  it('iniciarSubmissao grava a linha de `documentacao` → submeterParaValidacao NÃO recusa por doc ausente', async () => {
    const { iniciarSubmissao, submeterParaValidacao } = await import('@/lib/chat.functions');
    const { getDocumentacao } = await import('@/integrations/db/client.server');

    const r = (await iniciarSubmissao(payloadSubmissao())) as { projeto_id: string };

    // Pré-condição que o submit exige (é o 1º gate de submeterParaValidacao).
    expect(await getDocumentacao(r.projeto_id)).toBeTruthy();

    // O submit AINDA vai barrar este projeto (ele não tem ganho declarado) — o que não
    // pode acontecer é ser barrado por FALTA DE DOCUMENTAÇÃO.
    let codigo: string | undefined;
    try {
      await submeterParaValidacao({ projeto_id: r.projeto_id });
    } catch (e) {
      codigo = (e as { bloqueio?: { codigo?: string } }).bloqueio?.codigo;
    }
    expect(codigo).not.toBe('doc_ausente');
  });

  it('atualizarMetadados com anexos novos NÃO roda o orquestrador nem escreve turno de assistant', async () => {
    const { iniciarSubmissao, atualizarMetadados } = await import('@/lib/chat.functions');
    const { runOrchestrator } = await import('@/lib/agents/orchestrator');
    const { getChatMessages } = await import('@/integrations/db/client.server');

    const r = (await iniciarSubmissao(payloadSubmissao())) as { projeto_id: string };
    vi.mocked(runOrchestrator).mockClear();

    await atualizarMetadados({
      projeto_id: r.projeto_id,
      descricao_breve: 'Descrição corrigida pelo autor.',
      docs: [{ base64: 'bm92bw==', filename: 'novo.txt' }],
    });

    expect(vi.mocked(runOrchestrator)).not.toHaveBeenCalled();
    const msgs = await getChatMessages(r.projeto_id);
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(0);
  });

  it('CANÁRIO — desligar ≠ apagar: as funções e os gates do agente continuam EXPORTADOS', async () => {
    const chat = await import('@/lib/chat.functions');
    const orq = await import('@/lib/agents/orchestrator');
    const ganho = await import('@/lib/agents/ganho-projetado');
    const sobrep = await import('@/lib/agents/sobreposicao-receita');
    const custoChat = await import('@/lib/agents/custo-evitado-chat');

    for (const nome of ['enviarMensagem', 'iniciarSaving', 'iniciarReceita'] as const) {
      expect(typeof chat[nome], `chat.functions.${nome} sumiu`).toBe('function');
    }
    expect(typeof orq.runOrchestrator).toBe('function');
    expect(typeof orq.aplicaGateAlocacaoGanhos).toBe('function');
    expect(typeof ganho.deveBloquearPorProjecao).toBe('function');
    expect(typeof sobrep.deveBloquearPorSobreposicao).toBe('function');
    expect(typeof custoChat.deveBloquearPorCustoEvitadoChat).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — a doc é invisível: compila em background e nunca bloqueia
// ─────────────────────────────────────────────────────────────────────────────

describe('T7 — a doc compila em BACKGROUND e não bloqueia a submissão', () => {
  it('retorna SEM esperar a compilação, deixando o placeholder pendente com o `coletado`', async () => {
    const { iniciarSubmissao } = await import('@/lib/chat.functions');
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    const { precisaCompilarDoc, coletadoDePendente } = await import('@/lib/agents/doc-async');

    const soltar = compiladorPendurado(vi.mocked(compilarDocumentacao) as never);

    const r = (await comPrazo(
      iniciarSubmissao(payloadSubmissao()) as Promise<{ projeto_id: string }>,
      3000,
      'iniciarSubmissao',
    ));

    // Enquanto a compilação não voltou, o que está gravado é o PLACEHOLDER — e o
    // `coletado` do extrator sobrevive nele (é o que o cron usa para recompilar).
    const conteudo = await lerDoc(r.projeto_id);
    expect(conteudo, 'documentacao não foi gravada').toBeTruthy();
    expect(precisaCompilarDoc(conteudo)).toBe(true);
    expect(coletadoDePendente(conteudo)?.nome_projeto).toBe('Robô de conciliação');

    soltar();
  });

  it('compilação da doc FALHA → iniciarSubmissao não lança e a doc fica pendente p/ o cron', async () => {
    const { iniciarSubmissao } = await import('@/lib/chat.functions');
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    const { precisaCompilarDoc } = await import('@/lib/agents/doc-async');

    vi.mocked(compilarDocumentacao).mockRejectedValue(new Error('proxy fora'));

    const r = (await iniciarSubmissao(payloadSubmissao())) as { projeto_id: string };

    const conteudo = await lerDoc(r.projeto_id);
    expect(conteudo, 'documentacao não foi gravada').toBeTruthy();
    expect(precisaCompilarDoc(conteudo)).toBe(true);
  });

  it('o ANALISADOR não roda sobre doc pendente (nada de parecer em cima de placeholder)', async () => {
    const { analisarProjetoFn } = await import('@/lib/chat.functions');
    const { analisarProjeto } = await import('@/lib/agents/analyzer');
    const { placeholderDocPendente } = await import('@/lib/agents/doc-async');
    const { insertProjeto, upsertDocumentacao, getProjetoById } = await import(
      '@/integrations/db/client.server'
    );

    const projeto = await insertProjeto({
      responsavel_nome: 'Luis',
      responsavel_email: 'autor.v2@gocase.com',
      ferramenta: 'Python',
      nome: 'Projeto com doc pendente',
      membros: [],
      status: 'em_validacao',
    });
    await upsertDocumentacao(projeto.id, placeholderDocPendente(COLETADO_DO_EXTRATOR as never));

    await analisarProjetoFn({ projeto_id: projeto.id });

    expect(
      vi.mocked(analisarProjeto),
      'o analisador rodou sobre um placeholder — parecer/complexidade sobre "(não preenchido)"',
    ).not.toHaveBeenCalled();

    const depois = await getProjetoById(projeto.id);
    expect(depois?.observacoes ?? null).toBeFalsy();
    expect(depois?.complexidade ?? null).toBeFalsy();
  });

  it('quando o cron recompila a doc pendente, a ANÁLISE daquele projeto é disparada', async () => {
    const { recompilarDocsPendentes } = await import('@/lib/chat.functions');
    const { analisarProjeto } = await import('@/lib/agents/analyzer');
    const { placeholderDocPendente, precisaCompilarDoc } = await import('@/lib/agents/doc-async');
    const { insertProjeto, upsertDocumentacao, updateProjeto } = await import(
      '@/integrations/db/client.server'
    );

    const projeto = await insertProjeto({
      responsavel_nome: 'Luis',
      responsavel_email: 'autor.v2@gocase.com',
      ferramenta: 'Python',
      nome: 'Projeto que o cron recompila',
      membros: [],
      status: 'em_validacao',
    });
    // ⚠️ SUBMETIDO de propósito: o redisparo só vale para quem já foi enviado. Rascunho na
    // fila de docs pendentes não pode ser analisado (analisar grava status/validated_at e
    // espelha a linha — o rascunho apareceria no /dashboard e seria apagado em cascata pela
    // reconciliação). O caso do rascunho tem teste próprio, logo abaixo.
    await updateProjeto(projeto.id, { submitted_at: new Date().toISOString() });
    await upsertDocumentacao(projeto.id, placeholderDocPendente(COLETADO_DO_EXTRATOR as never));

    const r = await recompilarDocsPendentes(50);
    expect(r.recompilados).toBe(1);
    expect(precisaCompilarDoc(await lerDoc(projeto.id))).toBe(false);

    // Sem isto o projeto fica PARA SEMPRE com a análise que nunca aconteceu:
    // `reconciliarComplexidade` só preenche campo vazio, nunca corrige.
    await vi.waitFor(
      () => expect(vi.mocked(analisarProjeto)).toHaveBeenCalledWith(projeto.id),
      { timeout: 3000, interval: 25 },
    );
  });

  // ⚠️ O contra-caso do teste acima, e ele é sobre PERDA DE DADO, não sobre trabalho à toa.
  // A fila de docs pendentes não filtra status, e o placeholder nasce no `iniciarSubmissao` —
  // então todo RASCUNHO cuja compilação de fundo falhou está nela. Analisar um rascunho grava
  // `status`/`validated_at` e espelha a linha: ele deixaria de ser rascunho, apareceria no
  // /dashboard e, por não existir na planilha, seria APAGADO em cascata pela reconciliação
  // depois da carência de 1h.
  it('o cron NÃO analisa RASCUNHO, mesmo tendo recompilado a doc dele', async () => {
    const { recompilarDocsPendentes } = await import('@/lib/chat.functions');
    const { analisarProjeto } = await import('@/lib/agents/analyzer');
    const { placeholderDocPendente, precisaCompilarDoc } = await import('@/lib/agents/doc-async');
    const { insertProjeto, upsertDocumentacao, getProjetoById } = await import(
      '@/integrations/db/client.server'
    );

    const rascunho = await insertProjeto({
      responsavel_nome: 'Luis',
      responsavel_email: 'autor.v2@gocase.com',
      ferramenta: 'Python',
      nome: 'Rascunho abandonado',
      membros: [],
      status: 'rascunho',
    });
    await upsertDocumentacao(rascunho.id, placeholderDocPendente(COLETADO_DO_EXTRATOR as never));

    // A doc DELE é recompilada normalmente (o reparo da doc não depende de submissão)...
    await recompilarDocsPendentes(50);
    expect(precisaCompilarDoc(await lerDoc(rascunho.id))).toBe(false);

    // ...mas a análise NÃO dispara, e o status continua rascunho.
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(analisarProjeto)).not.toHaveBeenCalledWith(rascunho.id);
    expect((await getProjetoById(rascunho.id))?.status).toBe('rascunho');
  });

  it('GUARD — a doc que aterrissa DEPOIS do ganho não sobrescreve saving/receita', async () => {
    const { compilarEPersistirDoc } = await import('@/lib/chat.functions');
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    const { upsertDocumentacao } = await import('@/integrations/db/client.server');

    // O LLM alucina um financeiro dentro da doc compilada — ele NUNCA pode vazar ao blob.
    vi.mocked(compilarDocumentacao).mockResolvedValue({
      ...DOC_COMPILADA,
      saving: { economia_reais_mes: 999999 },
      receita: { valor_ganho_mensal: 888888 },
    } as never);

    await upsertDocumentacao('guard1', {
      compilacao_pendente: true,
      coletado_pendente: COLETADO_DO_EXTRATOR,
      saving: { economia_horas_mes: 40, economia_reais_mes: 1234 },
      receita: { valor_ganho_mensal: 500 },
    });

    await compilarEPersistirDoc(
      'guard1',
      {
        responsavel_nome: 'Luis', responsavel_email: 'autor.v2@gocase.com', area: null,
        ferramenta: 'Python', membros: [], nome_projeto: 'Robô de conciliação',
        data_criacao: null, doc_texto: null,
      } as never,
      COLETADO_DO_EXTRATOR as never,
    );

    const c = (await lerDoc('guard1'))!;
    expect(c.saving).toEqual({ economia_horas_mes: 40, economia_reais_mes: 1234 });
    expect(c.receita).toEqual({ valor_ganho_mensal: 500 });
    expect(c.o_que_faz).toBe('Concilia os lançamentos do dia.');
  });
});
