import { describe, it, expect } from "vitest";
import { montarPayloadRollup } from "@/lib/rollup-push.functions";

const cel = (over: Partial<Record<string, unknown>>) => ({
  periodo: "2026-06",
  area: "Fiscal",
  tipo_saving: "mensal",
  saving_reais: 0,
  receita_reais: 0,
  num_projetos: 1,
  ...over,
}) as {
  periodo: string;
  area: string;
  tipo_saving: string;
  saving_reais: number;
  receita_reais: number;
  num_projetos: number;
};

describe("push do rollup — montarPayloadRollup (contrato do squad Intelli)", () => {
  const celulas = [
    cel({ area: "Fiscal", tipo_saving: "mensal", saving_reais: 100 }),
    cel({ area: "Fiscal", tipo_saving: "pontual", saving_reais: 50 }),
    cel({ area: "CX", tipo_saving: "mensal", saving_reais: 200, receita_reais: 500 }),
  ];

  it("carimba origem/ambiente/gerado_em e mantém a cadência crua", () => {
    const p = montarPayloadRollup(celulas, "staging", "2026-06-26T00:00:00.000Z");
    expect(p.origem).toBe("godocs");
    expect(p.ambiente).toBe("staging");
    expect(p.gerado_em).toBe("2026-06-26T00:00:00.000Z");
    expect(p.grao).toBe("mensal");
    expect(p.celulas).toHaveLength(3);
    // tipo_saving cru preservado (o Gabriel normaliza)
    expect(new Set(p.celulas.map((c) => c.tipo_saving))).toEqual(new Set(["mensal", "pontual"]));
  });

  it("deriva totais POR ÁREA, com saving e receita SEPARADOS", () => {
    const p = montarPayloadRollup(celulas, "producao", "2026-06-26T00:00:00.000Z");
    const fiscal = p.totais_area.find((t) => t.area === "Fiscal" && t.periodo === "2026-06");
    const cx = p.totais_area.find((t) => t.area === "CX" && t.periodo === "2026-06");
    expect(fiscal).toEqual({
      periodo: "2026-06", area: "Fiscal", saving_reais: 150, receita_reais: 0, num_projetos: 2,
    });
    expect(cx).toEqual({
      periodo: "2026-06", area: "CX", saving_reais: 200, receita_reais: 500, num_projetos: 1,
    });
  });

  it("NÃO emite total geral da empresa (todo total tem área)", () => {
    const p = montarPayloadRollup(celulas, "producao", "2026-06-26T00:00:00.000Z");
    expect(p.totais_area.every((t) => typeof t.area === "string" && t.area.length > 0)).toBe(true);
    // não há chave de topo que some saving+receita nem que agregue entre áreas
    expect((p as Record<string, unknown>).total_geral).toBeUndefined();
    expect((p as Record<string, unknown>).ganho_total).toBeUndefined();
  });
});
