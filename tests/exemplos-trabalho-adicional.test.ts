/**
 * EXEMPLOS DO CAMPO "trabalho manual ADICIONAL" (formulário de saving, ramo do custo evitado).
 *
 * A pergunta 2c vem logo depois de a pessoa cadastrar o gasto que a empresa deixou de pagar,
 * e é aí que ela confunde as duas coisas — responder "sim" com o MESMO trabalho do gasto
 * eliminado é dupla contagem. O modal de exemplos existe para separar, então ele só cumpre
 * o papel se mostrar os DOIS lados: o que vale e o que não vale.
 *
 * Estes testes travam o conteúdo (não a aparência): perder um dos lados, ficar sem o motivo
 * ou enumerar tipos de gasto como lista fechada são regressões silenciosas na tela.
 */
import { describe, it, expect } from "vitest";
import { EXEMPLOS_TRABALHO_ADICIONAL } from "@/lib/submeter/exemplos-modal";

describe("exemplos do trabalho manual adicional", () => {
  it("mostra os dois lados, 3 de cada", () => {
    expect(EXEMPLOS_TRABALHO_ADICIONAL.filter((e) => e.vale)).toHaveLength(3);
    expect(EXEMPLOS_TRABALHO_ADICIONAL.filter((e) => !e.vale)).toHaveLength(3);
  });

  it("todo exemplo tem contexto, gasto eliminado e MOTIVO do veredito", () => {
    for (const ex of EXEMPLOS_TRABALHO_ADICIONAL) {
      expect(ex.contexto.trim().length).toBeGreaterThan(20);
      expect(ex.custoEliminado.trim().length).toBeGreaterThan(15);
      // Veredito sem motivo não ensina nada — é o que o campo precisa explicar.
      expect(ex.motivo.trim().length).toBeGreaterThan(30);
    }
  });

  it("o gasto eliminado sempre traz um valor em R$ (ancora o exemplo)", () => {
    for (const ex of EXEMPLOS_TRABALHO_ADICIONAL) {
      expect(ex.custoEliminado).toMatch(/R\$/);
    }
  });

  it("cobre os 3 erros que a pergunta produz na prática", () => {
    const naoValem = EXEMPLOS_TRABALHO_ADICIONAL.filter((e) => !e.vale);
    const texto = naoValem.map((e) => `${e.contexto} ${e.motivo}`.toLowerCase()).join(" | ");
    // 1. mesmo escopo do gasto eliminado → dupla contagem
    expect(texto).toMatch(/duas vezes|mesmo trabalho/);
    // 2. horas que ALGUÉM já fazia → é o outro ramo do formulário
    expect(texto).toMatch(/alguém já fazia|alguém fazia/);
    // 3. trabalho que nasceu com a automação → custo de operação
    expect(texto).toMatch(/nasceu com a automação/);
  });
});
