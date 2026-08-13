// Cache SWR das linhas do Sheets de um dono — o que tira a leitura da planilha do
// caminho crítico de `GET /api/meus-projetos`.
//
// Medido em prod (12/08/2026): `/api/meus-projetos` levava ~3 s porque
// `syncOwnerRowsFromSheet` (leitura da planilha inteira) rodava ANTES de qualquer coisa.
// Não dava para mandar ao background: Status / Motivo Reprovado / Motivo Reenvio /
// Atualizado Em saem dessas MESMAS linhas — sem elas a tela abre com "—".
//
// O que estes testes travam:
//  - cache fresco não relê;  vencido devolve o VELHO e revalida em background;
//  - isolate frio bloqueia;  N chamadas concorrentes = UMA leitura (single-flight);
//  - leitura que FALHOU nunca entra no cache (senão o Status de todo mundo some por 60 s);
//  - o cache é POR DONO (o de um usuário jamais responde pelo outro);
//  - invalidar (submissão/descontinuar) faz a próxima chamada reler.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/google/sync-reverse', () => ({
  syncOwnerRowsFromSheet: vi.fn(),
}));

// O fire-and-forget do worker passa por runBackground (ctx.waitUntil). Mockado para o
// teste poder AGUARDAR a promise de background e para a rejeição nunca vazar.
const bg: Promise<unknown>[] = [];
vi.mock('@/lib/background', () => ({
  runBackground: vi.fn((p: Promise<unknown>) => {
    bg.push(Promise.resolve(p).catch(() => undefined));
  }),
}));

import { syncOwnerRowsFromSheet } from '@/lib/google/sync-reverse';
import {
  lerLinhasDoDono,
  invalidarLinhasDoDono,
  _resetCacheMeusProjetos,
  CACHE_TTL_MS,
  STALE_MAX_MS,
} from '@/lib/meus-projetos-cache';

const mockSync = vi.mocked(syncOwnerRowsFromSheet);
const T0 = new Date('2026-08-12T12:00:00.000Z').getTime();
const DONO = 'kaique.breno@gocase.com';

function linha(id: string, status = 'Pendente') {
  return { 'ID Projeto': id, Projeto: `Projeto ${id}`, Email: DONO, Status: status };
}

/** Retorno de sucesso do sync (leitura da planilha respondeu). */
function ok(rows: ReturnType<typeof linha>[]) {
  return {
    total: rows.length,
    criados: 0,
    atualizados: 0,
    removidos: 0,
    ignorados: 0,
    erros: 0,
    detalhes: [],
    rows,
    leituraOk: true,
  } as unknown as Awaited<ReturnType<typeof syncOwnerRowsFromSheet>>;
}

/** Retorno de FALHA de leitura: `rows: []` igualzinho a "usuário sem projeto". */
function falhaDeLeitura() {
  return {
    total: 0,
    criados: 0,
    atualizados: 0,
    removidos: 0,
    ignorados: 0,
    erros: 1,
    detalhes: ['Falha ao ler a planilha: 503'],
    rows: [],
    leituraOk: false,
  } as unknown as Awaited<ReturnType<typeof syncOwnerRowsFromSheet>>;
}

async function drenarBackground() {
  while (bg.length) await bg.shift();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  bg.length = 0;
  mockSync.mockReset();
  _resetCacheMeusProjetos();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cache SWR das linhas do dono', () => {
  it('isolate frio BLOQUEIA e lê de verdade', async () => {
    mockSync.mockResolvedValue(ok([linha('abc')]));

    const r = await lerLinhasDoDono(DONO);

    expect(r.doCache).toBe(false);
    expect(r.rows).toHaveLength(1);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('cache FRESCO não relê a planilha', async () => {
    mockSync.mockResolvedValue(ok([linha('abc')]));
    await lerLinhasDoDono(DONO);

    vi.setSystemTime(T0 + CACHE_TTL_MS - 1);
    const r = await lerLinhasDoDono(DONO);

    expect(r.doCache).toBe(true);
    expect(r.revalidando).toBe(false);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('cache VENCIDO devolve o dado velho na hora e revalida em background', async () => {
    mockSync.mockResolvedValue(ok([linha('abc', 'Pendente')]));
    await lerLinhasDoDono(DONO);

    // A triagem mudou o Status na planilha enquanto isso.
    mockSync.mockResolvedValue(ok([linha('abc', 'Reprovado')]));
    vi.setSystemTime(T0 + CACHE_TTL_MS + 1);

    const r = await lerLinhasDoDono(DONO);
    // Ninguém esperou pela planilha: veio o valor ANTIGO, já revalidando.
    expect(r.doCache).toBe(true);
    expect(r.revalidando).toBe(true);
    expect(r.rows[0].Status).toBe('Pendente');

    await drenarBackground();

    // Depois da revalidação, a chamada seguinte já vê o Status novo — sem bloquear.
    const depois = await lerLinhasDoDono(DONO);
    expect(depois.rows[0].Status).toBe('Reprovado');
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('N chamadas concorrentes disparam UMA leitura (single-flight)', async () => {
    let resolver: (v: unknown) => void = () => {};
    mockSync.mockReturnValue(
      new Promise((res) => {
        resolver = res as (v: unknown) => void;
      }) as ReturnType<typeof syncOwnerRowsFromSheet>,
    );

    const tres = Promise.all([
      lerLinhasDoDono(DONO),
      lerLinhasDoDono(DONO),
      lerLinhasDoDono(DONO),
    ]);
    resolver(ok([linha('abc')]));
    const [a, b, c] = await tres;

    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(a.rows).toEqual(b.rows);
    expect(b.rows).toEqual(c.rows);
  });

  it('leitura que FALHOU não entra no cache — a próxima tenta de novo', async () => {
    mockSync.mockResolvedValue(falhaDeLeitura());
    const r1 = await lerLinhasDoDono(DONO);
    expect(r1.rows).toEqual([]);

    // Sem esta trava, o `[]` da falha ficaria 60 s no cache e a coluna Status de TODO
    // projeto do usuário viraria "—" — parecendo perda de dado, não indisponibilidade.
    mockSync.mockResolvedValue(ok([linha('abc')]));
    const r2 = await lerLinhasDoDono(DONO);

    expect(r2.rows).toHaveLength(1);
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('usuário SEM projeto (leitura ok, zero linhas) é cacheado normalmente', async () => {
    mockSync.mockResolvedValue(ok([]));
    await lerLinhasDoDono(DONO);
    const r = await lerLinhasDoDono(DONO);

    expect(r.doCache).toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('o cache é POR DONO — um usuário nunca responde pelo outro', async () => {
    mockSync.mockResolvedValue(ok([linha('do-kaique')]));
    await lerLinhasDoDono(DONO);

    mockSync.mockResolvedValue(ok([linha('da-helen')]));
    const outra = await lerLinhasDoDono('helen@gocase.com');

    expect(outra.doCache).toBe(false);
    expect(outra.rows[0]['ID Projeto']).toBe('da-helen');
    expect(mockSync).toHaveBeenCalledTimes(2);
  });

  it('e-mail casa sem diferenciar caixa/espaço', async () => {
    mockSync.mockResolvedValue(ok([linha('abc')]));
    await lerLinhasDoDono(DONO);

    const r = await lerLinhasDoDono(`  ${DONO.toUpperCase()} `);
    expect(r.doCache).toBe(true);
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('invalidar (submissão/descontinuar) faz a próxima chamada reler', async () => {
    mockSync.mockResolvedValue(ok([linha('abc')]));
    await lerLinhasDoDono(DONO);

    invalidarLinhasDoDono(DONO);
    mockSync.mockResolvedValue(ok([linha('abc'), linha('novo')]));
    const r = await lerLinhasDoDono(DONO);

    // Projeto recém-submetido não pode ficar com Status "—" esperando o TTL vencer.
    expect(r.doCache).toBe(false);
    expect(r.rows).toHaveLength(2);
  });

  it('sync EM VOO iniciado antes da invalidação não instala snapshot velho', async () => {
    // Cenário real: a lista revalida em background e, no meio, o usuário submete.
    // O snapshot em voo é anterior à submissão — instalá-lo esconderia o projeto novo.
    mockSync.mockResolvedValue(ok([linha('abc')]));
    await lerLinhasDoDono(DONO);

    let resolver: (v: unknown) => void = () => {};
    mockSync.mockReturnValue(
      new Promise((res) => {
        resolver = res as (v: unknown) => void;
      }) as ReturnType<typeof syncOwnerRowsFromSheet>,
    );
    vi.setSystemTime(T0 + CACHE_TTL_MS + 1);
    await lerLinhasDoDono(DONO); // dispara a revalidação em background

    invalidarLinhasDoDono(DONO); // submissão acontece agora
    resolver(ok([linha('abc')])); // o snapshot ANTIGO chega depois
    await drenarBackground();

    mockSync.mockResolvedValue(ok([linha('abc'), linha('novo')]));
    const r = await lerLinhasDoDono(DONO);
    expect(r.rows).toHaveLength(2);
  });

  it('dado velho DEMAIS volta a bloquear em vez de servir eternamente', async () => {
    mockSync.mockResolvedValue(ok([linha('abc', 'Pendente')]));
    await lerLinhasDoDono(DONO);

    // Revalidação falhando há muito tempo: melhor pagar a leitura do que afirmar um
    // Status de horas atrás.
    vi.setSystemTime(T0 + STALE_MAX_MS + 1);
    mockSync.mockResolvedValue(ok([linha('abc', 'Reprovado')]));
    const r = await lerLinhasDoDono(DONO);

    expect(r.doCache).toBe(false);
    expect(r.rows[0].Status).toBe('Reprovado');
  });

  it('e-mail vazio não lê nada nem quebra', async () => {
    const r = await lerLinhasDoDono('   ');
    expect(r.rows).toEqual([]);
    expect(mockSync).not.toHaveBeenCalled();
  });
});
