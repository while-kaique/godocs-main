// D6 (v2) — "a submissão NÃO espera a doc" e critério 1 do plano: nenhuma chamada de LLM no
// caminho do clique "Enviar". Este arquivo é a REDE que faltava (achado alto da re-verificação):
// sem ele, reintroduzir o `await reconciliarDocSePendente(...)` no submit ou a escrita do
// placeholder no Drive passaria verde.
//
// Prende: (1) submit com doc PENDENTE não chama o compilador nem o Drive; (2) o cron
// `recompilarDocsPendentes` compila e SÓ ENTÃO grava o resumo no Drive (projeto submetido);
// (3) `salvarResumoDocNoDrive` nunca lança quando o Drive falha.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';

vi.mock('@/lib/agents/doc-compiler', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/doc-compiler')>();
  return { ...real, compilarDocumentacao: vi.fn() };
});
vi.mock('@/lib/google/drive', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/google/drive')>();
  return { ...real, upsertResumoDoc: vi.fn(async () => 'https://drive.google.com/resumo'), uploadDocsToDrive: vi.fn(async () => []) };
});
vi.mock('@/lib/agents/analyzer', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/agents/analyzer')>();
  return { ...real, analisarProjeto: vi.fn(async () => ({ resultado: 'aprovado', pontuacao_total: 10, pontuacao_maxima: 13, justificativa: 'ok', resumo: 'ok', complexidade: 'automacao', criterios_hardcoded: [], criterios_dinamicos: [], classificacao_avaliacao: 'claro_sim', classificacao_justificativa: 'ok' })) };
});
vi.mock('@/lib/areas/teamguide.server', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/areas/teamguide.server')>();
  return { ...real, deriveAreaFromEmail: vi.fn(async () => 'Tecnologia'), ehLideranca: vi.fn(async () => false), getCargoDe: vi.fn(async () => null) };
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
const COLETADO = {
  nome_projeto: 'Robô de conciliação',
  o_que_faz: 'Concilia os lançamentos do dia.',
  execucao: null,
  dependencias: null,
  fluxo: null,
  configurar_antes: null,
  atencao: null,
  tem_ia_como_funcionalidade: null,
};

async function projetoComDocPendente(submetido: boolean) {
  const { placeholderDocPendente } = await import('@/lib/agents/doc-async');
  const { insertProjeto, upsertDocumentacao, updateProjeto } = await import('@/integrations/db/client.server');
  const projeto = await insertProjeto({
    responsavel_nome: 'Luis',
    responsavel_email: 'autor.v2@gocase.com',
    ferramenta: 'Python',
    nome: 'Robô de conciliação',
    membros: [],
    status: 'em_validacao',
  });
  if (submetido) await updateProjeto(projeto.id, { submitted_at: new Date().toISOString() });
  await upsertDocumentacao(projeto.id, placeholderDocPendente(COLETADO as never));
  return projeto;
}

beforeEach(async () => {
  db = await criarDbMemoria();
  db.pragma('foreign_keys = OFF');
  vi.clearAllMocks();
  const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
  vi.mocked(compilarDocumentacao).mockResolvedValue(DOC_COMPILADA as never);
  const { upsertResumoDoc } = await import('@/lib/google/drive');
  vi.mocked(upsertResumoDoc).mockResolvedValue('https://drive.google.com/resumo');
});

describe('D6 — submit com doc PENDENTE não toca LLM nem Drive', () => {
  it('submeterParaValidacao não chama o compilador nem upsertResumoDoc quando a doc é placeholder', async () => {
    const { submeterParaValidacao } = await import('@/lib/chat.functions');
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    const { upsertResumoDoc } = await import('@/lib/google/drive');
    const { precisaCompilarDoc } = await import('@/lib/agents/doc-async');
    const { getDocumentacao, parseJson } = await import('@/integrations/db/client.server');

    const projeto = await projetoComDocPendente(false);

    // O submit pode barrar por outro motivo (projeto sem ganho); o que se afirma é o que NÃO
    // aconteceu no caminho até lá.
    try {
      await submeterParaValidacao({ projeto_id: projeto.id });
    } catch {
      /* bloqueio de negócio — irrelevante aqui */
    }

    expect(vi.mocked(compilarDocumentacao), 'o submit compilou a doc (LLM no caminho crítico)').not.toHaveBeenCalled();
    expect(vi.mocked(upsertResumoDoc), 'o submit gravou o resumo do PLACEHOLDER no Drive').not.toHaveBeenCalled();
    // A doc continua pendente para o cron.
    const row = await getDocumentacao(projeto.id);
    const conteudo = parseJson<Record<string, unknown>>((row as { conteudo: string }).conteudo) ?? {};
    expect(precisaCompilarDoc(conteudo)).toBe(true);
  });
});

describe('D6 — quem fecha a doc é o cron, e é ele que grava o resumo no Drive', () => {
  it('recompilarDocsPendentes compila, grava o resumo no Drive UMA vez e persiste o link em arquivos_links', async () => {
    const { recompilarDocsPendentes } = await import('@/lib/chat.functions');
    const { compilarDocumentacao } = await import('@/lib/agents/doc-compiler');
    const { upsertResumoDoc } = await import('@/lib/google/drive');
    const { getProjetoById, parseJson } = await import('@/integrations/db/client.server');

    const projeto = await projetoComDocPendente(true);
    const r = await recompilarDocsPendentes(10);

    expect(r.recompilados).toBe(1);
    expect(vi.mocked(compilarDocumentacao)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertResumoDoc)).toHaveBeenCalledTimes(1);
    // O markdown gravado é da doc COMPILADA, não do placeholder.
    const md = vi.mocked(upsertResumoDoc).mock.calls[0][1] as string;
    expect(md).toContain('Concilia os lançamentos do dia.');
    expect(md).not.toContain('(não preenchido)');
    const depois = await getProjetoById(projeto.id);
    expect(parseJson<string[]>(depois?.arquivos_links as string)).toEqual(['https://drive.google.com/resumo']);
  });

  it('rascunho (não submetido) com doc pendente: o cron compila mas NÃO grava no Drive nem analisa', async () => {
    const { recompilarDocsPendentes } = await import('@/lib/chat.functions');
    const { upsertResumoDoc } = await import('@/lib/google/drive');
    const { analisarProjeto } = await import('@/lib/agents/analyzer');

    await projetoComDocPendente(false);
    const r = await recompilarDocsPendentes(10);

    expect(r.recompilados).toBe(1);
    expect(vi.mocked(upsertResumoDoc)).not.toHaveBeenCalled();
    expect(vi.mocked(analisarProjeto)).not.toHaveBeenCalled();
  });

  it('Drive falhando no cron não derruba a corrida nem a doc compilada', async () => {
    const { recompilarDocsPendentes, salvarResumoDocNoDrive } = await import('@/lib/chat.functions');
    const { upsertResumoDoc } = await import('@/lib/google/drive');
    const { getProjetoById } = await import('@/integrations/db/client.server');
    vi.mocked(upsertResumoDoc).mockRejectedValue(new Error('Drive 403'));

    const projeto = await projetoComDocPendente(true);
    const r = await recompilarDocsPendentes(10);
    expect(r.recompilados).toBe(1);

    const p = (await getProjetoById(projeto.id))!;
    await expect(salvarResumoDocNoDrive(projeto.id, p, DOC_COMPILADA as never, 'Tecnologia')).resolves.toBeNull();
  });
});
