import { describe, it, expect } from "vitest";
import {
  montarPayloadRollup,
  inicioDoMesIso,
  type CelulaRollup,
} from "@/lib/rollup-push.functions";

const cel = (over: Partial<CelulaRollup>): CelulaRollup => ({
  periodo: "2026-06",
  area: "Fiscal",
  tipo_saving: "mensal",
  saving_reais: 0,
  receita_reais: 0,
  num_projetos: 1,
  ...over,
});

describe("push do rollup — montarPayloadRollup (contrato REAL do squad Intelli)", () => {
  const celulas = [
    cel({ area: "Fiscal", tipo_saving: "mensal", saving_reais: 100 }),
    cel({ area: "Fiscal", tipo_saving: "pontual", saving_reais: 50 }),
    cel({ area: "CX", tipo_saving: "mensal", saving_reais: 200, receita_reais: 500 }),
  ];

  it("emite envelope granularity:month + rollups[] (não grao/celulas)", () => {
    const p = montarPayloadRollup(celulas);
    expect(p.granularity).toBe("month");
    expect(p.rollups).toHaveLength(3);
    // o contrato antigo NÃO deve mais existir
    expect((p as Record<string, unknown>).grao).toBeUndefined();
    expect((p as Record<string, unknown>).celulas).toBeUndefined();
    expect((p as Record<string, unknown>).totais_area).toBeUndefined();
    // source é derivado do token no lado dele — não vai no corpo
    expect((p as Record<string, unknown>).origem).toBeUndefined();
    expect((p as Record<string, unknown>).source).toBeUndefined();
  });

  it("cada item traz period_key, period_start ISO e tipo_saving cru", () => {
    const p = montarPayloadRollup(celulas);
    const item = p.rollups[0];
    expect(item.period_key).toBe("2026-06");
    expect(item.period_start).toBe("2026-06-01");
    expect(item.area).toBe("Fiscal");
    // cadência crua preservada (o Gabriel normaliza)
    expect(new Set(p.rollups.map((r) => r.tipo_saving))).toEqual(new Set(["mensal", "pontual"]));
    // saving e receita seguem SEPARADOS por item
    const cx = p.rollups.find((r) => r.area === "CX")!;
    expect(cx.saving_reais).toBe(200);
    expect(cx.receita_reais).toBe(500);
  });

  it("NÃO soma saving+receita nem emite total geral", () => {
    const p = montarPayloadRollup(celulas);
    expect((p as Record<string, unknown>).total_geral).toBeUndefined();
    expect((p as Record<string, unknown>).ganho_total).toBeUndefined();
    expect(p.rollups.every((r) => typeof r.area === "string" && r.area.length > 0)).toBe(true);
  });

  it("inicioDoMesIso deriva o primeiro dia e é idempotente", () => {
    expect(inicioDoMesIso("2026-07")).toBe("2026-07-01");
    expect(inicioDoMesIso("2026-12-01")).toBe("2026-12-01");
  });
});
