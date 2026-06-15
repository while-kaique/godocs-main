import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llmChat } from "@/lib/llm";

// Mock test do roteamento do LLM: NÃO bate na rede — intercepta o fetch e verifica
// para onde a chamada vai e com qual credencial, nos dois modos (proxy vs direto).
describe("llm — roteamento proxy vs direto", () => {
  const envBackup = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Limpa as chaves relevantes para cada teste partir de um estado conhecido.
    delete process.env.LLM_BASE_URL;
    delete process.env.API_PROXY_TOKEN;
    delete process.env.LLM_API_KEY;
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

  it("modo proxy: usa API_PROXY_TOKEN como Bearer e a LLM_BASE_URL do proxy", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok-TESTE";
    process.env.LLM_API_KEY = "sk-proj-NAO-USAR";
    fetchMock.mockResolvedValue(okResponse);

    const out = await llmChat([{ role: "user", content: "oi" }], { model: "gpt-5.4-mini" });

    expect(out).toBe("resposta-mock");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw.exemplo.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gw-tok-TESTE");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-5.4-mini");
  });

  it("tolera barra final na LLM_BASE_URL", async () => {
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1/";
    process.env.API_PROXY_TOKEN = "gw-tok-TESTE";
    fetchMock.mockResolvedValue(okResponse);

    await llmChat([{ role: "user", content: "oi" }], { model: "gpt-5.4-mini" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://gw.exemplo.com/v1/chat/completions");
  });

  it("modo direto (sem LLM_BASE_URL): mantém OpenAI + LLM_API_KEY, ignora o token do proxy", async () => {
    process.env.API_PROXY_TOKEN = "gw-tok-NAO-USAR";
    process.env.LLM_API_KEY = "sk-proj-DIRETO";
    fetchMock.mockResolvedValue(okResponse);

    await llmChat([{ role: "user", content: "oi" }], { model: "gpt-5.4-mini" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-proj-DIRETO");
  });

  it("proxy também roteia Anthropic para a base do proxy com x-api-key", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
    process.env.API_PROXY_TOKEN = "gw-tok-TESTE";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: "resposta-anthropic" }] }),
    });

    const out = await llmChat([{ role: "user", content: "oi" }], { model: "claude-haiku-4-5" });

    expect(out).toBe("resposta-anthropic");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gw.exemplo.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("gw-tok-TESTE");
  });
});
