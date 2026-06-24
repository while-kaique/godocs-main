import { describe, it, expect } from "vitest";
import { ehOwner, ehParticipante, temAcesso, ehEditorDelegado } from "@/lib/meus-projetos.functions";
import type { ProjetoRow } from "@/integrations/db/client.server";

// Constrói um ProjetoRow mínimo só com os campos que a classificação de papel usa.
function proj(responsavel_email: string, membros: string[], editores_delegados: string[] = []): ProjetoRow {
  return {
    responsavel_email,
    membros: JSON.stringify(membros),
    editores_delegados: JSON.stringify(editores_delegados),
  } as unknown as ProjetoRow;
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

describe("editor delegado", () => {
  // joao foi delegado; ana é participante mas não foi delegada.
  const p = proj("maria@gocase.com", ["joao@gocase.com", "ana@gocase.com"], ["joao@gocase.com"]);

  it("participante presente em editores_delegados é editor delegado", () => {
    expect(ehEditorDelegado(p, "joao@gocase.com")).toBe(true);
    expect(ehParticipante(p, "joao@gocase.com")).toBe(true);
  });

  it("participante não-delegado NÃO é editor delegado", () => {
    expect(ehEditorDelegado(p, "ana@gocase.com")).toBe(false);
  });

  it("o owner nunca é editor delegado (poder dele vem de ehOwner)", () => {
    const q = proj("maria@gocase.com", ["joao@gocase.com"], ["maria@gocase.com", "joao@gocase.com"]);
    expect(ehEditorDelegado(q, "maria@gocase.com")).toBe(false);
    expect(ehOwner(q, "maria@gocase.com")).toBe(true);
  });

  it("delegado que saiu de membros perde o poder (interseção defensiva)", () => {
    // joao consta em editores_delegados, mas não está mais em membros.
    const q = proj("maria@gocase.com", ["ana@gocase.com"], ["joao@gocase.com"]);
    expect(ehEditorDelegado(q, "joao@gocase.com")).toBe(false);
  });

  it("é case-insensitive e ignora espaços", () => {
    expect(ehEditorDelegado(p, "  JOAO@GOCASE.COM ")).toBe(true);
  });

  it("sem editores_delegados, ninguém é editor delegado", () => {
    const q = proj("maria@gocase.com", ["joao@gocase.com"]);
    expect(ehEditorDelegado(q, "joao@gocase.com")).toBe(false);
  });
});
