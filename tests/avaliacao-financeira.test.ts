import { describe, it, expect } from "vitest";
import {
  avaliarFinanceiro,
  TETO_MATERIALIDADE_FINANCEIRO,
} from "@/lib/agents/avaliacao-financeira";

describe("TETO_MATERIALIDADE_FINANCEIRO", () => {
  it("é a constante 5000", () => {
    expect(TETO_MATERIALIDADE_FINANCEIRO).toBe(5000);
  });
});

describe("avaliarFinanceiro — especialista financeiro determinístico e puro", () => {
  it("sem dados financeiros (nem saving nem receita) → inconclusivo, confiança 0.5, um sinal e motivo sobre 'sem dados'", () => {
    const r = avaliarFinanceiro({});
    expect(r.veredito).toBe("inconclusivo");
    expect(r.confianca).toBe(0.5);
    expect(r.sinais).toHaveLength(1);
    expect(r.motivo).not.toBeNull();
    expect(String(r.motivo)).toMatch(/sem dados/i);
  });

  it("saving e receita coerentes, materialidade baixa, sem red flags → ok, confiança 0.9, sinais vazio, motivo null", () => {
    const r = avaliarFinanceiro({
      temSaving: true,
      economiaReaisMes: 1200,
      economiaHorasMes: 20,
      materialidade: 1200,
    });
    expect(r.veredito).toBe("ok");
    expect(r.confianca).toBe(0.9);
    expect(r.sinais).toEqual([]);
    expect(r.motivo).toBeNull();
  });

  it("materialidade acima do teto default (8000 > 5000) com saving coerente → atenção, confiança 0.3, sinal menciona 'materialidade', motivo não-nulo", () => {
    const r = avaliarFinanceiro({
      temSaving: true,
      economiaReaisMes: 8000,
      economiaHorasMes: 120,
      materialidade: 8000,
    });
    expect(r.veredito).toBe("atencao");
    expect(r.confianca).toBe(0.3);
    expect(r.sinais.some((s) => /materialidade/i.test(s))).toBe(true);
    expect(r.motivo).not.toBeNull();
  });

  it("saving marcado mas economiaReaisMes ≤ 0 → atenção, algum sinal menciona ganho/líquido", () => {
    const r = avaliarFinanceiro({
      temSaving: true,
      economiaReaisMes: 0,
      materialidade: 0,
    });
    expect(r.veredito).toBe("atencao");
    expect(r.sinais.some((s) => /ganho|l[ií]quido/i.test(s))).toBe(true);
  });

  it("receita marcada mas valorReceitaMensal ≤ 0 → atenção", () => {
    const r = avaliarFinanceiro({
      temReceita: true,
      valorReceitaMensal: 0,
      materialidade: 0,
    });
    expect(r.veredito).toBe("atencao");
  });

  it("possível dupla contagem: custoEvitado e receita praticamente iguais → atenção, sinal menciona 'dupla contagem'", () => {
    const r = avaliarFinanceiro({
      temSaving: true,
      temReceita: true,
      custoEvitadoReais: 10000,
      valorReceitaMensal: 10000,
      economiaReaisMes: 10000,
      materialidade: 4000,
    });
    expect(r.veredito).toBe("atencao");
    expect(r.sinais.some((s) => /dupla contagem/i.test(s))).toBe(true);
  });

  it("custoEvitado e receita ambos > 0 mas muito diferentes → NÃO dispara dupla contagem, veredito ok", () => {
    const r = avaliarFinanceiro({
      temSaving: true,
      temReceita: true,
      custoEvitadoReais: 10000,
      valorReceitaMensal: 500,
      economiaReaisMes: 10000,
      materialidade: 4000,
    });
    expect(r.veredito).toBe("ok");
    expect(r.sinais.some((s) => /dupla contagem/i.test(s))).toBe(false);
  });

  it("teto custom respeitado: materialidade 6000 com teto 10000 → NÃO dispara por materialidade (ok)", () => {
    const r = avaliarFinanceiro({
      temSaving: true,
      economiaReaisMes: 6000,
      economiaHorasMes: 90,
      materialidade: 6000,
      teto: 10000,
    });
    expect(r.veredito).toBe("ok");
  });

  it("confiança está sempre em [0,1] em vários cenários", () => {
    const cenarios = [
      avaliarFinanceiro({}),
      avaliarFinanceiro({ temSaving: true, economiaReaisMes: 1200, materialidade: 1200 }),
      avaliarFinanceiro({ temSaving: true, economiaReaisMes: 8000, materialidade: 8000 }),
      avaliarFinanceiro({ temSaving: true, economiaReaisMes: 0, materialidade: 0 }),
      avaliarFinanceiro({ temReceita: true, valorReceitaMensal: 0, materialidade: 0 }),
    ];
    for (const r of cenarios) {
      expect(r.confianca).toBeGreaterThanOrEqual(0);
      expect(r.confianca).toBeLessThanOrEqual(1);
    }
  });
});
