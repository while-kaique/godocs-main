import { describe, it, expect } from "vitest";
import { parseDataFlexivel, fmtDataBR, toIsoOrNull } from "@/lib/format-date";

describe("parseDataFlexivel — ISO + pt-BR", () => {
  it("parseia ISO", () => {
    expect(parseDataFlexivel("2026-06-22T12:08:06.668Z")?.toISOString()).toBe(
      "2026-06-22T12:08:06.668Z",
    );
  });
  it("parseia pt-BR dd/mm/yyyy HH:MM:SS (em UTC, como a planilha grava)", () => {
    expect(parseDataFlexivel("22/06/2026 09:08:11")?.toISOString()).toBe(
      "2026-06-22T09:08:11.000Z",
    );
  });
  it("parseia pt-BR só data dd/mm/yyyy", () => {
    expect(parseDataFlexivel("03/06/2026")?.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });
  it("aceita 'yyyy-mm-dd HH:MM:SS' (created_at do sync)", () => {
    expect(parseDataFlexivel("2026-06-22 15:53:59")).not.toBeNull();
  });
  it("vazio/nulo/lixo → null", () => {
    expect(parseDataFlexivel(null)).toBeNull();
    expect(parseDataFlexivel("")).toBeNull();
    expect(parseDataFlexivel("não é data")).toBeNull();
  });
});

describe("fmtDataBR — exibição (não retorna 'Invalid date')", () => {
  it("formata pt-BR sem deslocar o dia (UTC)", () => {
    // bug original: new Date('22/06/2026 ...') → 'Invalid date'
    const out = fmtDataBR("22/06/2026 09:08:11");
    expect(out).not.toMatch(/invalid/i);
    expect(out).toContain("2026");
    expect(out).toMatch(/^22\b/); // dia 22, sem shift de fuso
  });
  it("data-only pt-BR não cai para o dia anterior", () => {
    expect(fmtDataBR("03/06/2026")).toMatch(/^03\b/);
  });
  it("formata ISO", () => {
    expect(fmtDataBR("2026-06-22T12:08:06.668Z")).toMatch(/^22\b/);
  });
  it("nulo → travessão", () => {
    expect(fmtDataBR(null)).toBe("—");
  });
});

describe("toIsoOrNull — normalização na ingestão do sync reverso", () => {
  it("pt-BR → ISO", () => {
    expect(toIsoOrNull("22/06/2026 09:08:11")).toBe("2026-06-22T09:08:11.000Z");
  });
  it("ISO passa adiante", () => {
    expect(toIsoOrNull("2026-06-22T12:08:06.668Z")).toBe("2026-06-22T12:08:06.668Z");
  });
  it("vazio → null", () => {
    expect(toIsoOrNull("")).toBeNull();
    expect(toIsoOrNull(null)).toBeNull();
  });
});
