import { describe, it, expect } from "vitest";
import { resolverAtualizadoEm, temAtualizadoEm } from "@/lib/meus-projetos.functions";

// Regressão do bug do aviso de legado "preso" após editar (caso Ytalo): o submit grava
// o espelho SQLite `atualizado_em` na hora, mas o sync IDA para o Sheets roda em
// background. resolverAtualizadoEm precisa cair no espelho SQLite quando a célula da
// planilha ainda está vazia — senão o legado segue marcado como pendente até o sync
// terminar (exigia hard-refresh).
describe("resolverAtualizadoEm: planilha quando preenchida, senão espelho SQLite", () => {
  it("usa o carimbo da planilha quando preenchido (Sheets é a fonte da verdade)", () => {
    expect(resolverAtualizadoEm("23/06/2026 10:00", "2026-06-20T00:00:00Z")).toBe("23/06/2026 10:00");
  });

  it("célula da planilha VAZIA cai no espelho SQLite (edição recém-feita)", () => {
    expect(resolverAtualizadoEm("", "2026-06-23T14:00:00Z")).toBe("2026-06-23T14:00:00Z");
    expect(temAtualizadoEm(resolverAtualizadoEm("", "2026-06-23T14:00:00Z"))).toBe(true);
  });

  it("projeto ausente do mapa da planilha (undefined) cai no espelho SQLite", () => {
    expect(resolverAtualizadoEm(undefined, "2026-06-23T14:00:00Z")).toBe("2026-06-23T14:00:00Z");
  });

  it("traços/marcadores da planilha contam como vazio e caem no espelho", () => {
    expect(resolverAtualizadoEm("—", "2026-06-23T14:00:00Z")).toBe("2026-06-23T14:00:00Z");
    expect(resolverAtualizadoEm("-", "2026-06-23T14:00:00Z")).toBe("2026-06-23T14:00:00Z");
  });

  it("legado genuinamente pendente (sem planilha e sem espelho) continua nulo → pendente", () => {
    expect(resolverAtualizadoEm("", null)).toBeNull();
    expect(resolverAtualizadoEm(undefined, undefined)).toBeNull();
    expect(temAtualizadoEm(resolverAtualizadoEm("", null))).toBe(false);
  });
});
