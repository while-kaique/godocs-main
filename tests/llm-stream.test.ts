import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  llmChatStream,
  extractPartialJsonStringField,
  splitSSE,
  parseOpenAIDelta,
} from "@/lib/llm";

// Monta uma Response-like de streaming SSE a partir de pedaços de texto CRU (já no formato
// "data: {...}\n\n"). Cada pedaço vira um read() separado, para exercitar o buffer entre reads.
function sseResponse(chunks: string[], init?: { ok?: boolean; status?: number }) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
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

// Response-like que emite alguns chunks e DEPOIS rejeita (rede caiu no meio do stream).
function sseThenThrow(chunks: string[], err: Error) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            if (i < chunks.length) return { done: false, value: enc.encode(chunks[i++]) };
            throw err;
          },
        };
      },
    },
  };
}

function abortErr() {
  return Object.assign(new Error("aborted"), { name: "AbortError" });
}

// Stream SSE CONTROLÁVEL: o teste empurra chunks/finaliza na mão; cada read() pendura até um
// push/finish OU até o AbortController (capturado do fetch via getSignal) disparar. Serve para
// exercitar os relógios de estol (primeiro-conteúdo × GAP) com fake timers.
function controllableSSE(getSignal: () => AbortSignal | null) {
  const enc = new TextEncoder();
  const pending: Array<{ done: boolean; value: Uint8Array | undefined }> = [];
  let waiter: { resolve: (v: { done: boolean; value: Uint8Array | undefined }) => void; reject: (e: Error) => void } | null =
    null;
  const wireAbort = () => {
    const sig = getSignal();
    if (!sig) return;
    if (sig.aborted) {
      waiter?.reject(abortErr());
      waiter = null;
      return;
    }
    sig.addEventListener(
      "abort",
      () => {
        waiter?.reject(abortErr());
        waiter = null;
      },
      { once: true },
    );
  };
  const response = {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read() {
            if (pending.length) return Promise.resolve(pending.shift()!);
            return new Promise<{ done: boolean; value: Uint8Array | undefined }>((resolve, reject) => {
              waiter = { resolve, reject };
              wireAbort();
            });
          },
        };
      },
    },
  };
  const api = {
    push(text: string) {
      const item = { done: false, value: enc.encode(text) };
      if (waiter) {
        waiter.resolve(item);
        waiter = null;
      } else pending.push(item);
    },
    finish() {
      const item = { done: true, value: undefined };
      if (waiter) {
        waiter.resolve(item);
        waiter = null;
      } else pending.push(item);
    },
  };
  return { response, api };
}

describe("extractPartialJsonStringField", () => {
  it("devolve null quando o campo ainda não começou", () => {
    expect(extractPartialJsonStringField('{"type":"prev', "content")).toBeNull();
    expect(extractPartialJsonStringField("", "content")).toBeNull();
  });
  it("extrai o valor parcial de content", () => {
    expect(extractPartialJsonStringField('{"type":"preview","content":"Olá mun', "content")).toBe(
      "Olá mun",
    );
  });
  it("para no fim da string (aspas de fechamento)", () => {
    expect(
      extractPartialJsonStringField('{"type":"preview","content":"pronto","fase":"saving"}', "content"),
    ).toBe("pronto");
  });
  it("decodifica \\n e aspas escapadas", () => {
    expect(extractPartialJsonStringField('{"content":"linha1\\nlinha2 \\"x\\" fim', "content")).toBe(
      'linha1\nlinha2 "x" fim',
    );
  });
  it("tolera escape truncado no fim do buffer (não vaza a barra)", () => {
    expect(extractPartialJsonStringField('{"content":"quase\\', "content")).toBe("quase");
  });
  it("tolera \\u truncado", () => {
    expect(extractPartialJsonStringField('{"content":"a\\u00', "content")).toBe("a");
  });
  it("decodifica \\uXXXX completo", () => {
    expect(extractPartialJsonStringField('{"content":"a\\u00e9b', "content")).toBe("aéb");
  });
  it("funciona com o campo question (options)", () => {
    expect(extractPartialJsonStringField('{"type":"options","question":"Qual', "question")).toBe(
      "Qual",
    );
  });
});

describe("splitSSE", () => {
  it("separa eventos por linha em branco e guarda o resto", () => {
    const { events, rest } = splitSSE("data: a\n\ndata: b\n\ndata: par");
    expect(events).toEqual(["data: a", "data: b"]);
    expect(rest).toBe("data: par");
  });
  it("sem evento completo → tudo vira resto", () => {
    const { events, rest } = splitSSE("data: incompl");
    expect(events).toEqual([]);
    expect(rest).toBe("data: incompl");
  });
});

describe("parseOpenAIDelta", () => {
  it("extrai delta.content", () => {
    expect(parseOpenAIDelta('data: {"choices":[{"delta":{"content":"oi"}}]}')).toBe("oi");
  });
  it("ignora [DONE] e chunk sem content (role)", () => {
    expect(parseOpenAIDelta("data: [DONE]")).toBe("");
    expect(parseOpenAIDelta('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBe("");
  });
});

describe("llmChatStream", () => {
  const envBackup = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.LLM_BASE_URL;
    delete process.env.API_PROXY_TOKEN;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_FALLBACK;
    delete process.env.LLM_FALLBACK_MODEL;
    process.env.LLM_PROVIDER = "openai";
  });
  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllGlobals();
  });

  it("acumula o texto cru e chama onRawDelta por pedaço", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"type\\":\\"preview\\",\\"content\\":\\"O"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lá"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" mundo\\"}"}}]}\n\ndata: [DONE]\n\n',
      ]),
    );
    const pieces: string[] = [];
    const raw = await llmChatStream([{ role: "user", content: "oi" }], {
      onRawDelta: (c) => pieces.push(c),
    });
    expect(pieces.join("")).toBe(raw);
    expect(raw).toBe('{"type":"preview","content":"Olá mundo"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // body pediu stream:true
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).stream).toBe(true);
  });

  it("erro de gateway (522) no proxy → refaz o stream direto na OpenAI (fallback)", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 522, text: async () => "<html>bad</html>" })
      .mockResolvedValueOnce(
        sseResponse(['data: {"choices":[{"delta":{"content":"ok-fallback"}}]}\n\ndata: [DONE]\n\n']),
      );
    const raw = await llmChatStream([{ role: "user", content: "oi" }], {});
    expect(raw).toBe("ok-fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
    const init2 = fetchMock.mock.calls[1][1] as RequestInit;
    expect((init2.headers as Record<string, string>).Authorization).toBe("Bearer sk-proj-FALLBACK");
    expect(JSON.parse(init2.body as string).model).toBe("gpt-5.4-mini");
  });

  it("stream cai DEPOIS de emitir conteúdo → devolve o parcial, NÃO cai no fallback", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    fetchMock.mockResolvedValueOnce(
      sseThenThrow(
        ['data: {"choices":[{"delta":{"content":"{\\"type\\":\\"preview\\",\\"content\\":\\"parci"}}]}\n\n'],
        new Error("ECONNRESET"),
      ),
    );
    const pieces: string[] = [];
    const raw = await llmChatStream([{ role: "user", content: "oi" }], {
      onRawDelta: (c) => pieces.push(c),
    });
    expect(raw).toBe('{"type":"preview","content":"parci');
    expect(pieces.join("")).toBe(raw);
    expect(fetchMock).toHaveBeenCalledTimes(1); // anti-prosa-dupla: sem fallback
  });

  it("sem LLM_FALLBACK: erro do proxy propaga (nada emitido)", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "erro" });
    await expect(llmChatStream([{ role: "user", content: "oi" }], {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Estol em DUAS FASES (24/08/2026): o GAP de 25s só vale DEPOIS do 1º conteúdo. ────────
  // Antes disso, o modelo pesado do Codex "pensa" >25s antes do 1º token; um GAP de 25s
  // abortaria o modelo bom e jogaria o memorial no fallback gpt-5.4-mini.

  it("silêncio > GAP ANTES do 1º conteúdo NÃO aborta (vale o relógio de primeiro-conteúdo)", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    vi.useFakeTimers();
    try {
      const holder: { signal: AbortSignal | null } = { signal: null };
      const { response, api } = controllableSSE(() => holder.signal);
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        holder.signal = init.signal as AbortSignal;
        return Promise.resolve(response);
      });
      // 1º chunk é só 'role' (SEM conteúdo) — não pode armar o GAP.
      api.push('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
      const p = llmChatStream([{ role: "user", content: "gere um memorial" }], {});
      await vi.advanceTimersByTimeAsync(0); // consome o role e pendura no próximo read
      // 30s de silêncio: passaria do GAP (25s), mas NÃO da janela de primeiro-conteúdo (60s).
      await vi.advanceTimersByTimeAsync(30_000);
      expect(holder.signal?.aborted).toBe(false); // o modelo ainda "pensa" — não corta
      // Agora chega o 1º conteúdo e o stream fecha normalmente.
      api.push('data: {"choices":[{"delta":{"content":"MEMORIAL-OK"}}]}\n\n');
      api.push("data: [DONE]\n\n");
      api.finish();
      await expect(p).resolves.toBe("MEMORIAL-OK");
      expect(fetchMock).toHaveBeenCalledTimes(1); // não caiu no fallback
    } finally {
      vi.useRealTimers();
    }
  });

  it("silêncio > GAP DEPOIS do 1º conteúdo AINDA aborta → devolve o parcial, sem fallback", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    vi.useFakeTimers();
    try {
      const holder: { signal: AbortSignal | null } = { signal: null };
      const { response, api } = controllableSSE(() => holder.signal);
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        holder.signal = init.signal as AbortSignal;
        return Promise.resolve(response);
      });
      api.push('data: {"choices":[{"delta":{"content":"PARCIAL"}}]}\n\n'); // 1º conteúdo → arma o GAP
      const pieces: string[] = [];
      const p = llmChatStream([{ role: "user", content: "oi" }], { onRawDelta: (c) => pieces.push(c) });
      await vi.advanceTimersByTimeAsync(0); // consome o conteúdo e pendura no próximo read
      expect(holder.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(25_100); // passa do GAP → aborta
      expect(holder.signal?.aborted).toBe(true);
      await expect(p).resolves.toBe("PARCIAL"); // emitted → devolve o parcial
      expect(pieces.join("")).toBe("PARCIAL");
      expect(fetchMock).toHaveBeenCalledTimes(1); // anti-prosa-dupla: NÃO cai no fallback
    } finally {
      vi.useRealTimers();
    }
  });

  it("estol ANTES do 1º conteúdo além da janela de primeiro-conteúdo → fallback (dois relógios)", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    vi.useFakeTimers();
    try {
      const holder: { signal: AbortSignal | null } = { signal: null };
      const { response: proxyResp, api: proxyApi } = controllableSSE(() => holder.signal);
      fetchMock
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          holder.signal = init.signal as AbortSignal;
          return Promise.resolve(proxyResp);
        })
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          holder.signal = init.signal as AbortSignal;
          return Promise.resolve(
            sseResponse(['data: {"choices":[{"delta":{"content":"ok-fallback"}}]}\n\ndata: [DONE]\n\n']),
          );
        });
      // Proxy manda só um chunk de 'role' e depois trava — nunca chega conteúdo.
      proxyApi.push('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
      const p = llmChatStream([{ role: "user", content: "oi" }], {});
      await vi.advanceTimersByTimeAsync(0);
      expect(holder.signal?.aborted).toBe(false);
      // Passa da janela de primeiro-conteúdo do proxy (60s) → aborta com nada emitido →
      // gatewayRetries:0 → fallback direto na OpenAI.
      await vi.advanceTimersByTimeAsync(60_100);
      await expect(p).resolves.toBe("ok-fallback");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
      expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).model).toBe(
        "gpt-5.4-mini",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("STREAM_FIRST_CONTENT_TIMEOUT_MS e STREAM_GAP_TIMEOUT_MS configuráveis por env (lidos lazy)", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    process.env.STREAM_FIRST_CONTENT_TIMEOUT_MS = "10000"; // 10s
    vi.useFakeTimers();
    try {
      const holder: { signal: AbortSignal | null } = { signal: null };
      const { response: proxyResp, api: proxyApi } = controllableSSE(() => holder.signal);
      fetchMock
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          holder.signal = init.signal as AbortSignal;
          return Promise.resolve(proxyResp);
        })
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          holder.signal = init.signal as AbortSignal;
          return Promise.resolve(
            sseResponse(['data: {"choices":[{"delta":{"content":"ok-fallback"}}]}\n\ndata: [DONE]\n\n']),
          );
        });
      proxyApi.push('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
      const p = llmChatStream([{ role: "user", content: "oi" }], {});
      await vi.advanceTimersByTimeAsync(0);
      // Aos 9s ainda não abortou (janela reduzida via env é 10s, não os 60s default).
      await vi.advanceTimersByTimeAsync(9_000);
      expect(holder.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1_100); // > 10s → aborta e cai no fallback
      await expect(p).resolves.toBe("ok-fallback");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
