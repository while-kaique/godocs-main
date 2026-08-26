import { describe, it, expect, beforeAll } from "vitest";
import { criarDbMemoria } from "./helpers/db-memoria";
import { upsertEspelhoLinha, lerRollupMensal } from "@/integrations/db/client.server";
import { recalcularRollupBackfill } from "@/lib/rollup-backfill";

// O rollup sai INTEIRO do espelho da planilha (o mesmo que o /dashboard lê): status, saving,
// receita, área, cadência e data. Por isso o teste NÃO semeia `projetos` — só o espelho.
type Celula = Record<string, string>;
async function seedEspelho(id: string, cols: Celula) {
  const linha = JSON.stringify({ "ID Projeto": id, ...cols });
  await upsertEspelhoLinha({
    projeto_id: id.toLowerCase(),
    linha,
    linha_resumo: linha,
    linha_hash: "",
    patch: null,
    escrito_em: null,
    lido_em: "2026-06-16T00:00:00.000Z",
  });
}

describe("rollup histórico — backfill do ESPELHO (integração)", () => {
  beforeAll(async () => {
    await criarDbMemoria();

    // ── Entram: Status = "Aprovado" ──
    await seedEspelho("ap1", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "15/06/2026",
      "Tipo de Saving": "mensal", "Saving Reais": "100",
    });
    await seedEspelho("ap2", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "20/06/2026",
      "Tipo de Saving": "mensal", "Saving Reais": "200",
    });
    // ap3 tem RECEITA na PLANILHA (coluna "Receita Mensal"), sem documentação nenhuma —
    // prova que a receita vem do espelho, não de `documentacao.conteudo.receita`.
    await seedEspelho("ap3", {
      Status: "Aprovado", "Área": "Contábil", "Data Submissão": "10/06/2026",
      "Tipo de Saving": "mensal", "Saving Reais": "50", "Receita Mensal": "500",
    });
    // aprovado SEM data → conta no total, mas não posiciona no tempo (fica fora das células).
    await seedEspelho("semdata", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "",
      "Tipo de Saving": "mensal", "Saving Reais": "70",
    });

    // ── Ficam de fora: status ≠ "Aprovado" ──
    await seedEspelho("pend", {
      Status: "Pendente", "Área": "Fiscal", "Data Submissão": "15/06/2026",
      "Tipo de Saving": "mensal", "Saving Reais": "999",
    });
    await seedEspelho("desc", {
      Status: "Descontinuado", "Área": "Fiscal", "Data Submissão": "15/06/2026",
      "Tipo de Saving": "mensal", "Saving Reais": "999",
    });
  });

  it("agrega só os APROVADOS do espelho, com saving e receita da planilha", async () => {
    const resumo = await recalcularRollupBackfill();
    expect(resumo.projetos).toBe(4); // ap1, ap2, ap3, semdata (todos "Aprovado")

    const celulas = await lerRollupMensal();

    // Fiscal/2026-06/mensal = ap1 (100) + ap2 (200) = 300, 2 projetos
    const fiscal = celulas.find(
      (c) => c.periodo === "2026-06" && c.area === "Fiscal" && c.tipo_saving === "mensal",
    );
    expect(fiscal?.saving_reais).toBe(300);
    expect(fiscal?.num_projetos).toBe(2);

    // Contábil traz a RECEITA da planilha (500), sem documentação
    const contabil = celulas.find(
      (c) => c.periodo === "2026-06" && c.area === "Contábil" && c.tipo_saving === "mensal",
    );
    expect(contabil?.saving_reais).toBe(50);
    expect(contabil?.receita_reais).toBe(500);

    // `pend`/`desc` (999) nunca viram célula; `semdata` (sem data) não posiciona no tempo →
    // a soma das células é 100+200+50 = 350 (o 70 do semdata fica de fora).
    expect(celulas.every((c) => c.saving_reais !== 999)).toBe(true);
    expect(celulas.reduce((a, c) => a + c.saving_reais, 0)).toBe(350);
  });

  it("é idempotente: rodar duas vezes não duplica linhas", async () => {
    await recalcularRollupBackfill();
    const primeira = await lerRollupMensal();
    await recalcularRollupBackfill();
    const segunda = await lerRollupMensal();

    expect(segunda).toHaveLength(primeira.length);
    const fiscal = segunda.find(
      (c) => c.periodo === "2026-06" && c.area === "Fiscal" && c.tipo_saving === "mensal",
    );
    expect(fiscal?.saving_reais).toBe(300);
    expect(fiscal?.num_projetos).toBe(2);
  });
});
