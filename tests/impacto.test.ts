import { describe, it, expect } from "vitest";
import {
  DIVISOR_FREQUENCIA,
  divisorDe,
  PESO_SAVING,
  PESO_CUSTO_EVITADO,
  PESO_RECEITA,
  mensalizar,
  impactoBruto,
  impactoLiquido,
  impactoLiquidoMensal,
  type Frequencia,
  type GanhosProjeto,
} from "@/lib/impacto";

// Fórmula do plano `docs/plans/godocs-v2-submissao-deterministica.md` (D2):
//
//   CE = CE_horas + CE_naocontratado
//   Impacto Bruto          =     S  +     CE  +     R
//   Impacto Líquido        = 1,0·S  + 0,5·CE  + 0,1·R  − C
//   Impacto Líquido Mensal = 1,0·m(S) + 0,5·m(CE) + 0,1·m(R) − m(C)
//   m(x) = x ÷ { pontual 4 · mensal 1 · trimestral 3 · semestral 6 }

describe("impacto — constantes nomeadas (fonte única dos pesos e divisores)", () => {
  it("os pesos são 1 (saving) · 0,5 (custo evitado) · 0,1 (receita)", () => {
    expect(PESO_SAVING).toBe(1);
    expect(PESO_CUSTO_EVITADO).toBe(0.5);
    expect(PESO_RECEITA).toBe(0.1);
  });

  it("os divisores de frequência são pontual 4 · mensal 1 · trimestral 3 · semestral 6", () => {
    expect(DIVISOR_FREQUENCIA.pontual).toBe(4);
    expect(DIVISOR_FREQUENCIA.mensal).toBe(1);
    expect(DIVISOR_FREQUENCIA.trimestral).toBe(3);
    expect(DIVISOR_FREQUENCIA.semestral).toBe(6);
  });

  it("as 4 frequências estão declaradas, e nenhuma a mais", () => {
    expect(Object.keys(DIVISOR_FREQUENCIA).sort()).toEqual([
      "mensal",
      "pontual",
      "semestral",
      "trimestral",
    ]);
  });
});

describe("mensalizar", () => {
  it("divide pelo divisor de cada frequência", () => {
    expect(mensalizar(12000, "mensal")).toBe(12000);
    expect(mensalizar(12000, "trimestral")).toBe(4000);
    expect(mensalizar(12000, "semestral")).toBe(2000);
    expect(mensalizar(12000, "pontual")).toBe(3000);
  });

  // ⚠️ TRAVA DE DECISÃO — na v2 o PONTUAL divide por 4 (a validade padrão do
  // projeto). Isso INVERTE de propósito a decisão de 01/07/2026 ("pontual entra
  // pelo valor cheio"), que segue valendo na v1. Não "corrigir" para valor cheio.
  it("PONTUAL divide por 4 — NÃO entra pelo valor cheio (inversão consciente da v1)", () => {
    expect(mensalizar(4000, "pontual")).toBe(1000);
    expect(mensalizar(4000, "pontual")).not.toBe(4000);
  });

  it("respeita a constante DIVISOR_FREQUENCIA em todas as frequências", () => {
    const frequencias: Frequencia[] = ["pontual", "mensal", "trimestral", "semestral"];
    for (const f of frequencias) {
      expect(mensalizar(9000, f)).toBeCloseTo(9000 / DIVISOR_FREQUENCIA[f], 8);
    }
  });

  it("zero é zero em qualquer frequência", () => {
    expect(mensalizar(0, "pontual")).toBe(0);
    expect(mensalizar(0, "semestral")).toBe(0);
  });

  it("valor que não divide redondo mantém a fração (sem arredondar)", () => {
    expect(mensalizar(10000, "trimestral")).toBeCloseTo(3333.3333333333, 6);
  });
});

describe("impactoBruto — soma CRUA das 3 categorias com número", () => {
  it("soma S + CE + R sem pesos e sem mensalizar", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
    };
    expect(impactoBruto(g)).toBe(73000);
  });

  it("NÃO aplica os pesos (receita entra cheia, custo evitado entra cheio)", () => {
    expect(impactoBruto({ receita: { valor: 1000, frequencia: "mensal" } })).toBe(1000);
    expect(
      impactoBruto({
        custoEvitado: { horas: 600, naoContratado: 400, frequencia: "mensal" },
      }),
    ).toBe(1000);
  });

  it("NÃO mensaliza — valor pontual entra cheio no bruto", () => {
    expect(impactoBruto({ savingEfetivado: { valor: 4000, frequencia: "pontual" } })).toBe(4000);
  });

  it("NÃO subtrai o custo para rodar, mesmo quando ele é maior que o ganho", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 1000, frequencia: "mensal" },
      custoRodar: [{ valor: 999999, frequencia: "mensal" }],
    };
    expect(impactoBruto(g)).toBe(1000);
  });

  it("projeto sem bloco nenhum é zero", () => {
    expect(impactoBruto({})).toBe(0);
  });
});

describe("impactoLiquido — pesos 1 / 0,5 / 0,1 e custo descontado a 100%", () => {
  it("saving pesa 100%", () => {
    expect(impactoLiquido({ savingEfetivado: { valor: 1000, frequencia: "mensal" } })).toBe(1000);
  });

  it("custo evitado pesa 50%", () => {
    expect(
      impactoLiquido({ custoEvitado: { horas: 1000, naoContratado: 0, frequencia: "mensal" } }),
    ).toBe(500);
  });

  it("receita pesa 10%", () => {
    expect(impactoLiquido({ receita: { valor: 1000, frequencia: "mensal" } })).toBe(100);
  });

  // Descontar custo certo por menos de 100% inflaria o projeto (D2).
  it("o custo para rodar SUBTRAI com peso 100%", () => {
    expect(impactoLiquido({ custoRodar: [{ valor: 1000, frequencia: "mensal" }] })).toBe(-1000);
    const comCusto: GanhosProjeto = {
      savingEfetivado: { valor: 5000, frequencia: "mensal" },
      custoRodar: [{ valor: 1200, frequencia: "mensal" }],
    };
    expect(impactoLiquido(comCusto)).toBe(3800);
  });

  it("soma a lista incremental inteira de custo para rodar", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 5000, frequencia: "mensal" },
      custoRodar: [
        { valor: 900, frequencia: "trimestral" },
        { valor: 300, frequencia: "mensal" },
      ],
    };
    // no líquido (não mensal) os itens entram CRUS: 900 + 300 = 1200
    expect(impactoLiquido(g)).toBe(3800);
  });

  it("NÃO mensaliza — o líquido usa os valores crus", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 4000, frequencia: "pontual" },
      receita: { valor: 40000, frequencia: "pontual" },
    };
    expect(impactoLiquido(g)).toBe(8000);
  });

  it("caso completo: 12000 + 0,5·10000 + 0,1·51000 − 1800 = 20300", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: 1200, frequencia: "semestral" },
      ],
    };
    expect(impactoLiquido(g)).toBe(20300);
  });

  it("o mesmo caso completo confere com os pesos lidos das constantes", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: 1200, frequencia: "semestral" },
      ],
    };
    const esperado =
      PESO_SAVING * 12000 + PESO_CUSTO_EVITADO * 10000 + PESO_RECEITA * 51000 - 1800;
    expect(impactoLiquido(g)).toBeCloseTo(esperado, 6);
  });

  it("projeto sem bloco nenhum é zero", () => {
    expect(impactoLiquido({})).toBe(0);
  });
});

describe("impactoLiquidoMensal — cada bloco mensalizado pela frequência DELE", () => {
  it("saving mensal + receita pontual: não existe divisor único do projeto", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 3000, frequencia: "mensal" },
      receita: { valor: 40000, frequencia: "pontual" },
    };
    // 1,0·(3000/1) + 0,1·(40000/4) = 3000 + 1000
    expect(impactoLiquidoMensal(g)).toBeCloseTo(4000, 8);
    // um divisor único para o projeto daria outra coisa — e é o erro a evitar
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(7000, 8); // tudo como mensal
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(1750, 8); // tudo como pontual
  });

  it("as 3 categorias em frequências diferentes", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
    };
    // 12000 + 0,5·(10000/3) + 0,1·12750 = 12000 + 1666,666… + 1275
    expect(impactoLiquidoMensal(g)).toBeCloseTo(14941.6666666667, 6);
  });

  it("a lista de custo para rodar mensaliza item por item, cada um na frequência dele", () => {
    const g: GanhosProjeto = {
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: 1200, frequencia: "semestral" },
      ],
    };
    // −(600/1 + 1200/6) = −800  (e NÃO −(1800/1) nem −(1800/6))
    expect(impactoLiquidoMensal(g)).toBeCloseTo(-800, 8);
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(-1800, 8);
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(-300, 8);
  });

  it("caso completo com frequências mistas nos ganhos E no custo", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: 1200, frequencia: "semestral" },
      ],
    };
    // 12000 + 1666,666… + 1275 − 800
    expect(impactoLiquidoMensal(g)).toBeCloseTo(14141.6666666667, 6);
  });

  it("o mesmo caso completo confere com pesos e divisores lidos das constantes", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: 1200, frequencia: "semestral" },
      ],
    };
    const esperado =
      PESO_SAVING * (12000 / DIVISOR_FREQUENCIA.mensal) +
      PESO_CUSTO_EVITADO * (10000 / DIVISOR_FREQUENCIA.trimestral) +
      PESO_RECEITA * (51000 / DIVISOR_FREQUENCIA.pontual) -
      (600 / DIVISOR_FREQUENCIA.mensal + 1200 / DIVISOR_FREQUENCIA.semestral);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(esperado, 6);
  });

  it("projeto sem bloco nenhum é zero", () => {
    expect(impactoLiquidoMensal({})).toBe(0);
  });
});

describe("custo evitado — os DOIS braços somam antes do peso", () => {
  it("CE = horas + não contratado", () => {
    const g: GanhosProjeto = {
      custoEvitado: { horas: 300, naoContratado: 700, frequencia: "mensal" },
    };
    expect(impactoBruto(g)).toBe(1000);
    expect(impactoLiquido(g)).toBe(500);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(500, 8);
  });

  it("a divisão entre os braços não altera o resultado (só a soma importa)", () => {
    const so_horas: GanhosProjeto = {
      custoEvitado: { horas: 1000, naoContratado: 0, frequencia: "trimestral" },
    };
    const so_nao_contratado: GanhosProjeto = {
      custoEvitado: { horas: 0, naoContratado: 1000, frequencia: "trimestral" },
    };
    const meio_a_meio: GanhosProjeto = {
      custoEvitado: { horas: 500, naoContratado: 500, frequencia: "trimestral" },
    };
    expect(impactoLiquido(so_horas)).toBe(impactoLiquido(meio_a_meio));
    expect(impactoLiquido(so_nao_contratado)).toBe(impactoLiquido(meio_a_meio));
    expect(impactoLiquidoMensal(so_horas)).toBeCloseTo(impactoLiquidoMensal(meio_a_meio), 8);
  });

  it("um braço zerado não anula o outro", () => {
    const g: GanhosProjeto = {
      custoEvitado: { horas: 0, naoContratado: 2400, frequencia: "semestral" },
    };
    expect(impactoBruto(g)).toBe(2400);
    expect(impactoLiquido(g)).toBe(1200);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(200, 8); // 0,5·(2400/6)
  });
});

describe("bloco não marcado entra como ZERO — a fórmula não muda com o nº de categorias", () => {
  it("1 categoria marcada (só saving)", () => {
    const g: GanhosProjeto = { savingEfetivado: { valor: 6000, frequencia: "semestral" } };
    expect(impactoBruto(g)).toBe(6000);
    expect(impactoLiquido(g)).toBe(6000);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(1000, 8);
  });

  it("1 categoria marcada (só custo evitado)", () => {
    const g: GanhosProjeto = {
      custoEvitado: { horas: 1200, naoContratado: 0, frequencia: "mensal" },
    };
    expect(impactoBruto(g)).toBe(1200);
    expect(impactoLiquido(g)).toBe(600);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(600, 8);
  });

  it("1 categoria marcada (só receita)", () => {
    const g: GanhosProjeto = { receita: { valor: 80000, frequencia: "pontual" } };
    expect(impactoBruto(g)).toBe(80000);
    expect(impactoLiquido(g)).toBe(8000);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(2000, 8); // 0,1·(80000/4)
  });

  it("2 categorias marcadas (saving + receita): o custo evitado ausente vale 0", () => {
    const duas: GanhosProjeto = {
      savingEfetivado: { valor: 2000, frequencia: "mensal" },
      receita: { valor: 30000, frequencia: "mensal" },
    };
    const tresComCeZerado: GanhosProjeto = {
      ...duas,
      custoEvitado: { horas: 0, naoContratado: 0, frequencia: "trimestral" },
    };
    expect(impactoBruto(duas)).toBe(32000);
    expect(impactoLiquido(duas)).toBe(5000);
    expect(impactoLiquidoMensal(duas)).toBeCloseTo(5000, 8);
    // ausente e presente-zerado dão o MESMO resultado
    expect(impactoBruto(tresComCeZerado)).toBe(impactoBruto(duas));
    expect(impactoLiquido(tresComCeZerado)).toBe(impactoLiquido(duas));
    expect(impactoLiquidoMensal(tresComCeZerado)).toBeCloseTo(impactoLiquidoMensal(duas), 8);
  });

  it("3 categorias marcadas, sem custo para rodar (lista ausente vale 0)", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
    };
    const comListaVazia: GanhosProjeto = { ...g, custoRodar: [] };
    expect(impactoLiquido(g)).toBe(22100); // 12000 + 5000 + 5100 − 0
    expect(impactoLiquido(comListaVazia)).toBe(impactoLiquido(g));
    expect(impactoLiquidoMensal(comListaVazia)).toBeCloseTo(impactoLiquidoMensal(g), 8);
  });
});

describe("ganho imensurável fica FORA de toda conta", () => {
  it("imensurável sozinho não vale número nenhum nos 3 resultados", () => {
    const g: GanhosProjeto = { imensuravel: true };
    expect(impactoBruto(g)).toBe(0);
    expect(impactoLiquido(g)).toBe(0);
    expect(impactoLiquidoMensal(g)).toBe(0);
  });

  it("imensurável junto de outros blocos não altera nenhum dos 3 resultados", () => {
    const base: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: 1200, frequencia: "semestral" },
      ],
    };
    const comImensuravel: GanhosProjeto = { ...base, imensuravel: true };
    expect(impactoBruto(comImensuravel)).toBe(impactoBruto(base));
    expect(impactoLiquido(comImensuravel)).toBe(impactoLiquido(base));
    expect(impactoLiquidoMensal(comImensuravel)).toBeCloseTo(impactoLiquidoMensal(base), 8);
  });

  it("imensuravel: false também não muda nada", () => {
    const base: GanhosProjeto = { savingEfetivado: { valor: 1000, frequencia: "mensal" } };
    expect(impactoLiquido({ ...base, imensuravel: false })).toBe(impactoLiquido(base));
    expect(impactoBruto({ ...base, imensuravel: false })).toBe(impactoBruto(base));
    expect(impactoLiquidoMensal({ ...base, imensuravel: false })).toBeCloseTo(
      impactoLiquidoMensal(base),
      8,
    );
  });
});

describe("impacto — pureza (mesma entrada, mesma saída; nada é mutado)", () => {
  it("não muta o objeto de entrada", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 12000, frequencia: "mensal" },
      custoEvitado: { horas: 8000, naoContratado: 2000, frequencia: "trimestral" },
      receita: { valor: 51000, frequencia: "pontual" },
      custoRodar: [{ valor: 600, frequencia: "mensal" }],
    };
    const antes = JSON.parse(JSON.stringify(g));
    impactoBruto(g);
    impactoLiquido(g);
    impactoLiquidoMensal(g);
    expect(g).toEqual(antes);
  });

  it("chamadas repetidas devolvem o mesmo número", () => {
    const g: GanhosProjeto = { receita: { valor: 51000, frequencia: "pontual" } };
    expect(impactoLiquidoMensal(g)).toBe(impactoLiquidoMensal(g));
  });
});

// ─── Guardas de entrada suja (achados dos revisores, 02/09) ──────────────────

describe("frequência fora do enum — FAIL-CLOSED, nunca NaN", () => {
  // O vocabulário das fontes da v1 é MAIOR que o enum: `custoPeriodicidade` tem
  // 'anual' e '', `recorrencia` tem '', `tipo_saving` pode ser null. O TypeScript
  // protege o chamador tipado, não o valor que vem do SQLite ou do formulário.
  // Sem guarda daria NaN → `JSON.stringify(NaN)` = null → campo de DINHEIRO nulo
  // no payload do Gomoon, e NaN num reduce zera o total da área inteira.
  const sujas = ["anual", "", "Mensal", "12", null, undefined];

  for (const suja of sujas) {
    it(`lança em ${JSON.stringify(suja)} em vez de devolver NaN`, () => {
      const f = suja as unknown as Frequencia;
      expect(() => divisorDe(f)).toThrow(/frequência desconhecida/);
      expect(() => mensalizar(1000, f)).toThrow(/frequência desconhecida/);
    });
  }

  it("a mensagem do erro diz o que era esperado (diagnóstico, não só falha)", () => {
    const f = "anual" as unknown as Frequencia;
    expect(() => divisorDe(f)).toThrow(/pontual/);
    expect(() => divisorDe(f)).toThrow(/semestral/);
  });

  it("⚠️ NUNCA cair em divisor 1 por omissão — 'anual' viraria mensal calado", () => {
    const f = "anual" as unknown as Frequencia;
    let caiuEmUm = false;
    try {
      caiuEmUm = mensalizar(12000, f) === 12000;
    } catch {
      caiuEmUm = false;
    }
    expect(caiuEmUm).toBe(false);
  });

  it("as 4 frequências válidas passam pela guarda sem lançar", () => {
    for (const f of ["pontual", "mensal", "trimestral", "semestral"] as Frequencia[]) {
      expect(() => divisorDe(f)).not.toThrow();
      expect(divisorDe(f)).toBe(DIVISOR_FREQUENCIA[f]);
    }
  });
});

describe("custo negativo — clampa em 0, NUNCA aumenta o impacto", () => {
  // Os canônicos da v1 (`somarItens`, `custoProjetoMensalFromItens`) já fazem
  // Math.max(0, valor); sem isso, digitar -500 num custo SOBE o impacto — a
  // direção gameável.
  it("item de custo negativo não vira ganho no líquido", () => {
    const g: GanhosProjeto = { custoRodar: [{ valor: -500, frequencia: "mensal" }] };
    expect(impactoLiquido(g)).toBe(0);
    expect(impactoLiquido(g)).not.toBe(500);
  });

  it("item de custo negativo não vira ganho no mensal", () => {
    const g: GanhosProjeto = { custoRodar: [{ valor: -1200, frequencia: "semestral" }] };
    expect(impactoLiquidoMensal(g)).toBe(0);
    expect(impactoLiquidoMensal(g)).not.toBeCloseTo(200, 8);
  });

  it("negativo no meio da lista não abate os itens legítimos", () => {
    const g: GanhosProjeto = {
      savingEfetivado: { valor: 10000, frequencia: "mensal" },
      custoRodar: [
        { valor: 600, frequencia: "mensal" },
        { valor: -400, frequencia: "mensal" },
      ],
    };
    // o -400 é descartado: 10000 - 600, e NÃO 10000 - 200
    expect(impactoLiquido(g)).toBe(9400);
    expect(impactoLiquidoMensal(g)).toBeCloseTo(9400, 8);
  });

  it("custo negativo NUNCA deixa o impacto acima do impacto sem custo nenhum", () => {
    const semCusto: GanhosProjeto = { savingEfetivado: { valor: 8000, frequencia: "mensal" } };
    const comNegativo: GanhosProjeto = { ...semCusto, custoRodar: [{ valor: -9999, frequencia: "mensal" }] };
    expect(impactoLiquido(comNegativo)).toBeLessThanOrEqual(impactoLiquido(semCusto));
    expect(impactoLiquidoMensal(comNegativo)).toBeLessThanOrEqual(impactoLiquidoMensal(semCusto));
  });
});
