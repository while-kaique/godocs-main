import { describe, it, expect } from "vitest";
import { recomputarSavingFinanceiro, enriquecerMemorial, custoEvitadoMensalFromItens } from "@/lib/agents/saving-calc";
import type { SavingColetado, ReceitaColetada } from "@/lib/agents/types";

describe("custoEvitadoMensalFromItens (re-derivação dos itens persistidos)", () => {
  it("item mensal entra cheio", () => {
    expect(custoEvitadoMensalFromItens([{ valor: 240, recorrencia: "mensal" }])).toBe(240);
  });
  it("item pontual é mensalizado ÷12", () => {
    expect(custoEvitadoMensalFromItens([{ valor: 6000, recorrencia: "pontual" }])).toBe(500);
  });
  it("misto soma mensal cheio + pontual ÷12", () => {
    expect(
      custoEvitadoMensalFromItens([
        { valor: 100, recorrencia: "mensal" },
        { valor: 1200, recorrencia: "pontual" },
      ]),
    ).toBe(200);
  });
  it("aceita JSON string (formato persistido no projeto)", () => {
    expect(custoEvitadoMensalFromItens('[{"valor":6000,"recorrencia":"pontual"}]')).toBe(500);
  });
  it("vazio/nulo/inválido → 0", () => {
    expect(custoEvitadoMensalFromItens(null)).toBe(0);
    expect(custoEvitadoMensalFromItens("[]")).toBe(0);
    expect(custoEvitadoMensalFromItens("lixo")).toBe(0);
  });
});

describe("recomputarSavingFinanceiro — R$ derivado das horas (backend é a fonte de verdade)", () => {
  // Cenário real do bug (projeto AVD da Jessica): o agente reajustou a linha de
  // 0h→1.5h para 30h→1.5h, setou economia_horas_mes=28.5, mas deixou
  // economia_reais_mes=0. Sem recálculo, saving_reais=0 vazava para a planilha.
  it("corrige economia_reais_mes=0 deixado pelo LLM ao reajustar horas", () => {
    const savingDoLLM: SavingColetado = {
      linhas: [
        {
          cargo: "Especialista+",
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

  it("soma custo evitado PONTUAL cheio (sem ÷12) ao total", () => {
    const out = recomputarSavingFinanceiro({
      linhas: [
        { cargo: "Analista Pleno", horas_antes: 40, horas_depois: 14, valor_hora: 29.9, economia_horas_mes: 26, economia_reais_mes: 777.4 },
      ],
      economia_horas_mes: 26,
      economia_reais_mes: 777.4,
      tipo_saving: "mensal",
      memorial_calculo: null,
      valor_ganho_mensal: null,
      custo_evitado_reais: 2700,
      custo_evitado_tipo: "pontual",
      custo_evitado_descricao: "Serviço externo único de R$ 2.700",
    });

    // 777.40 (horas) + 2700 (custo evitado pontual cheio) = 3477.40
    expect(out.economia_reais_mes).toBe(3477.4);
  });

  it("soma custo evitado MENSAL cheio (sem ÷12)", () => {
    const out = recomputarSavingFinanceiro({
      linhas: [
        { cargo: "Analista Pleno", horas_antes: 40, horas_depois: 14, valor_hora: 29.9, economia_horas_mes: 26, economia_reais_mes: 777.4 },
      ],
      economia_horas_mes: 26,
      economia_reais_mes: 777.4,
      tipo_saving: "mensal",
      memorial_calculo: null,
      valor_ganho_mensal: null,
      custo_evitado_reais: 300,
      custo_evitado_tipo: "mensal",
      custo_evitado_descricao: "Licença mensal de R$ 300 cancelada",
    });

    // 777.40 + 300 = 1077.40
    expect(out.economia_reais_mes).toBe(1077.4);
  });

  it("custo evitado pontual + custo externo: soma um e abate o outro", () => {
    const out = recomputarSavingFinanceiro(
      {
        linhas: [
          { cargo: "Analista Pleno", horas_antes: 40, horas_depois: 14, valor_hora: 29.9, economia_horas_mes: 26, economia_reais_mes: 777.4 },
        ],
        economia_horas_mes: 26,
        economia_reais_mes: 777.4,
        tipo_saving: "mensal",
        memorial_calculo: null,
        valor_ganho_mensal: null,
        custo_evitado_reais: 2700,
        custo_evitado_tipo: "pontual",
        custo_evitado_descricao: "Serviço externo único",
      },
      100, // custo externo mensal incorrido
    );

    // 777.40 + 2700 (evitado pontual cheio) - 100 (custo externo) = 3377.40
    expect(out.economia_reais_mes).toBe(3377.4);
  });

  it("carrega o custo externo recebido para o objeto saving retornado", () => {
    // O custo externo autoritativo vive em projeto.custo_externo_mensal e é passado
    // aqui — precisa viajar no saving para enriquecerMemorial lê-lo depois.
    const out = recomputarSavingFinanceiro(
      {
        linhas: [
          { cargo: "Analista Pleno", horas_antes: 40, horas_depois: 0, valor_hora: 29.9, economia_horas_mes: 40, economia_reais_mes: 1196 },
        ],
        economia_horas_mes: 40,
        economia_reais_mes: 1196,
        tipo_saving: "mensal",
        memorial_calculo: null,
        valor_ganho_mensal: null,
      } as SavingColetado,
      300,
    );

    expect(out.custo_externo_mensal).toBe(300);
    expect(out.economia_reais_mes).toBe(896); // 1196 - 300
  });

  it("ignora custo evitado ausente/nulo (objeto sem os campos)", () => {
    const out = recomputarSavingFinanceiro({
      linhas: [
        { cargo: "Assistente", horas_antes: 20, horas_depois: 0, valor_hora: 13.94, economia_horas_mes: 20, economia_reais_mes: 278.8 },
      ],
      economia_horas_mes: 20,
      economia_reais_mes: 278.8,
      tipo_saving: "mensal",
      memorial_calculo: null,
      valor_ganho_mensal: null,
    } as SavingColetado);

    expect(out.economia_reais_mes).toBe(278.8); // sem custo evitado → só as horas
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

// ═══════════════════════════════════════════════════════════════════
// enriquecerMemorial — injeta R$ no memorial interno (planilha)
// ═══════════════════════════════════════════════════════════════════

describe("enriquecerMemorial — memorial interno com valores financeiros", () => {
  it("injeta valor/hora, economia em R$ por pessoa e totais no memorial de saving", () => {
    const saving: SavingColetado = {
      linhas: [
        { cargo: "Estagiário", horas_antes: 180, horas_depois: 0, valor_hora: 10.78, economia_horas_mes: 180, economia_reais_mes: 1940.4 },
        { cargo: "Analista Sênior", horas_antes: 60, horas_depois: 0, valor_hora: 33.10, economia_horas_mes: 60, economia_reais_mes: 1986 },
      ],
      economia_horas_mes: 240,
      economia_reais_mes: 3926.4,
      tipo_saving: "mensal",
      memorial_calculo: "## Memorial de Cálculo\n\nTexto do LLM sem R$",
      valor_ganho_mensal: null,
      custo_evitado_reais: null,
      custo_evitado_tipo: null,
      custo_evitado_descricao: null,
    };

    const result = enriquecerMemorial(saving, undefined, ["saving"]);

    // Deve conter o memorial base
    expect(result).toContain("Texto do LLM sem R$");
    // Deve conter detalhamento financeiro
    expect(result).toContain("Detalhamento Financeiro (interno)");
    // Deve conter valor/hora de cada cargo
    expect(result).toContain("R$ 10.78/h");
    expect(result).toContain("R$ 33.10/h");
    // Deve conter economia em R$ por pessoa
    expect(result).toContain("R$ 1940.40");
    expect(result).toContain("R$ 1986.00");
    // Deve conter totais
    expect(result).toContain("Total horas:** 240h");
    expect(result).toContain("Total financeiro (horas):** R$ 3926.40");
    // Custo evitado N/A
    expect(result).toContain("Custo evitado:** N/A");
    // Economia líquida
    expect(result).toContain("Economia líquida total:** R$ 3926.40");
  });

  it("inclui custo evitado e custo externo no detalhamento financeiro", () => {
    const saving: SavingColetado = {
      linhas: [
        { cargo: "Analista Pleno", horas_antes: 40, horas_depois: 14, valor_hora: 29.9, economia_horas_mes: 26, economia_reais_mes: 777.4 },
      ],
      economia_horas_mes: 26,
      economia_reais_mes: 3377.4, // 777.4 + 2700 - 100
      tipo_saving: "mensal",
      memorial_calculo: "Memorial base",
      valor_ganho_mensal: null,
      custo_evitado_reais: 2700,
      custo_evitado_tipo: "pontual",
      custo_evitado_descricao: "Serviço externo de implementação",
      custo_externo_mensal: 100,
    };

    const result = enriquecerMemorial(saving, undefined, ["saving"]);

    expect(result).toContain("R$ 2700.00");
    expect(result).toContain("pontual");
    expect(result).toContain("Serviço externo de implementação");
    expect(result).toContain("R$ 100.00/mês");
    expect(result).toContain("Economia líquida total:** R$ 3377.40");
  });

  it("reflete o custo externo no memorial mesmo quando o saving vem SEM o campo (caminho do submit)", () => {
    // Regressão: o custo externo vive em projeto.custo_externo_mensal, não no objeto
    // saving que o LLM ecoa. O submit chama recomputarSavingFinanceiro(saving, custo)
    // antes de enriquecerMemorial. Sem carregar o campo adiante, o memorial mostrava
    // "Custo de ferramenta externa: N/A" e líquida bruta — contradizendo o Saving Reais.
    const savingDoLLM = {
      linhas: [
        { cargo: "Analista Pleno", horas_antes: 50, horas_depois: 10, valor_hora: 29.9, economia_horas_mes: 40, economia_reais_mes: 1196 },
      ],
      economia_horas_mes: 40,
      economia_reais_mes: 1196,
      tipo_saving: "mensal",
      memorial_calculo: "Memorial base sem R$",
      valor_ganho_mensal: null,
      // sem custo_externo_mensal — como vem do estado do chat
    } as SavingColetado;

    const recomputado = recomputarSavingFinanceiro(savingDoLLM, 300);
    const result = enriquecerMemorial(recomputado, undefined, ["saving"]);

    expect(result).toContain("R$ 300.00/mês");
    expect(result).not.toContain("Custo de ferramenta externa:** N/A");
    expect(result).toContain("Economia líquida total:** R$ 896.00");
  });

  it("gera memorial com receita incremental quando tipo é receita", () => {
    const receita: ReceitaColetada = {
      tipo_saving: "mensal",
      valor_ganho_mensal: 5000,
      memorial_calculo: "## Memorial de Receita\n\nTexto da receita",
      racional: "Vendas de estampas IA",
    };

    const result = enriquecerMemorial(undefined, receita, ["receita_incremental"]);

    expect(result).toContain("Texto da receita");
    expect(result).toContain("R$ 5000.00");
    expect(result).toContain("mensal");
  });

  it("gera memorial combinado (saving + receita) com divisão clara", () => {
    const saving: SavingColetado = {
      linhas: [
        { cargo: "Estagiário", horas_antes: 10, horas_depois: 0, valor_hora: 10.78, economia_horas_mes: 10, economia_reais_mes: 107.8 },
      ],
      economia_horas_mes: 10,
      economia_reais_mes: 107.8,
      tipo_saving: "mensal",
      memorial_calculo: "Memorial saving",
      valor_ganho_mensal: null,
      custo_evitado_reais: null,
      custo_evitado_tipo: null,
      custo_evitado_descricao: null,
    };
    const receita: ReceitaColetada = {
      tipo_saving: "mensal",
      valor_ganho_mensal: 3000,
      memorial_calculo: "Memorial receita",
      racional: null,
    };

    const result = enriquecerMemorial(saving, receita, ["saving", "receita_incremental"]);

    // Deve conter ambos os memoriais
    expect(result).toContain("Memorial saving");
    expect(result).toContain("Memorial receita");
    // Deve ter separação
    expect(result).toContain("---");
    // Saving financeiro
    expect(result).toContain("R$ 10.78/h");
    // Receita
    expect(result).toContain("R$ 3000.00");
  });

  it("retorna string vazia quando não há saving nem receita", () => {
    const result = enriquecerMemorial(undefined, undefined, []);
    expect(result).toBe("");
  });
});
