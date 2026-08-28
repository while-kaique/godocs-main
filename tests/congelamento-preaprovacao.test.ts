import { afterEach, describe, expect, it } from "vitest";
import {
  COPY_CONGELAMENTO_PREAPROVACAO,
  preAprovacaoCongelada,
} from "../src/lib/congelamento-preaprovacao";

afterEach(() => {
  delete process.env.PRE_APROVACAO_CONGELADA;
});

describe("congelamento da pré-aprovação (kill-switch por env)", () => {
  it("default OFF: env ausente → não congela (byte-idêntico ao de antes)", () => {
    delete process.env.PRE_APROVACAO_CONGELADA;
    expect(preAprovacaoCongelada()).toBe(false);
  });

  it("valores truthy ligam o congelamento", () => {
    for (const v of ["1", "true", "TRUE", "sim", "on", " On ", "Sim"]) {
      process.env.PRE_APROVACAO_CONGELADA = v;
      expect(preAprovacaoCongelada()).toBe(true);
    }
  });

  it("valores não reconhecidos NÃO congelam (nunca liga por engano)", () => {
    for (const v of ["", "0", "false", "nao", "off", "qualquer"]) {
      process.env.PRE_APROVACAO_CONGELADA = v;
      expect(preAprovacaoCongelada()).toBe(false);
    }
  });

  it("a copy é uma frase única, não vazia (fonte da tela + recusa do servidor)", () => {
    expect(COPY_CONGELAMENTO_PREAPROVACAO.length).toBeGreaterThan(20);
    expect(COPY_CONGELAMENTO_PREAPROVACAO).toContain("pausadas");
  });
});
