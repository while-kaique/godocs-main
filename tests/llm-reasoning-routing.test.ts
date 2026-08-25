// Testes RED (pré-implementação): roteamento de modelo + reasoning_effort POR FASE
// dentro de `runOrchestrator`. Mocka `@/lib/llm` para capturar o SEGUNDO argumento
// (as LLMOptions) que o orquestrador passa a llmChat, e verifica model/reasoningEffort
// por fase. As envs devem ser lidas EM RUNTIME dentro de runOrchestrator.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjetoContexto } from "@/lib/agents/types";
import { documentacaoVazia, receitaVazia, savingVazio } from "@/lib/agents/types";

// Captura as opts passadas a cada chamada de llmChat/llmChatStream.
const capturado: { llmChat: any[]; llmChatStream: any[] } = { llmChat: [], llmChatStream: [] };

// Mocka só llmChat/llmChatStream para capturar as opts; mantém o `sanitizeEffort`
// REAL (o orchestrator o importa deste módulo) via importOriginal — assim o teste
// exercita a allowlist de verdade, sem re-implementar o guard no mock.
vi.mock("@/lib/llm", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/llm")>();
  return {
    ...real,
    llmChat: vi.fn(async (_messages: unknown, opts: unknown) => {
      capturado.llmChat.push(opts);
      return JSON.stringify({
        type: "question",
        content: "mock",
        coletado: documentacaoVazia(),
        saving: savingVazio(),
        receita: receitaVazia(),
      });
    }),
    llmChatStream: vi.fn(async (_messages: unknown, opts: unknown) => {
      capturado.llmChatStream.push(opts);
      return JSON.stringify({
        type: "question",
        content: "mock",
        coletado: documentacaoVazia(),
        saving: savingVazio(),
        receita: receitaVazia(),
      });
    }),
  };
});

const { runOrchestrator } = await import("@/lib/agents/orchestrator");

function makeCtx(overrides: Partial<ProjetoContexto> = {}): ProjetoContexto {
  return {
    responsavel_nome: "Teste",
    responsavel_email: "teste@gocase.com",
    area: "CX",
    ferramenta: "n8n",
    membros: [],
    nome_projeto: "Projeto Teste",
    data_criacao: "2025-06-01",
    doc_texto: null,
    ...overrides,
  };
}

const envBackup = { ...process.env };

beforeEach(() => {
  capturado.llmChat = [];
  capturado.llmChatStream = [];
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_MODEL = "gpt-modelo-sol";
  delete process.env.LLM_MODEL_FAST;
  delete process.env.LLM_REASONING_EFFORT;
  delete process.env.LLM_REASONING_EFFORT_FAST;
});

afterEach(() => {
  process.env = { ...envBackup };
});

// ── Critério 1: default OFF = idêntico a hoje ────────────────────────────────
describe("Default OFF — sem envs de LLM_MODEL_FAST/REASONING", () => {
  it("não roteia model nem reasoningEffort em NENHUMA fase", async () => {
    await runOrchestrator(makeCtx({ doc_texto: "algo" }), [], "doc");
    await runOrchestrator(makeCtx(), [], "saving", documentacaoVazia(), savingVazio(), "Resumo", ["saving"]);

    for (const opts of capturado.llmChat) {
      expect(opts.model).toBeUndefined();
      expect(opts.reasoningEffort).toBeUndefined();
    }
  });
});

// ── Critério 2: roteamento por fase ──────────────────────────────────────────
describe("Roteamento por fase (LLM_MODEL_FAST + LLM_REASONING_EFFORT_FAST)", () => {
  beforeEach(() => {
    process.env.LLM_MODEL_FAST = "gpt-5.6-luna";
    process.env.LLM_REASONING_EFFORT_FAST = "low";
    delete process.env.LLM_REASONING_EFFORT;
  });

  it("fase doc → model=gpt-5.6-luna e reasoningEffort=low", async () => {
    await runOrchestrator(makeCtx({ doc_texto: "algo" }), [], "doc");
    const opts = capturado.llmChat.at(-1);
    expect(opts.model).toBe("gpt-5.6-luna");
    expect(opts.reasoningEffort).toBe("low");
  });

  it("fase doc_preview → model=gpt-5.6-luna e reasoningEffort=low", async () => {
    await runOrchestrator(makeCtx(), [{ role: "user", content: "ajuste" }], "doc_preview");
    const opts = capturado.llmChat.at(-1);
    expect(opts.model).toBe("gpt-5.6-luna");
    expect(opts.reasoningEffort).toBe("low");
  });

  it("fase saving → model=undefined (cai no LLM_MODEL) e reasoningEffort=undefined", async () => {
    await runOrchestrator(makeCtx(), [], "saving", documentacaoVazia(), savingVazio(), "Resumo", ["saving"]);
    const opts = capturado.llmChat.at(-1);
    expect(opts.model).toBeUndefined();
    expect(opts.reasoningEffort).toBeUndefined();
  });

  it("fase receita → model=undefined e reasoningEffort=undefined", async () => {
    await runOrchestrator(makeCtx(), [], "receita", documentacaoVazia(), savingVazio(), "Resumo", ["receita_incremental"]);
    const opts = capturado.llmChat.at(-1);
    expect(opts.model).toBeUndefined();
    expect(opts.reasoningEffort).toBeUndefined();
  });

  it("fase saving_preview → model=undefined e reasoningEffort=undefined", async () => {
    await runOrchestrator(makeCtx(), [{ role: "user", content: "ok" }], "saving_preview", documentacaoVazia(), savingVazio(), "Resumo", ["saving"]);
    const opts = capturado.llmChat.at(-1);
    expect(opts.model).toBeUndefined();
    expect(opts.reasoningEffort).toBeUndefined();
  });

  it("fase receita_preview → model=undefined e reasoningEffort=undefined", async () => {
    await runOrchestrator(makeCtx(), [{ role: "user", content: "ok" }], "receita_preview", documentacaoVazia(), savingVazio(), "Resumo", ["receita_incremental"]);
    const opts = capturado.llmChat.at(-1);
    expect(opts.model).toBeUndefined();
    expect(opts.reasoningEffort).toBeUndefined();
  });
});
