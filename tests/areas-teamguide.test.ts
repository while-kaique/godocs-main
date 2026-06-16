// Testa a derivação de áreas da TeamGuide com uma árvore sintética (sem rede).
// Valida a regra v3: filhos L1 da raiz viram área, EXCETO nós passthrough (por
// líder), cujos filhos L2 é que viram área. Dedup por slug, ordenado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveAreasFromTeamGuide, deriveAreaFromEmail } from '@/lib/areas/teamguide.server';

// Árvore mínima: 3 domínios (por líder) + 1 passthrough em cada um para cobrir a regra.
const TEAMS = [
  // Domínio Rafael Lobo
  { id: 'r', name: 'Gocase', teamParent: null, leader: { id: '1', name: 'Rafael Lobo' } },
  { id: 'tec', name: 'Tecnologia', teamParent: 'r', leader: { id: '2', name: 'Eughenio Dev' } },
  { id: 'bizops', name: 'BizOps', teamParent: 'r', leader: { id: '3', name: 'Bruno Bezerra Bluhm' } }, // passthrough
  { id: 'dados', name: 'Dados', teamParent: 'bizops', leader: { id: '4', name: 'Ricardo' } },
  { id: 'rpa', name: 'RPA', teamParent: 'bizops', leader: { id: '5', name: 'Alguém' } },
  // Domínio Guilherme Nobrega
  { id: 'g', name: 'Grupo G', teamParent: null, leader: { id: '6', name: 'Guilherme Nobrega' } },
  { id: 'growth', name: 'Growth', teamParent: 'g', leader: { id: '7', name: 'Lider Growth' } },
  // Domínio Luis Liveri
  { id: 'l', name: 'Grupo L', teamParent: null, leader: { id: '8', name: 'Luis Liveri' } },
  { id: 'ops', name: 'Operações', teamParent: 'l', leader: { id: '9', name: 'Rafael Menezes' } }, // passthrough
  { id: 'supply', name: 'Supply Chain', teamParent: 'ops', leader: { id: '10', name: 'X' } },
  // Time deletado deve ser ignorado
  { id: 'del', name: 'Fantasma', teamParent: 'r', leader: { id: '11', name: 'Y' }, deleted: true },
];

describe('deriveAreasFromTeamGuide', () => {
  beforeEach(() => {
    process.env.TG_API_TOKEN = 'fake-token';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => TEAMS } as Response)));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('aplica a regra passthrough (L1 normal vira área; passthrough usa L2)', async () => {
    const areas = await deriveAreasFromTeamGuide();
    // Tecnologia (L1 normal), Dados+RPA (L2 de BizOps passthrough), Growth (L1),
    // Supply Chain (L2 de Operações passthrough). Os nós passthrough NÃO viram área.
    expect(areas.sort()).toEqual(['Dados', 'Growth', 'RPA', 'Supply Chain', 'Tecnologia']);
    expect(areas).not.toContain('BizOps');
    expect(areas).not.toContain('Operações');
  });

  it('lança erro sem TG_API_TOKEN', async () => {
    delete process.env.TG_API_TOKEN;
    await expect(deriveAreasFromTeamGuide()).rejects.toThrow(/TG_API_TOKEN/);
  });
});

// Membros de teste: cada um aponta para um time da árvore TEAMS acima.
const MEMBERS = [
  { id: 'm1', name: 'João Dados Silva', contactEmail: 'joao.dados@gocase.com', teamsIds: ['dados'] },
  { id: 'm2', name: 'Maria RPA Souza', contactEmail: 'maria.rpa@gocase.com', teamsIds: ['rpa'] },
  // Pessoa cadastrada na própria raiz (fora de qualquer nó-área mapeado).
  { id: 'm3', name: 'Chefe Geral', contactEmail: 'chefe.geral@gocase.com', teamsIds: ['r'] },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

describe('deriveAreaFromEmail', () => {
  beforeEach(() => {
    process.env.TG_API_TOKEN = 'fake-token';
    // Mock que diferencia /teams (árvore) de /members (busca por NOME via ?text=).
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/teams') {
        return { ok: true, json: async () => TEAMS } as Response;
      }
      if (u.pathname.includes('/members')) {
        const text = norm(u.searchParams.get('text') ?? '');
        const page = Number(u.searchParams.get('page') ?? '0');
        // Só a página 0 traz resultados (mimetiza páginas parciais → fim).
        const hits = page === 0 ? MEMBERS.filter((m) => norm(m.name).includes(text)) : [];
        return { ok: true, json: async () => hits } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('resolve a área pelo email (L2 de passthrough)', async () => {
    expect(await deriveAreaFromEmail('joao.dados@gocase.com')).toBe('Dados');
    expect(await deriveAreaFromEmail('maria.rpa@gocase.com')).toBe('RPA');
  });

  it('é case-insensitive no email', async () => {
    expect(await deriveAreaFromEmail('JOAO.DADOS@gocase.com')).toBe('Dados');
  });

  it('retorna null quando o email não está na TeamGuide', async () => {
    expect(await deriveAreaFromEmail('ninguem.aqui@gocase.com')).toBeNull();
  });

  it('retorna null quando a pessoa não cai em nenhum nó-área', async () => {
    expect(await deriveAreaFromEmail('chefe.geral@gocase.com')).toBeNull();
  });

  it('lança erro sem TG_API_TOKEN', async () => {
    delete process.env.TG_API_TOKEN;
    await expect(deriveAreaFromEmail('joao.dados@gocase.com')).rejects.toThrow(/TG_API_TOKEN/);
  });
});
