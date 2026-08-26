// Cliente REST do Pinecone — o índice vetorial oficial dos especiais.
//
// ⚠️ Estes testes vivem em arquivo PRÓPRIO de propósito: o teste da orquestração
// (`pinecone-especiais.test.ts`) mocka o módulo `@/lib/pinecone` inteiro, e `vi.mock` vale para
// o arquivo todo — juntos, o mock engoliria o módulo real que aqui se quer exercitar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── pinecone.ts — cliente REST (fetch mockado) ──────────────────────────────

describe('pinecone.ts', () => {
  const fetchMock = vi.fn();
  const envOriginal = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.PINECONE_API_KEY = 'chave-de-teste';
    delete process.env.PINECONE_INDEX;
    delete process.env.GODOCS_ENV;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...envOriginal };
  });

  function respostaOk(body: unknown) {
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }
  function respostaErro(status: number) {
    return { ok: false, status, json: async () => ({}), text: async () => 'falhou' };
  }
  const INDICE = {
    name: 'godocs-especiais',
    host: 'idx-123.svc.pinecone.io',
    dimension: 3072,
    metric: 'cosine',
    status: { ready: true },
  };

  it('sem PINECONE_API_KEY não há config — o app degrada, não quebra', async () => {
    delete process.env.PINECONE_API_KEY;
    const { pineconeConfig, consultarVizinhos } = await import('@/lib/pinecone');
    expect(pineconeConfig()).toBeNull();
    expect(await consultarVizinhos([1, 2, 3])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('namespace vem do GODOCS_ENV — staging nunca escreve no namespace de prod', async () => {
    const { namespacePinecone } = await import('@/lib/pinecone');
    expect(namespacePinecone()).toBe('prod');
    process.env.GODOCS_ENV = 'staging';
    expect(namespacePinecone()).toBe('staging');
  });

  it('índice com dimensão diferente é REPROVADO em vez de usado', async () => {
    fetchMock.mockResolvedValueOnce(respostaOk({ ...INDICE, dimension: 1536 }));
    const { garantirIndice } = await import('@/lib/pinecone');
    const r = await garantirIndice();
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('1536');
    expect(r.motivo).toContain('IMUTÁVEL');
  });

  it('índice inexistente NÃO é criado sem {criar:true}', async () => {
    fetchMock.mockResolvedValueOnce(respostaErro(404));
    const { garantirIndice } = await import('@/lib/pinecone');
    const r = await garantirIndice();
    expect(r.ok).toBe(false);
    expect(r.criado).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o describe, nenhum POST de criação
  });

  it('com {criar:true} cria serverless 3072/cosine e redescreve', async () => {
    fetchMock
      .mockResolvedValueOnce(respostaErro(404)) // describe: não existe
      .mockResolvedValueOnce(respostaOk({})) // create
      .mockResolvedValueOnce(respostaOk(INDICE)); // describe de novo
    const { garantirIndice, DIMENSAO_INDICE } = await import('@/lib/pinecone');
    const r = await garantirIndice({ criar: true });
    expect(r.ok).toBe(true);
    expect(r.criado).toBe(true);
    const corpo = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(corpo.dimension).toBe(DIMENSAO_INDICE);
    expect(corpo.metric).toBe('cosine');
    expect(corpo.spec.serverless).toBeTruthy();
  });

  it('query devolve null em HTTP ruim (é isso que arma o fallback) e [] quando o índice está vazio', async () => {
    const { consultarVizinhos, limparCachePinecone } = await import('@/lib/pinecone');

    fetchMock.mockResolvedValueOnce(respostaOk(INDICE)).mockResolvedValueOnce(respostaErro(500));
    expect(await consultarVizinhos([1, 2])).toBeNull();

    limparCachePinecone();
    fetchMock.mockResolvedValueOnce(respostaOk(INDICE)).mockResolvedValueOnce(respostaOk({ matches: [] }));
    expect(await consultarVizinhos([1, 2])).toEqual([]);
  });

  it('upsert omite metadata nula e SEMPRE manda tem_nota_humana', async () => {
    fetchMock.mockResolvedValueOnce(respostaOk(INDICE)).mockResolvedValueOnce(respostaOk({}));
    const { upsertVetores } = await import('@/lib/pinecone');
    const r = await upsertVetores([
      {
        id: 'P1',
        vetor: [1, 2, 3],
        metadata: {
          projeto_id: 'P1',
          tem_nota_humana: false,
          estrela_humana: null,
          estrela_recomendada: 2,
          area: null,
          texto_hash: 'h1',
          modelo: 'text-embedding-3-large',
        },
      },
    ]);
    expect(r.ok).toBe(true);
    expect(r.enviados).toBe(1);
    const corpo = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const meta = corpo.vectors[0].metadata;
    expect(meta.tem_nota_humana).toBe(false);
    expect(meta.estrela_recomendada).toBe(2);
    expect('estrela_humana' in meta).toBe(false); // null não vai — o Pinecone não aceita
    expect('area' in meta).toBe(false);
  });

  it('upsert sem índice não lança — só reporta', async () => {
    fetchMock.mockResolvedValueOnce(respostaErro(404));
    const { upsertVetores } = await import('@/lib/pinecone');
    const r = await upsertVetores([
      { id: 'P1', vetor: [1], metadata: { projeto_id: 'P1', tem_nota_humana: true } },
    ]);
    expect(r.ok).toBe(false);
    expect(r.enviados).toBe(0);
  });
});
