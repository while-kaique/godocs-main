import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';

// Frente 1 (T6) — wiring da compilação ASSÍNCRONA: `reconciliarDocSePendente` e o persist do
// background. ⚠️ Desde a v2 (D6, 03/09/2026) o SUBMIT NÃO chama mais `reconciliarDocSePendente`:
// quem a usa é o cron `recompilarDocsPendentes` (ver `tests/submit-sem-llm-d6.test.ts`). Aqui:
//  - reconciliarDocSePendente compila quando pendente, preservando o financeiro, e NÃO lança
//    quando a compilação falha (a doc fica pendente para a próxima corrida).
//  - compilarEPersistirDoc persiste via patch e NUNCA lança.

// Mocka SÓ compilarDocumentacao (mantém o resto do módulo real via importOriginal).
vi.mock('@/lib/agents/doc-compiler', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/doc-compiler')>();
  return { ...real, compilarDocumentacao: vi.fn() };
});

let db: BetterSqlite3.Database;

const projetoFake = {
  nome: 'Projeto X',
  responsavel_nome: 'Luis',
  responsavel_email: 'luis@x.com',
  area: 'Tecnologia',
  ferramenta: 'Python',
  membros: JSON.stringify(['a@x.com']),
  data_criacao_projeto: null,
  descricao_breve: null,
} as unknown as NonNullable<
  Awaited<ReturnType<typeof import('@/integrations/db/client.server').getProjetoById>>
>;

async function seedDoc(projetoId: string, conteudo: Record<string, unknown>) {
  const { upsertDocumentacao } = await import('@/integrations/db/client.server');
  await upsertDocumentacao(projetoId, conteudo);
}
async function lerDoc(projetoId: string): Promise<Record<string, unknown>> {
  const { getDocumentacao } = await import('@/integrations/db/client.server');
  const row = await getDocumentacao(projetoId);
  return JSON.parse((row as { conteudo: string }).conteudo) as Record<string, unknown>;
}

const DOC_COMPILADA = {
  titulo: 'Projeto X',
  o_que_faz: 'Faz X para a área.',
  execucao: 'Manual.',
  fluxo: [{ etapa: 'A', descricao: 'passo' }],
};

beforeEach(async () => {
  db = await criarDbMemoria();
  db.pragma('foreign_keys = OFF');
  const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
  vi.mocked(compilarDocumentacao).mockReset();
  delete process.env.DOC_COMPILE_ASYNC;
});

afterEach(() => {
  delete process.env.DOC_COMPILE_ASYNC;
});

describe('reconciliarDocSePendente — submit garante a doc, preserva financeiro, bloqueia em falha', () => {
  it('pendente → compila, grava campos da doc e PRESERVA saving/receita', async () => {
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockResolvedValueOnce(DOC_COMPILADA as never);
    const { reconciliarDocSePendente } = await import('@/lib/chat.functions');

    await seedDoc('r1', {
      compilacao_pendente: true,
      coletado_pendente: { nome_projeto: 'Projeto X', o_que_faz: 'faz' },
      saving: { horas: 10, saving_reais: 1234 },
      receita: { valor: 5 },
    });

    const conteudo = await lerDoc('r1');
    const reconc = await reconciliarDocSePendente('r1', conteudo, projetoFake);

    // Retorno em memória (downstream) e o DB batem: doc compilada + financeiro intacto.
    for (const alvo of [reconc, await lerDoc('r1')]) {
      expect(alvo.o_que_faz).toBe('Faz X para a área.');
      expect(alvo.saving).toEqual({ horas: 10, saving_reais: 1234 });
      expect(alvo.receita).toEqual({ valor: 5 });
      expect('compilacao_pendente' in alvo).toBe(false);
      expect('coletado_pendente' in alvo).toBe(false);
    }
  });

  it('NÃO pendente → devolve o conteúdo intacto e NEM chama o compilador (idempotente)', async () => {
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    const { reconciliarDocSePendente } = await import('@/lib/chat.functions');

    const conteudo = { o_que_faz: 'já compilado', saving: { horas: 1 } };
    const reconc = await reconciliarDocSePendente('r2', conteudo, projetoFake);

    expect(reconc).toEqual(conteudo);
    expect(vi.mocked(compilarDocumentacao)).not.toHaveBeenCalled();
  });

  // ⚠️ DECISÃO INVERTIDA na T7 do GoDocs v2 (02/09/2026). Este teste cobrava o oposto —
  // "compilação FALHA → LANÇA (nunca submete doc incompleta)" —, e a razão registrada era
  // "sem async não há rede que recomponha". As duas metades caíram: no fluxo v2 a doc é
  // SEMPRE compilada em segundo plano, e a rede (o cron `recompilar-docs-pendentes`, que ao
  // terminar redispara a análise) roda independente de flag. Com a régua antiga, um soluço do
  // proxy no submit bloquearia a submissão inteira num fluxo que NÃO TEM MAIS CHAT para
  // retentar — o usuário veria "documentação ausente" sem saída nenhuma.
  //
  // O dente continua: a doc não pode ser dada por PRONTA. Ela tem de permanecer PENDENTE,
  // que é o que faz o cron voltar nela. Publicar doc incompleta segue sendo o defeito.
  it('compilação FALHA → NÃO lança, e a doc fica PENDENTE para o cron', async () => {
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockRejectedValueOnce(new Error('IA fora'));
    const { reconciliarDocSePendente } = await import('@/lib/chat.functions');
    const { precisaCompilarDoc } = await import('@/lib/agents/doc-async');

    await seedDoc('r3', { compilacao_pendente: true, coletado_pendente: { nome_projeto: 'X' } });
    const conteudo = await lerDoc('r3');

    const reconc = await reconciliarDocSePendente('r3', conteudo, projetoFake);

    // Não bloqueia o submit...
    expect(reconc).toBeTruthy();
    // ...mas NÃO finge que a doc ficou pronta — senão o cron nunca voltaria nela.
    expect(precisaCompilarDoc(reconc)).toBe(true);
    expect(precisaCompilarDoc(await lerDoc('r3'))).toBe(true);
  });

  it('repassa o perfil de LLM (fail-fast do submit) ao compilador', async () => {
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockResolvedValueOnce(DOC_COMPILADA as never);
    const { reconciliarDocSePendente } = await import('@/lib/chat.functions');

    await seedDoc('r5', { compilacao_pendente: true, coletado_pendente: { nome_projeto: 'X' } });
    const conteudo = await lerDoc('r5');
    const opts = { semFallbackModelo: true, retriesModelo: 0, timeoutMs: 120000 };
    await reconciliarDocSePendente('r5', conteudo, projetoFake, opts);

    // 3º argumento de compilarDocumentacao é o override de opts (0 retries = fail-fast).
    const args = vi.mocked(compilarDocumentacao).mock.calls[0];
    expect(args[2]).toMatchObject({ retriesModelo: 0, semFallbackModelo: true });
  });

  it('modo ASYNC + compilação falha → DEFERE (não trava o cliente): NÃO lança, doc fica pendente', async () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockRejectedValueOnce(new Error('proxy fora'));
    const { reconciliarDocSePendente } = await import('@/lib/chat.functions');

    await seedDoc('r4', { compilacao_pendente: true, coletado_pendente: { nome_projeto: 'X' }, saving: { horas: 3 } });
    const conteudo = await lerDoc('r4');

    // Cliente nunca trava: retorna (sem throw) e a doc segue PENDENTE p/ o cron recompilar.
    const reconc = await reconciliarDocSePendente('r4', conteudo, projetoFake);
    expect(reconc.compilacao_pendente).toBe(true);
    expect(reconc.saving).toEqual({ horas: 3 }); // financeiro preservado
  });
});

describe('compilarEPersistirDoc — background persiste via patch e é FAIL-SAFE', () => {
  it('sucesso → grava a doc (patch) preservando saving já existente', async () => {
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockResolvedValueOnce(DOC_COMPILADA as never);
    const { compilarEPersistirDoc } = await import('@/lib/chat.functions');

    await seedDoc('b1', {
      compilacao_pendente: true,
      coletado_pendente: { nome_projeto: 'X' },
      saving: { horas: 7 },
    });

    await compilarEPersistirDoc('b1', {
      responsavel_nome: 'L', responsavel_email: 'l@x', area: null, ferramenta: 'Python',
      membros: [], nome_projeto: 'X', data_criacao: null, doc_texto: null,
    }, { nome_projeto: 'X', o_que_faz: 'faz', execucao: null, dependencias: null, fluxo: null, configurar_antes: null, atencao: null });

    const c = await lerDoc('b1');
    expect(c.o_que_faz).toBe('Faz X para a área.');
    expect(c.saving).toEqual({ horas: 7 });
    expect('compilacao_pendente' in c).toBe(false);
  });

  it('falha na compilação → NÃO lança e deixa a doc PENDENTE p/ o submit reconciliar', async () => {
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    vi.mocked(compilarDocumentacao).mockRejectedValueOnce(new Error('IA fora'));
    const { compilarEPersistirDoc } = await import('@/lib/chat.functions');

    await seedDoc('b2', { compilacao_pendente: true, coletado_pendente: { nome_projeto: 'X' } });

    await expect(
      compilarEPersistirDoc('b2', {
        responsavel_nome: 'L', responsavel_email: 'l@x', area: null, ferramenta: 'Python',
        membros: [], nome_projeto: 'X', data_criacao: null, doc_texto: null,
      }, { nome_projeto: 'X', o_que_faz: null, execucao: null, dependencias: null, fluxo: null, configurar_antes: null, atencao: null }),
    ).resolves.toBeUndefined();

    const c = await lerDoc('b2');
    expect(c.compilacao_pendente).toBe(true); // continua pendente → submit reconcilia
  });
});
