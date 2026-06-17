import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/agents/analyzer";

// Importar o prompt já valida que o template literal compila (sem este teste, um
// erro de sintaxe no prompt do analyzer.ts passa batido — nenhum outro teste o importa).
describe("analyzer — classificação de complexidade", () => {
  const prompt = buildSystemPrompt();

  it("usa o campo usa_ia e a distinção IA de construção vs funcionalidade", () => {
    expect(prompt).toContain("usa_ia");
    // Prompt distingue IA usada para construir o projeto vs IA como funcionalidade
    expect(prompt).toContain("construir o projeto");
    expect(prompt).toContain("ferramenta de desenvolvimento");
  });

  it('não usa mais a régua antiga ("usa IA de forma ativa" / "minimamente inteligente")', () => {
    expect(prompt).not.toContain("minimamente inteligente");
    expect(prompt).not.toContain("usa IA (LLM, ML, NLP");
    expect(prompt).not.toContain("ia_decide_caminho");
  });

  it("inclui o critério de IA como funcionalidade do produto", () => {
    expect(prompt).toContain("tem_ia_como_funcionalidade");
    expect(prompt).toContain("IA como funcionalidade");
  });

  it("inclui o exemplo do painel de pedidos (orquestração sem IA) como automacao", () => {
    expect(prompt).toContain("Protheus");
    expect(prompt.toLowerCase()).toContain("nenhuma ia como funcionalidade");
  });

  it("qualquer uso de IA no produto final eleva para pelo menos inteligencia", () => {
    expect(prompt).toContain("pelo menos");
    expect(prompt).toContain('"inteligencia"');
  });

  it("inclui o exemplo de geração de documentação por IA como inteligencia", () => {
    expect(prompt).toContain("gera documentação");
    expect(prompt.toLowerCase()).toContain("inteligencia");
  });
});
