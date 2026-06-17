import { describe, it, expect } from "vitest";
import { ocultarReaisSaving } from "@/lib/submeter/constants";

// Regra de exposição de dados: o cliente NUNCA pode ver valores financeiros de
// saving (R$, taxa/hora, custo evitado em R$). Só horas. ocultarReaisSaving é a
// rede de segurança no render — não pode deixar vazar nenhum R$.
describe("ocultarReaisSaving", () => {
  it("remove linha com R$ inteira", () => {
    const out = ocultarReaisSaving(
      "Estagiário: 25h antes → 1h depois.\nEconomia em reais: R$ 258,72/mês.",
    );
    expect(out).not.toMatch(/r\$/i);
    expect(out).toContain("25h antes");
  });

  it("remove o memorial de custo evitado em R$ mas mantém as horas", () => {
    const texto = [
      "## Memorial de Cálculo",
      "Estagiário economiza 24h/mês.",
      "O projeto evitou um serviço externo que custaria R$ 2.700 (único).",
      "Mensalizado: R$ 2.700 ÷ 12 = R$ 225/mês.",
    ].join("\n");
    const out = ocultarReaisSaving(texto);
    expect(out).not.toMatch(/r\$/i);
    expect(out).not.toContain("2.700");
    expect(out).not.toContain("225");
    expect(out).toContain("24h/mês");
    expect(out).toContain("Memorial de Cálculo");
  });

  it("remove linha de taxa/valor por hora", () => {
    const out = ocultarReaisSaving("Valor por hora do cargo: R$ 10,78.\nTotal: 24h/mês.");
    expect(out).not.toMatch(/hora do cargo|r\$/i);
    expect(out).toContain("24h/mês");
  });

  it("preserva linha de horas que menciona 'custo' (custo adicional em horas)", () => {
    const texto = "Economia de 66h/mês.\nCusto adicional: analista monitora 1h/mês.";
    const out = ocultarReaisSaving(texto);
    expect(out).toContain("Custo adicional: analista monitora 1h/mês");
    expect(out).toContain("66h/mês");
  });

  it("remove 'X reais' mesmo sem o símbolo R$", () => {
    const out = ocultarReaisSaving("Economiza 10h/mês.\nIsso equivale a 2700 reais por ano.");
    expect(out).not.toMatch(/reais/i);
    expect(out).toContain("10h/mês");
  });

  it("strip inline de R$ residual no meio de uma linha mantida", () => {
    // Linha que escapa do filtro de linha mas tem R$ inline → remove o R$ inline.
    const out = ocultarReaisSaving("A automação reduz o tempo de R$ 500 em insumos manuais.");
    expect(out).not.toMatch(/r\$\s*500/i);
  });

  it("não quebra com texto vazio", () => {
    expect(ocultarReaisSaving("")).toBe("");
  });

  it("colapsa quebras de linha em excesso deixadas pela remoção", () => {
    const out = ocultarReaisSaving("Linha A\nR$ 100\nR$ 200\nLinha B");
    expect(out).not.toMatch(/\n{3,}/);
    expect(out).toContain("Linha A");
    expect(out).toContain("Linha B");
  });
});
