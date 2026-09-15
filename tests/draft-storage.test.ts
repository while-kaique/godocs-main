import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveDraft,
  loadDraft,
  clearDraft,
  editDraftKey,
  deveDescartarDraftEdicao,
  type DraftSnapshot,
  msDoCarimboDoServidor,
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
  ({
    projetoId,
    step: 3,
    chatMessages: [{ role: "user", content: "oi" }],
  }) as unknown as DraftSnapshot;

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
  const AGORA = Date.parse("2026-09-15T19:00:00Z");

  /**
   * ⚠️ O INCIDENTE que criou esta régua (15/09/2026, «Proxy AI»): o autor adicionou um
   * Coautor e reenviou — o servidor gravou os dois participantes. Ao reabrir a edição, um
   * rascunho salvo ANTES daquela adição foi aplicado por cima do seed, a lista voltou a uma
   * pessoa, e a sincronização seguinte APAGOU o Coautor no servidor, em silêncio. Medido no
   * `form_events`: 17:08 grava `[rafael, joao.gabriel]`, 17:14 grava `[rafael]`.
   */
  it("⚠️ DESCARTA o rascunho quando o servidor foi atualizado DEPOIS dele", () => {
    expect(
      deveDescartarDraftEdicao({
        servidorAtualizadoEm: "2026-09-15 19:00:00",
        draft: draft({ salvoEm: AGORA - 60_000 }),
      }),
    ).toBe(true);
  });

  it("PRESERVA o rascunho quando ele é mais novo que o servidor (edição em curso)", () => {
    expect(
      deveDescartarDraftEdicao({
        servidorAtualizadoEm: "2026-09-15 19:00:00",
        draft: draft({ salvoEm: AGORA + 60_000 }),
      }),
    ).toBe(false);
  });

  /**
   * ⚠️ O `updated_at` do SQLite é UTC SEM sufixo, e o JS o lê como hora LOCAL. Sem o `+ "Z"`,
   * em Brasília o servidor pareceria 3h mais velho do que é e o descarte nunca aconteceria —
   * exatamente no fuso de quem usa o produto. Mesma armadilha do `diaDaDecisao`.
   */
  it("⚠️ lê o carimbo do servidor como UTC, não como hora local", () => {
    expect(msDoCarimboDoServidor("2026-09-15 19:00:00")).toBe(Date.parse("2026-09-15T19:00:00Z"));
    // ISO com fuso explícito continua valendo.
    expect(msDoCarimboDoServidor("2026-09-15T19:00:00Z")).toBe(Date.parse("2026-09-15T19:00:00Z"));
  });

  it("carimbo ilegível ou ausente não descarta nada (e não lança)", () => {
    for (const bruto of [null, undefined, "", "ontem"]) {
      expect(
        deveDescartarDraftEdicao({ servidorAtualizadoEm: bruto, draft: draft({ salvoEm: 1 }) }),
      ).toBe(false);
    }
  });

  /**
   * ⚠️ Rascunho gravado antes de 15/09/2026 não tem `salvoEm` e não dá para datar. Conta como
   * VELHO: manter é repetir o incidente (apagar participante em silêncio); descartar custa,
   * uma única vez, o que a pessoa digitou e nunca sincronizou — e ela reabre com o que o
   * servidor tem, que é o estado do último reenvio dela.
   */
  it("rascunho SEM carimbo conta como velho quando o servidor tem atualização", () => {
    expect(
      deveDescartarDraftEdicao({
        servidorAtualizadoEm: "2026-09-15 19:00:00",
        draft: draft(),
      }),
    ).toBe(true);
  });

  it("rascunho sem carimbo + servidor sem carimbo: preserva (nada a comparar)", () => {
    expect(deveDescartarDraftEdicao({ servidorAtualizadoEm: null, draft: draft() })).toBe(false);
  });
});

describe("o carimbo do rascunho", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  /** Sem ele não há como saber que o rascunho ficou para trás — é a base da régua acima. */
  it("saveDraft carimba a hora, mesmo quando o snapshot não traz", () => {
    const antes = Date.now();
    saveDraft({ projetoId: "p1" } as DraftSnapshot, "k");
    const lido = loadDraft("k");
    expect(lido?.salvoEm).toBeGreaterThanOrEqual(antes);
  });

  it("o carimbo do momento da GRAVAÇÃO vence o que veio no snapshot", () => {
    saveDraft({ projetoId: "p1", salvoEm: 1 } as DraftSnapshot, "k");
    expect(loadDraft("k")?.salvoEm).toBeGreaterThan(1);
  });
});
