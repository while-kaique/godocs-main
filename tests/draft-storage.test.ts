import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  editDraftKey,
  deveDescartarDraftEdicao,
  type DraftSnapshot,
} from "@/lib/submeter/draft-storage";
import { ganhosFormVazio } from "@/lib/submeter/validacao-etapa3";

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

describe("deveDescartarDraftEdicao: hoje NEUTRO (v2), e é decisão", () => {
  // ⚠️ Este guard era ativo na v1: descartava o rascunho de edição que afirmava "fase de
  // doc concluída" (`chatComplete`/preview aprovado) contra um servidor SEM documentação —
  // estado típico de legado, que ressuscitava a tela de aprovação final e travava a
  // submissão em "Documentação ainda não foi gerada".
  //
  // Na v2 esse estado não existe: a doc é gerada em background, invisível, sem tela de
  // aprovação, e projeto com doc pendente é reconciliado pelo cron em vez de travar. O
  // rascunho não tem mais nada a afirmar sobre a doc.
  //
  // Estes casos travam a NEUTRALIDADE de propósito: se alguém voltar a descartar rascunho
  // de edição, tem de ser DECISÃO (passa por aqui), não efeito colateral — descartar hoje
  // jogaria fora os blocos de ganho que a pessoa já preencheu.
  const draft = (d: Partial<DraftSnapshot> = {}) => ({ ...d }) as DraftSnapshot;

  it("PRESERVA o rascunho mesmo quando o servidor ainda não tem doc", () => {
    expect(deveDescartarDraftEdicao({ serverTemDoc: false, draft: draft() })).toBe(false);
  });

  it("PRESERVA o rascunho quando o servidor JÁ tem doc (reenvio normal)", () => {
    expect(deveDescartarDraftEdicao({ serverTemDoc: true, draft: draft() })).toBe(false);
  });

  it("PRESERVA rascunho com blocos de ganho preenchidos — é o que se perderia", () => {
    const comGanhos = draft({
      ganhos: { ...ganhosFormVazio(), savingValorAntes: "1.200,00" },
    });
    expect(deveDescartarDraftEdicao({ serverTemDoc: false, draft: comGanhos })).toBe(false);
  });
});