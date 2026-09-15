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
  resumirPorJanela,
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

describe("o resumo", () => {
  const agora = new Date("2026-09-15T18:00:00Z"); // 15h de Brasília, terça
  const base = [
    dec("a", "Aprovado", "2026-09-15 12:00:00"),
    dec("b", "Reprovado", "2026-09-15 13:00:00"),
    dec("c", "Aprovado", "2026-09-14 12:00:00"),
    dec("d", "Aprovado", "2026-09-10 12:00:00"), // quinta da semana passada
  ];

  it("conta aprovados e reprovados por janela", () => {
    const [hoje, ontem, semana] = resumirPorJanela(base, agora);
    expect([hoje.aprovados, hoje.reprovados]).toEqual([1, 1]);
    expect([ontem.aprovados, ontem.reprovados]).toEqual([1, 0]);
    // A semana (segunda 14 até hoje 15) tem os 3, e NÃO o da semana passada.
    expect([semana.aprovados, semana.reprovados]).toEqual([2, 1]);
  });

  it("as três janelas vêm sempre, mesmo vazias", () => {
    const r = resumirPorJanela([], agora);
    expect(r.map((j) => j.janela)).toEqual(["hoje", "ontem", "semana"]);
    expect(r.every((j) => j.itens.length === 0)).toBe(true);
  });

  it("os itens vêm do mais recente para o mais antigo", () => {
    const [hoje] = resumirPorJanela(base, agora);
    expect(hoje.itens.map((i) => i.projeto_id)).toEqual(["b", "a"]);
  });

  it("projeto sem nome cai no id, nunca em branco", () => {
    const r = resumirPorJanela(
      [{ ...dec("xyz", "Aprovado", "2026-09-15 12:00:00"), projeto_nome: null }],
      agora,
    );
    expect(r[0].itens[0].nome).toBe("xyz");
  });

  /**
   * ⚠️ O agente só grava `Aprovado`/`Reprovado` (`agenteDeveGravar`). Um status diferente aqui
   * significa que a régua mudou sem este módulo saber — ele aparece na LISTA mas fica fora das
   * duas contagens, visível em vez de somado na caixa errada.
   */
  it("⚠️ o que NÃO é decisão fica fora da lista e das contagens", () => {
    // Escritas antigas (antes da trava de 15/09) gravaram `Pendente`/`Pré-aprovado` com o
    // ator do agente. O painel promete "decisões": mostrá-las ali seria chamar de decisão o
    // que não é. Elas continuam no `admin_status_log`, que é a auditoria.
    const r = resumirPorJanela(
      [
        dec("z", "Pendente", "2026-09-15 12:00:00"),
        dec("w", "Pré-aprovado", "2026-09-15 12:30:00"),
        dec("ok", "Aprovado", "2026-09-15 13:00:00"),
      ],
      agora,
    );
    expect(r[0].itens.map((i) => i.projeto_id)).toEqual(["ok"]);
    expect(r[0].aprovados).toBe(1);
  });
});
