import { describe, it, expect } from "vitest";
import {
  MARCA,
  LIMITE_DETALHE,
  SECAO,
  encurtarDetalhe,
  montarTitulo,
} from "../src/lib/titulo-pagina";

describe("montarTitulo", () => {
  it("sem detalhe, fecha com a marca", () => {
    expect(montarTitulo(SECAO.investigador)).toBe(`Investigador · ${MARCA}`);
    expect(montarTitulo(SECAO.dashboard, null)).toBe(`Dash · ${MARCA}`);
    expect(montarTitulo(SECAO.aprovacoes, "   ")).toBe(`Aprovações · ${MARCA}`);
  });

  it("com detalhe, o detalhe OCUPA o lugar da marca", () => {
    // A aba do navegador corta cedo: com "Seção · nome · GoDocs" o nome do projeto —
    // a informação que motivou a feature — some antes de aparecer.
    expect(montarTitulo(SECAO.investigador, "Bot de Faturamento V2")).toBe(
      "Investigador · Bot de Faturamento V2",
    );
    expect(montarTitulo(SECAO.dashboard, "Reenvio pendente")).toBe("Dash · Reenvio pendente");
    expect(montarTitulo(SECAO.investigador, "Bot")).not.toContain(MARCA);
  });

  it("a SEÇÃO vem primeiro (é o que sobra quando a aba encolhe)", () => {
    for (const secao of Object.values(SECAO)) {
      expect(montarTitulo(secao, "Projeto qualquer").startsWith(secao)).toBe(true);
    }
  });

  it("normaliza espaço e quebra de linha do nome vindo da planilha", () => {
    expect(montarTitulo(SECAO.projeto, "  Automação   de\nreembolsos ")).toBe(
      "Projeto · Automação de reembolsos",
    );
  });

  it("seção vazia não gera título órfão começando com o separador", () => {
    expect(montarTitulo("", "Qualquer coisa")).toBe(MARCA);
  });
});

describe("encurtarDetalhe", () => {
  it("mantém o que cabe", () => {
    const curto = "Bot de Faturamento V2";
    expect(encurtarDetalhe(curto)).toBe(curto);
  });

  it("corta o que não cabe e marca com reticências", () => {
    const longo = "A".repeat(LIMITE_DETALHE + 30);
    const saida = encurtarDetalhe(longo);
    expect(saida.endsWith("…")).toBe(true);
    expect(saida.length).toBeLessThanOrEqual(LIMITE_DETALHE + 1);
  });

  it("prefere cortar no espaço a partir uma palavra ao meio", () => {
    const nome =
      "Automação de conciliação bancária para o time financeiro do grupo inteiro";
    const saida = encurtarDetalhe(nome);
    expect(saida.endsWith("…")).toBe(true);
    expect(saida).not.toMatch(/\s…$/); // sem espaço solto antes das reticências
    // Cortou numa fronteira de palavra: o que sobrou é prefixo de palavras completas.
    expect(nome.startsWith(saida.slice(0, -1))).toBe(true);
    expect(saida.slice(0, -1)).toMatch(/\S$/);
  });

  it("uma palavra só, gigante, ainda respeita o limite", () => {
    const saida = encurtarDetalhe("X".repeat(200));
    expect(saida.length).toBe(LIMITE_DETALHE + 1);
  });
});

describe("rótulos de seção", () => {
  it("a fila do líder NÃO usa a palavra 'Aprovado' (nomenclatura é pré-aprovação)", () => {
    expect(SECAO.aprovacoes).toBe("Aprovações");
  });

  it("todo rótulo é curto o bastante para sobrar espaço ao detalhe", () => {
    for (const rotulo of Object.values(SECAO)) {
      expect(rotulo.length).toBeLessThanOrEqual(16);
      expect(rotulo.trim()).toBe(rotulo);
    }
  });
});
