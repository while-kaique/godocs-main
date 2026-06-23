import { describe, it, expect } from "vitest";
import { buildSavingPrompt, buildSavingPreviewPrompt } from "@/lib/agents/orchestrator";
import { documentacaoVazia, savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// Gate de ECONOMIA ALTA (≥44h/mês, só saving MENSAL): quando o saving mensal total
// (ou um cargo individual) atinge 44h/mês — uma jornada semanal CLT poupada por mês —
// o agente é OBRIGADO a investigar e registrar no memorial "o que mudou após a
// automação". Pontual fica de fora. Ver buildSavingPrompt em orchestrator.ts.

const ctx: ProjetoContexto = {
  nome_projeto: "Projeto X",
  ferramenta: "Python",
  membros: [],
  alguem_fazia: "sim",
} as unknown as ProjetoContexto;

const linha = (over: Partial<SavingLinha>): SavingLinha => ({
  cargo: "Analista",
  horas_antes: 0,
  horas_depois: 0,
  valor_hora: 50,
  economia_horas_mes: 0,
  economia_reais_mes: 0,
  ...over,
});

function saving(over: Partial<SavingColetado>): SavingColetado {
  return { ...savingVazio(), tipo_saving: "mensal", ...over };
}

const MARCADOR_2_4 = "SEÇÃO 2.4 — O QUE MUDOU APÓS A AUTOMAÇÃO";

describe("gate de economia alta — buildSavingPrompt", () => {
  it("dispara quando o total mensal é ≥ 44h (Seção 2.4 injetada)", () => {
    const s = saving({
      economia_horas_mes: 124,
      linhas: [linha({ horas_antes: 135, horas_depois: 11, economia_horas_mes: 124 })],
    });
    const prompt = buildSavingPrompt(ctx, documentacaoVazia(), s, "resumo");
    expect(prompt).toContain(MARCADOR_2_4);
    expect(prompt).toContain("124h/mês");
    // gate adicional no passo 4 do "COMO CONDUZIR"
    expect(prompt).toContain("GATE ADICIONAL");
    // a justificativa de validade é registro obrigatório no ponto fixo [2.4]
    expect(prompt).toContain("REGISTRO OBRIGATÓRIO NO MEMORIAL (ponto fixo [2.4])");
    expect(prompt).toContain("JUSTIFICATIVA");
  });

  it("dispara no limiar exato de 44h", () => {
    const s = saving({
      economia_horas_mes: 44,
      linhas: [linha({ horas_antes: 44, horas_depois: 0, economia_horas_mes: 44 })],
    });
    expect(buildSavingPrompt(ctx, documentacaoVazia(), s, "")).toContain(MARCADOR_2_4);
  });

  it("dispara pela soma de várias pessoas (total ≥ 44h mesmo sem cargo individual ≥ 44h)", () => {
    const s = saving({
      economia_horas_mes: 60,
      linhas: [
        linha({ cargo: "Analista", horas_antes: 30, economia_horas_mes: 30 }),
        linha({ cargo: "Estagiário", horas_antes: 30, economia_horas_mes: 30 }),
      ],
    });
    expect(buildSavingPrompt(ctx, documentacaoVazia(), s, "")).toContain(MARCADOR_2_4);
  });

  it("NÃO dispara abaixo de 44h", () => {
    const s = saving({
      economia_horas_mes: 30,
      linhas: [linha({ horas_antes: 30, economia_horas_mes: 30 })],
    });
    const prompt = buildSavingPrompt(ctx, documentacaoVazia(), s, "");
    expect(prompt).not.toContain(MARCADOR_2_4);
    expect(prompt).not.toContain("GATE ADICIONAL");
  });

  it("NÃO dispara para saving PONTUAL, mesmo com total alto", () => {
    const s = saving({
      tipo_saving: "pontual",
      economia_horas_mes: 200,
      linhas: [linha({ horas_antes: 200, economia_horas_mes: 200 })],
    });
    expect(buildSavingPrompt(ctx, documentacaoVazia(), s, "")).not.toContain(MARCADOR_2_4);
  });
});

describe("gate de economia alta — buildSavingPreviewPrompt (rede de segurança)", () => {
  it("exige a explicação do que mudou ao aprovar economia alta mensal", () => {
    const s = saving({
      economia_horas_mes: 124,
      linhas: [linha({ horas_antes: 135, horas_depois: 11, economia_horas_mes: 124 })],
      memorial_calculo: "memorial sem explicar o que mudou",
    });
    expect(buildSavingPreviewPrompt(s)).toContain("ECONOMIA ALTA");
  });

  it("não adiciona a rede de segurança para saving pontual", () => {
    const s = saving({
      tipo_saving: "pontual",
      economia_horas_mes: 200,
      linhas: [linha({ horas_antes: 200, economia_horas_mes: 200 })],
    });
    expect(buildSavingPreviewPrompt(s)).not.toContain("ECONOMIA ALTA");
  });
});
