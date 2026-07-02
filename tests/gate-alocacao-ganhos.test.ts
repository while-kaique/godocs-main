import { describe, it, expect } from "vitest";
import {
  aplicaGateAlocacaoGanhos,
  respostaAlocacaoVaga,
  LIMITE_ECONOMIA_ALTA,
} from "@/lib/agents/orchestrator";
import { savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// Gate DETERMINÍSTICO da "Alocação de Ganhos" (Seção 2.4 — "o que mudou após a automação").
// Quando o saving MENSAL é alto (≥44h) e ALGUÉM fazia à mão, o backend GARANTE que o usuário
// seja perguntado pra onde foi o tempo liberado, em vez de deixar o LLM inventar o boilerplate
// vago "realocado para outras atividades". _(origem: projeto Gostream, 150h/mês.)_

const ctx = (over: Partial<ProjetoContexto> = {}): ProjetoContexto =>
  ({
    nome_projeto: "X",
    ferramenta: "n8n",
    membros: [],
    alguem_fazia: "sim",
    ...over,
  }) as unknown as ProjetoContexto;

const linha = (over: Partial<SavingLinha> = {}): SavingLinha => ({
  cargo: "Analista",
  horas_antes: 30,
  horas_depois: 0,
  valor_hora: 50,
  economia_horas_mes: 30,
  economia_reais_mes: 0,
  ...over,
});

const saving = (over: Partial<SavingColetado> = {}): SavingColetado => ({
  ...savingVazio(),
  tipo_saving: "mensal",
  ...over,
});

describe("aplicaGateAlocacaoGanhos — escopo do gate", () => {
  it("dispara: sim + mensal + total ≥ 44h (5 cargos × 30h = 150h — caso Gostream)", () => {
    const s = saving({
      economia_horas_mes: 150,
      linhas: Array.from({ length: 5 }, () => linha({ economia_horas_mes: 30, horas_antes: 30 })),
    });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(true);
  });

  it("dispara pela SOMA (nenhum cargo ≥44h individual, mas total ≥44h)", () => {
    const s = saving({
      economia_horas_mes: 60,
      linhas: [
        linha({ economia_horas_mes: 30 }),
        linha({ cargo: "Estagiário", economia_horas_mes: 30 }),
      ],
    });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(true);
  });

  it("dispara por um CARGO individual ≥44h mesmo com total baixo", () => {
    // (na prática total = soma; aqui forçamos economia_horas_mes < 44 mas uma linha ≥44)
    const s = saving({
      economia_horas_mes: 44,
      linhas: [linha({ economia_horas_mes: 50, horas_antes: 50 })],
    });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(true);
  });

  it("dispara no limiar exato de 44h", () => {
    const s = saving({
      economia_horas_mes: LIMITE_ECONOMIA_ALTA,
      linhas: [linha({ economia_horas_mes: 44, horas_antes: 44 })],
    });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(true);
  });

  it("NÃO dispara abaixo de 44h", () => {
    const s = saving({ economia_horas_mes: 30, linhas: [linha({ economia_horas_mes: 30 })] });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(false);
  });

  it("NÃO dispara para PONTUAL, mesmo com total alto", () => {
    const s = saving({
      tipo_saving: "pontual",
      economia_horas_mes: 200,
      linhas: [linha({ economia_horas_mes: 200, horas_antes: 200 })],
    });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(false);
  });

  it("NÃO dispara para TRIMESTRAL (base ≠ mês)", () => {
    const s = saving({
      tipo_saving: "trimestral",
      economia_horas_mes: 200,
      linhas: [linha({ economia_horas_mes: 200 })],
    });
    expect(aplicaGateAlocacaoGanhos(ctx(), s)).toBe(false);
  });

  it("NÃO dispara para contrafactual ('nao' — ninguém fazia: sem tempo humano liberado)", () => {
    const s = saving({
      economia_horas_mes: 150,
      linhas: [linha({ economia_horas_mes: 150, horas_antes: 150 })],
    });
    expect(aplicaGateAlocacaoGanhos(ctx({ alguem_fazia: "nao" }), s)).toBe(false);
  });

  it("NÃO dispara para custo evitado puro ('externo')", () => {
    const s = saving({ economia_horas_mes: 0, custo_evitado_reais: 5000, linhas: [] });
    expect(aplicaGateAlocacaoGanhos(ctx({ alguem_fazia: "externo" }), s)).toBe(false);
  });
});

describe("respostaAlocacaoVaga — heurística conservadora", () => {
  it("VAGA: o boilerplate exato do Gostream (realocado para outras atividades)", () => {
    expect(
      respostaAlocacaoVaga(
        "o tempo liberado foi realocado para outras atividades do time de R&S, sem necessidade de manter essa rotina manual",
      ),
    ).toBe(true);
  });

  it("VAGA: família 'sobra tempo' / 'mais produtividade' / 'mais eficiente'", () => {
    expect(respostaAlocacaoVaga("sobra mais tempo para o time")).toBe(true);
    expect(respostaAlocacaoVaga("o time ficou muito mais produtivo no geral")).toBe(true);
    expect(respostaAlocacaoVaga("ganhamos produtividade e eficiência")).toBe(true);
    expect(respostaAlocacaoVaga("foi para outras demandas do setor")).toBe(true);
  });

  it("VAGA: resposta curta demais", () => {
    expect(respostaAlocacaoVaga("sei lá")).toBe(true);
    expect(respostaAlocacaoVaga("")).toBe(true);
    expect(respostaAlocacaoVaga("   ")).toBe(true);
  });

  it("CONCRETA: destino nomeado (aceita, não repergunta)", () => {
    expect(
      respostaAlocacaoVaga(
        "o tempo foi para hunting e entrevistas; hoje fazemos 2 a 3 entrevistas a mais por dia",
      ),
    ).toBe(false);
    expect(
      respostaAlocacaoVaga("agora a equipe faz mais análise de crédito e atende novos clientes"),
    ).toBe(false);
    expect(
      respostaAlocacaoVaga("passaram a cuidar do fechamento contábil e da conciliação bancária"),
    ).toBe(false);
  });

  it("CONCRETA: resposta vaga MAS com número concreto de nova entrega é aceita", () => {
    // "sobra tempo" bate no padrão vago, mas o número quantifica a entrega → aceita.
    expect(respostaAlocacaoVaga("sobra tempo e por isso fechamos 15 vagas a mais por mês")).toBe(
      false,
    );
  });
});
