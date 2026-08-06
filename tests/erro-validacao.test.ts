import { describe, it, expect } from "vitest";
import { z } from "zod";
import { traduzirErroValidacao } from "@/lib/erro-validacao";

/** Reproduz o caso real (Josiely, 05/08/2026): `ferramenta` com 201 chars. */
const schema = z.object({
  ferramenta: z.string().min(1).max(200),
  nome_projeto: z.string().min(1).max(200),
  docs: z.array(z.object({ base64: z.string().min(1) })).min(1),
});

function erroDe(valor: unknown): unknown {
  try {
    schema.parse(valor);
    throw new Error("deveria ter falhado");
  } catch (e) {
    return e;
  }
}

describe("traduzirErroValidacao", () => {
  it("too_big de string → 400 nomeando o CAMPO e o LIMITE, em PT-BR", () => {
    const err = erroDe({ ferramenta: "x".repeat(201), nome_projeto: "ok", docs: [{ base64: "a" }] });
    const r = traduzirErroValidacao(err);
    expect(r?.status).toBe(400);
    expect(r?.mensagem).toContain("Ferramenta utilizada");
    expect(r?.mensagem).toContain("200 caracteres");
    // O bug era justamente isto vazar para o usuário:
    expect(r?.mensagem).not.toContain("too_big");
    expect(r?.mensagem).not.toContain("String must contain");
  });

  it("campo obrigatório ausente → 'preencha este campo'", () => {
    const r = traduzirErroValidacao(erroDe({ docs: [{ base64: "a" }] }));
    expect(r?.status).toBe(400);
    expect(r?.mensagem).toContain("preencha este campo");
  });

  it("array vazio → pede pelo menos 1 item", () => {
    const r = traduzirErroValidacao(erroDe({ ferramenta: "a", nome_projeto: "b", docs: [] }));
    expect(r?.mensagem).toContain("Arquivos");
    expect(r?.mensagem).toContain("pelo menos 1 item");
  });

  it("no máximo 3 frases, com contador do resto", () => {
    const s = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() });
    let err: unknown;
    try { s.parse({}); } catch (e) { err = e; }
    const m = traduzirErroValidacao(err)!.mensagem;
    expect(m).toContain("+2 outro(s) campo(s)");
  });

  it("NÃO engole erro que não é de validação (devolve null → segue 500)", () => {
    expect(traduzirErroValidacao(new Error("banco caiu"))).toBeNull();
    expect(traduzirErroValidacao(null)).toBeNull();
    expect(traduzirErroValidacao({ issues: [] })).toBeNull();
  });
});
