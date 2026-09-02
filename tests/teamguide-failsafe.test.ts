// RED: as leituras da TeamGuide passam a ler do ESPELHO e NUNCA lançam — com o espelho
// vazio e a TeamGuide indisponível (sem TG_API_TOKEN), devolvem o default seguro.
//
// ⚠️ Hoje essas funções LANÇAM sem TG_API_TOKEN (chamam a API direto). Este teste encoda
// o COMPORTAMENTO NOVO (fail-safe sobre o espelho) — deve falhar até a migração.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarDbMemoria } from './helpers/db-memoria';

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

// Árvore/refs mínimos para o caminho FELIZ (após popular o espelho).
const TIMES = [
  { id: 25419, name: 'Gogroup', teamParent: null, leader: null },
  { id: 46642, name: 'BIZOPS', teamParent: 25419, leader: { id: 3, name: 'Bruno Bezerra Bluhm' } },
  { id: 50001, name: 'RPA', teamParent: 46642, leader: { id: 20, name: 'Lucas Gonçalves Queiroz' } },
];
const REFS = [
  { id: 20, name: 'Lucas Gonçalves Queiroz', contactEmail: 'lucas.queiroz@gocase.com', position: 'Coordenador de RPA JR', teamsIds: [50001] },
  { id: 30, name: 'Luis Albuquerque', contactEmail: 'luis.albuquerque@gocase.com', position: 'Analista de RPA', teamsIds: [50001] },
];

function dublarFetch() {
  const fn = vi.fn(async (url: string) => {
    const u = new URL(url, 'https://api.teamguide.app');
    if (u.pathname === '/teams') return json(TIMES);
    if (u.pathname.startsWith('/employees/refs'))
      return json(REFS.map((r) => ({ id: r.id, name: r.name, contactEmail: r.contactEmail, position: r.position })));
    const m = u.pathname.match(/^\/teams\/([^/]+)\/members$/);
    if (m) {
      const membros = REFS.filter((r) => r.teamsIds.some((t) => String(t) === m[1]));
      const pagina = Number(u.searchParams.get('pageNumber') ?? '0') || 0;
      return json(pagina === 0 ? membros.map((r) => ({ id: r.id, name: r.name, contactEmail: r.contactEmail })) : []);
    }
    return json([]);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('teamguide.server — FAIL-SAFE com espelho vazio e TeamGuide fora', () => {
  beforeEach(async () => {
    vi.resetModules();
    await criarDbMemoria();
    delete process.env.TG_API_TOKEN; // TeamGuide indisponível
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('getCargoDe → null (não lança)', async () => {
    const { getCargoDe } = await import('@/lib/areas/teamguide.server');
    await expect(getCargoDe('alguem@gocase.com')).resolves.toBeNull();
  });

  it('ehLideranca → false (não lança)', async () => {
    const { ehLideranca } = await import('@/lib/areas/teamguide.server');
    await expect(ehLideranca('alguem@gocase.com')).resolves.toBe(false);
  });

  it('deriveAreaFromEmail → null (não lança)', async () => {
    const { deriveAreaFromEmail } = await import('@/lib/areas/teamguide.server');
    await expect(deriveAreaFromEmail('alguem@gocase.com')).resolves.toBeNull();
  });

  it('deriveAreasFromTeamGuide → [] (não lança)', async () => {
    const { deriveAreasFromTeamGuide } = await import('@/lib/areas/teamguide.server');
    await expect(deriveAreasFromTeamGuide()).resolves.toEqual([]);
  });

  it('listarPessoasTeamGuide → [] (não lança)', async () => {
    const { listarPessoasTeamGuide } = await import('@/lib/areas/teamguide.server');
    await expect(listarPessoasTeamGuide()).resolves.toEqual([]);
  });

  it('getLideresDe → [] (não lança)', async () => {
    const { getLideresDe } = await import('@/lib/areas/teamguide.server');
    await expect(getLideresDe('alguem@gocase.com')).resolves.toEqual([]);
  });

  it('getLideradosDe → [] (não lança)', async () => {
    const { getLideradosDe } = await import('@/lib/areas/teamguide.server');
    await expect(getLideradosDe('alguem@gocase.com')).resolves.toEqual([]);
  });

  it('getNomeDe → null (não lança)', async () => {
    const { getNomeDe } = await import('@/lib/areas/teamguide.server');
    await expect(getNomeDe('alguem@gocase.com')).resolves.toBeNull();
  });
});

describe('teamguide.server — caminho FELIZ lê do espelho após sincronizar', () => {
  beforeEach(async () => {
    vi.resetModules();
    await criarDbMemoria();
    process.env.TG_API_TOKEN = 'fake-token';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('getCargoDe / listarPessoasTeamGuide / getNomeDe respondem do espelho populado', async () => {
    dublarFetch();
    const { sincronizarTeamGuide } = await import('@/lib/teamguide-espelho');
    await sincronizarTeamGuide('manual');

    const { getCargoDe, getNomeDe, listarPessoasTeamGuide } = await import(
      '@/lib/areas/teamguide.server'
    );

    expect(await getCargoDe('lucas.queiroz@gocase.com')).toBe('Coordenador de RPA JR');
    expect(await getNomeDe('lucas.queiroz@gocase.com')).toBe('Lucas Gonçalves Queiroz');

    const pessoas = await listarPessoasTeamGuide();
    expect(pessoas.map((p) => p.email)).toContain('luis.albuquerque@gocase.com');
  });
});
