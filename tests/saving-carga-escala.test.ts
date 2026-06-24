import { describe, it, expect } from "vitest";
import { buildSavingPrompt, aplicaSplitCargaEscala } from "@/lib/agents/orchestrator";
import { documentacaoVazia, savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// F4 — Carga real × ganho por escala. Quando ALGUÉM fazia a tarefa à mão
// (alguem_fazia='sim') e o saving é recorrente (não pontual), separa o total de horas
// em horas_carga_real (trabalho humano de fato) e horas_escala (volume incremental que
// só a automação cobre). O TOTAL não muda — o split é transparência.
// A pergunta do split é um GATE DETERMINÍSTICO no backend (chat.functions.ts): o
// prompt só explica o conceito e diz que o SISTEMA conduz a pergunta. Ver
// aplicaSplitCargaEscala + o gate em enviarMensagem.

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

describe("aplicaSplitCargaEscala (escopo do gate)", () => {
  it("TRUE quando alguém fazia (sim) + recorrente + horas reais", () => {
    expect(aplicaSplitCargaEscala(ctx(), saving())).toBe(true);
    expect(aplicaSplitCargaEscala(ctx(), saving({ tipo_saving: "trimestral" }))).toBe(true);
    expect(aplicaSplitCargaEscala(ctx(), saving({ tipo_saving: "semestral" }))).toBe(true);
  });
  it("FALSE no contrafactual (nao) e no custo evitado puro (externo)", () => {
    expect(aplicaSplitCargaEscala(ctx({ alguem_fazia: "nao" }), saving())).toBe(false);
    expect(aplicaSplitCargaEscala(ctx({ alguem_fazia: "externo" }), saving())).toBe(false);
  });
  it("FALSE no pontual (trabalho único, sem escala)", () => {
    expect(aplicaSplitCargaEscala(ctx(), saving({ tipo_saving: "pontual" }))).toBe(false);
  });
  it("FALSE quando não há horas reais (todas 0h antes)", () => {
    const semHoras = saving({ linhas: [linha({ horas_antes: 0, horas_depois: 0, economia_horas_mes: 0 })] });
    expect(aplicaSplitCargaEscala(ctx(), semHoras)).toBe(false);
  });
});

describe("buildSavingPrompt — bloco carga real × escala (conduzido pelo SISTEMA)", () => {
  it("injeta o bloco e diz que o SISTEMA pergunta (não o LLM) quando aplicável", () => {
    const p = buildSavingPrompt(ctx(), documentacaoVazia(), saving(), "resumo");
    expect(p).toContain(BLOCO);
    expect(p).toContain("CONDUZIDA PELO SISTEMA");
    expect(p).toContain("horas_carga_real");
    expect(p).toContain("horas_escala");
  });

  it("NÃO injeta no contrafactual / externo / pontual / sem horas", () => {
    expect(buildSavingPrompt(ctx({ alguem_fazia: "nao" }), documentacaoVazia(), saving(), "r")).not.toContain(BLOCO);
    expect(buildSavingPrompt(ctx({ alguem_fazia: "externo" }), documentacaoVazia(), saving(), "r")).not.toContain(BLOCO);
    expect(buildSavingPrompt(ctx(), documentacaoVazia(), saving({ tipo_saving: "pontual" }), "r")).not.toContain(BLOCO);
    const semHoras = saving({ linhas: [linha({ horas_antes: 0, horas_depois: 0, economia_horas_mes: 0 })] });
    expect(buildSavingPrompt(ctx(), documentacaoVazia(), semHoras, "r")).not.toContain(BLOCO);
  });
});
