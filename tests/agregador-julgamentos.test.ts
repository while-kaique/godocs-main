import { describe, it, expect } from "vitest";
import { agregarJulgamentos } from "@/lib/agents/agregador-avaliacao";
import type {
  DimensaoAvaliacao,
  JulgamentoEspecialista,
} from "@/lib/agents/especialista-avaliacao";

/** Fábrica de julgamento de especialista para os cenários da mesa. */
function jul(
  dimensao: DimensaoAvaliacao,
  preocupa: boolean,
  confianca: number,
  argumento = `parecer de ${dimensao}`,
): JulgamentoEspecialista {
  return { dimensao, preocupa, argumento, confianca, sinais: [], origem: "llm" };
}

const TODOS_TRANQUILOS_ALTA: JulgamentoEspecialista[] = [
  jul("fte", false, 0.9),
  jul("financeiro", false, 0.9),
  jul("rag", false, 0.85),
  jul("cetico", false, 0.9),
];

describe("agregarJulgamentos — chair sobre os julgamentos LLM da mesa", () => {
  it("especial:true → isento, veredito 'isento', não aplica em_validacao, confiança 1 (independe dos julgamentos)", () => {
    const r = agregarJulgamentos({
      julgamentos: [jul("fte", true, 0.9), jul("cetico", true, 0.9)],
      especial: true,
    });
    expect(r.isento).toBe(true);
    expect(r.veredito).toBe("isento");
    expect(r.aplicarEmValidacao).toBe(false);
    expect(r.confianca).toBe(1);
  });

  it("fluxoDireto:true → isento, veredito 'isento'", () => {
    const r = agregarJulgamentos({ julgamentos: TODOS_TRANQUILOS_ALTA, fluxoDireto: true });
    expect(r.isento).toBe(true);
    expect(r.veredito).toBe("isento");
  });

  it("sem julgamentos → em_validacao (dúvida máxima), confiança 0, sem divergência, com motivo", () => {
    const r = agregarJulgamentos({ julgamentos: [] });
    expect(r.veredito).toBe("em_validacao");
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.confianca).toBe(0);
    expect(r.divergencia).toBe(false);
    expect(r.motivos.length).toBeGreaterThan(0);
  });

  it("todos tranquilos e confiantes → aprovar, sem divergência, confiança alta (≈0.89)", () => {
    const r = agregarJulgamentos({ julgamentos: TODOS_TRANQUILOS_ALTA });
    expect(r.veredito).toBe("aprovar");
    expect(r.aplicarEmValidacao).toBe(false);
    expect(r.isento).toBe(false);
    expect(r.divergencia).toBe(false);
    // concordância direcional 1.0 × confiança média ≈0.8875
    expect(r.confianca).toBeGreaterThan(0.85);
  });

  it("todos concordam que está TRANQUILO mas INSEGUROS (conf 0.3) → em_validacao, confiança baixa, SEM divergência", () => {
    const r = agregarJulgamentos({
      julgamentos: [
        jul("fte", false, 0.3),
        jul("financeiro", false, 0.3),
        jul("rag", false, 0.3),
        jul("cetico", false, 0.3),
      ],
    });
    // consenso na direção, mas o painel não está seguro → humano decide
    expect(r.divergencia).toBe(false);
    expect(r.confianca).toBeLessThan(0.6);
    expect(r.veredito).toBe("em_validacao");
    expect(r.aplicarEmValidacao).toBe(true);
  });

  it("divisão 2×2 (dois preocupam, dois tranquilos) → em_validacao, divergência true, confiança baixa (~0.4)", () => {
    const r = agregarJulgamentos({
      julgamentos: [
        jul("fte", true, 0.8),
        jul("financeiro", true, 0.8),
        jul("rag", false, 0.8),
        jul("cetico", false, 0.8),
      ],
    });
    expect(r.veredito).toBe("em_validacao");
    expect(r.divergencia).toBe(true);
    expect(r.confianca).toBeLessThan(0.5);
  });

  it("um único especialista preocupa entre tranquilos → em_validacao, divergência true, motivos inclui o ARGUMENTO do preocupado", () => {
    const argCetico = "número fechou na conversa sem rastro de medição — refuto a aprovação";
    const r = agregarJulgamentos({
      julgamentos: [
        jul("fte", false, 0.9),
        jul("financeiro", false, 0.9),
        jul("rag", false, 0.9),
        jul("cetico", true, 0.9, argCetico),
      ],
    });
    expect(r.veredito).toBe("em_validacao");
    expect(r.divergencia).toBe(true);
    expect(r.motivos).toContain(argCetico);
  });

  it("todos preocupam e confiantes → em_validacao, SEM divergência (só um lado), confiança alta, motivos com os argumentos", () => {
    const r = agregarJulgamentos({
      julgamentos: [
        jul("fte", true, 0.9, "12 FTE para 1 pessoa"),
        jul("financeiro", true, 0.9, "materialidade acima do teto"),
        jul("rag", true, 0.9, "fora da vizinhança aprovada"),
        jul("cetico", true, 0.9, "impacto projetado vendido como realizado"),
      ],
    });
    expect(r.veredito).toBe("em_validacao");
    expect(r.divergencia).toBe(false);
    expect(r.confianca).toBeGreaterThan(0.85);
    expect(r.motivos).toContain("materialidade acima do teto");
  });

  it("limiarConfianca custom (0.95): todos tranquilos conf 0.9 (confiança ≈0.9 < 0.95) → em_validacao", () => {
    const r = agregarJulgamentos({ julgamentos: TODOS_TRANQUILOS_ALTA, limiarConfianca: 0.95 });
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.veredito).toBe("em_validacao");
  });

  it("NUNCA devolve reprovar/rejeitado — com todos preocupando o veredito é 'em_validacao'", () => {
    const r = agregarJulgamentos({
      julgamentos: [
        jul("fte", true, 0.9),
        jul("financeiro", true, 0.9),
        jul("cetico", true, 0.9),
      ],
    });
    expect(["aprovar", "em_validacao", "isento"]).toContain(r.veredito);
    expect(r.veredito).not.toBe("reprovar");
    expect(r.veredito).not.toBe("rejeitado");
  });

  it("confiança de saída sempre em [0,1] (inclui confianças cruas fora de faixa)", () => {
    const cenarios = [
      agregarJulgamentos({ julgamentos: TODOS_TRANQUILOS_ALTA }),
      agregarJulgamentos({ julgamentos: TODOS_TRANQUILOS_ALTA, especial: true }),
      agregarJulgamentos({ julgamentos: [] }),
      agregarJulgamentos({
        julgamentos: [
          jul("fte", true, 5 as number), // fora de faixa → clampado
          jul("financeiro", false, -3 as number),
          jul("rag", false, Number.NaN),
        ],
      }),
    ];
    for (const r of cenarios) {
      expect(r.confianca).toBeGreaterThanOrEqual(0);
      expect(r.confianca).toBeLessThanOrEqual(1);
    }
  });
});
