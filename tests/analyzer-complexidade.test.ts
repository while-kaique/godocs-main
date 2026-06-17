import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/agents/analyzer";

// Importar o prompt já valida que o template literal compila (sem este teste, um
// erro de sintaxe no prompt do analyzer.ts passa batido — nenhum outro teste o importa).
describe("analyzer — classificação de complexidade", () => {
  const prompt = buildSystemPrompt();

  it("inclui o campo ia_decide_caminho e a distinção de sofisticação vs inteligência", () => {
    expect(prompt).toContain("ia_decide_caminho");
    expect(prompt).toContain("Sofisticação de engenharia ≠ inteligência");
  });

  it('não usa mais a régua antiga ("usa IA de forma ativa" / "minimamente inteligente")', () => {
    expect(prompt).not.toContain("minimamente inteligente");
    expect(prompt).not.toContain("usa IA (LLM, ML, NLP");
  });

  it("inclui o critério de IA como funcionalidade do produto", () => {
    expect(prompt).toContain("tem_ia_como_funcionalidade");
    expect(prompt).toContain("IA como funcionalidade");
  });

  it("inclui o exemplo do painel de pedidos (orquestração sem IA) como automacao", () => {
    expect(prompt).toContain("Protheus");
    expect(prompt.toLowerCase()).toContain("nenhuma ia como funcionalidade");
  });

  it("inclui o exemplo de geração de documentação por IA como inteligencia", () => {
    expect(prompt).toContain("gera documentação");
    expect(prompt.toLowerCase()).toContain("inteligencia");
  });
});
