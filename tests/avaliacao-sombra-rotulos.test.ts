import { describe, it, expect } from "vitest";
import {
  rotuloVeredito,
  rotuloEstadoDeliberacao,
  rotuloResultadoRetroativo,
  rotuloGrau,
  medicaoDaConfianca,
  faixaDeConfianca,
  grauConfianca,
  aparenciaConfianca,
  CORES_GRAU,
  CORES_GRAU_NEUTRO,
} from "@/lib/avaliacao-sombra-rotulos";
import { agruparCalibragem } from "@/lib/avaliacao-calibragem";
import { readFileSync } from "node:fs";

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

describe("medicaoDaConfianca (INV-18 — frequência medida ou nada)", () => {
  const cheia = agruparCalibragem([
    ...Array.from({ length: 24 }, () => ({ grau: "alta", resultado: "acerto" })),
    ...Array.from({ length: 6 }, () => ({ grau: "alta", resultado: "conservador" })),
    ...Array.from({ length: 3 }, () => ({ grau: "baixa", resultado: "acerto" })),
  ]);

  it("faixa COM amostra: devolve a taxa em 10 e a frase com o n", () => {
    const r = medicaoDaConfianca(0.9, cheia);
    expect(r.faixa).toBe("alta");
    expect(r.emDez).toBe(8); // 24 de 30
    expect(r.medicao).toContain("8 de 10");
    expect(r.medicao).toContain("30 casos");
  });

  it("faixa SEM amostra suficiente: nenhum número, e a frase diz que não há medição", () => {
    const r = medicaoDaConfianca(0.2, cheia);
    expect(r.faixa).toBe("baixa");
    expect(r.emDez).toBeNull();
    expect(r.medicao).toBe("ainda sem medição");
  });

  it("sem calibragem nenhuma (ou sem número de confiança) não inventa percentual", () => {
    expect(medicaoDaConfianca(0.9, null).emDez).toBeNull();
    expect(medicaoDaConfianca(0.9, null).medicao).toBe("ainda sem medição");
    expect(medicaoDaConfianca(null, cheia).emDez).toBeNull();
    expect(faixaDeConfianca(null)).toBeNull();
    expect(faixaDeConfianca(NaN)).toBeNull();
  });
});

describe("canário: nenhuma tela traduz a confiança em percentual (INV-18)", () => {
  const telas = [
    "src/components/dashboard/chip-sombra.tsx",
    "src/components/dashboard/projeto-detalhe-dialog.tsx",
    "src/routes/_authenticated/dashboard.tsx",
  ];
  it("pctConfianca não existe mais e nenhum componente calcula % de confiança", () => {
    const rotulos = readFileSync("src/lib/avaliacao-sombra-rotulos.ts", "utf8");
    expect(rotulos).not.toMatch(/export function pctConfianca/);
    for (const t of telas) {
      const src = readFileSync(t, "utf8");
      // A CHAMADA, não a palavra: os comentários que registram a remoção podem (e devem) citá-la.
      expect(src, t).not.toMatch(/pctConfianca\s*\(/);
      // `conf * 100` era a outra forma de dizer a mesma mentira.
      expect(src, t).not.toMatch(/confianca[^\n]{0,20}\*\s*100/);
    }
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
