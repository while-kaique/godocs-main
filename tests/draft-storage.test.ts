import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  editDraftKey,
  type DraftSnapshot,
} from "@/lib/submeter/draft-storage";

// localStorage em memória (node não tem). Replica o suficiente p/ o draft-storage.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

const snap = (projetoId: string): DraftSnapshot =>
  ({ projetoId, step: 3, chatMessages: [{ role: "user", content: "oi" }] } as unknown as DraftSnapshot);

describe("draft-storage: isolamento submissão nova × edição (por projeto)", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("editDraftKey é por projeto e distinto da chave de submissão nova", () => {
    expect(editDraftKey("P1")).toBe("godocs:edicao-v1:P1");
    expect(editDraftKey("P1")).not.toBe(editDraftKey("P2"));
  });

  it("rascunho de edição não colide com o de submissão nova", () => {
    saveDraft(snap("novo-123")); // chave default
    saveDraft(snap("LEGADO-9"), editDraftKey("LEGADO-9")); // chave de edição

    expect(loadDraft()?.projetoId).toBe("novo-123");
    expect(loadDraft(editDraftKey("LEGADO-9"))?.projetoId).toBe("LEGADO-9");
  });

  it("limpar a edição de um projeto não apaga a submissão nova nem outra edição", () => {
    saveDraft(snap("novo-123"));
    saveDraft(snap("P1"), editDraftKey("P1"));
    saveDraft(snap("P2"), editDraftKey("P2"));

    clearDraft(editDraftKey("P1"));

    expect(loadDraft(editDraftKey("P1"))).toBeNull();
    expect(loadDraft()?.projetoId).toBe("novo-123"); // intacto
    expect(loadDraft(editDraftKey("P2"))?.projetoId).toBe("P2"); // intacto
  });

  it("snapshot sem projetoId é ignorado na leitura", () => {
    saveDraft({ step: 3 } as unknown as DraftSnapshot, editDraftKey("X"));
    expect(loadDraft(editDraftKey("X"))).toBeNull();
  });
});
