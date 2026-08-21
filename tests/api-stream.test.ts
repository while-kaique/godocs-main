import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiStream, ApiError } from "@/lib/api-client";

function sseFetchResponse(chunks: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/event-stream; charset=utf-8" : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

function jsonFetchResponse(obj: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    body: null,
    text: async () => JSON.stringify(obj),
  };
}

describe("apiStream", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("SSE: entrega deltas via onDelta e devolve o envelope final", async () => {
    fetchMock.mockResolvedValueOnce(
      sseFetchResponse([
        'data: {"t":"delta","c":"Olá "}\n\n',
        'data: {"t":"delta","c":"mundo"}\n\ndata: {"t":"envelope","r":{"type":"preview","content":"Olá mundo","fase":"saving_preview"}}\n\n',
      ]),
    );
    const deltas: string[] = [];
    const env = await apiStream<{ type: string; content: string; fase: string }>(
      "/api/chat/enviar-mensagem",
      { projeto_id: "x", content: "oi" },
      { onDelta: (c) => deltas.push(c) },
    );
    expect(deltas).toEqual(["Olá ", "mundo"]);
    expect(env.type).toBe("preview");
    expect(env.content).toBe("Olá mundo");
    expect(env.fase).toBe("saving_preview");
  });

  it("SSE: evento error vira ApiError com status e bloqueio", async () => {
    fetchMock.mockResolvedValueOnce(
      sseFetchResponse([
        'data: {"t":"delta","c":"parcial"}\n\ndata: {"t":"error","m":"Falhou","status":400,"bloqueio":{"tipo":"saving"}}\n\n',
      ]),
    );
    const err = await apiStream("/api/chat/enviar-mensagem", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toBe("Falhou");
    expect((err as ApiError).bloqueio).toEqual({ tipo: "saving" });
  });

  it("transporte JSON (flag desligada): lê o corpo como envelope, sem deltas", async () => {
    fetchMock.mockResolvedValueOnce(jsonFetchResponse({ type: "question", content: "?" }));
    const deltas: string[] = [];
    const env = await apiStream<{ type: string }>("/api/chat/enviar-mensagem", {}, { onDelta: (c) => deltas.push(c) });
    expect(env.type).toBe("question");
    expect(deltas).toEqual([]);
  });

  it("transporte JSON !ok: vira ApiError com a mensagem do corpo", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonFetchResponse({ error: "muito longo", bloqueio: { tipo: "x" } }, { ok: false, status: 400 }),
    );
    const err = await apiStream("/api/chat/enviar-mensagem", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
    expect((err as ApiError).message).toBe("muito longo");
  });

  it("SSE encerra SEM envelope → ApiError 500", async () => {
    fetchMock.mockResolvedValueOnce(sseFetchResponse(['data: {"t":"delta","c":"só isso"}\n\n']));
    const err = await apiStream("/api/chat/enviar-mensagem", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});
