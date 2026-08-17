// Abrir a ficha de triagem sem espera — prefetch por INTENÇÃO + cache curto.
//
// O que estes testes prendem (é o plano `docs/plans/detalhe-triagem-abre-instantaneo.md`):
//  1. o clique aproveita o que o hover aqueceu (1 fetch, não 2);
//  2. atravessar linhas rolando a tabela NÃO gera uma requisição por linha (atraso de 150 ms
//     com timer único + cancelamento);
//  3. erro NUNCA fica cacheado (a abertura seguinte tenta de novo e mostra o erro real);
//  4. gravar status invalida a ficha (senão a reabertura afirmaria o status anterior);
//  5. o TTL é curto de propósito — passado ele, refaz o fetch;
//  6. nada disso gera "unhandled rejection".
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  obterDetalhe,
  prefetchDetalhe,
  agendarPrefetchDetalhe,
  cancelarPrefetchDetalhe,
  invalidarDetalhe,
  limparDetalhes,
  rotaDetalheDashboard,
  semearLote,
  DETALHE_TTL_MS,
  DETALHE_INTENCAO_MS,
  DETALHE_MAX_ENTRADAS,
} from "@/lib/dashboard-detalhe-cache";

type Ficha = { id: string; campos: Record<string, string> };

const FICHA: Ficha = { id: "legado-148", campos: { Status: "Pendente" } };

async function drenar() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const naoTratadas: unknown[] = [];
const capturar = (e: unknown) => naoTratadas.push(e);

beforeEach(() => {
  limparDetalhes();
  naoTratadas.length = 0;
  process.on("unhandledRejection", capturar);
});

afterEach(() => {
  process.off("unhandledRejection", capturar);
  limparDetalhes();
  vi.useRealTimers();
});

describe("cache da ficha de triagem", () => {
  it("o clique aproveita o que o hover aqueceu — 1 fetch só", async () => {
    const fetcher = vi.fn(async () => FICHA);
    prefetchDetalhe("LEGADO-148", fetcher);

    await expect(obterDetalhe<Ficha>("LEGADO-148", fetcher)).resolves.toEqual(FICHA);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("casa o id sem caixa (o espelho guarda em minúsculas)", async () => {
    const fetcher = vi.fn(async () => FICHA);
    prefetchDetalhe("LEGADO-148", fetcher);
    await obterDetalhe<Ficha>("  legado-148 ", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reabrir a mesma ficha dentro do TTL não gera requisição nova", async () => {
    const fetcher = vi.fn(async () => FICHA);
    await obterDetalhe<Ficha>("legado-148", fetcher);
    await obterDetalhe<Ficha>("legado-148", fetcher);
    await obterDetalhe<Ficha>("legado-148", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("passado o TTL, refaz o fetch (a ficha semeia campos que a triagem regrava)", async () => {
    const fetcher = vi.fn(async () => FICHA);
    const agora = Date.now();
    const relogio = vi.spyOn(Date, "now");
    relogio.mockReturnValue(agora);

    await obterDetalhe<Ficha>("legado-148", fetcher);
    relogio.mockReturnValue(agora + DETALHE_TTL_MS + 1);
    await obterDetalhe<Ficha>("legado-148", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    relogio.mockRestore();
  });

  it("gravar status invalida a ficha — a reabertura relê", async () => {
    const fetcher = vi.fn(async () => FICHA);
    await obterDetalhe<Ficha>("legado-148", fetcher);
    invalidarDetalhe("LEGADO-148"); // é o que o dialog chama depois de salvar
    await obterDetalhe<Ficha>("legado-148", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('o "Atualizar" que sincroniza limpa TODAS as fichas', async () => {
    const fetcher = vi.fn(async () => FICHA);
    await obterDetalhe<Ficha>("a", fetcher);
    await obterDetalhe<Ficha>("b", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);

    limparDetalhes();
    await obterDetalhe<Ficha>("a", fetcher);
    await obterDetalhe<Ficha>("b", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  // ── erro: a regra que o `dashboard-prefetch.ts` já estabeleceu ──
  it("erro NÃO fica cacheado — e propaga para quem pediu", async () => {
    const fetcher = vi
      .fn<() => Promise<Ficha>>()
      .mockRejectedValueOnce(new Error("Acesso negado."))
      .mockResolvedValue(FICHA);

    await expect(obterDetalhe<Ficha>("legado-148", fetcher)).rejects.toThrow("Acesso negado.");
    await drenar();
    // A abertura seguinte tenta de novo em vez de herdar a falha.
    await expect(obterDetalhe<Ficha>("legado-148", fetcher)).resolves.toEqual(FICHA);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("prefetch que falha não gera unhandled rejection", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("edge devolveu HTML");
    });
    prefetchDetalhe("legado-148", fetcher);
    await drenar();
    expect(naoTratadas).toEqual([]);
  });

  it("fetcher que lança de forma síncrona não guarda entrada nem explode", async () => {
    const sincrono = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as () => Promise<Ficha>;
    await expect(obterDetalhe<Ficha>("legado-148", sincrono)).rejects.toThrow("boom");
    await drenar();

    const ok = vi.fn(async () => FICHA);
    await expect(obterDetalhe<Ficha>("legado-148", ok)).resolves.toEqual(FICHA);
    expect(naoTratadas).toEqual([]);
  });

  // ── intenção: rolar a tabela não pode virar uma requisição por linha ──
  it("hover curto (mouse atravessando a linha) NÃO dispara requisição", () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => FICHA);

    agendarPrefetchDetalhe("legado-148", fetcher);
    vi.advanceTimersByTime(DETALHE_INTENCAO_MS - 1);
    cancelarPrefetchDetalhe(); // mouseleave antes do prazo
    vi.advanceTimersByTime(1_000);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hover que PERMANECE dispara uma requisição", () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => FICHA);

    agendarPrefetchDetalhe("legado-148", fetcher);
    vi.advanceTimersByTime(DETALHE_INTENCAO_MS);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("atravessar N linhas deixa só a ÚLTIMA intenção viva (timer único)", () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => FICHA);

    for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
      agendarPrefetchDetalhe(id, fetcher);
      vi.advanceTimersByTime(DETALHE_INTENCAO_MS - 50); // não dá tempo de nenhuma vencer
    }
    vi.advanceTimersByTime(DETALHE_INTENCAO_MS);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("id vazio não agenda nem busca nada", () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => FICHA);
    agendarPrefetchDetalhe("   ", fetcher);
    prefetchDetalhe("", fetcher);
    vi.advanceTimersByTime(1_000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("o cache tem teto — não é depósito da sessão", async () => {
    const fetcher = vi.fn(async () => FICHA);
    for (let i = 0; i < DETALHE_MAX_ENTRADAS + 5; i++) {
      await obterDetalhe<Ficha>(`p${i}`, fetcher);
    }
    const chamadasAntes = fetcher.mock.calls.length;
    // As primeiras já foram descartadas: pedir de novo refaz o fetch.
    await obterDetalhe<Ficha>("p0", fetcher);
    expect(fetcher.mock.calls.length).toBe(chamadasAntes + 1);
  });

  it("a rota é montada com o id escapado (fonte única da URL)", () => {
    expect(rotaDetalheDashboard("LEGADO-148")).toBe("/api/admin/dashboard/projetos/LEGADO-148");
    expect(rotaDetalheDashboard("a b/c")).toBe("/api/admin/dashboard/projetos/a%20b%2Fc");
  });
});

describe("semearLote — a página inteira numa requisição", () => {
  beforeEach(() => limparDetalhes());

  it("semeia as fichas e a abertura NÃO faz requisição nenhuma", async () => {
    const fichas = { a: { id: "a" }, b: { id: "b" } };
    const lote = vi.fn().mockResolvedValue(fichas);
    semearLote(["a", "b"], lote);
    await new Promise((r) => setTimeout(r, 0));

    const individual = vi.fn();
    await expect(obterDetalhe("a", individual)).resolves.toEqual({ id: "a" });
    await expect(obterDetalhe("B", individual)).resolves.toEqual({ id: "b" });
    expect(individual).not.toHaveBeenCalled();
    expect(lote).toHaveBeenCalledTimes(1);
  });

  it("não repete id que já tem ficha fresca (nem atropela requisição em voo)", async () => {
    const emVoo = vi.fn().mockResolvedValue({ id: "a", origem: "individual" });
    void obterDetalhe("a", emVoo);
    const lote = vi.fn().mockResolvedValue({});
    semearLote(["a"], lote);
    expect(lote).not.toHaveBeenCalled();
  });

  it("lote que FALHA não vira entrada — a abertura tenta de novo e mostra o erro real", async () => {
    const lote = vi.fn().mockRejectedValue(new Error("500"));
    semearLote(["a"], lote);
    await new Promise((r) => setTimeout(r, 0));
    const individual = vi.fn().mockResolvedValue({ id: "a" });
    await expect(obterDetalhe("a", individual)).resolves.toEqual({ id: "a" });
    expect(individual).toHaveBeenCalledTimes(1);
  });

  it("lista vazia não dispara requisição", () => {
    const lote = vi.fn();
    semearLote([], lote);
    semearLote(["", "   "], lote);
    expect(lote).not.toHaveBeenCalled();
  });
});
