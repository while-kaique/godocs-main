// T21 — Memória e LOG dos agentes em ÁRVORE (plano `regua-estrelas-e-time-unificado.md`, §11.3).
//
// O que este arquivo PRENDE:
//  (a) o módulo PURO `src/lib/agentes-log.ts` — validação de um nó (quem pode ser raiz, pai do
//      mesmo ciclo), materialização do `caminho` (prefixo consultável por LIKE), profundidade,
//      montagem da árvore a partir da lista plana e o resumo agregado de um ciclo;
//  (b) o módulo server `src/lib/agentes-log.functions.ts` — `registrarNoAgente`/`abrirCiclo`
//      NUNCA lançam (log não pode derrubar a avaliação que já aconteceu — mesma régua do
//      `registrarAtividade`), nó inválido não chega ao banco e é CONTADO, raiz não consulta o pai,
//      e a listagem é keyset (pede limit+1, corta em limit, cursor só quando sobrou).
//
// Por quê: o log em árvore é o que permite reconstruir "quem chamou quem" numa avaliação e
// auditar custo/veredito por ciclo; se o caminho nascer errado, a subárvore fica inalcançável.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------------------
// Mock do client de banco (o módulo `.functions.ts` importa daqui) — nunca toca SQLite real.
// ---------------------------------------------------------------------------------------
const insertAvaliacaoCiclo = vi.fn(async (_reg: unknown) => undefined);
const updateAvaliacaoCiclo = vi.fn(async (_id: string, _patch: unknown): Promise<number | null> => 1);
const insertAgenteLog = vi.fn(async (_reg: unknown) => undefined);
const getAgenteLogNo = vi.fn(
  async (_id: string): Promise<{ id: string; ciclo_id: string; caminho: string; profundidade: number } | undefined> =>
    undefined,
);
const queryAgenteLogPorCiclo = vi.fn(async (_cicloId: string, _projetoId?: string) => [] as unknown[]);
const queryAgenteLog = vi.fn(async (_filtros: unknown) => [] as unknown[]);
const queryAvaliacaoCiclos = vi.fn(async (_filtros: unknown) => [] as unknown[]);

vi.mock('@/integrations/db/client.server', () => ({
  insertAvaliacaoCiclo: (...a: unknown[]) => insertAvaliacaoCiclo(...(a as [unknown])),
  updateAvaliacaoCiclo: (...a: unknown[]) => updateAvaliacaoCiclo(...(a as [string, unknown])),
  insertAgenteLog: (...a: unknown[]) => insertAgenteLog(...(a as [unknown])),
  getAgenteLogNo: (...a: unknown[]) => getAgenteLogNo(...(a as [string])),
  queryAgenteLogPorCiclo: (...a: unknown[]) => queryAgenteLogPorCiclo(...(a as [string, string?])),
  queryAgenteLog: (...a: unknown[]) => queryAgenteLog(...(a as [unknown])),
  queryAvaliacaoCiclos: (...a: unknown[]) => queryAvaliacaoCiclos(...(a as [unknown])),
}));

import {
  validarNo,
  montarCaminho,
  profundidadeDe,
  prefixoSubarvore,
  montarArvore,
  resumirCiclo,
  type NoAgente,
  type NoAgenteEntrada,
  type PaiResumo,
} from '@/lib/agentes-log';

import {
  abrirCiclo,
  fecharCiclo,
  registrarNoAgente,
  recusasRegistroAgente,
  lerArvore,
  listarCiclos,
  listarLog,
} from '@/lib/agentes-log.functions';

// ---------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------
function entrada(over: Partial<NoAgenteEntrada> = {}): NoAgenteEntrada {
  return {
    ciclo_id: 'C1',
    pai_id: 'raiz',
    projeto_id: 'P1',
    agente: 'cerebroA',
    tipo: 'cerebro',
    ...over,
  };
}

function no(over: Partial<NoAgente> & { id: string }): NoAgente {
  return {
    ciclo_id: 'C1',
    pai_id: null,
    projeto_id: 'P1',
    agente: 'orq',
    tipo: 'orquestrador',
    caminho: `C1/orq:${over.id}`,
    profundidade: 0,
    created_at: '2026-09-02 10:00:00',
    ...over,
  };
}

const paiRaiz: PaiResumo = { id: 'raiz', ciclo_id: 'C1', caminho: 'C1/orq:raiz', profundidade: 0 };

beforeEach(() => {
  insertAvaliacaoCiclo.mockReset().mockResolvedValue(undefined);
  updateAvaliacaoCiclo.mockReset().mockResolvedValue(1);
  insertAgenteLog.mockReset().mockResolvedValue(undefined);
  getAgenteLogNo.mockReset().mockResolvedValue(undefined);
  queryAgenteLogPorCiclo.mockReset().mockResolvedValue([]);
  queryAgenteLog.mockReset().mockResolvedValue([]);
  queryAvaliacaoCiclos.mockReset().mockResolvedValue([]);
});

// =======================================================================================
// (a) MÓDULO PURO
// =======================================================================================
describe('validarNo — quem pode entrar no log', () => {
  it('recusa ciclo_id vazio com motivo "ciclo_ausente"', () => {
    expect(validarNo(entrada({ ciclo_id: '' }), paiRaiz)).toEqual({ ok: false, motivo: 'ciclo_ausente' });
  });

  it('recusa projeto_id vazio com motivo "projeto_ausente"', () => {
    expect(validarNo(entrada({ projeto_id: '' }), paiRaiz)).toEqual({ ok: false, motivo: 'projeto_ausente' });
  });

  it('recusa agente vazio com motivo "agente_ausente"', () => {
    expect(validarNo(entrada({ agente: '' }), paiRaiz)).toEqual({ ok: false, motivo: 'agente_ausente' });
  });

  it('só o orquestrador pode ser raiz (pai_id null)', () => {
    expect(validarNo(entrada({ tipo: 'orquestrador', agente: 'orq', pai_id: null }), null)).toEqual({ ok: true });
  });

  it.each(['cerebro', 'especialista', 'cetico', 'consenso', 'tool', 'debate'] as const)(
    'tipo "%s" sem pai → "sem_pai"',
    (tipo) => {
      expect(validarNo(entrada({ tipo, pai_id: null }), null)).toEqual({ ok: false, motivo: 'sem_pai' });
    },
  );

  it('pai_id informado mas o pai não existe no banco → "pai_inexistente"', () => {
    expect(validarNo(entrada({ pai_id: 'fantasma' }), null)).toEqual({ ok: false, motivo: 'pai_inexistente' });
  });

  it('pai de OUTRO ciclo → "pai_de_outro_ciclo" (a árvore não cruza ciclos)', () => {
    const paiDeOutro: PaiResumo = { ...paiRaiz, ciclo_id: 'C2' };
    expect(validarNo(entrada({ ciclo_id: 'C1' }), paiDeOutro)).toEqual({ ok: false, motivo: 'pai_de_outro_ciclo' });
  });

  it('nó completo com pai do mesmo ciclo → ok', () => {
    expect(validarNo(entrada(), paiRaiz)).toEqual({ ok: true });
  });
});

describe('montarCaminho / profundidadeDe / prefixoSubarvore', () => {
  it('raiz: "<cicloId>/<agente>:<id>"', () => {
    expect(montarCaminho(null, 'C1', 'orq', 'a')).toBe('C1/orq:a');
  });

  it('filho: "<pai.caminho>/<agente>:<id>"', () => {
    expect(montarCaminho(paiRaiz, 'C1', 'cerebroA', 'b')).toBe('C1/orq:raiz/cerebroA:b');
  });

  it('neto encadeia a partir do caminho do pai, não do ciclo', () => {
    const paiFilho: PaiResumo = { id: 'b', ciclo_id: 'C1', caminho: 'C1/orq:raiz/cerebroA:b', profundidade: 1 };
    expect(montarCaminho(paiFilho, 'C1', 'tool', 'c')).toBe('C1/orq:raiz/cerebroA:b/tool:c');
  });

  it('profundidade: raiz 0, filho = pai + 1', () => {
    expect(profundidadeDe(null)).toBe(0);
    expect(profundidadeDe(paiRaiz)).toBe(1);
    expect(profundidadeDe({ ...paiRaiz, profundidade: 4 })).toBe(5);
  });

  it('prefixoSubarvore devolve o padrão LIKE da subárvore ("caminho/%")', () => {
    expect(prefixoSubarvore('C1/orq:a')).toBe('C1/orq:a/%');
  });
});

describe('montarArvore — lista plana → raízes com filhos aninhados', () => {
  it('lista vazia → []', () => {
    expect(montarArvore([])).toEqual([]);
  });

  it('aninha filho e neto sob a raiz; nenhum nó aparece em dois lugares', () => {
    const raiz = no({ id: 'a' });
    const filho = no({
      id: 'b',
      pai_id: 'a',
      agente: 'cerebroA',
      tipo: 'cerebro',
      caminho: 'C1/orq:a/cerebroA:b',
      profundidade: 1,
      created_at: '2026-09-02 10:00:01',
    });
    const neto = no({
      id: 'c',
      pai_id: 'b',
      agente: 'tool',
      tipo: 'tool',
      caminho: 'C1/orq:a/cerebroA:b/tool:c',
      profundidade: 2,
      created_at: '2026-09-02 10:00:02',
    });
    // Ordem embaralhada de propósito: a árvore não pode depender da ordem da lista.
    const arvore = montarArvore([neto, raiz, filho]);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].no.id).toBe('a');
    expect(arvore[0].filhos).toHaveLength(1);
    expect(arvore[0].filhos[0].no.id).toBe('b');
    expect(arvore[0].filhos[0].filhos).toHaveLength(1);
    expect(arvore[0].filhos[0].filhos[0].no.id).toBe('c');
    expect(arvore[0].filhos[0].filhos[0].filhos).toEqual([]);

    // Contagem total de nós na árvore = 3 (ninguém duplicado, ninguém perdido).
    const contar = (ns: ReturnType<typeof montarArvore>): number =>
      ns.reduce((acc, n) => acc + 1 + contar(n.filhos), 0);
    expect(contar(arvore)).toBe(3);
  });

  it('nó cujo pai NÃO está na lista vira raiz (lista filtrada por projeto não perde nó)', () => {
    const orfao = no({
      id: 'x',
      pai_id: 'pai-fora-da-lista',
      agente: 'cerebroA',
      tipo: 'cerebro',
      caminho: 'C1/orq:z/cerebroA:x',
      profundidade: 1,
    });
    const arvore = montarArvore([orfao]);
    expect(arvore).toHaveLength(1);
    expect(arvore[0].no.id).toBe('x');
  });

  it('filhos ordenados por created_at e, no empate, por id', () => {
    const raiz = no({ id: 'a' });
    const f3 = no({ id: 'f3', pai_id: 'a', tipo: 'cerebro', created_at: '2026-09-02 10:00:05' });
    const f1 = no({ id: 'f1', pai_id: 'a', tipo: 'cerebro', created_at: '2026-09-02 10:00:01' });
    const f2b = no({ id: 'f2b', pai_id: 'a', tipo: 'cerebro', created_at: '2026-09-02 10:00:03' });
    const f2a = no({ id: 'f2a', pai_id: 'a', tipo: 'cerebro', created_at: '2026-09-02 10:00:03' });
    const arvore = montarArvore([f3, f2b, raiz, f1, f2a]);
    expect(arvore[0].filhos.map((f) => f.no.id)).toEqual(['f1', 'f2a', 'f2b', 'f3']);
  });

  it('duas raízes (dois orquestradores) ficam lado a lado', () => {
    const arvore = montarArvore([no({ id: 'a' }), no({ id: 'b', created_at: '2026-09-02 11:00:00' })]);
    expect(arvore.map((r) => r.no.id).sort()).toEqual(['a', 'b']);
  });
});

describe('resumirCiclo — agregados de um ciclo', () => {
  it('total, por tipo, por veredito (ignora null), erros, custo e tokens (null = 0)', () => {
    const nos: NoAgente[] = [
      no({ id: 'a', tipo: 'orquestrador', custo_usd: 0.01, tokens_in: 100, tokens_out: 50 }),
      no({
        id: 'b',
        pai_id: 'a',
        tipo: 'cerebro',
        veredito: 'aprovado',
        custo_usd: 0.02,
        tokens_in: 200,
        tokens_out: null,
      }),
      no({ id: 'c', pai_id: 'a', tipo: 'cerebro', veredito: 'reprovado', custo_usd: null, tokens_in: null, tokens_out: 25 }),
      no({ id: 'd', pai_id: 'a', tipo: 'cetico', veredito: 'aprovado', erro: 'timeout', custo_usd: 0.005 }),
      no({ id: 'e', pai_id: 'a', tipo: 'tool', veredito: null, erro: 'HTTP 500' }),
    ];
    const r = resumirCiclo(nos);
    expect(r.total).toBe(5);
    expect(r.por_tipo).toEqual({ orquestrador: 1, cerebro: 2, cetico: 1, tool: 1 });
    expect(r.por_veredito).toEqual({ aprovado: 2, reprovado: 1 });
    expect(r.erros).toBe(2);
    expect(r.custo_usd).toBeCloseTo(0.035, 6);
    expect(r.tokens).toBe(100 + 50 + 200 + 25);
  });

  it('lista vazia → zeros e mapas vazios', () => {
    expect(resumirCiclo([])).toEqual({
      total: 0,
      por_tipo: {},
      por_veredito: {},
      erros: 0,
      custo_usd: 0,
      tokens: 0,
    });
  });
});

// =======================================================================================
// (b) MÓDULO SERVER (banco mockado)
// =======================================================================================
describe('registrarNoAgente — nunca lança', () => {
  it('insertAgenteLog rejeita → devolve null, não propaga', async () => {
    getAgenteLogNo.mockResolvedValue(paiRaiz);
    insertAgenteLog.mockRejectedValue(new Error('SQLITE_BUSY'));
    await expect(registrarNoAgente(entrada())).resolves.toBeNull();
  });

  it('getAgenteLogNo rejeita → devolve null, não propaga', async () => {
    getAgenteLogNo.mockRejectedValue(new Error('banco fora'));
    await expect(registrarNoAgente(entrada())).resolves.toBeNull();
    expect(insertAgenteLog).not.toHaveBeenCalled();
  });
});

describe('registrarNoAgente — nó inválido não chega ao banco e é CONTADO', () => {
  it('cerebro sem pai → null, sem insert, contador de recusas sobe', async () => {
    const antes = recusasRegistroAgente();
    const r = await registrarNoAgente(entrada({ pai_id: null }));
    expect(r).toBeNull();
    expect(insertAgenteLog).not.toHaveBeenCalled();
    expect(recusasRegistroAgente()).toBe(antes + 1);
  });

  it('agente vazio → null, sem insert, contador sobe', async () => {
    const antes = recusasRegistroAgente();
    await registrarNoAgente(entrada({ agente: '' }));
    expect(insertAgenteLog).not.toHaveBeenCalled();
    expect(recusasRegistroAgente()).toBe(antes + 1);
  });

  it('pai inexistente no banco → null, sem insert, contador sobe', async () => {
    getAgenteLogNo.mockResolvedValue(undefined);
    const antes = recusasRegistroAgente();
    await registrarNoAgente(entrada({ pai_id: 'fantasma' }));
    expect(insertAgenteLog).not.toHaveBeenCalled();
    expect(recusasRegistroAgente()).toBe(antes + 1);
  });

  it('pai de outro ciclo → null, sem insert, contador sobe', async () => {
    getAgenteLogNo.mockResolvedValue({ ...paiRaiz, ciclo_id: 'C2' });
    const antes = recusasRegistroAgente();
    await registrarNoAgente(entrada({ ciclo_id: 'C1' }));
    expect(insertAgenteLog).not.toHaveBeenCalled();
    expect(recusasRegistroAgente()).toBe(antes + 1);
  });
});

describe('registrarNoAgente — caminho e profundidade materializados', () => {
  it('filho: consulta o pai, grava caminho = pai.caminho/agente:id e profundidade = pai + 1', async () => {
    getAgenteLogNo.mockResolvedValue(paiRaiz);
    const r = await registrarNoAgente(entrada({ id: 'b', agente: 'cerebroA' }));
    expect(getAgenteLogNo).toHaveBeenCalledWith('raiz');
    expect(r).toEqual({ id: 'b', caminho: 'C1/orq:raiz/cerebroA:b' });
    expect(insertAgenteLog).toHaveBeenCalledTimes(1);
    const reg = insertAgenteLog.mock.calls[0][0] as Record<string, unknown>;
    expect(reg.id).toBe('b');
    expect(reg.caminho).toBe('C1/orq:raiz/cerebroA:b');
    expect(reg.profundidade).toBe(1);
    expect(reg.pai_id).toBe('raiz');
    expect(reg.ciclo_id).toBe('C1');
    expect(reg.projeto_id).toBe('P1');
    expect(reg.agente).toBe('cerebroA');
    expect(reg.tipo).toBe('cerebro');
  });

  it('neto: profundidade 2 e caminho encadeado do pai', async () => {
    getAgenteLogNo.mockResolvedValue({ id: 'b', ciclo_id: 'C1', caminho: 'C1/orq:raiz/cerebroA:b', profundidade: 1 });
    const r = await registrarNoAgente(entrada({ id: 'c', pai_id: 'b', agente: 'tool', tipo: 'tool' }));
    expect(r).toEqual({ id: 'c', caminho: 'C1/orq:raiz/cerebroA:b/tool:c' });
    const reg = insertAgenteLog.mock.calls[0][0] as Record<string, unknown>;
    expect(reg.profundidade).toBe(2);
  });

  it('raiz (orquestrador, pai null): caminho = ciclo/agente:id, profundidade 0, NÃO consulta getAgenteLogNo', async () => {
    const r = await registrarNoAgente(entrada({ id: 'a', pai_id: null, agente: 'orq', tipo: 'orquestrador' }));
    expect(getAgenteLogNo).not.toHaveBeenCalled();
    expect(r).toEqual({ id: 'a', caminho: 'C1/orq:a' });
    const reg = insertAgenteLog.mock.calls[0][0] as Record<string, unknown>;
    expect(reg.profundidade).toBe(0);
    expect(reg.pai_id).toBeNull();
  });

  it('sem id informado, gera um id não vazio e o usa no caminho', async () => {
    const r = await registrarNoAgente(entrada({ pai_id: null, agente: 'orq', tipo: 'orquestrador' }));
    expect(r).not.toBeNull();
    expect(r!.id.length).toBeGreaterThan(0);
    expect(r!.caminho).toBe(`C1/orq:${r!.id}`);
  });
});

describe('abrirCiclo / fecharCiclo', () => {
  it('abrirCiclo devolve id não vazio e grava status "aberto" + gatilho', async () => {
    const id = await abrirCiclo({ gatilho: 'submissao', modelos: { cerebro: 'sol' }, variante: 'v1' });
    expect(typeof id).toBe('string');
    expect((id as string).length).toBeGreaterThan(0);
    expect(insertAvaliacaoCiclo).toHaveBeenCalledTimes(1);
    const reg = insertAvaliacaoCiclo.mock.calls[0][0] as Record<string, unknown>;
    expect(reg.id).toBe(id);
    expect(reg.status).toBe('aberto');
    expect(reg.gatilho).toBe('submissao');
  });

  it('abrirCiclo nunca lança: insert rejeitado → null', async () => {
    insertAvaliacaoCiclo.mockRejectedValue(new Error('disk I/O error'));
    await expect(abrirCiclo({ gatilho: 'cron' })).resolves.toBeNull();
  });

  it('fecharCiclo grava o status final e devolve true quando o banco reportou escrita', async () => {
    updateAvaliacaoCiclo.mockResolvedValue(1);
    const ok = await fecharCiclo('C1', { status: 'concluido', metricas: { acuracia: 0.67 } });
    expect(ok).toBe(true);
    expect(updateAvaliacaoCiclo).toHaveBeenCalledTimes(1);
    const [id, patch] = updateAvaliacaoCiclo.mock.calls[0] as [string, Record<string, unknown>];
    expect(id).toBe('C1');
    expect(patch.status).toBe('concluido');
  });

  it('fecharCiclo nunca lança: update rejeitado → false', async () => {
    updateAvaliacaoCiclo.mockRejectedValue(new Error('banco fora'));
    await expect(fecharCiclo('C1', { status: 'erro' })).resolves.toBe(false);
  });
});

describe('lerArvore', () => {
  it('lê os nós do ciclo (e do projeto, quando informado) e devolve a árvore montada', async () => {
    queryAgenteLogPorCiclo.mockResolvedValue([
      no({ id: 'a' }),
      no({ id: 'b', pai_id: 'a', tipo: 'cerebro', caminho: 'C1/orq:a/cerebroA:b', profundidade: 1 }),
    ]);
    const arvore = await lerArvore('C1', 'P1');
    expect(queryAgenteLogPorCiclo).toHaveBeenCalledWith('C1', 'P1');
    expect(arvore).toHaveLength(1);
    expect(arvore[0].no.id).toBe('a');
    expect(arvore[0].filhos[0].no.id).toBe('b');
  });

  it('ciclo sem nós → []', async () => {
    expect(await lerArvore('C-vazio')).toEqual([]);
  });
});

// Keyset: os testes só olham o `limit` pedido ao banco (número solto ou campo `limit` do objeto de
// filtros) e o corte da página — não o formato interno do cursor.
function limitPedido(chamada: unknown[]): number | undefined {
  for (const arg of chamada) {
    if (typeof arg === 'number') return arg;
    if (arg && typeof arg === 'object' && typeof (arg as Record<string, unknown>).limit === 'number') {
      return (arg as Record<string, unknown>).limit as number;
    }
  }
  return undefined;
}

function ciclo(id: string, created_at: string) {
  return { id, gatilho: 'submissao', status: 'concluido', created_at };
}

describe('listarCiclos — keyset', () => {
  it('pede limit + 1; com limit + 1 de volta devolve limit itens e proximoCursor não nulo', async () => {
    queryAvaliacaoCiclos.mockResolvedValue([
      ciclo('c1', '2026-09-02 10:00:00'),
      ciclo('c2', '2026-09-02 09:00:00'),
      ciclo('c3', '2026-09-02 08:00:00'),
    ]);
    const r = await listarCiclos({ limit: 2 });
    expect(limitPedido(queryAvaliacaoCiclos.mock.calls[0])).toBe(3);
    expect(r.itens).toHaveLength(2);
    expect((r.itens as { id: string }[]).map((i) => i.id)).toEqual(['c1', 'c2']);
    expect(r.proximoCursor).not.toBeNull();
    expect(typeof r.proximoCursor).toBe('string');
  });

  it('com menos que limit + 1, proximoCursor é null', async () => {
    queryAvaliacaoCiclos.mockResolvedValue([ciclo('c1', '2026-09-02 10:00:00')]);
    const r = await listarCiclos({ limit: 5 });
    expect(r.itens).toHaveLength(1);
    expect(r.proximoCursor).toBeNull();
  });

  it('limit como string ("10") é aceito → pede 11', async () => {
    await listarCiclos({ limit: '10' });
    expect(limitPedido(queryAvaliacaoCiclos.mock.calls[0])).toBe(11);
  });

  it('default 50 → pede 51', async () => {
    await listarCiclos();
    expect(limitPedido(queryAvaliacaoCiclos.mock.calls[0])).toBe(51);
  });

  it('teto 200 → pede no máximo 201', async () => {
    await listarCiclos({ limit: 9999 });
    expect(limitPedido(queryAvaliacaoCiclos.mock.calls[0])).toBe(201);
  });
});

describe('listarLog — keyset com filtros', () => {
  it('pede limit + 1; corta em limit e devolve cursor quando sobrou', async () => {
    queryAgenteLog.mockResolvedValue([
      no({ id: 'a', created_at: '2026-09-02 10:00:00' }),
      no({ id: 'b', created_at: '2026-09-02 09:00:00' }),
      no({ id: 'c', created_at: '2026-09-02 08:00:00' }),
    ]);
    const r = await listarLog({ agente: 'orq', limit: 2 });
    expect(limitPedido(queryAgenteLog.mock.calls[0])).toBe(3);
    expect(r.itens).toHaveLength(2);
    expect((r.itens as { id: string }[]).map((i) => i.id)).toEqual(['a', 'b']);
    expect(r.proximoCursor).not.toBeNull();
  });

  it('com menos que limit + 1, proximoCursor é null', async () => {
    queryAgenteLog.mockResolvedValue([no({ id: 'a' })]);
    const r = await listarLog({ limit: 3 });
    expect(r.itens).toHaveLength(1);
    expect(r.proximoCursor).toBeNull();
  });

  it('repassa os filtros (agente, desde, veredito, projeto) ao banco', async () => {
    await listarLog({ agente: 'cetico', desde: '2026-09-01', veredito: 'reprovado', projeto: 'P9', limit: 1 });
    const filtros = queryAgenteLog.mock.calls[0][0] as Record<string, unknown>;
    expect(filtros).toMatchObject({ agente: 'cetico', desde: '2026-09-01', veredito: 'reprovado', projeto: 'P9' });
  });

  it('limit string, default 50 e teto 200', async () => {
    await listarLog({ limit: '10' });
    expect(limitPedido(queryAgenteLog.mock.calls[0])).toBe(11);
    await listarLog();
    expect(limitPedido(queryAgenteLog.mock.calls[1])).toBe(51);
    await listarLog({ limit: 5000 });
    expect(limitPedido(queryAgenteLog.mock.calls[2])).toBe(201);
  });

  it('a 2ª página recebe o cursor da 1ª (a posição do keyset chega ao banco) e fecha sem cursor', async () => {
    queryAgenteLog.mockResolvedValueOnce([
      no({ id: 'a', created_at: '2026-09-02 10:00:00' }),
      no({ id: 'b', created_at: '2026-09-02 09:00:00' }),
    ]);
    const p1 = await listarLog({ limit: 1 });
    expect(p1.proximoCursor).not.toBeNull();

    queryAgenteLog.mockResolvedValueOnce([no({ id: 'b', created_at: '2026-09-02 09:00:00' })]);
    const p2 = await listarLog({ limit: 1, cursor: p1.proximoCursor! });
    // A 2ª chamada ao banco tem de carregar algo além de `limit` (a posição decodificada do
    // cursor) — sem isso a paginação devolveria a 1ª página para sempre.
    const filtros2 = queryAgenteLog.mock.calls[1][0] as Record<string, unknown>;
    const chavesComValor = Object.entries(filtros2)
      .filter(([k, v]) => k !== 'limit' && v !== undefined && v !== null)
      .map(([k]) => k);
    expect(chavesComValor.length).toBeGreaterThan(0);
    expect((p2.itens as { id: string }[]).map((i) => i.id)).toEqual(['b']);
    expect(p2.proximoCursor).toBeNull();
  });
});
