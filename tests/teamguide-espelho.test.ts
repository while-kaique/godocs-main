// RED: espelho da TeamGuide no SQLite + sync fail-safe. Módulo `@/lib/teamguide-espelho`
// ainda não existe. Banco de VERDADE (better-sqlite3 em memória); só a rede é mockada.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';

type Time = {
  id: string | number;
  name: string;
  teamParent: string | number | null;
  leader: { id: string | number; name: string } | null;
  deleted?: boolean;
};
type Ref = {
  id: string | number;
  name: string;
  contactEmail: string | null;
  position: string | null;
  teamsIds: (string | number)[];
};

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

// Árvore mínima com ids NUMÉRICOS (a API real devolve número; o espelho deve normalizar p/ string).
const TIMES: Time[] = [
  { id: 25419, name: 'Gogroup', teamParent: null, leader: null },
  { id: 46642, name: 'BIZOPS', teamParent: 25419, leader: { id: 3, name: 'Bruno Bezerra Bluhm' } },
  { id: 50001, name: 'RPA', teamParent: 46642, leader: { id: 20, name: 'Lucas Gonçalves Queiroz' } },
];

const REFS: Ref[] = [
  {
    id: 20,
    name: 'Lucas Gonçalves Queiroz',
    contactEmail: 'LUCAS.QUEIROZ@GOCASE.COM', // maiúsculo de propósito: espelho grava minúsculo
    position: 'Coordenador de RPA JR',
    teamsIds: [50001],
  },
  {
    id: 30,
    name: 'Luis Albuquerque',
    contactEmail: 'luis.albuquerque@gocase.com',
    position: 'Analista de RPA',
    teamsIds: [50001],
  },
];

/** Dublê fiel: /teams, /employees/refs, /teams/{id}/members (paginação que termina). */
function dublarFetch(times = TIMES, refs = REFS) {
  const fn = vi.fn(async (url: string) => {
    const u = new URL(url, 'https://api.teamguide.app');
    if (u.pathname === '/teams') return json(times.filter((t) => !t.deleted));

    if (u.pathname.startsWith('/employees/refs')) {
      return json(
        refs.map((r) => ({
          id: r.id,
          name: r.name,
          contactEmail: r.contactEmail,
          position: r.position,
        })),
      );
    }

    const m = u.pathname.match(/^\/teams\/([^/]+)\/members$/);
    if (m) {
      const timeId = m[1];
      // Fiel à API real: directOnly=false devolve a SUBÁRVORE do time, e o membro carrega os
      // próprios teamsIds (é de lá que a derivação tira área/liderança).
      const recursivo = u.searchParams.get('directOnly') !== 'true';
      const subarvore = new Set<string>([timeId]);
      for (let mudou = true; mudou; ) {
        mudou = false;
        for (const t of times) {
          if (t.teamParent != null && subarvore.has(String(t.teamParent)) && !subarvore.has(String(t.id))) {
            subarvore.add(String(t.id));
            mudou = true;
          }
        }
      }
      const membros = refs.filter((r) =>
        r.teamsIds.some((t) => (recursivo ? subarvore.has(String(t)) : String(t) === timeId)),
      );
      // A 1ª página traz todos; páginas seguintes vazias (loop termina).
      const pagina = Number(u.searchParams.get('pageNumber') ?? '0') || 0;
      return json(
        pagina === 0
          ? membros.map((r) => ({
              id: r.id,
              name: r.name,
              contactEmail: r.contactEmail,
              teamsIds: r.teamsIds,
            }))
          : [],
      );
    }
    return json([]);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

let db: BetterSqlite3.Database;

describe('teamguide-espelho — sincronizar e ler', () => {
  beforeEach(async () => {
    process.env.TG_API_TOKEN = 'fake-token';
    db = await criarDbMemoria();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('espelho vazio (nunca sincronizou) devolve [] sem lançar', async () => {
    const { lerEspelhoTimes, lerEspelhoPessoas } = await import('@/lib/teamguide-espelho');
    await expect(lerEspelhoTimes()).resolves.toEqual([]);
    await expect(lerEspelhoPessoas()).resolves.toEqual([]);
  });

  it('sync manual popula o espelho com times e pessoas normalizados', async () => {
    dublarFetch();
    const { sincronizarTeamGuide, lerEspelhoTimes, lerEspelhoPessoas } = await import(
      '@/lib/teamguide-espelho'
    );

    const res = await sincronizarTeamGuide('manual');
    expect(res.ok).toBe(true);
    expect(res.times).toBeGreaterThan(0);
    expect(res.pessoas).toBeGreaterThan(0);

    const times = await lerEspelhoTimes();
    const rpa = times.find((t) => t.name === 'RPA');
    expect(rpa).toBeDefined();
    // ⚠️ ids em STRING mesmo com a API devolvendo número.
    expect(rpa!.id).toBe('50001');
    expect(rpa!.teamParent).toBe('46642');
    expect(typeof rpa!.id).toBe('string');

    const pessoas = await lerEspelhoPessoas();
    const lucas = pessoas.find((p) => p.nome === 'Lucas Gonçalves Queiroz');
    expect(lucas).toBeDefined();
    // e-mail minúsculo, cargo do `position`, teamsIds string[] vindos dos members.
    expect(lucas!.email).toBe('lucas.queiroz@gocase.com');
    expect(lucas!.cargo).toBe('Coordenador de RPA JR');
    expect(lucas!.teamsIds).toContain('50001');
    expect(lucas!.teamsIds.every((t) => typeof t === 'string')).toBe(true);
  });

  it('falha do fetch NÃO apaga o espelho já populado (ok:false, dados anteriores preservados)', async () => {
    dublarFetch();
    const { sincronizarTeamGuide, lerEspelhoTimes, lerEspelhoPessoas } = await import(
      '@/lib/teamguide-espelho'
    );
    await sincronizarTeamGuide('manual');
    expect((await lerEspelhoTimes()).length).toBeGreaterThan(0);

    // Agora a rede cai: o sync deve devolver ok:false SEM lançar e SEM zerar o espelho.
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNRESET');
    }));
    const res = await sincronizarTeamGuide('manual');
    expect(res.ok).toBe(false);

    expect((await lerEspelhoTimes()).length).toBeGreaterThan(0);
    expect((await lerEspelhoPessoas()).length).toBeGreaterThan(0);
  });

  it('sem TG_API_TOKEN o sync devolve ok:false e preserva o espelho anterior', async () => {
    dublarFetch();
    const { sincronizarTeamGuide, lerEspelhoPessoas } = await import('@/lib/teamguide-espelho');
    await sincronizarTeamGuide('manual');
    const antes = await lerEspelhoPessoas();
    expect(antes.length).toBeGreaterThan(0);

    delete process.env.TG_API_TOKEN;
    const res = await sincronizarTeamGuide('manual');
    expect(res.ok).toBe(false);
    expect((await lerEspelhoPessoas()).length).toBe(antes.length);
  });

  it('hash-skip: 2 syncs idênticos não reescrevem a linha do espelho (atualizado_em intacto)', async () => {
    dublarFetch();
    const { sincronizarTeamGuide } = await import('@/lib/teamguide-espelho');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
      const r1 = await sincronizarTeamGuide('manual');
      expect(r1.ok).toBe(true);
      const ts1 = (
        db.prepare("SELECT atualizado_em FROM teamguide_espelho WHERE chave='pessoas'").get() as
          | { atualizado_em: number }
          | undefined
      )?.atualizado_em;
      expect(ts1).toBeDefined();

      // Relógio avança, mas os dados são os MESMOS → o hash bate → não reescreve.
      vi.setSystemTime(new Date('2026-09-02T10:30:00Z'));
      const r2 = await sincronizarTeamGuide('manual');
      expect(r2.ok).toBe(true);
      const ts2 = (
        db.prepare("SELECT atualizado_em FROM teamguide_espelho WHERE chave='pessoas'").get() as
          | { atualizado_em: number }
          | undefined
      )?.atualizado_em;

      expect(ts2).toBe(ts1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('statusTeamGuideEspelho — saúde do espelho (Critério 5)', () => {
  beforeEach(async () => {
    process.env.TG_API_TOKEN = 'fake-token';
    db = await criarDbMemoria();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
  });

  it('espelho nunca sincronizado → idade nula, sem última corrida', async () => {
    const { statusTeamGuideEspelho } = await import('@/lib/teamguide-espelho');
    const s = await statusTeamGuideEspelho();
    expect(s.ultimoSyncOkMs).toBeNull();
    expect(s.idadeMs).toBeNull();
    expect(s.ultimaFalhou).toBe(false);
    expect(s.pessoas).toBe(0);
    expect(s.times).toBe(0);
    expect(s.ultimaRun).toBeNull();
  });

  it('após um sync OK → idade calculada, contadores e última corrida', async () => {
    dublarFetch();
    const { sincronizarTeamGuide, statusTeamGuideEspelho } = await import('@/lib/teamguide-espelho');
    await sincronizarTeamGuide('manual');

    const s = await statusTeamGuideEspelho();
    expect(s.ultimoSyncOkMs).not.toBeNull(); // isoParaMs parseou o iniciado_em
    expect(s.idadeMs).not.toBeNull();
    expect(s.idadeMs!).toBeGreaterThanOrEqual(0);
    expect(s.pessoas).toBeGreaterThan(0);
    expect(s.times).toBeGreaterThan(0);
    expect(s.ultimaFalhou).toBe(false);
    expect(s.ultimaRun?.ok).toBe(true);
    expect(s.ultimaRun?.gatilho).toBe('manual');
  });

  it('sync OK e depois FALHO → ultimaFalhou=true, mas idade vem do último OK', async () => {
    dublarFetch();
    const { sincronizarTeamGuide, statusTeamGuideEspelho } = await import('@/lib/teamguide-espelho');
    await sincronizarTeamGuide('manual');

    delete process.env.TG_API_TOKEN; // próximo sync falha
    const falho = await sincronizarTeamGuide('manual');
    expect(falho.ok).toBe(false);

    const s = await statusTeamGuideEspelho();
    expect(s.ultimaFalhou).toBe(true); // a última corrida falhou
    expect(s.ultimoSyncOkMs).not.toBeNull(); // …mas a idade ainda sai do último OK
    expect(s.idadeMs).not.toBeNull();
    expect(s.ultimaRun?.ok).toBe(false);
  });
});

describe('sincronizarTeamGuide — falha dispara alerta (Critério 3, fiação)', () => {
  beforeEach(async () => {
    await criarDbMemoria();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TG_API_TOKEN;
    delete process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
  });

  it('sync falho com webhook de Ajuda setado registra o alerta teamguide-sync', async () => {
    process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA = 'https://chat.example/hook';
    // Sem TG_API_TOKEN → getToken lança → catch do sync → alertarErroIntegracao.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    const { sincronizarTeamGuide } = await import('@/lib/teamguide-espelho');
    const { getAlertaEstado } = await import('@/integrations/db/client.server');

    const res = await sincronizarTeamGuide('cron');
    expect(res.ok).toBe(false);

    const estado = await getAlertaEstado('teamguide-sync');
    expect(estado).toBeDefined();
    expect(estado!.ultimo_em).not.toBeNull();
  });
});
