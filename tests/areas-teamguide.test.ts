// Testa a derivação de áreas da TeamGuide com uma árvore sintética (sem rede).
// Valida a regra v3: filhos L1 da raiz viram área, EXCETO nós passthrough (por
// líder), cujos filhos L2 é que viram área. Dedup por slug, ordenado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deriveAreasFromTeamGuide } from '@/lib/areas/teamguide.server';

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
