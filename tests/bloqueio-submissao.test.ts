import { afterEach, describe, expect, it } from "vitest";
import {
  COPY_BLOQUEIO,
  FIM_PADRAO_UTC,
  INICIO_PADRAO_UTC,
  deveRecusarSubmissao,
  estaBloqueado,
  estadoBloqueio,
  faseBloqueio,
  janelaBloqueio,
} from "../src/lib/bloqueio-submissao";
import {
  bloqueioSubmissaoPausada,
  formatarBloqueio,
} from "../src/lib/mensagens-submissao";

const INICIO = Date.parse(INICIO_PADRAO_UTC); // 2026-08-26T02:59:00Z
const FIM = Date.parse(FIM_PADRAO_UTC); // 2026-09-01T03:00:00Z

const ANTES = INICIO - 60_000; // 1 min antes do início
const MEIO = (INICIO + FIM) / 2; // no meio da janela
const DEPOIS = FIM + 60_000; // 1 min depois da reabertura

afterEach(() => {
  delete process.env.SUBMISSAO_BLOQUEIO_INICIO;
  delete process.env.SUBMISSAO_BLOQUEIO_FIM;
});

describe("estaBloqueado — bordas da janela", () => {
  it("antes do início → false", () => {
    expect(estaBloqueado(ANTES)).toBe(false);
  });
  it("no instante do início → true (inclusivo)", () => {
    expect(estaBloqueado(INICIO)).toBe(true);
  });
  it("no meio → true", () => {
    expect(estaBloqueado(MEIO)).toBe(true);
  });
  it("no instante do fim → false (reabertura, exclusivo)", () => {
    expect(estaBloqueado(FIM)).toBe(false);
  });
  it("depois do fim → false", () => {
    expect(estaBloqueado(DEPOIS)).toBe(false);
  });
});

describe("faseBloqueio / estadoBloqueio", () => {
  it("antes → fase 'antes', não bloqueado, mensagem de aviso prévio", () => {
    const e = estadoBloqueio(ANTES);
    expect(faseBloqueio(ANTES)).toBe("antes");
    expect(e.bloqueado).toBe(false);
    expect(e.mensagem).toBe(COPY_BLOQUEIO.avisoPrevio);
  });
  it("durante → fase 'durante', bloqueado, mensagem de pausa", () => {
    const e = estadoBloqueio(MEIO);
    expect(faseBloqueio(MEIO)).toBe("durante");
    expect(e.bloqueado).toBe(true);
    expect(e.mensagem).toBe(COPY_BLOQUEIO.durante);
  });
  it("depois → fase 'livre', não bloqueado, sem mensagem", () => {
    const e = estadoBloqueio(DEPOIS);
    expect(faseBloqueio(DEPOIS)).toBe("livre");
    expect(e.bloqueado).toBe(false);
    expect(e.mensagem).toBeNull();
  });
});

describe("deveRecusarSubmissao — recusa do servidor", () => {
  it("dentro da janela → recusa (submissão nova E reenvio/edição)", () => {
    expect(deveRecusarSubmissao(MEIO)).toBe(true);
    expect(deveRecusarSubmissao(INICIO)).toBe(true);
  });
  it("fora da janela → passa", () => {
    expect(deveRecusarSubmissao(ANTES)).toBe(false);
    expect(deveRecusarSubmissao(FIM)).toBe(false);
    expect(deveRecusarSubmissao(DEPOIS)).toBe(false);
  });
  it("a decisão agora é só o relógio — bate com estaBloqueado (reenvio incluído)", () => {
    for (const t of [ANTES, INICIO, MEIO, FIM, DEPOIS]) {
      expect(deveRecusarSubmissao(t)).toBe(estaBloqueado(t));
    }
  });
});

describe("override por env (lido lazy)", () => {
  it("SUBMISSAO_BLOQUEIO_INICIO/FIM movem a janela", () => {
    process.env.SUBMISSAO_BLOQUEIO_INICIO = "2030-01-01T00:00:00Z";
    process.env.SUBMISSAO_BLOQUEIO_FIM = "2030-01-08T00:00:00Z";
    const j = janelaBloqueio();
    expect(j.inicio).toBe(Date.parse("2030-01-01T00:00:00Z"));
    expect(j.fim).toBe(Date.parse("2030-01-08T00:00:00Z"));
    // O default de agosto/2026 deixa de bloquear; a janela de 2030 passa a valer.
    expect(estaBloqueado(MEIO)).toBe(false);
    expect(estaBloqueado(Date.parse("2030-01-03T00:00:00Z"))).toBe(true);
  });
  it("override inválido cai no default baked (não abre a janela por engano)", () => {
    process.env.SUBMISSAO_BLOQUEIO_INICIO = "isso-nao-e-data";
    const j = janelaBloqueio();
    expect(j.inicio).toBe(INICIO);
    expect(estaBloqueado(MEIO)).toBe(true);
  });
});

describe("copy — FONTE ÚNICA, sem traço/hífen", () => {
  it("as frases não têm '-' nem '—'", () => {
    for (const frase of [COPY_BLOQUEIO.avisoPrevio, COPY_BLOQUEIO.durante]) {
      expect(frase).not.toMatch(/[-—]/);
    }
  });
  it("a recusa do servidor reusa a copy 'durante' (sem duplicar texto)", () => {
    const b = bloqueioSubmissaoPausada();
    expect(b.codigo).toBe("submissao_pausada");
    // titulo + resumo recompõem exatamente a copy 'durante' (junção "titulo. resumo").
    expect(`${b.titulo}. ${b.resumo}`).toBe(COPY_BLOQUEIO.durante);
    // O texto plano (Error.message / api_logs) carrega a copy inteira.
    expect(formatarBloqueio(b)).toContain(COPY_BLOQUEIO.durante);
  });
});
