import { describe, it, expect } from "vitest";
import { mapItem } from "@/lib/meus-projetos.functions";
import type { ProjetoRow } from "@/integrations/db/client.server";

// INV-02 + decisão /ggsd:plan (Luis, 2026-07-17): na tela "Meus Projetos" o dono (e
// QUALQUER usuário) não vê o valor R$ do projeto — e o número NEM trafega ao client.
// Defesa em profundidade: mesmo que o front vaze o campo, mapItem devolve `null`, então
// não dá para ler o valor no devtools/Network. Admin segue vendo o ganho no investigador
// (funções próprias, fora deste caminho). Plano: docs/plans/ocultar-valor-meus-projetos.md.
describe("mapItem: não serializa o ganho (R$) para o client", () => {
  it("zera ganho_total_mensal mesmo quando o banco tem valor", () => {
    const row = { id: "p1", nome: "Proj", ganho_total_mensal: 661.8 } as ProjetoRow & {
      area_nome: string | null;
    };
    const item = mapItem(row, null, "owner", true);
    expect(item.ganho_total_mensal).toBeNull();
  });
});
