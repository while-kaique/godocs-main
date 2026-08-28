import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llmChat } from "@/lib/llm";

// Fatia C — `semFallbackModelo`: no compilador da doc, em erro/timeout do proxy NÃO caímos no
// modelo leve escondido (gpt-5.4-mini via LLM_FALLBACK). Retentamos o MESMO modelo (luna) no
// proxy e, se esgotar, LANÇAMOS (o chamador defere). NUNCA toca api.openai.com.
describe("llm — semFallbackModelo: nunca cai no mini, retenta o mesmo modelo", () => {
  const envBackup = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.LLM_API_KEY;
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllGlobals();
  });

  const okResponse = {
    ok: true,
    json: async () => ({ choices: [{ message: { content: "resposta-proxy" } }] }),
  };
  const badGateway = { ok: false, status: 522, text: async () => "<html>bad gateway</html>" };

  const chamadasOpenAiDireto = () =>
    fetchMock.mock.calls.filter((c) => String(c[0]).startsWith("https://api.openai.com")).length;

  it("proxy 522 SEMPRE + semFallbackModelo → LANÇA, retenta o luna no proxy, nunca toca api.openai.com", async () => {
    fetchMock.mockResolvedValue(badGateway);

    await expect(
      llmChat([{ role: "user", content: "oi" }], {
        model: "luna",
        semFallbackModelo: true,
        retriesModelo: 1,
      }),
    ).rejects.toThrow();

    // tentativa + 1 retry = 2 chamadas, TODAS ao proxy com model=luna, ZERO ao openai direto.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chamadasOpenAiDireto()).toBe(0);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe("https://gw.exemplo.com/v1/chat/completions");
      expect(JSON.parse((init as RequestInit).body as string).model).toBe("luna");
    }
  });

  it("proxy 522 e depois OK + semFallbackModelo → retorna a resposta do proxy no luna, sem mini", async () => {
    fetchMock.mockResolvedValueOnce(badGateway).mockResolvedValueOnce(okResponse);

    const out = await llmChat([{ role: "user", content: "oi" }], {
      model: "luna",
      semFallbackModelo: true,
      retriesModelo: 1,
    });

    expect(out).toBe("resposta-proxy");
    expect(chamadasOpenAiDireto()).toBe(0);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse((init as RequestInit).body as string).model).toBe("luna");
    }
  });

  it("GUARDA DE REGRESSÃO: SEM semFallbackModelo, 522 continua caindo no mini (comportamento de hoje)", async () => {
    fetchMock.mockResolvedValueOnce(badGateway).mockResolvedValueOnce(okResponse);

    const out = await llmChat([{ role: "user", content: "oi" }], { model: "luna" });

    expect(out).toBe("resposta-proxy");
    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe("https://api.openai.com/v1/chat/completions");
    expect((init2.headers as Record<string, string>).Authorization).toBe("Bearer sk-proj-FALLBACK");
    expect(JSON.parse(init2.body as string).model).toBe("gpt-5.4-mini");
  });
});
