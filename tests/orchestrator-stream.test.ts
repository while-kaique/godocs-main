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

  it("turno QUESTION: streama a prosa (content) incrementalmente e junta = content final", async () => {
    const texto = "Qual o objetivo do projeto?\nMe conte com é detalhes.";
    const full = JSON.stringify({
      type: "question",
      content: texto,
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
    // a prosa da PERGUNTA (campo content) deve chegar token a token
    expect(deltas.join("")).toBe(texto);
    expect(deltas.length).toBeGreaterThan(1); // veio em pedaços, não de uma vez
  });

  it("turno OPTIONS: streama a prosa (campo question) token a token — bolha não nasce vazia", async () => {
    const pergunta = "Alguém já fazia esse trabalho?\nEscolha uma opção é assim.";
    const full = JSON.stringify({
      type: "options",
      question: pergunta,
      options: ["Sim", "Não", "Era terceirizado"],
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
    expect(res.type).toBe("options");
    // o texto vive em `question` (NÃO em content); precisa streamar, não string vazia
    expect(deltas.join("")).toBe(pergunta);
    expect(deltas.join("")).not.toBe("");
    expect(deltas.length).toBeGreaterThan(1);
  });

  it("INVARIANTE doc_preview: type=complete na fase doc_preview NUNCA streama (compilação silenciosa)", async () => {
    const full = JSON.stringify({
      type: "complete",
      content: "Documentação compilada pesada e longa.",
      coletado: documentacaoVazia(),
      saving: savingVazio(),
    });
    streamMock.mockImplementation(feed(full, 4));
    const deltas: string[] = [];
    const res = await runOrchestrator(
      makeCtx(),
      [{ role: "user", content: "compila a doc" }],
      "doc_preview",
      documentacaoVazia(),
      savingVazio(),
      "",
      ["saving"],
      receitaVazia(),
      { onDelta: (c) => deltas.push(c) },
    );
    expect(res.type).toBe("complete");
    expect(deltas).toEqual([]); // doc_preview complete segue silenciosa
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
