import { describe, it, expect } from "vitest";
import { ehOwner, ehParticipante, temAcesso } from "@/lib/meus-projetos.functions";
import type { ProjetoRow } from "@/integrations/db/client.server";

// Constrói um ProjetoRow mínimo só com os campos que a classificação de papel usa.
function proj(responsavel_email: string, membros: string[]): ProjetoRow {
  return { responsavel_email, membros: JSON.stringify(membros) } as unknown as ProjetoRow;
}

describe("ownership: owner × participante", () => {
  const owner = proj("maria@gocase.com", ["joao@gocase.com", "ana@gocase.com"]);

  it("o autor (responsavel_email) é owner e tem acesso", () => {
    expect(ehOwner(owner, "maria@gocase.com")).toBe(true);
    expect(ehParticipante(owner, "maria@gocase.com")).toBe(false);
    expect(temAcesso(owner, "maria@gocase.com")).toBe(true);
  });

  it("quem está em membros é participante (não owner), com acesso de leitura", () => {
    expect(ehOwner(owner, "joao@gocase.com")).toBe(false);
    expect(ehParticipante(owner, "joao@gocase.com")).toBe(true);
    expect(temAcesso(owner, "joao@gocase.com")).toBe(true);
  });

  it("o autor NUNCA é participante, mesmo se estiver também na lista de membros", () => {
    const p = proj("maria@gocase.com", ["maria@gocase.com", "joao@gocase.com"]);
    expect(ehOwner(p, "maria@gocase.com")).toBe(true);
    expect(ehParticipante(p, "maria@gocase.com")).toBe(false);
  });

  it("quem não é autor nem membro não tem acesso", () => {
    expect(temAcesso(owner, "estranho@gocase.com")).toBe(false);
    expect(ehOwner(owner, "estranho@gocase.com")).toBe(false);
    expect(ehParticipante(owner, "estranho@gocase.com")).toBe(false);
  });

  it("e-mail é case-insensitive e ignora espaços", () => {
    expect(ehOwner(owner, "  MARIA@gocase.com ")).toBe(true);
    expect(ehParticipante(owner, "JOAO@GOCASE.COM")).toBe(true);
  });
});
