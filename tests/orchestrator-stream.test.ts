import { describe, it, expect, vi } from "vitest";
import type { ProjetoContexto } from "@/lib/agents/types";
import { documentacaoVazia, receitaVazia, savingVazio } from "@/lib/agents/types";

// Mock APENAS o llmChatStream/llmChat do módulo de LLM; mantém o parser incremental REAL
// (extractPartialJsonStringField), que é quem o orchestrator usa para fatiar a prosa.
const streamMock = vi.fn();
vi.mock("@/lib/llm", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, llmChatStream: streamMock, llmChat: vi.fn() };
});

const { runOrchestrator } = await import("@/lib/agents/orchestrator");

function makeCtx(): ProjetoContexto {
  return {
    responsavel_nome: "Teste",
    responsavel_email: "teste@gocase.com",
    area: "CX",
    ferramenta: "n8n",
    membros: [],
    nome_projeto: "Projeto Teste",
    data_criacao: "2025-06-01",
    doc_texto: null,
  };
}

// Simula um stream: entrega `full` em pedaços de `size` chars via onRawDelta e devolve full.
function feed(full: string, size = 5) {
  return async (_msgs: unknown, opts: { onRawDelta?: (c: string) => void }) => {
    for (let i = 0; i < full.length; i += size) opts.onRawDelta?.(full.slice(i, i + size));
    return full;
  };
}

describe("runOrchestrator — streaming da prosa", () => {
  it("turno PREVIEW: emite a prosa (content) incrementalmente e junta = content final", async () => {
    const full = JSON.stringify({
      type: "preview",
      content: "Linha um.\nLinha dois com \"aspas\" e é acento.",
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    });
    streamMock.mockImplementation(feed(full, 4));
    const deltas: string[] = [];
    const res = await runOrchestrator(
      makeCtx(),
      [{ role: "user", content: "manda o preview" }],
      "saving",
      documentacaoVazia(),
      savingVazio(),
      "",
      ["saving"],
      receitaVazia(),
      { onDelta: (c) => deltas.push(c) },
    );
    expect(res.type).toBe("preview");
    expect(res.fase).toBe("saving_preview"); // transição preview→*_preview
    // a prosa acumulada deve ser exatamente o content decodificado (com \n e acentos)
    expect(deltas.join("")).toBe('Linha um.\nLinha dois com "aspas" e é acento.');
    expect(deltas.length).toBeGreaterThan(1); // veio em pedaços, não de uma vez
  });

  it("turno QUESTION: NÃO streama prosa (fica bufferizado)", async () => {
    const full = JSON.stringify({
      type: "question",
      content: "Qual o objetivo do projeto?",
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    });
    streamMock.mockImplementation(feed(full, 4));
    const deltas: string[] = [];
    const res = await runOrchestrator(
      makeCtx(),
      [{ role: "user", content: "oi" }],
      "saving",
      documentacaoVazia(),
      savingVazio(),
      "",
      ["saving"],
      receitaVazia(),
      { onDelta: (c) => deltas.push(c) },
    );
    expect(res.type).toBe("question");
    expect(deltas).toEqual([]); // question não streama
  });

  it("sem onDelta: usa o caminho bufferizado (llmChatStream não é chamado)", async () => {
    const { llmChat } = (await import("@/lib/llm")) as unknown as { llmChat: ReturnType<typeof vi.fn> };
    llmChat.mockResolvedValue(
      JSON.stringify({ type: "question", content: "oi?", coletado: documentacaoVazia(), saving: savingVazio() }),
    );
    streamMock.mockClear();
    await runOrchestrator(makeCtx(), [{ role: "user", content: "oi" }], "saving");
    expect(streamMock).not.toHaveBeenCalled();
    expect(llmChat).toHaveBeenCalled();
  });
});
