import { describe, it, expect } from "vitest";
import { recomputarSavingFinanceiro } from "@/lib/agents/saving-calc";
import type { SavingColetado } from "@/lib/agents/types";

describe("recomputarSavingFinanceiro — R$ derivado das horas (backend é a fonte de verdade)", () => {
  // Cenário real do bug (projeto AVD da Jessica): o agente reajustou a linha de
  // 0h→1.5h para 30h→1.5h, setou economia_horas_mes=28.5, mas deixou
  // economia_reais_mes=0. Sem recálculo, saving_reais=0 vazava para a planilha.
  it("corrige economia_reais_mes=0 deixado pelo LLM ao reajustar horas", () => {
    const savingDoLLM: SavingColetado = {
      linhas: [
        {
          cargo: "Especialista / Gestor / Head",
          horas_antes: 30,
          horas_depois: 1.5,
          valor_hora: 55.15,
          economia_horas_mes: 28.5,
          economia_reais_mes: 0, // ← bug: LLM não recalcula R$
        },
      ],
      economia_horas_mes: 28.5,
      economia_reais_mes: 0, // ← bug
      tipo_saving: "pontual",
      memorial_calculo: "...",
      valor_ganho_mensal: null,
    } as SavingColetado;

    const out = recomputarSavingFinanceiro(savingDoLLM);

    expect(out.linhas[0].economia_reais_mes).toBe(1571.78); // 28.5 × 55.15
    expect(out.economia_horas_mes).toBe(28.5);
    expect(out.economia_reais_mes).toBe(1571.78);
  });

  it("deriva valor_hora pela tabela CARGOS a partir do cargo", () => {
    const out = recomputarSavingFinanceiro({
      linhas: [
        {
          cargo: "Analista Pleno",
          horas_antes: 40,
          horas_depois: 6,
          valor_hora: 0,
          economia_horas_mes: 0,
          economia_reais_mes: 0,
        },
      ],
      economia_horas_mes: null,
      economia_reais_mes: null,
      tipo_saving: "mensal",
      memorial_calculo: null,
      valor_ganho_mensal: null,
    } as SavingColetado);

    expect(out.linhas[0].valor_hora).toBe(29.9);
    expect(out.linhas[0].economia_horas_mes).toBe(34); // 40 - 6
    expect(out.linhas[0].economia_reais_mes).toBe(1016.6); // 34 × 29.9
  });

  it("soma múltiplas linhas e abate o custo externo mensal do total líquido", () => {
    const out = recomputarSavingFinanceiro(
      {
        linhas: [
          {
            cargo: "Analista Pleno",
            horas_antes: 40,
            horas_depois: 6,
            valor_hora: 29.9,
            economia_horas_mes: 34,
            economia_reais_mes: 1016.6,
          },
          {
            cargo: "Assistente",
            horas_antes: 20,
            horas_depois: 0,
            valor_hora: 13.94,
            economia_horas_mes: 20,
            economia_reais_mes: 278.8,
          },
        ],
        economia_horas_mes: 54,
        economia_reais_mes: 1295.4,
        tipo_saving: "mensal",
        memorial_calculo: null,
        valor_ganho_mensal: null,
      } as SavingColetado,
      300, // custo externo mensal
    );

    expect(out.economia_horas_mes).toBe(54);
    expect(out.economia_reais_mes).toBe(995.4); // 1295.4 - 300
  });

  it("clampa ganho negativo de horas em 0 (horas_depois > horas_antes)", () => {
    const out = recomputarSavingFinanceiro({
      linhas: [
        {
          cargo: "Assistente",
          horas_antes: 0,
          horas_depois: 5,
          valor_hora: 13.94,
          economia_horas_mes: 0,
          economia_reais_mes: 0,
        },
      ],
      economia_horas_mes: null,
      economia_reais_mes: null,
      tipo_saving: "mensal",
      memorial_calculo: null,
      valor_ganho_mensal: null,
    } as SavingColetado);

    expect(out.linhas[0].economia_horas_mes).toBe(0);
    expect(out.linhas[0].economia_reais_mes).toBe(0);
    expect(out.economia_reais_mes).toBe(0);
  });
});
