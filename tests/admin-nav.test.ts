/**
 * Menu lateral do admin.
 *
 * O menu é a única superfície que diz quais telas existem, então o que estes testes
 * seguram é a diferença entre "saiu do menu" e "deixou de existir": `/areas`,
 * `/email-legados` e `/testes` continuam no ar, alcançáveis por URL — só não são trabalho
 * de rotina da triagem. E `/especiais` e `/aprovacoes-pendentes` saíram porque a triagem
 * absorveu as duas, não porque a função sumiu.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  ITENS_NAV,
  CHAVE_MENU_RECOLHIDO,
  lerMenuRecolhido,
  gravarMenuRecolhido,
} from "@/lib/admin-nav";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const layout = ler("src/routes/_authenticated/route.tsx");

describe("o que o menu oferece", () => {
  it("as quatro telas de rotina, e o Dashboard é a primeira", () => {
    expect(ITENS_NAV.map((i) => i.to)).toEqual([
      "/dashboard",
      "/aglutinacao",
      "/investigador",
      "/fluxos",
    ]);
  });

  it("nenhum item leva às telas que a triagem absorveu", () => {
    const destinos = ITENS_NAV.map((i) => i.to);
    expect(destinos).not.toContain("/especiais");
    expect(destinos).not.toContain("/aprovacoes-pendentes");
  });

  it("nenhum item leva às telas que saíram da rotina", () => {
    const destinos = ITENS_NAV.map((i) => i.to);
    expect(destinos).not.toContain("/areas");
    expect(destinos).not.toContain("/email-legados");
    expect(destinos).not.toContain("/testes");
  });

  it("⚠️ sair do menu NÃO é deixar de existir: as rotas seguem no repo", () => {
    for (const rota of [
      "src/routes/_authenticated/areas.tsx",
      "src/routes/_authenticated/email-legados.tsx",
      "src/routes/_authenticated/especiais.tsx",
      "src/routes/_authenticated/aprovacoes-pendentes.tsx",
    ]) {
      expect(existsSync(resolve(process.cwd(), rota))).toBe(true);
    }
  });

  it("o Dashboard é o único sem preload no hover", () => {
    // Hover num link com preload dispara `iniciarPrefetchDashboard()` no `beforeLoad` do
    // layout, e a cota de leitura da planilha é COMPARTILHADA com produção.
    const semPreload = ITENS_NAV.filter((i) => i.preload === false).map((i) => i.to);
    expect(semPreload).toEqual(["/dashboard"]);
  });

  it("todo item tem descrição — é a única pista do ícone no menu recolhido", () => {
    for (const item of ITENS_NAV) {
      expect(item.descricao.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("o menu recolhe e a escolha fica", () => {
  /** A suíte roda em Node, que não tem `localStorage` — o dobro cobre o caso do navegador. */
  function comArmazenamento(): () => void {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const memoria = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => memoria.get(k) ?? null,
        setItem: (k: string, v: string) => void memoria.set(k, v),
        removeItem: (k: string) => void memoria.delete(k),
      },
    });
    return () => {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    };
  }

  // ⚠️ O padrão virou RECOLHIDO em 14/09/2026 (decisão do Luis): são 4 destinos conhecidos,
  // e a esteira ao lado ganha em largura. Só quem ABRIU (valor "0" gravado) recebe aberto.
  it("sem preferência gravada, nasce RECOLHIDO", () => {
    const restaurar = comArmazenamento();
    globalThis.localStorage.removeItem(CHAVE_MENU_RECOLHIDO);
    expect(lerMenuRecolhido()).toBe(true);
    restaurar();
  });

  it("grava e lê de volta", () => {
    const restaurar = comArmazenamento();
    gravarMenuRecolhido(false);
    expect(lerMenuRecolhido()).toBe(false);
    gravarMenuRecolhido(true);
    expect(lerMenuRecolhido()).toBe(true);
    restaurar();
  });

  it("ambiente SEM localStorage (servidor, render inicial) devolve o padrão", () => {
    expect(lerMenuRecolhido()).toBe(true);
    expect(() => gravarMenuRecolhido(true)).not.toThrow();
  });

  // ⚠️ O estado inicial do React tem de ser o MESMO padrão, senão o menu pisca aberto a
  // cada navegação para quem nunca mudou a preferência (que é a maioria).
  it("o layout nasce recolhido, sem esperar o efeito", () => {
    expect(layout).toContain("useState(true)");
  });

  it("armazenamento indisponível não derruba o menu", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("bloqueado");
      },
    });
    expect(() => lerMenuRecolhido()).not.toThrow();
    expect(lerMenuRecolhido()).toBe(true);
    expect(() => gravarMenuRecolhido(true)).not.toThrow();
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

describe("fiação do layout", () => {
  it("o menu desenha a lista declarada, sem itens digitados no JSX", () => {
    expect(layout).toContain("ITENS_NAV.map");
  });

  it("o botão de recolher diz o que faz, em texto", () => {
    expect(layout).toContain("Expandir o menu");
    expect(layout).toContain("Recolher o menu");
  });

  it("recolhido, o rótulo vai para leitor de tela em vez de sumir", () => {
    expect(layout).toContain("sr-only");
  });
});
