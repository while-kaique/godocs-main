import { describe, it, expect } from "vitest";
import {
  rotuloVeredito,
  rotuloEstadoDeliberacao,
  rotuloResultadoRetroativo,
  rotuloGrau,
  pctConfianca,
  grauConfianca,
  aparenciaConfianca,
  CORES_GRAU,
  CORES_GRAU_NEUTRO,
} from "@/lib/avaliacao-sombra-rotulos";

describe("rotuloVeredito", () => {
  it("traduz os vereditos conhecidos", () => {
    expect(rotuloVeredito("aprovar")).toBe("Aprovar");
    expect(rotuloVeredito("em_validacao")).toBe("Validar");
    expect(rotuloVeredito("isento")).toBe("Isento");
  });
  it("desconhecido cai no valor cru, null/undefined viram —", () => {
    expect(rotuloVeredito("outro")).toBe("outro");
    expect(rotuloVeredito(null)).toBe("—");
    expect(rotuloVeredito(undefined)).toBe("—");
  });
});

describe("rotuloEstadoDeliberacao", () => {
  it("traduz os estados", () => {
    expect(rotuloEstadoDeliberacao("deliberando")).toBe("Deliberando");
    expect(rotuloEstadoDeliberacao("consenso")).toBe("Consenso");
    expect(rotuloEstadoDeliberacao("nao_consenso")).toBe("Sem consenso");
    expect(rotuloEstadoDeliberacao("isento")).toBe("Isento");
  });
  it("desconhecido/null fallback", () => {
    expect(rotuloEstadoDeliberacao("x")).toBe("x");
    expect(rotuloEstadoDeliberacao(null)).toBe("—");
  });
});

describe("rotuloResultadoRetroativo", () => {
  it("traduz os resultados", () => {
    expect(rotuloResultadoRetroativo("acerto")).toBe("Acerto");
    expect(rotuloResultadoRetroativo("conservador")).toBe("Conservador");
    expect(rotuloResultadoRetroativo("erro_grave")).toBe("Erro grave");
    expect(rotuloResultadoRetroativo("sem_base")).toBe("Sem base");
  });
  it("desconhecido/null fallback", () => {
    expect(rotuloResultadoRetroativo("z")).toBe("z");
    expect(rotuloResultadoRetroativo(undefined)).toBe("—");
  });
});

describe("grauConfianca (limiares 0.8 / 0.6)", () => {
  it("alta >= 0.8", () => {
    expect(grauConfianca(0.8)).toBe("alta");
    expect(grauConfianca(0.95)).toBe("alta");
  });
  it("media em [0.6, 0.8)", () => {
    expect(grauConfianca(0.6)).toBe("media");
    expect(grauConfianca(0.79)).toBe("media");
  });
  it("baixa abaixo de 0.6", () => {
    expect(grauConfianca(0.59)).toBe("baixa");
    expect(grauConfianca(0)).toBe("baixa");
  });
});

describe("pctConfianca", () => {
  it("arredonda para inteiro com %", () => {
    expect(pctConfianca(0.82)).toBe("82%");
    expect(pctConfianca(0.825)).toBe("83%");
    expect(pctConfianca(1)).toBe("100%");
    expect(pctConfianca(0)).toBe("0%");
  });
  it("null/undefined/não-finito → —", () => {
    expect(pctConfianca(null)).toBe("—");
    expect(pctConfianca(undefined)).toBe("—");
    expect(pctConfianca(NaN)).toBe("—");
  });
});

describe("rotuloGrau", () => {
  it("por extenso, e sem grau quando null", () => {
    expect(rotuloGrau("alta")).toBe("confiança alta");
    expect(rotuloGrau("media")).toBe("confiança média");
    expect(rotuloGrau("baixa")).toBe("confiança baixa");
    expect(rotuloGrau(null)).toBe("sem confiança");
  });
});

describe("aparenciaConfianca", () => {
  it("mapeia a confiança para as cores do grau", () => {
    expect(aparenciaConfianca(0.9)).toBe(CORES_GRAU.alta);
    expect(aparenciaConfianca(0.7)).toBe(CORES_GRAU.media);
    expect(aparenciaConfianca(0.3)).toBe(CORES_GRAU.baixa);
  });
  it("sem confiança medida → aparência neutra", () => {
    expect(aparenciaConfianca(null)).toBe(CORES_GRAU_NEUTRO);
    expect(aparenciaConfianca(undefined)).toBe(CORES_GRAU_NEUTRO);
    expect(aparenciaConfianca(NaN)).toBe(CORES_GRAU_NEUTRO);
  });
});
