/**
 * CALIBRADOR do painel (T4) — parte PURA.
 *
 * O que estes testes prendem:
 * - **rodada artificialmente inflada volta para a curva** (a guarda que o plano pede);
 * - **nunca PROMOVE**: `nota_depois <= nota_antes`, sempre, em qualquer entrada;
 * - **a cota não INVERTE a ordem** — quem estava acima continua acima (é o que separa "calibrar" de
 *   "reordenar por palpite");
 * - **as duas tarefas do calibrador** (T1, achado 3): segurar o topo (cota) **e** não promover o
 *   lixo (piso de prova). Um calibrador só-histograma passaria no 1º e falharia no 2º;
 * - **piso absoluto por faixa**: uma página pequena com UMA prata legítima não é rebaixada;
 * - `aplicarCota:false` mede e RELATA sem mexer na nota (é como se compara os dois regimes no T7);
 * - curva de referência é PARÂMETRO e o resumo declara QUAL foi usada.
 */
import { describe, it, expect } from "vitest";
import {
  EIXOS_VALOR_PARA_OURO,
  FATOR_TOLERANCIA,
  MIN_POR_FAIXA,
  NOTA_EXIGE_DOIS_EIXOS,
  NOTA_EXIGE_PROVA_NOMEADA,
  aplicarPisosDeProva,
  calibrarRodada,
  compararForca,
  CURVA_ESPECIAIS_AUDITADOS,
  curvaDeNotas,
  entradaDeConsolidado,
  explicarCalibragem,
  percentilDaCurva,
  type EntradaCalibragem,
} from "@/lib/especiais-calibrador";
import { CURVA_BASE, NOTA_MAX, percentilAcimaDe } from "@/lib/especiais-regua";
import { LENTE_GATE, consolidarLentes, type AvaliacaoLente } from "@/lib/agents/especiais-lentes";

function ent(
  id: string,
  nota: number,
  opts: {
    gate?: number;
    prova?: "nomeada" | "vaga" | "ausente";
    valor?: number[];
    valorNomeado?: number;
  } = {},
): EntradaCalibragem {
  return {
    projeto_id: id,
    nota_preliminar: nota,
    gate: opts.gate ?? nota,
    gate_evidencia: opts.prova ?? "nomeada",
    notas_valor: opts.valor ?? [nota, nota],
    valor_nomeado_max: opts.valorNomeado ?? 0,
  };
}

describe("piso de prova (por projeto, sem curva)", () => {
  it("≥3 sem prova nomeada no eixo estrutural não passa da faixa de baixo", () => {
    const r = aplicarPisosDeProva(ent("a", 4, { prova: "vaga" }));
    expect(r.nota).toBe(NOTA_EXIGE_PROVA_NOMEADA - 1);
    expect(r.motivos).toContain("prova_nao_nomeada");
  });

  // ⚠️ Decisão do Kaique, 27/08/2026 (T7 medido): a prova nomeada não precisa mais ser a DO GATE —
  // vale a de qualquer eixo que sustente ≥3. Exigindo-a só do gate, os 48 especiais ficaram TODOS em
  // 2★ contra 41,7% de ≥3★ da triagem humana. O piso continua sendo sobre PROVA, não sobre o eixo.
  it("≥3 com gate vago PASSA quando um eixo de valor traz prova nomeada sustentando ≥3", () => {
    const r = aplicarPisosDeProva(
      ent("a", 3, { prova: "vaga", valorNomeado: NOTA_EXIGE_PROVA_NOMEADA }),
    );
    expect(r.nota).toBe(3);
    expect(r.motivos).not.toContain("prova_nao_nomeada");
  });

  it("≥3 com gate vago e prova nomeada ABAIXO de 3 segue rebaixado", () => {
    const r = aplicarPisosDeProva(
      ent("a", 4, { prova: "vaga", valorNomeado: NOTA_EXIGE_PROVA_NOMEADA - 1 }),
    );
    expect(r.nota).toBe(NOTA_EXIGE_PROVA_NOMEADA - 1);
    expect(r.motivos).toContain("prova_nao_nomeada");
  });

  it("≥5 com um eixo de valor só cai para a faixa de baixo", () => {
    const r = aplicarPisosDeProva(ent("a", 6, { valor: [6, 0, 0] }));
    expect(r.nota).toBe(NOTA_EXIGE_DOIS_EIXOS - 1);
    expect(r.motivos).toContain("um_eixo_so");
  });

  it("≥5 com os eixos exigidos passa intacta", () => {
    const r = aplicarPisosDeProva(ent("a", 6, { valor: [6, 4] }));
    expect(r.nota).toBe(6);
    expect(r.motivos).toEqual([]);
    expect(EIXOS_VALOR_PARA_OURO).toBe(2);
  });

  it("nota baixa nunca é tocada (o piso de prova só desce)", () => {
    for (const n of [0, 1, 2]) {
      const r = aplicarPisosDeProva(ent("a", n, { prova: "ausente", valor: [] }));
      expect(r.nota).toBe(n);
    }
  });

  it("nota fora da escala é trazida para dentro, com motivo declarado", () => {
    expect(aplicarPisosDeProva(ent("a", 99)).nota).toBe(NOTA_MAX);
    expect(aplicarPisosDeProva(ent("a", -3)).nota).toBe(0);
    expect(aplicarPisosDeProva(ent("a", 99)).motivos).toContain("fora_da_escala");
  });
});

describe("cota por faixa (por rodada)", () => {
  it("rodada artificialmente INFLADA volta para a curva", () => {
    // 20 projetos, todos 6★ com prova nomeada e 2 eixos fortes: nada barra pelo piso de prova.
    const entradas = Array.from({ length: 20 }, (_, i) =>
      ent(`p${String(i).padStart(2, "0")}`, 6, { valor: [6, 5] }),
    );
    const { linhas, resumo } = calibrarRodada(entradas);

    const cota3 = resumo.cotas.find((c) => c.limiar === NOTA_EXIGE_PROVA_NOMEADA)!;
    const cota5 = resumo.cotas.find((c) => c.limiar === NOTA_EXIGE_DOIS_EIXOS)!;
    expect(cota3.antes).toBe(20);
    expect(cota3.depois).toBeLessThanOrEqual(cota3.permitido);
    expect(cota5.depois).toBeLessThanOrEqual(cota5.permitido);
    expect(resumo.rebaixados_por_cota).toBeGreaterThan(0);
    // a permissão sai da curva declarada (a dos ESPECIAIS, por default), não de um número na mão
    const pct3 = percentilDaCurva(CURVA_ESPECIAIS_AUDITADOS, NOTA_EXIGE_PROVA_NOMEADA);
    expect(cota3.referencia_pct).toBeCloseTo(Math.round(pct3 * 10) / 10, 1);
    expect(cota3.permitido).toBe(
      Math.max(MIN_POR_FAIXA, Math.ceil((20 * pct3 * FATOR_TOLERANCIA) / 100)),
    );
    // e ninguém subiu
    for (const l of linhas) expect(l.nota_depois).toBeLessThanOrEqual(l.nota_antes);
  });

  it("NÃO inverte a ordem: quem estava acima continua acima", () => {
    const entradas = [
      ent("alta", 8, { valor: [8, 7] }),
      ...Array.from({ length: 15 }, (_, i) => ent(`media${i}`, 5, { valor: [5, 4] })),
      ...Array.from({ length: 10 }, (_, i) => ent(`baixa${i}`, 1, { valor: [1] })),
    ];
    const { linhas } = calibrarRodada(entradas);
    const porId = new Map(linhas.map((l) => [l.projeto_id, l]));
    for (const a of linhas) {
      for (const b of linhas) {
        if (a.nota_antes > b.nota_antes) {
          expect(porId.get(a.projeto_id)!.nota_depois).toBeGreaterThanOrEqual(
            porId.get(b.projeto_id)!.nota_depois,
          );
        }
      }
    }
  });

  it("página pequena com UMA prata legítima não é rebaixada (piso absoluto)", () => {
    const entradas = [
      ent("boa", 3, { valor: [3, 3] }),
      ...Array.from({ length: 11 }, (_, i) => ent(`p${i}`, 1, { valor: [1] })),
    ];
    const { linhas, resumo } = calibrarRodada(entradas);
    expect(linhas.find((l) => l.projeto_id === "boa")!.nota_depois).toBe(3);
    expect(resumo.rebaixados_por_cota).toBe(0);
  });

  it("`aplicarCota:false` relata sem mexer na nota", () => {
    const entradas = Array.from({ length: 20 }, (_, i) => ent(`p${i}`, 6, { valor: [6, 5] }));
    const { linhas, resumo } = calibrarRodada(entradas, { aplicarCota: false });
    for (const l of linhas) expect(l.nota_depois).toBe(6);
    expect(resumo.cota_aplicada).toBe(false);
    expect(resumo.rebaixados_por_cota).toBe(0);
    expect(resumo.mais_generosa).toBe(true); // mediu e acusou
  });

  it("rodada vazia devolve resumo zerado sem lançar", () => {
    const { linhas, resumo } = calibrarRodada([]);
    expect(linhas).toEqual([]);
    expect(resumo.total).toBe(0);
    expect(resumo.mais_generosa).toBe(false);
  });
});

describe("as DUAS tarefas juntas (achado 3 do T1)", () => {
  it("segura o topo E não promove o lixo na mesma rodada", () => {
    const entradas = [
      // lixo: prova ausente no eixo estrutural, mas uma lente de valor animada
      ...Array.from({ length: 12 }, (_, i) =>
        ent(`lixo${i}`, 4, { gate: 4, prova: "ausente", valor: [4, 4] }),
      ),
      // topo: prova nomeada e 2 eixos fortes
      ...Array.from({ length: 8 }, (_, i) => ent(`topo${i}`, 7, { valor: [7, 6] })),
    ];
    const { linhas, resumo } = calibrarRodada(entradas);
    const porId = new Map(linhas.map((l) => [l.projeto_id, l]));

    // nenhum "lixo" fica em faixa de prata
    for (let i = 0; i < 12; i++) {
      expect(porId.get(`lixo${i}`)!.nota_depois).toBeLessThan(NOTA_EXIGE_PROVA_NOMEADA);
    }
    expect(resumo.rebaixados_por_prova).toBe(12);
    // e o topo foi contido pela cota
    expect(resumo.rebaixados_por_cota).toBeGreaterThan(0);
  });
});

describe("curva de referência é parâmetro", () => {
  it("a `CURVA_BASE` é MUITO mais dura que a dos especiais — e o default é a dos especiais", () => {
    const entradas = Array.from({ length: 20 }, (_, i) => ent(`p${i}`, 3, { valor: [3, 3] }));
    const padrao = calibrarRodada(entradas).resumo;
    const comBase = calibrarRodada(entradas, { curva: CURVA_BASE }).resumo;

    const cotaPadrao = padrao.cotas.find((c) => c.limiar === 3)!;
    const cotaBase = comBase.cotas.find((c) => c.limiar === 3)!;
    // medido 26/08/2026: 41,7% dos especiais auditados são ≥3, contra 5,4% da base inteira
    expect(cotaPadrao.referencia_pct).toBeGreaterThan(cotaBase.referencia_pct * 5);
    expect(cotaPadrao.permitido).toBeGreaterThan(cotaBase.permitido);
    expect(padrao.curva_referencia).toBe("CURVA_ESPECIAIS_AUDITADOS");
    expect(comBase.curva_referencia).toContain("base inteira");
  });

  it("curva declarada de fora é respeitada, com o rótulo que o chamador der", () => {
    const entradas = Array.from({ length: 20 }, (_, i) => ent(`p${i}`, 3, { valor: [3, 3] }));
    const generosa = curvaDeNotas([0, 3, 3, 3, 4, 5, 7, 10, 10, 10]); // 80% ≥3
    const solta = calibrarRodada(entradas, {
      curva: generosa,
      rotuloCurva: "força-tarefa",
    }).resumo;
    expect(solta.cotas.find((c) => c.limiar === 3)!.permitido).toBeGreaterThan(
      calibrarRodada(entradas).resumo.cotas.find((c) => c.limiar === 3)!.permitido,
    );
    expect(solta.curva_referencia).toBe("força-tarefa");
  });

  it("a curva dos especiais AUDITADOS é a medição de 26/08/2026 (48 com nota humana)", () => {
    const total = Object.values(CURVA_ESPECIAIS_AUDITADOS).reduce((s, v) => s + v, 0);
    expect(total).toBe(48);
    expect(percentilDaCurva(CURVA_ESPECIAIS_AUDITADOS, 3)).toBeCloseTo(41.7, 1);
    expect(percentilDaCurva(CURVA_ESPECIAIS_AUDITADOS, 5)).toBeCloseTo(12.5, 1);
  });

  it("`percentilDaCurva` ignora a chave `vazio` e casa com a régua na CURVA_BASE", () => {
    expect(percentilDaCurva(CURVA_BASE, 3)).toBeCloseTo(percentilAcimaDe(3), 6);
    expect(percentilDaCurva({ "0": 1, vazio: 999 }, 0)).toBe(100);
    expect(percentilDaCurva({}, 3)).toBe(0);
  });

  it("`curvaDeNotas` conta por nota inteira dentro da escala", () => {
    expect(curvaDeNotas([0, 0, 3, 3, 3, 99, -2])).toEqual({
      "0": 3,
      "3": 3,
      [String(NOTA_MAX)]: 1,
    });
  });
});

describe("ponte com o T3 e texto determinístico", () => {
  const av = (lente: string, nota: number): AvaliacaoLente => ({
    lente,
    piso: null,
    ancora: null,
    nota,
    evidencia: "nomeada",
    confianca: "media",
    justificativa: "x",
    sustentacao: "painel de faturamento",
  });

  it("`entradaDeConsolidado` não confunde o gate com as lentes de valor", () => {
    const avals = [av(LENTE_GATE, 3), av("alcance_reuso", 5), av("risco_evitado", 0)];
    const e = entradaDeConsolidado("p1", avals, consolidarLentes(avals));
    expect(e.gate).toBe(3);
    expect(e.gate_evidencia).toBe("nomeada");
    expect(e.notas_valor.sort()).toEqual([0, 5]);
    expect(e.nota_preliminar).toBe(4); // gate 3 + margem de 1
  });

  it("`compararForca` põe a nota na frente da prova (é o que preserva a ordem)", () => {
    const forte = ent("b", 5, { prova: "vaga" });
    const fraco = ent("a", 4, { prova: "nomeada" });
    expect(compararForca(forte, fraco)).toBeLessThan(0);
  });

  it("a explicação nomeia o motivo, e nota intacta é dita como tal", () => {
    const rebaixada = explicarCalibragem({
      projeto_id: "p",
      nota_antes: 4,
      nota_depois: 2,
      motivos: ["prova_nao_nomeada"],
    });
    expect(rebaixada).toContain("4★");
    expect(rebaixada).toContain("2★");
    expect(rebaixada).toContain("NOMEADO");

    const intacta = explicarCalibragem({
      projeto_id: "p",
      nota_antes: 2,
      nota_depois: 2,
      motivos: [],
    });
    expect(intacta).toContain("não mexeu");
  });
});
