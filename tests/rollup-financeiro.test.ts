import { describe, it, expect } from "vitest";
import {
  AREA_NAO_IDENTIFICADA,
  TIPO_SAVING_INDEFINIDO,
  periodoMensal,
  agregarRollupMensal,
  derivarTotaisPorArea,
  type ProjetoRollupInput,
  type CelulaRollup,
} from "@/lib/rollup-financeiro";

const proj = (over: Partial<ProjetoRollupInput>): ProjetoRollupInput => ({
  submitted_at: "2026-06-15T12:00:00.000Z",
  area: "Fiscal",
  tipo_saving: "mensal",
  saving_reais: 0,
  receita_reais: 0,
  ...over,
});

describe("periodoMensal", () => {
  it("extrai YYYY-MM de um ISO válido", () => {
    expect(periodoMensal("2026-06-15T12:00:00.000Z")).toBe("2026-06");
    expect(periodoMensal("2026-11-30T23:00:00.000Z")).toBe("2026-11");
  });

  it("devolve null para entrada ausente ou inválida", () => {
    expect(periodoMensal(null)).toBeNull();
    expect(periodoMensal("")).toBeNull();
    expect(periodoMensal("lixo")).toBeNull();
  });
});

describe("agregarRollupMensal", () => {
  it("soma dois projetos na mesma (mês, área, tipo) numa única célula", () => {
    const celulas = agregarRollupMensal([
      proj({ saving_reais: 100, receita_reais: 10 }),
      proj({ saving_reais: 200, receita_reais: 20 }),
    ]);
    expect(celulas).toHaveLength(1);
    const c = celulas[0];
    expect(c.periodo).toBe("2026-06");
    expect(c.area).toBe("Fiscal");
    expect(c.tipo_saving).toBe("mensal");
    expect(c.saving_reais).toBe(300);
    expect(c.receita_reais).toBe(30);
    expect(c.num_projetos).toBe(2);
    expect(c.grao).toBe("mensal");
  });

  it("separa células quando o tipo_saving difere na mesma (mês, área)", () => {
    const celulas = agregarRollupMensal([
      proj({ tipo_saving: "mensal", saving_reais: 100 }),
      proj({ tipo_saving: "pontual", saving_reais: 200 }),
    ]);
    expect(celulas).toHaveLength(2);
    const tipos = celulas.map((c) => c.tipo_saving).sort();
    expect(tipos).toEqual(["mensal", "pontual"]);
  });

  it("usa ÁREA NÃO IDENTIFICADA quando a área é null ou vazia", () => {
    const cNull = agregarRollupMensal([proj({ area: null, saving_reais: 5 })]);
    expect(cNull).toHaveLength(1);
    expect(cNull[0].area).toBe(AREA_NAO_IDENTIFICADA);

    const cVazia = agregarRollupMensal([proj({ area: "", saving_reais: 5 })]);
    expect(cVazia).toHaveLength(1);
    expect(cVazia[0].area).toBe(AREA_NAO_IDENTIFICADA);
  });

  it("usa TIPO_SAVING_INDEFINIDO quando o tipo_saving é null ou vazio", () => {
    const cNull = agregarRollupMensal([proj({ tipo_saving: null, saving_reais: 5 })]);
    expect(cNull).toHaveLength(1);
    expect(cNull[0].tipo_saving).toBe(TIPO_SAVING_INDEFINIDO);

    const cVazia = agregarRollupMensal([proj({ tipo_saving: "", saving_reais: 5 })]);
    expect(cVazia).toHaveLength(1);
    expect(cVazia[0].tipo_saving).toBe(TIPO_SAVING_INDEFINIDO);
  });

  it("exclui projetos com submitted_at null ou período inválido", () => {
    const celulas = agregarRollupMensal([
      proj({ submitted_at: null, saving_reais: 999 }),
      proj({ submitted_at: "lixo", saving_reais: 999 }),
      proj({ submitted_at: "2026-06-15T12:00:00.000Z", saving_reais: 1 }),
    ]);
    expect(celulas).toHaveLength(1);
    expect(celulas[0].saving_reais).toBe(1);
    expect(celulas[0].num_projetos).toBe(1);
  });

  it("trata saving_reais/receita_reais null como 0", () => {
    const celulas = agregarRollupMensal([
      proj({ saving_reais: null, receita_reais: null }),
    ]);
    expect(celulas).toHaveLength(1);
    expect(celulas[0].saving_reais).toBe(0);
    expect(celulas[0].receita_reais).toBe(0);
    expect(celulas[0].num_projetos).toBe(1);
  });

  it("arredonda os totais a 2 casas decimais", () => {
    const celulas = agregarRollupMensal([
      proj({ saving_reais: 0.1, receita_reais: 0.1 }),
      proj({ saving_reais: 0.2, receita_reais: 0.2 }),
    ]);
    expect(celulas).toHaveLength(1);
    expect(celulas[0].saving_reais).toBe(0.3);
    expect(celulas[0].receita_reais).toBe(0.3);
  });

  it("conta 1 projeto (não 2) quando ele tem saving E receita, somando os dois valores", () => {
    const celulas = agregarRollupMensal([
      proj({ saving_reais: 100, receita_reais: 50 }),
    ]);
    expect(celulas).toHaveLength(1);
    expect(celulas[0].num_projetos).toBe(1);
    expect(celulas[0].saving_reais).toBe(100);
    expect(celulas[0].receita_reais).toBe(50);
  });

  it("devolve [] para entrada vazia", () => {
    expect(agregarRollupMensal([])).toEqual([]);
  });
});

describe("derivarTotaisPorArea", () => {
  const cel = (over: Partial<CelulaRollup>): CelulaRollup => ({
    grao: "mensal",
    periodo: "2026-06",
    area: "Fiscal",
    tipo_saving: "mensal",
    saving_reais: 0,
    receita_reais: 0,
    num_projetos: 1,
    ...over,
  });

  it("soma os tipos_saving numa única linha por (periodo, área)", () => {
    const totais = derivarTotaisPorArea([
      cel({ tipo_saving: "mensal", saving_reais: 100, receita_reais: 10 }),
      cel({ tipo_saving: "pontual", saving_reais: 200, receita_reais: 20 }),
    ]);
    const fiscal = totais.filter((t) => t.area === "Fiscal" && t.periodo === "2026-06");
    expect(fiscal).toHaveLength(1);
    expect(fiscal[0].saving_reais).toBe(300);
    expect(fiscal[0].receita_reais).toBe(30);
  });

  it("nunca produz linha de total geral (nem linha sem área, nem agregado entre áreas)", () => {
    const totais = derivarTotaisPorArea([
      cel({ area: "Fiscal", saving_reais: 100 }),
      cel({ area: "Contábil", saving_reais: 200 }),
    ]);
    // exatamente 2 TotalArea (uma por área), jamais uma 3ª "consolidada"
    const doPeriodo = totais.filter((t) => t.periodo === "2026-06");
    expect(doPeriodo).toHaveLength(2);
    const areas = doPeriodo.map((t) => t.area).sort();
    expect(areas).toEqual(["Contábil", "Fiscal"]);
    // nenhuma linha sem área
    expect(totais.every((t) => t.area && t.area.length > 0)).toBe(true);
  });
});
