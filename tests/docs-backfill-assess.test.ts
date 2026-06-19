// Avaliação do backfill de docs — mocka os helpers de DB (api_logs + projetos).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/integrations/db/client.server', () => ({
  getIniciarSubmissaoLogs: vi.fn(),
  getProjetosLinkInfo: vi.fn(),
}));

import { getIniciarSubmissaoLogs, getProjetosLinkInfo } from '@/integrations/db/client.server';
import { assessDocsBackfill } from '@/lib/docs-backfill';

const mLogs = getIniciarSubmissaoLogs as unknown as ReturnType<typeof vi.fn>;
const mProj = getProjetosLinkInfo as unknown as ReturnType<typeof vi.fn>;

// Body íntegro (JSON válido) com N docs.
const bodyIntegro = (n: number) =>
  JSON.stringify({ nome_projeto: 'X', docs: Array.from({ length: n }, (_, i) => ({ base64: 'QUJD', filename: `f${i}.pdf` })) });

// Body truncado: 1 doc completo + 1 cortado no meio do base64, + marcador.
const bodyTruncado =
  '{"docs":[{"base64":"QUJDREVG","filename":"a.pdf"},{"base64":"QUJDREVGR0hJSktMTU5P' +
  '\n…[truncado — 999.999 chars]';

// Body truncado sem nenhum base64 completo (cortado já no primeiro).
const bodyPerdido = '{"docs":[{"base64":"QUJDREVGR0hJ\n…[truncado — 999.999 chars]';

beforeEach(() => {
  mLogs.mockReset();
  mProj.mockReset();
});

describe('assessDocsBackfill', () => {
  it('classifica recuperável / parcial / perdido e cruza com arquivos_links', async () => {
    mLogs.mockResolvedValue([
      { id: '1', projeto_id: 'p-ok', request_body: bodyIntegro(2), created_at: '2026-06-18T10:00:00Z' },
      { id: '2', projeto_id: 'p-trunc', request_body: bodyTruncado, created_at: '2026-06-18T11:00:00Z' },
      { id: '3', projeto_id: 'p-perdido', request_body: bodyPerdido, created_at: '2026-06-18T12:00:00Z' },
      { id: '4', projeto_id: 'p-comlink', request_body: bodyIntegro(1), created_at: '2026-06-18T13:00:00Z' },
    ]);
    mProj.mockResolvedValue([
      { id: 'p-ok', nome: 'OK', arquivos_links: null },
      { id: 'p-trunc', nome: 'Trunc', arquivos_links: null },
      { id: 'p-perdido', nome: 'Perdido', arquivos_links: null },
      { id: 'p-comlink', nome: 'ComLink', arquivos_links: '["https://drive/x"]' },
      { id: 'legado-1', nome: 'Legado', arquivos_links: null }, // legado, sem log → ignorado em sem_log
      { id: 'p-semlog', nome: 'SemLog', arquivos_links: null }, // não-legado, sem link, sem log
    ]);

    const r = await assessDocsBackfill();
    expect(r.total_logs).toBe(4);
    expect(r.projetos_com_log).toBe(4);
    expect(r.recuperaveis).toBe(2); // p-ok e p-comlink (json íntegro)
    expect(r.parciais).toBe(1); // p-trunc (1 base64 completo + 1 cortado)
    expect(r.perdidos).toBe(1); // p-perdido
    expect(r.ja_com_link).toBe(1); // p-comlink
    expect(r.projetos_sem_log).toBe(1); // só p-semlog (legado não conta)

    const trunc = r.itens.find((i) => i.projeto_id === 'p-trunc')!;
    expect(trunc.status).toBe('parcial');
    expect(trunc.docs_completos).toBe(1);
  });

  it('escolhe o melhor log por projeto (mais docs completos)', async () => {
    mLogs.mockResolvedValue([
      { id: 'a', projeto_id: 'p1', request_body: bodyPerdido, created_at: '2026-06-18T09:00:00Z' },
      { id: 'b', projeto_id: 'p1', request_body: bodyIntegro(3), created_at: '2026-06-18T08:00:00Z' },
    ]);
    mProj.mockResolvedValue([{ id: 'p1', nome: 'P1', arquivos_links: null }]);

    const r = await assessDocsBackfill();
    expect(r.projetos_com_log).toBe(1);
    expect(r.recuperaveis).toBe(1);
    expect(r.itens[0].docs_completos).toBe(3);
  });

  it('lida com ausência total de logs', async () => {
    mLogs.mockResolvedValue([]);
    mProj.mockResolvedValue([{ id: 'p-semlog', nome: 'X', arquivos_links: null }]);
    const r = await assessDocsBackfill();
    expect(r.total_logs).toBe(0);
    expect(r.projetos_sem_log).toBe(1);
  });
});
