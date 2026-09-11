import { describe, it, expect, vi, afterEach } from 'vitest';
import { gerarEmbeddingsLote, TENTATIVAS_EMBEDDING } from '@/lib/embeddings';

const cfg = { apiKey: 'sk-teste', modelo: 'text-embedding-3-large' } as never;
const ok = (n: number) => new Response(JSON.stringify({ model: 'text-embedding-3-large', data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [0.1, 0.2, 0.3] })) }), { status: 200 });
const erro = (status: number) => new Response(JSON.stringify({ error: { message: 'The server had an error while processing your request.', type: 'server_error' } }), { status });
const semEspera = async () => {};

afterEach(() => vi.unstubAllGlobals());

describe('embeddings — um soluço da OpenAI não apaga a memória vetorial (11/09/2026)', () => {
  it('⚠️ HTTP 500 transitório é RETENTADO e o lote sai inteiro na 2ª tentativa', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(erro(500)).mockResolvedValueOnce(ok(2));
    vi.stubGlobal('fetch', fetchMock);
    const r = await gerarEmbeddingsLote(['a', 'b'], cfg, { dormir: semEspera });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.every((e) => e && e.dim === 3)).toBe(true);
  });

  it('429 e erro de rede também são retentados', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(erro(429)).mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(ok(1));
    vi.stubGlobal('fetch', fetchMock);
    const r = await gerarEmbeddingsLote(['a'], cfg, { dormir: semEspera });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r[0]?.dim).toBe(3);
  });

  it('esgotadas as tentativas, devolve null para todos (e só então reporta a falha)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(erro(503));
    vi.stubGlobal('fetch', fetchMock);
    const r = await gerarEmbeddingsLote(['a', 'b'], cfg, { dormir: semEspera });
    expect(fetchMock).toHaveBeenCalledTimes(TENTATIVAS_EMBEDDING);
    expect(r).toEqual([null, null]);
  });

  it('⚠️ 4xx (chave morta) NÃO é retentado — repetir não conserta e gastaria à toa', async () => {
    const fetchMock = vi.fn().mockResolvedValue(erro(401));
    vi.stubGlobal('fetch', fetchMock);
    const r = await gerarEmbeddingsLote(['a'], cfg, { dormir: semEspera });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r).toEqual([null]);
  });
});
