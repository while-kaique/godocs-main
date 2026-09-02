// Base TeamGuide (F0): paginação (agora no SYNC), fallback de área (D5) e liderança (D7).
//
// ⚠️ REFATORADO p/ o ESPELHO (02/09/2026): as leituras (`getLideresDe`, `deriveAreaFromEmail`,
// `ehLideranca`…) não falam mais com a rede — leem o espelho SQLite. Os testes de LEITURA
// semeiam o espelho direto (`semearEspelhoTeamGuide`) com os MESMOS fixtures. A PAGINAÇÃO de
// membros migrou para o SYNC (`sincronizarTeamGuide`), então o bloco T1 roda o sync contra o
// `fetch` dublado e confere que o espelho recebeu todos os membros, sem girar até o limite.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarDbMemoria } from './helpers/db-memoria';
import { semearEspelhoTeamGuide } from './helpers/teamguide-espelho-fake';
import type { TGTeam, TGMember } from '@/lib/areas/teamguide-derivacao';
import {
  getLideresDe,
  getLideradosDe,
  ehLideranca,
  getCargoDe,
  deriveAreaFromEmail,
  __resetTeamguideSnapshotCache,
} from '@/lib/areas/teamguide.server';

type Time = {
  id: string;
  name: string;
  teamParent: string | null;
  leader: { id: string; name: string } | null;
  deleted?: boolean;
};
type Membro = {
  id: string;
  name: string;
  contactEmail: string;
  teamsIds: string[];
  /** `position` da API — é o que decide a isenção desde a D20. */
  cargo?: string | null;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Semeia o espelho a partir dos fixtures (times/membros): o cargo vira `position` de um ref e
 * os teamsIds vêm do membro — `montarPessoas` une os dois, como o sync faria.
 */
async function semear(times: Time[], membros: Membro[]): Promise<void> {
  const refs = membros.map((m) => ({
    id: m.id,
    name: m.name,
    contactEmail: m.contactEmail,
    position: m.cargo ?? null,
  }));
  await semearEspelhoTeamGuide({
    times: times as unknown as TGTeam[],
    membros: membros as unknown as TGMember[],
    refs,
  });
}

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

/** Conjunto {time + todos os descendentes} (ids comparados como TEXTO). */
function descendentes(raiz: string, times: Time[]): Set<string> {
  const filhos = new Map<string, string[]>();
  for (const t of times) {
    if (t.teamParent == null) continue;
    const pai = String(t.teamParent);
    filhos.set(pai, [...(filhos.get(pai) ?? []), String(t.id)]);
  }
  const vistos = new Set([raiz]);
  const fila = [raiz];
  while (fila.length) {
    const atual = fila.pop() as string;
    for (const f of filhos.get(atual) ?? []) {
      if (!vistos.has(f)) {
        vistos.add(f);
        fila.push(f);
      }
    }
  }
  return vistos;
}

type Chamada = { url: string; timeId: string | null };

/** Dublê fiel da API TeamGuide, para os testes de SYNC. `paginaFixa` = API ignora a paginação. */
function dublarFetch(times: Time[], membros: Membro[], opcoes: { paginaFixa?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const ativos = times.filter((t) => !t.deleted);

  const fn = vi.fn(async (url: string) => {
    const u = new URL(url);
    const alvoMembros = u.pathname.match(/^\/teams\/([^/]+)\/members$/);
    chamadas.push({ url, timeId: alvoMembros ? alvoMembros[1] : null });

    if (u.pathname === '/teams') return json(ativos);

    if (u.pathname === '/employees/refs') {
      // Fiel à API: refs trazem o CARGO (position), não teamsIds — estes vêm dos members.
      return json(
        membros.map((m) => ({
          id: m.id,
          name: m.name,
          contactEmail: m.contactEmail,
          position: m.cargo ?? null,
        })),
      );
    }

    if (alvoMembros) {
      const timeId = alvoMembros[1];
      const soDiretos = u.searchParams.get('directOnly') === 'true';
      const alcance = soDiretos ? new Set([timeId]) : descendentes(timeId, ativos);
      const lista = membros.filter((m) => m.teamsIds.some((t) => alcance.has(String(t))));
      // Teto de 100 no pageSize (a API devolve 100 mesmo se pedirem 1000).
      const tamanho = Math.min(Number(u.searchParams.get('pageSize') ?? '25') || 25, 100);
      // `?page=N` é IGNORADO pela API real → sem pageNumber, é sempre a 1ª página.
      const pagina = opcoes.paginaFixa ? 0 : Number(u.searchParams.get('pageNumber') ?? '0') || 0;
      const inicio = pagina * tamanho;
      return json(
        (opcoes.paginaFixa ? lista.slice(0, tamanho) : lista.slice(inicio, inicio + tamanho)).map(
          (m) => ({ id: m.id, name: m.name, contactEmail: m.contactEmail, teamsIds: m.teamsIds }),
        ),
      );
    }
    return json([]);
  });

  vi.stubGlobal('fetch', fn);
  return { chamadas, fn };
}

const paginasPorTime = (chamadas: Chamada[]) => {
  const mapa = new Map<string, number>();
  for (const c of chamadas) {
    if (!c.timeId) continue;
    mapa.set(c.timeId, (mapa.get(c.timeId) ?? 0) + 1);
  }
  return mapa;
};

// ---------------------------------------------------------------------------
// T1 — Paginação de membros AGORA NO SYNC (pageNumber/pageSize, teto 100)
// ---------------------------------------------------------------------------

const TIMES_PAGINACAO: Time[] = [
  { id: '25419', name: 'Gogroup', teamParent: null, leader: null },
  { id: '43685', name: 'N1', teamParent: '25419', leader: { id: '1', name: 'Rafael Lobo' } },
  { id: '46642', name: 'BIZOPS', teamParent: '43685', leader: { id: '3', name: 'Bruno Bezerra Bluhm' } },
  { id: '50001', name: 'RPA', teamParent: '46642', leader: { id: '20', name: 'Lucas Gonçalves Queiroz' } },
];

const LUCAS: Membro = {
  id: '20',
  name: 'Lucas Gonçalves Queiroz',
  contactEmail: 'lucas.queiroz@gocase.com',
  teamsIds: ['50001'],
};
const BRUNO: Membro = {
  id: '3',
  name: 'Bruno Bezerra Bluhm',
  contactEmail: 'bruno.bezerra@gocase.com',
  teamsIds: ['46642'],
};

/** Gera N liderados dentro do time RPA. */
const gerarEquipe = (n: number): Membro[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Pessoa ${i}`,
    contactEmail: `pessoa${i}@gocase.com`,
    teamsIds: ['50001'],
  }));

describe('paginação de membros no SYNC (T1)', () => {
  beforeEach(async () => {
    process.env.TG_API_TOKEN = 'fake-token';
    await criarDbMemoria();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('encerra o loop quando a API devolve SEMPRE a mesma página (param ignorado)', async () => {
    // A página repetida vem CHEIA (100 = teto do pageSize): parar por "página parcial" não
    // salva ninguém aqui — só parar por "página sem id novo".
    const equipe = gerarEquipe(150);
    const { chamadas } = dublarFetch(TIMES_PAGINACAO, [LUCAS, BRUNO, ...equipe], {
      paginaFixa: true,
    });
    const { sincronizarTeamGuide } = await import('@/lib/teamguide-espelho');
    await sincronizarTeamGuide('manual');
    __resetTeamguideSnapshotCache();

    const liderados = await getLideradosDe('lucas.queiroz@gocase.com');

    // Não duplica ninguém…
    const emails = liderados.map((p) => p.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.length).toBeGreaterThanOrEqual(90);
    expect(emails.length).toBeLessThanOrEqual(100);
    expect(emails).toContain('pessoa0@gocase.com');
    // …e o SYNC para de girar assim que a página não traz id novo (nunca as 20 páginas).
    for (const [timeId, paginas] of paginasPorTime(chamadas)) {
      expect(paginas, `time ${timeId} pediu ${paginas} páginas`).toBeLessThanOrEqual(3);
    }
  });

  it('acumula 2 páginas cheias + a parcial usando pageNumber/pageSize', async () => {
    const equipe = gerarEquipe(230);
    const { chamadas } = dublarFetch(TIMES_PAGINACAO, [LUCAS, BRUNO, ...equipe]);
    const { sincronizarTeamGuide } = await import('@/lib/teamguide-espelho');
    await sincronizarTeamGuide('manual');
    __resetTeamguideSnapshotCache();

    const liderados = await getLideradosDe('lucas.queiroz@gocase.com');

    const emails = liderados.map((p) => p.email.toLowerCase());
    expect(emails.length).toBe(230);
    expect(emails).toContain('pessoa0@gocase.com');
    expect(emails).toContain('pessoa229@gocase.com');
    // O próprio líder não é liderado de si mesmo.
    expect(emails).not.toContain('lucas.queiroz@gocase.com');

    // O SYNC paginou pelos nomes REAIS do parâmetro, respeitando o teto de 100.
    const buscasDeMembros = chamadas.filter((c) => c.timeId);
    expect(buscasDeMembros.length).toBeGreaterThan(0);
    for (const c of buscasDeMembros) {
      const u = new URL(c.url);
      expect(u.searchParams.get('page'), `usou ?page= em ${c.url}`).toBeNull();
      expect(u.searchParams.get('pageNumber')).not.toBeNull();
      expect(Number(u.searchParams.get('pageSize'))).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// T2/T3 — Fallback de área (D5) e resolução por e-mail exato
// ---------------------------------------------------------------------------

const TIMES_AREA: Time[] = [
  { id: 'r', name: 'Gocase', teamParent: null, leader: { id: '1', name: 'Rafael Lobo' } },
  { id: 'tec', name: 'Tecnologia', teamParent: 'r', leader: { id: '2', name: 'Eughenio Dev' } },
  { id: 'bizops', name: 'BizOps', teamParent: 'r', leader: { id: '3', name: 'Bruno Bezerra Bluhm' } },
  { id: 'dados', name: 'Dados', teamParent: 'bizops', leader: { id: '4', name: 'Ricardo Maurique' } },
  { id: 'rpa', name: 'RPA', teamParent: 'bizops', leader: { id: '5', name: 'Lucas Gonçalves Queiroz' } },
  { id: 'g', name: 'Grupo G', teamParent: null, leader: { id: '6', name: 'Guilherme Nobrega' } },
  { id: 'mkt', name: 'MKT | PRODUTO | B2B GOCASE', teamParent: 'g', leader: { id: '12', name: 'Pedro Glycerio' } },
  { id: 'growth', name: 'Growth', teamParent: 'mkt', leader: { id: '7', name: 'Lider Growth' } },
  { id: 'l', name: 'Grupo L', teamParent: null, leader: { id: '8', name: 'Luis Liveri' } },
  { id: 'ops', name: 'Operações', teamParent: 'l', leader: { id: '9', name: 'Rafael Menezes' } },
  { id: 'supply', name: 'Supply Chain', teamParent: 'ops', leader: { id: '10', name: 'Leandro Dias' } },
  { id: 'quindere', name: 'TIME JOAQUIM QUINDERE', teamParent: 'l', leader: { id: '13', name: 'Joaquim Quindere' } },
  { id: 'fiscal', name: 'Fiscal', teamParent: 'quindere', leader: { id: '14', name: 'Aline Montenegro' } },
];

const MEMBROS_AREA: Membro[] = [
  // Já cobertos hoje pela regra de área — NÃO podem mudar.
  { id: 'm1', name: 'João Dados Silva', contactEmail: 'joao.dados@gocase.com', teamsIds: ['dados'] },
  { id: 'm2', name: 'Maria RPA Souza', contactEmail: 'maria.rpa@gocase.com', teamsIds: ['rpa'] },
  { id: 'm3', name: 'Tereza Tec', contactEmail: 'tereza.tec@gocase.com', teamsIds: ['tec'] },
  { id: 'm4', name: 'Gil Growth', contactEmail: 'gil.growth@gocase.com', teamsIds: ['growth'] },
  { id: 'm5', name: 'Sara Supply', contactEmail: 'sara.supply@gocase.com', teamsIds: ['supply'] },
  // Hoje caem no vazio: alocados NO nó guarda-chuva (raiz ou passthrough).
  { id: 'm6', name: 'Rafael Lobo', contactEmail: 'rafael@gocase.com', teamsIds: ['r'] },
  { id: 'm7', name: 'Bruno Bezerra Bluhm', contactEmail: 'bruno.bezerra@gocase.com', teamsIds: ['bizops'] },
  { id: 'm8', name: 'Rafael Menezes', contactEmail: 'rafael.menezes@gocase.com', teamsIds: ['ops'] },
  { id: 'm9', name: 'Joaquim Quindere', contactEmail: 'joaquim.quindere@gocase.com', teamsIds: ['quindere'] },
  { id: 'm10', name: 'Pedro Glycerio', contactEmail: 'pedro.glycerio@gocase.com', teamsIds: ['mkt'] },
  { id: 'm11', name: 'Guilherme Nobrega', contactEmail: 'guilherme.nobrega@gocase.com', teamsIds: ['g'] },
];

describe('deriveAreaFromEmail — fallback de nó guarda-chuva (T2/D5)', () => {
  beforeEach(async () => {
    await criarDbMemoria();
    await semear(TIMES_AREA, MEMBROS_AREA);
  });

  it('quem está num nó passthrough resolve para o NOME DO PRÓPRIO NÓ', async () => {
    expect(await deriveAreaFromEmail('bruno.bezerra@gocase.com')).toBe('BizOps');
    expect(await deriveAreaFromEmail('rafael.menezes@gocase.com')).toBe('Operações');
    expect(await deriveAreaFromEmail('joaquim.quindere@gocase.com')).toBe('TIME JOAQUIM QUINDERE');
    expect(await deriveAreaFromEmail('pedro.glycerio@gocase.com')).toBe('MKT | PRODUTO | B2B GOCASE');
  });

  it('quem está numa raiz de domínio resolve para o NOME DA RAIZ', async () => {
    expect(await deriveAreaFromEmail('rafael@gocase.com')).toBe('Gocase');
    expect(await deriveAreaFromEmail('guilherme.nobrega@gocase.com')).toBe('Grupo G');
  });

  it('quem já resolvia uma área normal NÃO muda', async () => {
    expect(await deriveAreaFromEmail('joao.dados@gocase.com')).toBe('Dados');
    expect(await deriveAreaFromEmail('maria.rpa@gocase.com')).toBe('RPA');
    expect(await deriveAreaFromEmail('tereza.tec@gocase.com')).toBe('Tecnologia');
    expect(await deriveAreaFromEmail('gil.growth@gocase.com')).toBe('Growth');
    expect(await deriveAreaFromEmail('sara.supply@gocase.com')).toBe('Supply Chain');
  });

  it('resolve a área quando os ids da fixture são NÚMERO', async () => {
    const num = new Map(TIMES_AREA.map((t, i) => [t.id, String(100 + i)]));
    const times = TIMES_AREA.map((t) => ({
      ...t,
      id: Number(num.get(t.id)),
      teamParent: t.teamParent == null ? null : Number(num.get(t.teamParent)),
      leader: t.leader ? { ...t.leader, id: Number(t.leader.id) } : null,
    })) as unknown as Time[];
    const membros = MEMBROS_AREA.map((m) => ({
      ...m,
      teamsIds: m.teamsIds.map((t) => Number(num.get(t))),
    })) as unknown as Membro[];

    await criarDbMemoria();
    await semear(times, membros);

    expect(await deriveAreaFromEmail('joao.dados@gocase.com')).toBe('Dados');
    expect(await deriveAreaFromEmail('bruno.bezerra@gocase.com')).toBe('BizOps');
  });

  it('e-mail fora da TeamGuide segue devolvendo null (sem exceção)', async () => {
    expect(await deriveAreaFromEmail('ninguem.aqui@gocase.com')).toBeNull();
  });
});

describe('deriveAreaFromEmail — resolução por e-mail exato (T3)', () => {
  beforeEach(async () => {
    await criarDbMemoria();
    await semear(TIMES_AREA, MEMBROS_AREA);
  });

  it('resolve pelo e-mail EXATO, sem confundir homônimo (nomes iguais, times diferentes)', async () => {
    const homonimos: Membro[] = [
      ...MEMBROS_AREA,
      { id: 'h1', name: 'Ana Silva', contactEmail: 'ana.silva@gocase.com', teamsIds: ['dados'] },
      { id: 'h2', name: 'Ana Silva', contactEmail: 'ana.silva2@gocase.com', teamsIds: ['supply'] },
    ];
    await criarDbMemoria();
    await semear(TIMES_AREA, homonimos);

    expect(await deriveAreaFromEmail('ana.silva@gocase.com')).toBe('Dados');
    expect(await deriveAreaFromEmail('ana.silva2@gocase.com')).toBe('Supply Chain');
  });
});

// ---------------------------------------------------------------------------
// T4 — Liderança (D4/D6/D7)
// ---------------------------------------------------------------------------

const TIMES_LIDERANCA: Time[] = [
  { id: '25419', name: 'Gogroup', teamParent: null, leader: null },
  { id: '43685', name: 'N1', teamParent: '25419', leader: { id: '1', name: 'Rafael Lobo' } },
  { id: '43689', name: 'N1 - LUIS LIVERI', teamParent: '25419', leader: { id: '8', name: 'Luis Liveri' } },
  { id: '46642', name: 'BIZOPS', teamParent: '43685', leader: { id: '3', name: 'Bruno Bezerra Bluhm' } },
  { id: '50001', name: 'RPA', teamParent: '46642', leader: { id: '20', name: 'Lucas Gonçalves Queiroz' } },
  { id: '50004', name: 'GENTE E GESTÃO', teamParent: '43689', leader: { id: '21', name: 'Simony Morais' } },
  { id: '50003', name: 'FACILITIES', teamParent: '50004', leader: { id: '22', name: 'Adyla Martins' } },
  { id: '48320', name: 'TIME JOAQUIM QUINDERE', teamParent: '43689', leader: { id: '23', name: 'Joaquim Quindere' } },
  { id: '50008', name: 'FISCAL', teamParent: '48320', leader: { id: '24', name: 'Aline Montenegro' } },
];

const MEMBROS_LIDERANCA: Membro[] = [
  { id: '1', name: 'Rafael Lobo', contactEmail: 'rafael@gocase.com', teamsIds: ['43685'], cargo: 'CEO' },
  { id: '8', name: 'Luis Liveri', contactEmail: 'luis.liveri@gocase.com', teamsIds: ['43689'] },
  { id: '3', name: 'Bruno Bezerra Bluhm', contactEmail: 'bruno.bezerra@gocase.com', teamsIds: ['46642'], cargo: 'Diretor Executivo' },
  { id: '20', name: 'Lucas Gonçalves Queiroz', contactEmail: 'lucas.queiroz@gocase.com', teamsIds: ['50001'], cargo: 'Coordenador de RPA JR' },
  { id: '30', name: 'Luis Albuquerque', contactEmail: 'luis.albuquerque@gocase.com', teamsIds: ['50001'], cargo: 'Analista de RPA' },
  { id: '21', name: 'Simony Morais', contactEmail: 'simony.morais@gocase.com', teamsIds: ['50004'] },
  { id: '22', name: 'Adyla Martins', contactEmail: 'adyla.martins@gocase.com', teamsIds: ['50003'] },
  { id: '23', name: 'Joaquim Quindere', contactEmail: 'joaquim.quindere@gocase.com', teamsIds: ['48320', '50008'] },
  { id: '24', name: 'Aline Montenegro', contactEmail: 'aline.montenegro@gocase.com', teamsIds: ['50008'] },
];

const porNome = (lista: { nome: string }[]) => lista.map((l) => l.nome).sort();

describe('getLideresDe / getLideradosDe (T4)', () => {
  beforeEach(async () => {
    await criarDbMemoria();
    await semear(TIMES_LIDERANCA, MEMBROS_LIDERANCA);
  });

  it('líder de P = líder do time de P', async () => {
    expect(await getLideresDe('luis.albuquerque@gocase.com')).toEqual([
      { nome: 'Lucas Gonçalves Queiroz', email: 'lucas.queiroz@gocase.com' },
    ]);
  });

  it('é case-insensitive no e-mail', async () => {
    expect(porNome(await getLideresDe('LUIS.ALBUQUERQUE@gocase.com'))).toEqual([
      'Lucas Gonçalves Queiroz',
    ]);
  });

  it('quem É líder do próprio time sobe para o time pai (caso Adyla → Simony)', async () => {
    expect(await getLideresDe('adyla.martins@gocase.com')).toEqual([
      { nome: 'Simony Morais', email: 'simony.morais@gocase.com' },
    ]);
  });

  it('CEO na raiz sem líder devolve lista vazia, sem erro (D6)', async () => {
    await expect(getLideresDe('rafael@gocase.com')).resolves.toEqual([]);
  });

  it('pessoa em 2+ times devolve TODOS os líderes (D4)', async () => {
    // Joaquim lidera o próprio TIME JOAQUIM QUINDERE (→ sobe pro pai, Luis Liveri)
    // e é membro do FISCAL, liderado pela Aline.
    expect(porNome(await getLideresDe('joaquim.quindere@gocase.com'))).toEqual([
      'Aline Montenegro',
      'Luis Liveri',
    ]);
  });

  it('e-mail desconhecido devolve lista vazia (nunca lança)', async () => {
    await expect(getLideresDe('ninguem.aqui@gocase.com')).resolves.toEqual([]);
    await expect(getLideradosDe('ninguem.aqui@gocase.com')).resolves.toEqual([]);
  });

  it('ciclo na árvore de times não trava (termina, sem auto-liderança)', async () => {
    const ciclo: Time[] = [
      { id: 'a', name: 'Time A', teamParent: 'b', leader: { id: '91', name: 'Lider Unico' } },
      { id: 'b', name: 'Time B', teamParent: 'a', leader: { id: '91', name: 'Lider Unico' } },
    ];
    const membrosCiclo: Membro[] = [
      { id: '91', name: 'Lider Unico', contactEmail: 'lider.unico@gocase.com', teamsIds: ['a'] },
      { id: '92', name: 'Zeca Liderado', contactEmail: 'zeca@gocase.com', teamsIds: ['b'] },
    ];
    await criarDbMemoria();
    await semear(ciclo, membrosCiclo);

    // O líder dos dois times é a MESMA pessoa: subir pelo pai dá a volta.
    const dele = await getLideresDe('lider.unico@gocase.com');
    expect(dele.every((l) => l.email !== 'lider.unico@gocase.com')).toBe(true);
    expect(dele).toEqual([]);
    // E quem não é líder continua achando o líder normalmente.
    expect(porNome(await getLideresDe('zeca@gocase.com'))).toEqual(['Lider Unico']);
  }, 5000);

  it('getLideradosDe devolve o outro lado da mesma relação', async () => {
    expect(porNome(await getLideradosDe('lucas.queiroz@gocase.com'))).toEqual(['Luis Albuquerque']);
    expect(porNome(await getLideradosDe('simony.morais@gocase.com'))).toEqual(['Adyla Martins']);
    // Bruno lidera o BIZOPS, então quem responde por ele é o Rafael (N1).
    expect(porNome(await getLideradosDe('rafael@gocase.com'))).toEqual(['Bruno Bezerra Bluhm']);
    expect(porNome(await getLideresDe('bruno.bezerra@gocase.com'))).toEqual(['Rafael Lobo']);
  });

  it('resolve igual quando os ids da fixture são NÚMERO', async () => {
    const timesNum = TIMES_LIDERANCA.map((t) => ({
      ...t,
      id: Number(t.id),
      teamParent: t.teamParent == null ? null : Number(t.teamParent),
      leader: t.leader ? { ...t.leader, id: Number(t.leader.id) } : null,
    })) as unknown as Time[];
    const membrosNum = MEMBROS_LIDERANCA.map((m) => ({
      ...m,
      id: Number(m.id),
      teamsIds: m.teamsIds.map(Number),
    })) as unknown as Membro[];

    await criarDbMemoria();
    await semear(timesNum, membrosNum);

    expect(porNome(await getLideresDe('luis.albuquerque@gocase.com'))).toEqual([
      'Lucas Gonçalves Queiroz',
    ]);
    expect(porNome(await getLideresDe('adyla.martins@gocase.com'))).toEqual(['Simony Morais']);
    expect(await getLideresDe('rafael@gocase.com')).toEqual([]);
    expect(porNome(await getLideradosDe('lucas.queiroz@gocase.com'))).toEqual(['Luis Albuquerque']);
  });

  it('espelho vazio → [] (fail-safe, NÃO lança)', async () => {
    await criarDbMemoria();
    __resetTeamguideSnapshotCache();
    await expect(getLideresDe('luis.albuquerque@gocase.com')).resolves.toEqual([]);
    await expect(getLideradosDe('lucas.queiroz@gocase.com')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D20 — Isenção de pré-aprovação pelo CARGO (coordenador para cima)
// ---------------------------------------------------------------------------

describe('ehLideranca — isenção de pré-aprovação (D20)', () => {
  beforeEach(async () => {
    await criarDbMemoria();
    await semear(TIMES_LIDERANCA, MEMBROS_LIDERANCA);
  });

  it('cargo de coordenador para cima é isento (Lucas, Bruno, CEO)', async () => {
    expect(await ehLideranca('lucas.queiroz@gocase.com')).toBe(true); // Coordenador de RPA JR
    expect(await ehLideranca('bruno.bezerra@gocase.com')).toBe(true); // Diretor Executivo
    expect(await ehLideranca('rafael@gocase.com')).toBe(true); // CEO
  });

  it('cargo de analista NÃO isenta, e quem aprova é o líder DIRETO', async () => {
    expect(await ehLideranca('luis.albuquerque@gocase.com')).toBe(false);
    // …e é o líder DIRETO (Lucas), nunca o líder do líder (Bruno).
    expect(porNome(await getLideresDe('luis.albuquerque@gocase.com'))).toEqual([
      'Lucas Gonçalves Queiroz',
    ]);
  });

  it('LIDERAR UM TIME NÃO ISENTA MAIS — é o cargo que decide (caso Fablícia)', async () => {
    const times: Time[] = [
      ...TIMES_LIDERANCA,
      { id: '50097', name: 'TRANSPORTES E SLA B2C', teamParent: '46642', leader: { id: '41', name: 'Kelly Sousa' } },
      { id: '50096', name: '[TRANSPORTES] TIME FABRICIA LIMA', teamParent: '50097', leader: { id: '42', name: 'Fablicia Lima' } },
    ];
    const membros: Membro[] = [
      ...MEMBROS_LIDERANCA,
      { id: '41', name: 'Kelly Sousa', contactEmail: 'kelly.sousa@gocase.com', teamsIds: ['50097'], cargo: 'Supervisora de Transportes' },
      { id: '42', name: 'Fablicia Lima', contactEmail: 'fablicia.lima@gocase.com', teamsIds: ['50096'], cargo: 'Analista de Logistica PL' },
    ];
    await criarDbMemoria();
    await semear(times, membros);

    expect(await ehLideranca('fablicia.lima@gocase.com')).toBe(false);
    expect(porNome(await getLideresDe('fablicia.lima@gocase.com'))).toEqual(['Kelly Sousa']);
    expect(await ehLideranca('kelly.sousa@gocase.com')).toBe(false);
  });

  it('e-mail vazio, desconhecido ou sem cargo cadastrado NÃO isenta (nunca lança)', async () => {
    const membros: Membro[] = [
      ...MEMBROS_LIDERANCA,
      // Está na base, lidera um time, mas o cargo não foi cadastrado → entra em fila.
      { id: '43', name: 'Sem Cargo', contactEmail: 'sem.cargo@gocase.com', teamsIds: ['50001'] },
    ];
    await criarDbMemoria();
    await semear(TIMES_LIDERANCA, membros);

    expect(await ehLideranca('')).toBe(false);
    expect(await ehLideranca('ninguem.aqui@gocase.com')).toBe(false);
    expect(await ehLideranca('sem.cargo@gocase.com')).toBe(false);
  });

  it('getCargoDe devolve o cargo cru da TeamGuide', async () => {
    expect(await getCargoDe('lucas.queiroz@gocase.com')).toBe('Coordenador de RPA JR');
    expect(await getCargoDe('LUCAS.QUEIROZ@GOCASE.COM')).toBe('Coordenador de RPA JR');
    expect(await getCargoDe('ninguem.aqui@gocase.com')).toBeNull();
    expect(await getCargoDe('')).toBeNull();
  });
});
