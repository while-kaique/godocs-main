/**
 * A view temporal do agente (hoje · ontem · esta semana).
 *
 * O que estes testes seguram é o que erra em silêncio numa feature de data: o FUSO. O
 * `created_at` do log é UTC e "hoje" para quem lê a tela é o dia de Brasília — às 21h daqui
 * o UTC já virou, e uma janela ingênua mostraria as decisões da noite no dia errado.
 */
import { describe, it, expect } from "vitest";
import {
  diaAnterior,
  diaBrasilia,
  diaDaDecisao,
  naJanela,
  indexarDecisoes,
  desdeParaJanelas,
  segundaDaSemana,
  type DecisaoDoAgente,
} from "@/lib/agentes-atividade";

const dec = (id: string, status: string, created_at: string): DecisaoDoAgente => ({
  projeto_id: id,
  projeto_nome: `Projeto ${id}`,
  status_novo: status,
  created_at,
});

describe("o fuso, que é onde este tipo de tela erra", () => {
  it("⚠️ 23h de Brasília ainda é HOJE, mesmo com o UTC já virado", () => {
    // 2026-09-15 23:30 BRT === 2026-09-16 02:30 UTC. Ler o carimbo cru daria o dia seguinte.
    expect(diaDaDecisao(dec("a", "Aprovado", "2026-09-16 02:30:00"))).toBe("2026-09-15");
  });

  it("01h de Brasília é o dia novo", () => {
    expect(diaDaDecisao(dec("a", "Aprovado", "2026-09-16 04:00:00"))).toBe("2026-09-16");
  });

  it("⚠️ o carimbo do SQLite é UTC: sem o 'Z' o JS o leria como hora local", () => {
    // O servidor roda em UTC, então o erro passaria despercebido em prod e apareceria só
    // para quem estivesse em outro fuso.
    expect(diaDaDecisao(dec("a", "Aprovado", "2026-09-15 16:24:26"))).toBe("2026-09-15");
    expect(diaDaDecisao(dec("a", "Aprovado", "2026-09-15T16:24:26Z"))).toBe("2026-09-15");
  });

  it("carimbo ilegível ou ausente não vira dia nenhum", () => {
    expect(diaDaDecisao(dec("a", "Aprovado", ""))).toBeNull();
    expect(diaDaDecisao({ ...dec("a", "Aprovado", ""), created_at: null })).toBeNull();
    expect(diaDaDecisao(dec("a", "Aprovado", "ontem de tarde"))).toBeNull();
  });

  it("diaBrasilia converte de UTC para o dia daqui", () => {
    expect(diaBrasilia(new Date("2026-09-16T02:30:00Z"))).toBe("2026-09-15");
  });
});

describe("as janelas", () => {
  it("⚠️ a semana começa na SEGUNDA: sexta não cai na semana passada no domingo", () => {
    // 2026-09-15 é uma terça. A segunda dela é 14.
    expect(segundaDaSemana("2026-09-15")).toBe("2026-09-14");
    // 2026-09-20 é um domingo — a segunda dele ainda é 14, não 21.
    expect(segundaDaSemana("2026-09-20")).toBe("2026-09-14");
    // E na própria segunda, é ela mesma.
    expect(segundaDaSemana("2026-09-14")).toBe("2026-09-14");
  });

  it("diaAnterior atravessa a virada de mês", () => {
    expect(diaAnterior("2026-09-01")).toBe("2026-08-31");
    expect(diaAnterior("2026-01-01")).toBe("2025-12-31");
  });

  it("hoje, ontem e semana recortam o que se espera", () => {
    const hoje = "2026-09-15";
    expect(naJanela("2026-09-15", "hoje", hoje)).toBe(true);
    expect(naJanela("2026-09-14", "hoje", hoje)).toBe(false);
    expect(naJanela("2026-09-14", "ontem", hoje)).toBe(true);
    expect(naJanela("2026-09-13", "ontem", hoje)).toBe(false);
    // 13 é domingo: fora da semana que começa em 14.
    expect(naJanela("2026-09-13", "semana", hoje)).toBe(false);
    expect(naJanela("2026-09-14", "semana", hoje)).toBe(true);
  });

  it("⚠️ a semana INCLUI hoje e ontem: não são fatias exclusivas", () => {
    const hoje = "2026-09-15";
    expect(naJanela(hoje, "semana", hoje)).toBe(true);
    expect(naJanela("2026-09-14", "semana", hoje)).toBe(true);
  });

  it("dia nulo não entra em janela nenhuma", () => {
    expect(naJanela(null, "hoje", "2026-09-15")).toBe(false);
    expect(naJanela(null, "semana", "2026-09-15")).toBe(false);
  });
});

describe("a marca que o filtro lê", () => {
  const agora = new Date("2026-09-15T18:00:00Z"); // 15h de Brasília, terça

  it("marca cada projeto com as janelas em que a decisão dele cai", () => {
    const m = indexarDecisoes(
      [
        { id: "a", status: "Aprovado", quando: "2026-09-15 13:00:00" },
        { id: "c", status: "Aprovado", quando: "2026-09-14 10:00:00" },
        { id: "d", status: "Reprovado", quando: "2026-09-10 10:00:00" },
      ],
      agora,
    );
    // Hoje também é "esta semana" — as janelas se sobrepõem de propósito.
    expect(m.get("a")?.janelas).toEqual(["hoje", "semana"]);
    expect(m.get("c")?.janelas).toEqual(["ontem", "semana"]);
    // Semana passada: decidido, mas fora das três janelas.
    expect(m.get("d")?.janelas).toEqual([]);
  });

  it("id de legado casa por chave canônica (o log guarda em MAIÚSCULA)", () => {
    const m = indexarDecisoes(
      [{ id: "LEGADO-233", status: "Aprovado", quando: "2026-09-15 13:00:00" }],
      agora,
    );
    expect(m.get("legado-233")?.status).toBe("Aprovado");
  });

  /**
   * ⚠️ Rerodada e correção existem: o filtro tem de concordar com a coluna, e a coluna mostra
   * a ÚLTIMA escrita.
   */
  it("com mais de uma decisão no período, vale a mais recente", () => {
    const m = indexarDecisoes(
      [
        { id: "a", status: "Reprovado", quando: "2026-09-15 09:00:00" },
        { id: "a", status: "Aprovado", quando: "2026-09-15 17:00:00" },
      ],
      agora,
    );
    expect(m.get("a")?.status).toBe("Aprovado");
  });

  it("a ordem de chegada não muda o resultado", () => {
    const linhas = [
      { id: "a", status: "Aprovado", quando: "2026-09-15 17:00:00" },
      { id: "a", status: "Reprovado", quando: "2026-09-15 09:00:00" },
    ];
    expect(indexarDecisoes(linhas, agora).get("a")?.status).toBe("Aprovado");
    expect(indexarDecisoes([...linhas].reverse(), agora).get("a")?.status).toBe("Aprovado");
  });

  /**
   * ⚠️ O agente só grava `Aprovado`/`Reprovado` (`agenteDeveGravar`). As escritas de
   * `Pendente`/`Pré-aprovado` com o ator do time são anteriores à trava de 15/09 e são o
   * defeito que ela fechou: recortar a lista por elas as carimbaria como veredito. Elas
   * continuam no `admin_status_log`, que é a auditoria.
   */
  it("⚠️ o que NÃO é decisão não vira marca", () => {
    const m = indexarDecisoes(
      [
        { id: "z", status: "Pendente", quando: "2026-09-15 12:00:00" },
        { id: "w", status: "Pré-aprovado", quando: "2026-09-15 12:30:00" },
        { id: "ok", status: "Aprovado", quando: "2026-09-15 13:00:00" },
      ],
      agora,
    );
    expect([...m.keys()]).toEqual(["ok"]);
  });

  it("⚠️ status antigo não apaga a decisão real do mesmo projeto", () => {
    // O time gravou `Pendente` de manhã (pré-trava) e `Aprovado` à tarde: a marca é a decisão.
    const m = indexarDecisoes(
      [
        { id: "a", status: "Aprovado", quando: "2026-09-15 09:00:00" },
        { id: "a", status: "Pendente", quando: "2026-09-15 18:00:00" },
      ],
      agora,
    );
    expect(m.get("a")?.status).toBe("Aprovado");
  });

  it("carimbo ilegível não vira janela nenhuma, e não lança", () => {
    const m = indexarDecisoes([{ id: "a", status: "Aprovado", quando: "ontem" }], agora);
    expect(m.get("a")?.janelas).toEqual([]);
  });

  it("desdeParaJanelas devolve o formato do created_at do SQLite, 10 dias atrás", () => {
    expect(desdeParaJanelas(new Date("2026-09-15T18:00:00Z"))).toBe("2026-09-05 18:00:00");
  });
});
