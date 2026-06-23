import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llmChat } from "@/lib/llm";

// Fallback do LLM: quando o ai-proxy demora (timeout/abort) OU retorna erro, a
// chamada deve ser refeita DIRETO na OpenAI (sem proxy) com a chave LLM_FALLBACK e o
// modelo gpt-5.4-mini — para o usuário não ver o erro nem ficar preso no "tente
// novamente". Intercepta o fetch (não bate na rede).
describe("llm — fallback direto quando o proxy falha/demora", () => {
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

  const okResponse = {
    ok: true,
    json: async () => ({ choices: [{ message: { content: "resposta-mock" } }] }),
  };

  it("erro de gateway no proxy → OpenAI direto com LLM_FALLBACK + gpt-5.4-mini", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 522, text: async () => "<html>bad gateway</html>" })
      .mockResolvedValueOnce(okResponse);

    const out = await llmChat([{ role: "user", content: "oi" }], { model: "gpt-modelo-proxy" });

    expect(out).toBe("resposta-mock");
    expect(fetchMock).toHaveBeenCalledTimes(2); // proxy falhou rápido (gatewayRetries:0) → fallback
    // 1ª = proxy
    expect(fetchMock.mock.calls[0][0]).toBe("https://gw.exemplo.com/v1/chat/completions");
    // 2ª = OpenAI direto, chave de fallback, modelo gpt-5.4-mini
    const [url2, init2] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url2).toBe("https://api.openai.com/v1/chat/completions");
    expect((init2.headers as Record<string, string>).Authorization).toBe("Bearer sk-proj-FALLBACK");
    expect(JSON.parse(init2.body as string).model).toBe("gpt-5.4-mini");
  });

  it("timeout do proxy (AbortError) → cai no direto", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    fetchMock.mockRejectedValueOnce(abortErr).mockResolvedValueOnce(okResponse);

    const out = await llmChat([{ role: "user", content: "oi" }], {});

    expect(out).toBe("resposta-mock");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("LLM_FALLBACK_MODEL sobrescreve o modelo do fallback", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    process.env.LLM_FALLBACK_MODEL = "gpt-5.4-mini-custom";
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "indisponível" })
      .mockResolvedValueOnce(okResponse);

    await llmChat([{ role: "user", content: "oi" }], {});
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string).model).toBe("gpt-5.4-mini-custom");
  });

  it("proxy OK → NÃO aciona fallback (uma chamada só)", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    fetchMock.mockResolvedValue(okResponse);

    const out = await llmChat([{ role: "user", content: "oi" }], {});
    expect(out).toBe("resposta-mock");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sem LLM_FALLBACK: erro do proxy propaga, sem chamada direta", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok";
    // Erro definitivo (não-gateway) para não pagar backoff no teste.
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "erro interno" });

    await expect(llmChat([{ role: "user", content: "oi" }], {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("modo direto (sem proxy): fallback não se aplica — não há o que contornar", async () => {
    process.env.LLM_API_KEY = "sk-proj-DIRETO";
    process.env.LLM_FALLBACK = "sk-proj-FALLBACK";
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "erro" });

    await expect(llmChat([{ role: "user", content: "oi" }], {})).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1); // não tenta o fallback fora do modo proxy
  });
});
