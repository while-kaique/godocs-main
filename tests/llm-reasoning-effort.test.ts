// Testes RED (pré-implementação): roteamento de modelo + reasoning_effort POR FASE.
// Este arquivo cobre a camada `src/lib/llm.ts`:
//   - o guard puro `sanitizeEffort` (allowlist; nunca deixa passar `minimal`);
//   - a injeção de `reasoning_effort` no BODY do POST (opt-in), nos DOIS caminhos
//     (llmChat / callOpenAI e llmChatStream / callOpenAIStream);
//   - o default OFF (sem a opção → a chave NÃO aparece no body).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { llmChat, llmChatStream, sanitizeEffort } from "@/lib/llm";

const envBackup = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;

const okResponse = {
  ok: true,
  json: async () => ({ choices: [{ message: { content: "resposta-mock" } }] }),
};

// Response-like de streaming SSE mínima (mesmo padrão de tests/llm-stream.test.ts).
function sseResponse(chunks: string[]) {
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
            return { done: true, value: undefined };
          },
        };
      },
    },
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Modo proxy (é o caminho de produção); envs de reasoning limpas por padrão.
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_BASE_URL = "https://gw.exemplo.com/v1";
  process.env.API_PROXY_TOKEN = "gw-tok";
  process.env.LLM_MODEL = "gpt-modelo-sol";
  delete process.env.LLM_MODEL_FAST;
  delete process.env.LLM_REASONING_EFFORT;
  delete process.env.LLM_REASONING_EFFORT_FAST;
  delete process.env.LLM_FALLBACK;
});

afterEach(() => {
  process.env = { ...envBackup };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Critério 3: guard anti-`minimal` (helper puro exportado) ──────────────────
describe("sanitizeEffort — allowlist (nunca deixa passar `minimal`)", () => {
  it("aceita os valores válidos da allowlist", () => {
    for (const v of ["low", "medium", "high", "xhigh", "max"]) {
      expect(sanitizeEffort(v)).toBe(v);
    }
  });

  it("rejeita `minimal` (o gateway devolve 502 determinístico)", () => {
    expect(sanitizeEffort("minimal")).toBeUndefined();
  });

  it("rejeita valor fora da allowlist", () => {
    expect(sanitizeEffort("x")).toBeUndefined();
  });

  it("rejeita string vazia", () => {
    expect(sanitizeEffort("")).toBeUndefined();
  });

  it("rejeita undefined", () => {
    expect(sanitizeEffort(undefined)).toBeUndefined();
  });
});

// ── Critérios 1 e 4: injeção no body (opt-in), caminho NÃO-streaming ──────────
describe("llmChat (callOpenAI) — reasoning_effort no body", () => {
  it("OMITE reasoning_effort quando a opção está ausente (default OFF)", async () => {
    fetchMock.mockResolvedValue(okResponse);
    await llmChat([{ role: "user", content: "oi" }], { jsonMode: true });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("INJETA reasoning_effort quando a opção é passada", async () => {
    fetchMock.mockResolvedValue(okResponse);
    await llmChat([{ role: "user", content: "oi" }], { reasoningEffort: "low" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reasoning_effort).toBe("low");
  });
});

// ── Critério 4: injeção no body (opt-in), caminho STREAMING ───────────────────
describe("llmChatStream (callOpenAIStream) — reasoning_effort no body", () => {
  it("OMITE reasoning_effort quando a opção está ausente", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']),
    );
    await llmChatStream([{ role: "user", content: "oi" }], {});
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("INJETA reasoning_effort quando a opção é passada", async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']),
    );
    await llmChatStream([{ role: "user", content: "oi" }], { reasoningEffort: "high" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.reasoning_effort).toBe("high");
  });
});
