// Upload ao Google Drive — mocka auth (token) e fetch (rede).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/google/auth', () => ({ getDriveAccessToken: vi.fn().mockResolvedValue('tok-123') }));

import { uploadFileToDrive, uploadDocsToDrive } from '@/lib/google/drive';

const okResp = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
const errResp = (status: number, text = 'denied') =>
  ({ ok: false, status, json: async () => ({}), text: async () => text }) as Response;

// base64 de "ola" (ASCII) — conteúdo binário qualquer serve.
const B64 = btoa('ola');

describe('upload ao Drive', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uploadFileToDrive retorna o webViewLink em sucesso', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp({ id: 'abc', webViewLink: 'https://drive/abc' }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await uploadFileToDrive({ base64: B64, filename: 'doc.pdf' });
    expect(r).toEqual({ id: 'abc', link: 'https://drive/abc' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/upload/drive/v3/files');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    expect(String(init.headers['Content-Type'])).toContain('multipart/related; boundary=');
    // metadata (nome + pasta) presente no corpo
    const bodyText = await (init.body as Blob).text();
    expect(bodyText).toContain('"name":"doc.pdf"');
    expect(bodyText).toContain('"parents"');
    expect(bodyText).toContain('application/pdf'); // mime inferido da extensão
  });

  it('fallback de link quando a API não retorna webViewLink', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResp({ id: 'xyz' })));
    const r = await uploadFileToDrive({ base64: B64, filename: 'a.txt' });
    expect(r.link).toBe('https://drive.google.com/file/d/xyz/view');
  });

  it('usa o folderId passado em opts (pasta separada, ex.: prints do widget de ajuda)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResp({ id: 'a', webViewLink: 'https://drive/a' }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadFileToDrive({ base64: B64, filename: 'p.png' }, { folderId: 'PASTA_AJUDA' });
    const bodyText = await (fetchMock.mock.calls[0][1].body as Blob).text();
    expect(bodyText).toContain('"parents":["PASTA_AJUDA"]');
  });

  it('uploadFileToDrive propaga erro (403 sem acesso à pasta)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResp(403, 'no access')));
    await expect(uploadFileToDrive({ base64: B64, filename: 'a.pdf' })).rejects.toThrow(/403/);
  });

  it('uploadDocsToDrive retorna só os links que tiveram sucesso (não quebra na falha)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResp({ id: '1', webViewLink: 'https://drive/1' }))
      .mockResolvedValueOnce(errResp(403))
      .mockResolvedValueOnce(okResp({ id: '3', webViewLink: 'https://drive/3' }));
    vi.stubGlobal('fetch', fetchMock);

    const links = await uploadDocsToDrive([
      { base64: B64, filename: 'a.pdf' },
      { base64: B64, filename: 'b.pdf' },
      { base64: B64, filename: 'c.pdf' },
    ]);
    expect(links).toEqual(['https://drive/1', 'https://drive/3']);
  });

  it('uploadDocsToDrive devolve [] quando todos falham (SA sem acesso ainda)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResp(404)));
    const links = await uploadDocsToDrive([{ base64: B64, filename: 'a.pdf' }]);
    expect(links).toEqual([]);
  });
});
