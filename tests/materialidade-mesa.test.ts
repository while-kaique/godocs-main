import { describe, it, expect } from "vitest";
import { materialidadeMesa } from "@/lib/avaliacao-normais.functions";

describe("materialidadeMesa", () => {
  it("guard do bug: receita entra ÷10, não crua (0, 51000 → 5100)", () => {
    expect(materialidadeMesa(0, 51000)).toBe(5100);
  });

  it("saving cheio + receita ÷10 (3000, 20000 → 5000)", () => {
    expect(materialidadeMesa(3000, 20000)).toBe(5000);
  });

  it("só saving, receita null (4200, null → 4200)", () => {
    expect(materialidadeMesa(4200, null)).toBe(4200);
  });

  it("nulls tratados como 0 (null, null → 0)", () => {
    expect(materialidadeMesa(null, null)).toBe(0);
  });

  it("só receita, saving null (null, 51000 → 5100)", () => {
    expect(materialidadeMesa(null, 51000)).toBe(5100);
  });
});
