import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/agents/analyzer";

// Importar o prompt já valida que o template literal compila (sem este teste, um
// erro de sintaxe no prompt do analyzer.ts passa batido — nenhum outro teste o importa).
describe("analyzer — classificação de complexidade", () => {
  const prompt = buildSystemPrompt();

  it('separa os níveis pelo PAPEL da IA, não por "ter LLM"', () => {
    expect(prompt).toContain("ia_decide_caminho");
    expect(prompt).toContain("Sofisticação de engenharia ≠ inteligência");
    // O gate explícito: sem IA decidindo, é obrigatoriamente automacao.
    expect(prompt).toMatch(/OBRIGATORIAMENTE "automacao"/);
  });

  it('não usa mais a régua antiga ("usa IA de forma ativa" / "minimamente inteligente")', () => {
    expect(prompt).not.toContain("minimamente inteligente");
    expect(prompt).not.toContain("usa IA (LLM, ML, NLP");
  });

  it("inclui o exemplo do painel de pedidos (orquestração sem IA) como automacao", () => {
    expect(prompt).toContain("Protheus");
    expect(prompt.toLowerCase()).toContain("nenhuma ia decide o caminho");
  });
});
