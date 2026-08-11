import { describe, it, expect } from "vitest";
import { deveMostrarIntro } from "@/lib/submeter/constants";

// Quem vê a tela de apresentação do formulário. O predicado é a ÚNICA trava: o
// componente `SubmeterPageContent` é compartilhado entre /submeter e /editar/$id,
// então um `true` a mais aqui põe a apresentação na frente de quem só quer
// corrigir um projeto já submetido.
describe("deveMostrarIntro", () => {
  it("mostra para quem abre /submeter do zero", () => {
    expect(deveMostrarIntro({ temRascunhoLocal: false })).toBe(true);
  });

  it("NÃO mostra na edição — /editar/$id reusa o mesmo componente", () => {
    expect(deveMostrarIntro({ editProjetoId: "abc123", temRascunhoLocal: false })).toBe(false);
  });

  it("NÃO mostra em retomada explícita (?retomar=<id>)", () => {
    expect(deveMostrarIntro({ resumeDraftId: "abc123", temRascunhoLocal: false })).toBe(false);
  });

  // O rehydrate do rascunho salta para a etapa onde a pessoa parou
  // (`setStep(d.step ?? 3)`); a intro ficaria na frente do chat em andamento.
  it("NÃO mostra quando há rascunho local para retomar", () => {
    expect(deveMostrarIntro({ temRascunhoLocal: true })).toBe(false);
  });

  it("string vazia não conta como id (o ?retomar ausente chega assim)", () => {
    expect(
      deveMostrarIntro({
        editProjetoId: "",
        resumeDraftId: "",
        temRascunhoLocal: false,
      }),
    ).toBe(true);
  });
});
