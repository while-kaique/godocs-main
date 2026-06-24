import { describe, it, expect } from "vitest";
import {
  MEMORIAL_ESQUELETO,
  descreverEsqueletoMemorial,
  type ModoMemorial,
} from "@/lib/agents/memorial-format";

// O esqueleto é a FONTE ÚNICA da estrutura do memorial financeiro. Estes testes
// travam os invariantes que não podem regredir conforme o sistema evolui.
describe("MEMORIAL_ESQUELETO — esqueleto do memorial (fonte única)", () => {
  it("custo_evitado NÃO tem 'Saving de Pessoas' (perfil sem horas)", () => {
    const secoes = MEMORIAL_ESQUELETO.custo_evitado.map((s) => s.secao);
    expect(secoes).not.toContain("Saving de Pessoas");
    expect(secoes).toContain("Contratos/Serviços Evitados");
    expect(secoes).toContain("Resumo");
  });

  it("saving TEM 'Saving de Pessoas' e 'Contratos/Serviços Evitados'", () => {
    const secoes = MEMORIAL_ESQUELETO.saving.map((s) => s.secao);
    expect(secoes).toContain("Saving de Pessoas");
    expect(secoes).toContain("Contratos/Serviços Evitados");
  });

  it("toda seção condicional/opcional declara um gatilho", () => {
    for (const modo of Object.keys(MEMORIAL_ESQUELETO) as ModoMemorial[]) {
      for (const s of MEMORIAL_ESQUELETO[modo]) {
        if (s.nivel !== "obrigatoria") {
          expect(s.gatilho, `${modo} / ${s.secao}`).toBeTruthy();
        }
      }
    }
  });

  it("custo_evitado exige realidade + atribuição + escopo na seção de evitados", () => {
    const evitados = MEMORIAL_ESQUELETO.custo_evitado.find(
      (s) => s.secao === "Contratos/Serviços Evitados",
    );
    expect(evitados?.nivel).toBe("obrigatoria");
    expect(evitados?.conteudo).toMatch(/REALIDADE/);
    expect(evitados?.conteudo).toMatch(/ATRIBUIÇÃO/);
    expect(evitados?.conteudo).toMatch(/ESCOPO/);
  });

  it("descreverEsqueletoMemorial renderiza seções com o nível em tag", () => {
    const txt = descreverEsqueletoMemorial("custo_evitado");
    expect(txt).toContain("### Contratos/Serviços Evitados  [OBRIGATÓRIA]");
    expect(txt).toContain("### Resumo  [OBRIGATÓRIA]");
    // não há SEÇÃO de horas no perfil de custo evitado puro (a prosa pode citá-la
    // para dizer que ela NÃO existe — por isso checamos o cabeçalho "### ...").
    expect(txt).not.toContain("### Saving de Pessoas");
  });

  it("saving marca '2.4 O que mudou' como condicional (≥44h)", () => {
    const s24 = MEMORIAL_ESQUELETO.saving.find(
      (s) => s.secao === "O que mudou após a automação",
    );
    expect(s24?.nivel).toBe("condicional");
    expect(s24?.gatilho).toMatch(/44h/);
  });
});
