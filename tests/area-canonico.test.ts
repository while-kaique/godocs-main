import { describe, it, expect } from "vitest";
import { canonicalizarArea } from "@/lib/area-canonico";
import { agregarRollupMensal } from "@/lib/rollup-financeiro";

describe("canonicalizarArea", () => {
  it("funde variantes de caixa/acento na mesma grafia canônica", () => {
    expect(canonicalizarArea("GENTE E GESTÃO")).toBe("Gente & Gestão");
    expect(canonicalizarArea("Gente e Gestão")).toBe("Gente & Gestão");
    expect(canonicalizarArea("SUPPLY GOGROUP")).toBe("Supply Chain");
    expect(canonicalizarArea("Supply Gogroup")).toBe("Supply Chain");
    expect(canonicalizarArea("TRANSPORTES")).toBe("Transportes");
    expect(canonicalizarArea("Transportes")).toBe("Transportes");
    expect(canonicalizarArea("B2B Gocase")).toBe("B2B Gocase");
    expect(canonicalizarArea("B2B GOCASE")).toBe("B2B Gocase");
  });

  it("aplica os renomes legado que FUNDEM em um só canônico", () => {
    expect(canonicalizarArea("LOJAS")).toBe("Lojas");
    expect(canonicalizarArea("LOJAS - ADM")).toBe("Lojas");
    expect(canonicalizarArea("SUPPLY CHAIN")).toBe("Supply Chain");
    expect(canonicalizarArea("Operações Gocase - Administrativo")).toBe("Operações Gocase");
    expect(canonicalizarArea("OPERAÇÕES GOCASE")).toBe("Operações Gocase");
    expect(canonicalizarArea("DESENVOLVIMENTO PRODUTO GOBEAUTE")).toBe("Produto Gobeaute");
    expect(canonicalizarArea("Tecnologia - Projetos")).toBe("Tecnologia");
  });

  it("alinha grafia às 23 do Gabriel", () => {
    expect(canonicalizarArea("AZ")).toBe("AZ Buy");
    expect(canonicalizarArea("CSC")).toBe("Projetos/CSC");
    expect(canonicalizarArea("JURIDICO")).toBe("Jurídico/Compliance");
    expect(canonicalizarArea("FP&A")).toBe("FP&A e Tesouraria");
    expect(canonicalizarArea("SOURCING E PROCUREMENT GOBEAUTE")).toBe(
      "Sourcing & Procurement Gobeaute",
    );
    expect(canonicalizarArea("Sourcing & Procurement Gobeaute")).toBe(
      "Sourcing & Procurement Gobeaute",
    );
  });

  it("mantém genéricos e pequenos como decidido (não fatia, não dropa)", () => {
    expect(canonicalizarArea("PRODUTO")).toBe("Produto");
    expect(canonicalizarArea("Operações")).toBe("Operações");
    expect(canonicalizarArea("FINANÇAS")).toBe("Finanças");
    expect(canonicalizarArea("Contabilidade")).toBe("Contabilidade");
    expect(canonicalizarArea("Produção")).toBe("Produção");
    expect(canonicalizarArea("BIZOPS")).toBe("BIZOPS");
    expect(canonicalizarArea("GENTE E GESTÃO | CX")).toBe("GENTE E GESTÃO | CX");
    expect(canonicalizarArea("RPA")).toBe("RPA");
    expect(canonicalizarArea("Pós-venda")).toBe("Pós-venda");
  });

  it("mantém os 2 não-área (não descarta)", () => {
    expect(canonicalizarArea("ÁREA NÃO IDENTIFICADA")).toBe("ÁREA NÃO IDENTIFICADA");
    expect(canonicalizarArea("N1 - LUIS LIVERI")).toBe("N1 - LUIS LIVERI");
  });

  it("passthrough de slug desconhecido (área futura nunca some/mangle) e vazio → ''", () => {
    expect(canonicalizarArea("Nova Área X")).toBe("Nova Área X");
    expect(canonicalizarArea("  ")).toBe("");
    expect(canonicalizarArea(null)).toBe("");
    expect(canonicalizarArea(undefined)).toBe("");
  });
});

describe("integração: canonicalização preserva totais no agregador", () => {
  it("soma as variantes no mesmo canônico sem inventar/perder valor", () => {
    const iso = "2026-05-10T12:00:00.000Z";
    const cru = [
      { submitted_at: iso, area: "GENTE E GESTÃO", tipo_saving: "mensal", saving_reais: 100, receita_reais: 0 },
      { submitted_at: iso, area: "Gente e Gestão", tipo_saving: "mensal", saving_reais: 50, receita_reais: 0 },
      { submitted_at: iso, area: "LOJAS", tipo_saving: "mensal", saving_reais: 30, receita_reais: 0 },
      { submitted_at: iso, area: "LOJAS - ADM", tipo_saving: "mensal", saving_reais: 20, receita_reais: 0 },
    ];
    const totalCru = cru.reduce((s, p) => s + p.saving_reais, 0);
    const canon = cru.map((p) => ({ ...p, area: canonicalizarArea(p.area) }));
    const celulas = agregarRollupMensal(canon);

    // 4 linhas cruas → 2 áreas canônicas
    expect(new Set(celulas.map((c) => c.area))).toEqual(new Set(["Gente & Gestão", "Lojas"]));
    const gg = celulas.find((c) => c.area === "Gente & Gestão")!;
    expect(gg.saving_reais).toBe(150);
    expect(gg.num_projetos).toBe(2);
    const lojas = celulas.find((c) => c.area === "Lojas")!;
    expect(lojas.saving_reais).toBe(50);
    // total geral idêntico ao cru
    expect(celulas.reduce((s, c) => s + c.saving_reais, 0)).toBe(totalCru);
  });
});
