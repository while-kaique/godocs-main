import { describe, it, expect } from "vitest";
import {
  montarPayloadRollup,
  montarSerieCumulativa,
  inicioDoMesIso,
  type CelulaRollup,
} from "@/lib/rollup-push.functions";

const cel = (over: Partial<CelulaRollup>): CelulaRollup => ({
  periodo: "2026-05",
  area: "Fiscal",
  tipo_saving: "mensal",
  saving_reais: 0,
  receita_reais: 0,
  num_projetos: 1,
  ...over,
});

describe("série cumulativa por área — montarSerieCumulativa", () => {
  it("saving mensal acumula: R$2.000 no mês 5 → R$6.000 no mês 7 (o caso do Gabriel)", () => {
    const serie = montarSerieCumulativa(
      [cel({ periodo: "2026-05", area: "Fiscal", saving_reais: 2000 })],
      "2026-07",
    );
    expect(serie.map((l) => [l.periodo, l.saving_reais])).toEqual([
      ["2026-05", 2000],
      ["2026-06", 4000],
      ["2026-07", 6000],
    ]);
  });

  it("pontual entra uma vez e fica plano; desconhecido idem (não infla)", () => {
    const serie = montarSerieCumulativa(
      [
        cel({ periodo: "2026-05", area: "CX", tipo_saving: "pontual", saving_reais: 500 }),
        cel({ periodo: "2026-05", area: "CX", tipo_saving: "sei-la", saving_reais: 100 }),
      ],
      "2026-07",
    );
    expect(serie.every((l) => l.saving_reais === 600)).toBe(true);
  });

  it("trimestral só multiplica a cada 3 meses", () => {
    const serie = montarSerieCumulativa(
      [cel({ periodo: "2026-01", area: "T", tipo_saving: "trimestral", saving_reais: 900 })],
      "2026-04",
    );
    // jan/fev/mar = 1×; abr (dm=3) = 2×
    expect(serie.map((l) => l.saving_reais)).toEqual([900, 900, 900, 1800]);
  });

  it("receita acumula mensal e fica separada do saving; num_projetos é running total", () => {
    const serie = montarSerieCumulativa(
      [
        cel({ periodo: "2026-05", area: "G", saving_reais: 0, receita_reais: 1000, num_projetos: 1 }),
        cel({ periodo: "2026-06", area: "G", saving_reais: 300, receita_reais: 0, num_projetos: 2 }),
      ],
      "2026-06",
    );
    const jun = serie.find((l) => l.periodo === "2026-06")!;
    expect(jun.receita_reais).toBe(2000); // 1000 × 2 meses
    expect(jun.saving_reais).toBe(300);
    expect(jun.num_projetos).toBe(3); // 1 + 2 acumulados
  });
});

describe("payload — montarPayloadRollup (contrato do squad Intelli)", () => {
  it("emite granularity:month + rollups com period_key/period_start ISO", () => {
    const serie = montarSerieCumulativa(
      [cel({ periodo: "2026-05", area: "Fiscal", saving_reais: 2000 })],
      "2026-06",
    );
    const p = montarPayloadRollup(serie);
    expect(p.granularity).toBe("month");
    expect(p.rollups[0]).toMatchObject({
      period_key: "2026-05",
      period_start: "2026-05-01",
      area: "Fiscal",
    });
    // contrato antigo não existe mais
    expect((p as Record<string, unknown>).grao).toBeUndefined();
    expect((p as Record<string, unknown>).celulas).toBeUndefined();
    expect((p as Record<string, unknown>).source).toBeUndefined();
  });

  it("inicioDoMesIso deriva o 1º dia e é idempotente", () => {
    expect(inicioDoMesIso("2026-07")).toBe("2026-07-01");
    expect(inicioDoMesIso("2026-12-01")).toBe("2026-12-01");
  });
});
