/**
 * AJUDA DO CAMPO "trabalho manual ADICIONAL" (formulário de saving, ramo do custo evitado).
 *
 * A pergunta 2c vem logo depois de a pessoa cadastrar o gasto que a empresa deixou de pagar,
 * e é aí que ela confunde as duas coisas — responder "sim" com o MESMO trabalho do gasto
 * eliminado é dupla contagem. O popup de ajuda existe para separar, e faz isso com uma lista
 * curta de sinais: "não é esse caso se…" (✕) e "é esse caso se…" (✓).
 *
 * Estes testes travam o conteúdo (não a aparência): perder um dos lados, perder um dos 2 erros
 * reais ou virar um texto longo são regressões silenciosas na tela.
 */
import { describe, it, expect } from "vitest";
import { SINAIS_TRABALHO_ADICIONAL } from "@/lib/submeter/exemplos-modal";

describe("sinais do trabalho manual adicional", () => {
  it("mostra os dois lados, 2 de cada", () => {
    // Dois por lado é decisão de produto: a lista tem de ser lida de um olhar.
    expect(SINAIS_TRABALHO_ADICIONAL.filter((s) => !s.vale)).toHaveLength(2);
    expect(SINAIS_TRABALHO_ADICIONAL.filter((s) => s.vale)).toHaveLength(2);
  });

  it("começa pelos casos que NÃO valem (é o erro que a pergunta produz)", () => {
    expect(SINAIS_TRABALHO_ADICIONAL[0].vale).toBe(false);
  });

  it("cada sinal é uma frase curta, legível de um olhar", () => {
    for (const s of SINAIS_TRABALHO_ADICIONAL) {
      expect(s.texto.trim().length).toBeGreaterThan(20);
      // Piso de leitura rápida: passando disso já não é mais uma lista para escanear.
      expect(s.texto.length).toBeLessThanOrEqual(110);
      if (s.detalhe) expect(s.detalhe.length).toBeLessThanOrEqual(130);
    }
  });

  it("cobre os 2 erros que a pergunta produz na prática", () => {
    const naoValem = SINAIS_TRABALHO_ADICIONAL.filter((s) => !s.vale)
      .map((s) => `${s.texto} ${s.detalhe ?? ""}`.toLowerCase())
      .join(" | ");
    // 1. mesmo escopo do gasto eliminado → dupla contagem
    expect(naoValem).toMatch(/mesmo trabalho/);
    // 2. horas que ALGUÉM já fazia → manda de volta ao outro ramo do formulário
    expect(naoValem).toMatch(/alguém já fazia/);
  });
});
