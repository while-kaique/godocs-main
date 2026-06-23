import { describe, it, expect } from "vitest";
import { buildSavingPrompt } from "@/lib/agents/orchestrator";
import { documentacaoVazia, savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// Plausibilidade POR PESSOA — uma linha pode esconder VÁRIAS pessoas.
// Caso de origem: 3 gerentes executando o mesmo processo (270×/mês = 45h/mês),
// mas o memorial gravou o total "geral" como se fosse de UMA pessoa só. 45h/mês
// para um único gerente abrindo painel e enviando parcial é inimaginável de
// início — só fecha porque eram 3 pessoas (~15h cada). O agente deve confirmar o
// headcount, embutir o × N pessoas nas linhas e deixar o nº de pessoas EXPLÍCITO
// no memorial. Tudo prompt-enforced (não há gate determinístico no backend).

const ctx: ProjetoContexto = {
  nome_projeto: "Resumo Executivo",
  ferramenta: "Apps Script",
  membros: [],
  alguem_fazia: "sim",
} as unknown as ProjetoContexto;

const linha = (over: Partial<SavingLinha>): SavingLinha => ({
  cargo: "Especialista / Gestor / Head",
  horas_antes: 45,
  horas_depois: 0,
  valor_hora: 55.15,
  economia_horas_mes: 45,
  economia_reais_mes: 0,
  ...over,
});

function saving(over: Partial<SavingColetado>): SavingColetado {
  return { ...savingVazio(), tipo_saving: "mensal", ...over };
}

describe("plausibilidade por pessoa — buildSavingPrompt", () => {
  const s = saving({
    economia_horas_mes: 45,
    linhas: [linha({})],
  });

  it("inclui a regra PLAUSIBILIDADE POR PESSOA (uma linha pode esconder várias pessoas)", () => {
    const p = buildSavingPrompt(ctx, documentacaoVazia(), s, "resumo");
    expect(p).toContain("PLAUSIBILIDADE POR PESSOA");
    expect(p).toContain("UMA LINHA PODE ESCONDER VÁRIAS PESSOAS");
    // a pergunta de sanidade por indivíduo
    expect(p).toContain("uma ÚNICA pessoa desse cargo");
  });

  it("exige confirmar o headcount e embutir o × N pessoas nas linhas", () => {
    const p = buildSavingPrompt(ctx, documentacaoVazia(), s, "resumo");
    expect(p).toContain("quantas pessoas faziam");
    expect(p).toContain("× N pessoas");
  });

  it("exige o nº de pessoas EXPLÍCITO no memorial (não um total \"geral\")", () => {
    const p = buildSavingPrompt(ctx, documentacaoVazia(), s, "resumo");
    expect(p).toContain("Nº DE PESSOAS POR TRÁS DO TOTAL");
    expect(p).toContain("N pessoas × ~Xh cada = Yh");
  });

  it("a regra de MULTIPLICADORES cobre várias pessoas do mesmo cargo", () => {
    const p = buildSavingPrompt(ctx, documentacaoVazia(), s, "resumo");
    expect(p).toContain("VÁRIAS PESSOAS do mesmo cargo");
  });

  it("o template do preview traz a linha 'Pessoas no cargo'", () => {
    const p = buildSavingPrompt(ctx, documentacaoVazia(), s, "resumo");
    expect(p).toContain("Pessoas no cargo");
  });
});
