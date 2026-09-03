// Testa a derivação de áreas da TeamGuide com uma árvore sintética (sem rede).
// Valida a regra v3: filhos L1 da raiz viram área, EXCETO nós passthrough (por
// líder), cujos filhos L2 é que viram área. Dedup por slug, ordenado.
import { describe, it, expect, beforeEach } from 'vitest';
import { deriveAreasFromTeamGuide, deriveAreaFromEmail } from '@/lib/areas/teamguide.server';
import { criarDbMemoria } from './helpers/db-memoria';
import { semearEspelhoTeamGuide } from './helpers/teamguide-espelho-fake';

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
  beforeEach(async () => {
    await criarDbMemoria();
    await semearEspelhoTeamGuide({ times: TEAMS });
  });

  it('aplica a regra passthrough (L1 normal vira área; passthrough usa L2)', async () => {
    const areas = await deriveAreasFromTeamGuide();
    // Tecnologia (L1 normal), Dados+RPA (L2 de BizOps passthrough), Growth (L1),
    // Supply Chain (L2 de Operações passthrough). Os nós passthrough NÃO viram área.
    expect(areas.sort()).toEqual(['Dados', 'Growth', 'RPA', 'Supply Chain', 'Tecnologia']);
    expect(areas).not.toContain('BizOps');
    expect(areas).not.toContain('Operações');
  });

  it('espelho vazio → [] (fail-safe, NÃO lança)', async () => {
    await criarDbMemoria();
    const { __resetTeamguideSnapshotCache } = await import('@/lib/areas/teamguide.server');
    __resetTeamguideSnapshotCache();
    await expect(deriveAreasFromTeamGuide()).resolves.toEqual([]);
  });
});

// Membros de teste: cada um aponta para um time da árvore TEAMS acima.
const MEMBERS = [
  { id: 'm1', name: 'João Dados Silva', contactEmail: 'joao.dados@gocase.com', teamsIds: ['dados'] },
  { id: 'm2', name: 'Maria RPA Souza', contactEmail: 'maria.rpa@gocase.com', teamsIds: ['rpa'] },
  // Pessoa cadastrada na própria raiz (fora de qualquer nó-área mapeado).
  { id: 'm3', name: 'Chefe Geral', contactEmail: 'chefe.geral@gocase.com', teamsIds: ['r'] },
];

describe('deriveAreaFromEmail', () => {
  beforeEach(async () => {
    await criarDbMemoria();
    await semearEspelhoTeamGuide({ times: TEAMS, membros: MEMBERS });
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

  // D5: quem está alocado NO nó guarda-chuva (raiz/passthrough) resolve para o
  // nome do próprio nó, em vez de cair no vazio ("ÁREA NÃO IDENTIFICADA").
  it('usa o nome do próprio nó quando a pessoa está na raiz/passthrough', async () => {
    expect(await deriveAreaFromEmail('chefe.geral@gocase.com')).toBe('Gocase');
  });

  it('espelho vazio → null (fail-safe, NÃO lança)', async () => {
    await criarDbMemoria();
    const { __resetTeamguideSnapshotCache } = await import('@/lib/areas/teamguide.server');
    __resetTeamguideSnapshotCache();
    await expect(deriveAreaFromEmail('joao.dados@gocase.com')).resolves.toBeNull();
  });
});
