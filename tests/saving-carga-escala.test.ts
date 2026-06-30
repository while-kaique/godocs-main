import { describe, it, expect } from "vitest";
import { buildSavingPrompt, aplicaSplitCargaEscala, precisaConfirmarEscala, interpretarCargaReal, contestaTotalCargaReal, parseNumeroPtBR, LIMITE_ESCALA_ALTA } from "@/lib/agents/orchestrator";
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

describe("precisaConfirmarEscala (trava de plausibilidade do split)", () => {
  it("TRUE quando a escala fica ≥60% do total (carga real subestimada / inflada)", () => {
    expect(precisaConfirmarEscala(1, 22)).toBe(true);   // legado-189: 1h de 22h → escala 95%
    expect(precisaConfirmarEscala(1, 11)).toBe(true);   // legado-231: escala 91%
    expect(precisaConfirmarEscala(6, 32)).toBe(true);   // faff95: escala 81%
    expect(precisaConfirmarEscala(40, 100)).toBe(true); // escala exatamente 60%
  });
  it("FALSE quando a maior parte é carga real (escala < 60%)", () => {
    expect(precisaConfirmarEscala(50, 100)).toBe(false); // escala 50%
    expect(precisaConfirmarEscala(99, 100)).toBe(false); // escala 1%
  });
  it("o caso legítimo de escala alta (ex. 24h real / 132h total = 82%) também confirma — não bloqueia, só confere", () => {
    expect(precisaConfirmarEscala(24, 132)).toBe(true);
  });
  it("FALSE quando carga real ≥ total (escala 0 — fez tudo) e em entradas inválidas", () => {
    expect(precisaConfirmarEscala(22, 22)).toBe(false);  // fez tudo
    expect(precisaConfirmarEscala(108.2, 107.8)).toBe(false); // f4dd86: real>total → escala 0
    expect(precisaConfirmarEscala(0, 0)).toBe(false);    // total 0
    expect(precisaConfirmarEscala(NaN, 100)).toBe(false);
  });
  it("usa o limite de 60% (LIMITE_ESCALA_ALTA)", () => {
    expect(LIMITE_ESCALA_ALTA).toBe(0.6);
  });
});

describe("interpretarCargaReal (resposta do usuário ao gate da carga real)", () => {
  it('CASO REPORTADO: "100% das horas eram na mão" → carga real = total (não re-pergunta)', () => {
    expect(interpretarCargaReal("100% das horas eram na mão", 35)).toBe(35);
    expect(interpretarCargaReal("100% era na mão, as 35h era trabalho real, nada escalado", 35)).toBe(35);
  });
  it("porcentagem → fração do total (última citada vence)", () => {
    expect(interpretarCargaReal("uns 50% na mão", 40)).toBe(20);
    expect(interpretarCargaReal("100 por cento manual", 12)).toBe(12);
    expect(interpretarCargaReal("não era 100%, era 50%", 40)).toBe(20);
  });
  it('"nada escalado / sem escala / não foi escalado" → carga real = total (escala 0)', () => {
    expect(interpretarCargaReal("nada escalado", 18)).toBe(18);
    expect(interpretarCargaReal("foi tudo manual, sem escala", 9)).toBe(9);
    expect(interpretarCargaReal("não foi escalado nada", 7)).toBe(7);
  });
  it('"fazia tudo / o volume todo" → total; "não fazia tudo" NÃO vira total', () => {
    expect(interpretarCargaReal("a pessoa fazia o volume todo", 50)).toBe(50);
    expect(interpretarCargaReal("não fazia tudo", 50)).not.toBe(50);
  });
  it("números explícitos continuam funcionando (1 valor; 2 que somam o total)", () => {
    expect(interpretarCargaReal("eram umas 24h", 132)).toBe(24);
    expect(interpretarCargaReal("24h de carga real e 108 de escala", 132)).toBe(24);
    expect(interpretarCargaReal("fazia 35", 35)).toBe(35);
  });
  it("ambíguo/sem sinal → null (re-pergunta determinística)", () => {
    expect(interpretarCargaReal("não sei dizer", 30)).toBeNull();
    expect(interpretarCargaReal("", 30)).toBeNull();
  });

  it("BUG DECIMAL: preserva decimais com ponto ('0.5'→0.5, não 5) — o agente exibe '0.5h'", () => {
    // Antes: ".replace(/\\./g,'')" virava "0.5"→"05"=5 → >total → null → re-pergunta (loop).
    expect(interpretarCargaReal("0.3h", 0.5)).toBe(0.3);
    expect(interpretarCargaReal("era 1.83h por mês", 2)).toBeCloseTo(1.83, 2);
    expect(interpretarCargaReal("fazia 12.5h", 20)).toBe(12.5);
    expect(interpretarCargaReal("0,5", 1)).toBe(0.5); // vírgula decimal pt-BR
  });

  it("milhar com ponto continua funcionando ('1.234'→1234)", () => {
    expect(interpretarCargaReal("eram 1.234h", 2000)).toBe(1234);
    expect(interpretarCargaReal("12.000", 20000)).toBe(12000);
  });
});

describe("parseNumeroPtBR (decimal × milhar, sem destruir o decimal)", () => {
  it("ponto como DECIMAL (caso do bug)", () => {
    expect(parseNumeroPtBR("0.5")).toBe(0.5);
    expect(parseNumeroPtBR("1.83")).toBeCloseTo(1.83, 2);
    expect(parseNumeroPtBR("12.5")).toBe(12.5);
    expect(parseNumeroPtBR("0.123")).toBeCloseTo(0.123, 3); // parte inteira "0" → decimal
  });
  it("ponto como MILHAR (3 dígitos depois, inteiro ≠ 0)", () => {
    expect(parseNumeroPtBR("1.234")).toBe(1234);
    expect(parseNumeroPtBR("12.000")).toBe(12000);
    expect(parseNumeroPtBR("1.000.000")).toBe(1000000);
  });
  it("vírgula é sempre decimal; ponto+vírgula = milhar+decimal", () => {
    expect(parseNumeroPtBR("0,5")).toBe(0.5);
    expect(parseNumeroPtBR("1.234,56")).toBeCloseTo(1234.56, 2);
  });
  it("inteiros simples", () => {
    expect(parseNumeroPtBR("5")).toBe(5);
    expect(parseNumeroPtBR("220")).toBe(220);
  });
});

describe("contestaTotalCargaReal (escape do loop — usuário contesta o total)", () => {
  it("CASO REPORTADO: '5min por dia pra cada colaborador, isso não é 0.5h por mês' → contesta", () => {
    expect(contestaTotalCargaReal("eu disse que era 5min por dia pra cada colaborador. isso nao é 0.5h por mes", 0.5)).toBe(true);
  });
  it("valor por unidade de tempo (dia/semana/execução) ou min/seg → contesta (precisa converter)", () => {
    expect(contestaTotalCargaReal("eram uns 5 min por dia", 0.5)).toBe(true);
    expect(contestaTotalCargaReal("uns 30 minutos por execução", 2)).toBe(true);
    expect(contestaTotalCargaReal("1h por semana", 4)).toBe(true);
  });
  it("correção/contestação explícita do número → contesta", () => {
    expect(contestaTotalCargaReal("isso está errado", 10)).toBe(true);
    expect(contestaTotalCargaReal("não é esse o valor", 10)).toBe(true);
    expect(contestaTotalCargaReal("na verdade é bem mais", 10)).toBe(true);
  });
  it("nº claramente acima do total → contesta (acha que o total deveria ser maior)", () => {
    expect(contestaTotalCargaReal("eram umas 40h", 0.5)).toBe(true);
    expect(contestaTotalCargaReal("uns 90", 30)).toBe(true);
  });
  it("resposta normal de carga real NÃO contesta (segue o fluxo do split)", () => {
    expect(contestaTotalCargaReal("eram umas 24h", 132)).toBe(false);
    expect(contestaTotalCargaReal("a pessoa fazia o volume todo", 50)).toBe(false);
    expect(contestaTotalCargaReal("uns 50% na mão", 40)).toBe(false);
    expect(contestaTotalCargaReal("fazia 35", 35)).toBe(false);
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
