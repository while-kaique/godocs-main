import { describe, it, expect } from "vitest";
import { buildSavingPrompt } from "@/lib/agents/orchestrator";
import { documentacaoVazia, savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// F4 — Carga real × ganho por escala. Quando ALGUÉM fazia a tarefa à mão
// (alguem_fazia='sim') e o saving é recorrente (não pontual), o agente separa o total
// de horas em horas_carga_real (trabalho humano de fato) e horas_escala (volume
// incremental que só a automação cobre). O TOTAL não muda — o split é transparência.
// Mecanismo prompt-enforced (sem gate determinístico). Ver buildSavingPrompt.

const ctx = (over: Partial<ProjetoContexto> = {}): ProjetoContexto =>
  ({
    nome_projeto: "Projeto X",
    ferramenta: "Python",
    membros: [],
    alguem_fazia: "sim",
    ...over,
  }) as unknown as ProjetoContexto;

const linha = (over: Partial<SavingLinha> = {}): SavingLinha => ({
  cargo: "Analista",
  horas_antes: 132,
  horas_depois: 0,
  valor_hora: 50,
  economia_horas_mes: 132,
  economia_reais_mes: 0,
  ...over,
});

const saving = (over: Partial<SavingColetado> = {}): SavingColetado => ({
  ...savingVazio(),
  tipo_saving: "mensal",
  economia_horas_mes: 132,
  linhas: [linha()],
  ...over,
});

const BLOCO = "CARGA REAL × GANHO POR ESCALA";
const GATE = "GATE CARGA REAL × ESCALA";

describe("buildSavingPrompt — bloco carga real × escala", () => {
  it("injeta o bloco e o gate quando alguém fazia (sim) e é mensal com horas reais", () => {
    const p = buildSavingPrompt(ctx(), documentacaoVazia(), saving(), "resumo");
    expect(p).toContain(BLOCO);
    expect(p).toContain(GATE);
    expect(p).toContain("horas_carga_real");
    expect(p).toContain("horas_escala");
  });

  it("NÃO injeta no contrafactual (ninguém fazia)", () => {
    const p = buildSavingPrompt(ctx({ alguem_fazia: "nao" }), documentacaoVazia(), saving(), "resumo");
    expect(p).not.toContain(BLOCO);
    expect(p).not.toContain(GATE);
  });

  it("NÃO injeta no custo evitado puro (externo) — fluxo dedicado sem horas", () => {
    const p = buildSavingPrompt(ctx({ alguem_fazia: "externo" }), documentacaoVazia(), saving(), "resumo");
    expect(p).not.toContain(BLOCO);
  });

  it("NÃO injeta no pontual (sem repetição → sem escala)", () => {
    const p = buildSavingPrompt(ctx(), documentacaoVazia(), saving({ tipo_saving: "pontual" }), "resumo");
    expect(p).not.toContain(BLOCO);
  });

  it("NÃO injeta quando não há horas reais (todas 0h antes)", () => {
    const semHoras = saving({
      economia_horas_mes: 0,
      linhas: [linha({ horas_antes: 0, horas_depois: 0, economia_horas_mes: 0 })],
    });
    const p = buildSavingPrompt(ctx(), documentacaoVazia(), semHoras, "resumo");
    expect(p).not.toContain(BLOCO);
  });
});
