import { describe, it, expect } from "vitest";
import {
  avaliarSinalRag,
  agregarVotos,
  PISO_APOIO_RAG,
  MIN_VIZINHOS_APOIO,
  LIMIAR_CONFIANCA_AGREGADOR,
} from "@/lib/agents/agregador-avaliacao";
import type { ResultadoFinanceiro } from "@/lib/agents/avaliacao-financeira";
import type { ResultadoPlausibilidadeFTE } from "@/lib/agents/analyzer";

describe("constantes do agregador", () => {
  it("PISO_APOIO_RAG é 0.5, MIN_VIZINHOS_APOIO é 2 e LIMIAR_CONFIANCA_AGREGADOR é 0.6", () => {
    expect(PISO_APOIO_RAG).toBe(0.5);
    expect(MIN_VIZINHOS_APOIO).toBe(2);
    expect(LIMIAR_CONFIANCA_AGREGADOR).toBe(0.6);
  });
});

describe("avaliarSinalRag — sinal do RAG a partir dos vizinhos aprovados", () => {
  it("sem vizinhos → apoio false, confiança 0.4, vizinhos 0, topSimilaridade 0, motivo não-nulo", () => {
    const r = avaliarSinalRag([]);
    expect(r.apoio).toBe(false);
    expect(r.confianca).toBe(0.4);
    expect(r.vizinhos).toBe(0);
    expect(r.topSimilaridade).toBe(0);
    expect(r.motivo).not.toBeNull();
  });

  it("≥2 vizinhos e o maior ≥ 0.5 → apoio true, confiança 0.85, vizinhos 2, topSimilaridade 0.8, motivo null", () => {
    const r = avaliarSinalRag([{ similaridade: 0.8 }, { similaridade: 0.6 }]);
    expect(r.apoio).toBe(true);
    expect(r.confianca).toBe(0.85);
    expect(r.vizinhos).toBe(2);
    expect(r.topSimilaridade).toBe(0.8);
    expect(r.motivo).toBeNull();
  });

  it("vizinhos presentes mas abaixo do mínimo (1 só) → apoio false, confiança 0.55, motivo não-nulo", () => {
    const r = avaliarSinalRag([{ similaridade: 0.9 }]);
    expect(r.apoio).toBe(false);
    expect(r.confianca).toBe(0.55);
    expect(r.motivo).not.toBeNull();
  });

  it("topSimilaridade é o MAIOR dos vizinhos, não o primeiro", () => {
    const r = avaliarSinalRag([{ similaridade: 0.3 }, { similaridade: 0.9 }]);
    expect(r.topSimilaridade).toBe(0.9);
  });
});

const fteOk: ResultadoPlausibilidadeFTE = {
  implausivel: false,
  fte: 1,
  pessoas: 2,
  motivo: null,
};
const financeiroOk: ResultadoFinanceiro = {
  veredito: "ok",
  confianca: 0.9,
  motivo: null,
  sinais: [],
};
const ragApoio = {
  apoio: true,
  confianca: 0.85,
  vizinhos: 2,
  topSimilaridade: 0.8,
  motivo: null,
};

describe("agregarVotos — juiz agregador puro com confiança", () => {
  it("especial:true → isento, veredito 'isento', não aplica em_validacao, confiança 1 (independe dos votos)", () => {
    const r = agregarVotos({
      fte: { implausivel: true, fte: 5, pessoas: 1, motivo: "absurdo" },
      financeiro: { veredito: "atencao", confianca: 0.3, motivo: "x", sinais: ["y"] },
      rag: { apoio: false, confianca: 0.4, vizinhos: 0, topSimilaridade: 0, motivo: "z" },
      especial: true,
    });
    expect(r.isento).toBe(true);
    expect(r.veredito).toBe("isento");
    expect(r.aplicarEmValidacao).toBe(false);
    expect(r.confianca).toBe(1);
  });

  it("fluxoDireto:true → isento, veredito 'isento'", () => {
    const r = agregarVotos({
      fte: fteOk,
      financeiro: financeiroOk,
      rag: ragApoio,
      fluxoDireto: true,
    });
    expect(r.isento).toBe(true);
    expect(r.veredito).toBe("isento");
  });

  it("tudo bom → aprovar, sem em_validacao, sem divergência, confiança ≈ mínimo dos três (0.85)", () => {
    const r = agregarVotos({ fte: fteOk, financeiro: financeiroOk, rag: ragApoio });
    expect(r.veredito).toBe("aprovar");
    expect(r.aplicarEmValidacao).toBe(false);
    expect(r.isento).toBe(false);
    expect(r.divergencia).toBe(false);
    expect(r.confianca).toBeCloseTo(0.85, 5);
  });

  it("FTE implausível → em_validacao, aplica em_validacao, confiança baixa (≤0.2), motivos inclui o motivo do FTE", () => {
    const motivoFte = "Saving de 500h/mês equivale a 12 FTE para 1 pessoa";
    const r = agregarVotos({
      fte: { implausivel: true, fte: 2.3, pessoas: 1, motivo: motivoFte },
      financeiro: financeiroOk,
      rag: ragApoio,
    });
    expect(r.veredito).toBe("em_validacao");
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.confianca).toBeLessThanOrEqual(0.2);
    expect(r.motivos).toContain(motivoFte);
  });

  it("financeiro 'atenção' (confiança 0.3) com FTE ok e RAG apoio → em_validacao, motivos inclui o motivo financeiro", () => {
    const motivoFin = "materialidade acima do teto";
    const r = agregarVotos({
      fte: fteOk,
      financeiro: { veredito: "atencao", confianca: 0.3, motivo: motivoFin, sinais: [motivoFin] },
      rag: ragApoio,
    });
    expect(r.veredito).toBe("em_validacao");
    expect(r.motivos).toContain(motivoFin);
  });

  it("divergência: FTE ok, financeiro ok (0.9), RAG SEM apoio (0.55) → aplica em_validacao, divergência true, veredito em_validacao, motivos inclui o do RAG", () => {
    const motivoRag = "sem vizinhos aprovados suficientes para apoiar";
    const r = agregarVotos({
      fte: fteOk,
      financeiro: financeiroOk,
      rag: { apoio: false, confianca: 0.55, vizinhos: 1, topSimilaridade: 0.9, motivo: motivoRag },
    });
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.divergencia).toBe(true);
    expect(r.veredito).toBe("em_validacao");
    expect(r.motivos).toContain(motivoRag);
  });

  it("limiarConfianca custom (0.9): mesmo cenário bom mas confiança 0.85 < 0.9 → aplica em_validacao, veredito em_validacao", () => {
    const r = agregarVotos({
      fte: fteOk,
      financeiro: financeiroOk,
      rag: ragApoio,
      limiarConfianca: 0.9,
    });
    expect(r.aplicarEmValidacao).toBe(true);
    expect(r.veredito).toBe("em_validacao");
  });

  it("NUNCA devolve reprovar/rejeitado — com todos os votos ruins o veredito é 'em_validacao'", () => {
    const r = agregarVotos({
      fte: { implausivel: true, fte: 12, pessoas: 1, motivo: "absurdo" },
      financeiro: { veredito: "atencao", confianca: 0.3, motivo: "dupla contagem", sinais: ["dupla contagem"] },
      rag: { apoio: false, confianca: 0.4, vizinhos: 0, topSimilaridade: 0, motivo: "sem apoio" },
    });
    expect(r.veredito).toBe("em_validacao");
    expect(["aprovar", "em_validacao", "isento"]).toContain(r.veredito);
    expect(r.veredito).not.toBe("reprovar");
    expect(r.veredito).not.toBe("rejeitado");
  });

  it("confiança de saída sempre em [0,1] em vários cenários", () => {
    const cenarios = [
      agregarVotos({ fte: fteOk, financeiro: financeiroOk, rag: ragApoio }),
      agregarVotos({ fte: fteOk, financeiro: financeiroOk, rag: ragApoio, especial: true }),
      agregarVotos({
        fte: { implausivel: true, fte: 12, pessoas: 1, motivo: "absurdo" },
        financeiro: { veredito: "atencao", confianca: 0.3, motivo: "x", sinais: ["x"] },
        rag: { apoio: false, confianca: 0.4, vizinhos: 0, topSimilaridade: 0, motivo: "z" },
      }),
    ];
    for (const r of cenarios) {
      expect(r.confianca).toBeGreaterThanOrEqual(0);
      expect(r.confianca).toBeLessThanOrEqual(1);
    }
  });
});
