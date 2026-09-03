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
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "100",
    });
    await seedEspelho("ap2", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "20/06/2026",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "200",
    });
    // ap3 tem RECEITA na PLANILHA (coluna "Receita Incremental"), sem documentação nenhuma —
    // prova que a receita vem do espelho, não de `documentacao.conteudo.receita`.
    await seedEspelho("ap3", {
      Status: "Aprovado", "Área": "Contábil", "Data Submissão": "10/06/2026",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "50", "Receita Incremental": "500",
    });
    // aprovado SEM data → conta no total, mas não posiciona no tempo (fica fora das células).
    await seedEspelho("semdata", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "70",
    });

    // ── Ficam de fora: status ≠ "Aprovado" ──
    await seedEspelho("pend", {
      Status: "Pendente", "Área": "Fiscal", "Data Submissão": "15/06/2026",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "999",
    });
    await seedEspelho("desc", {
      Status: "Descontinuado", "Área": "Fiscal", "Data Submissão": "15/06/2026",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "999",
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

// ─────────────────────────────────────────────────────────────────────────────
// Linha do GoDocs v2: "Impacto Bruto" JÁ inclui a receita (D2: S + CE + R), então
// lê-lo direto ao lado de "Receita Incremental" contaria a receita DUAS vezes na série
// empurrada ao squad Intelli — cujo contrato é saving e receita CRUS e SEPARADOS.
// O discriminador de geração é "Impacto Líquido Mensal", coluna que só o v2 escreve.
describe("rollup — v2 não conta a receita duas vezes", () => {
  beforeAll(async () => {
    await criarDbMemoria();
    // v2: bruto 1000 = saving 700 + receita 300. O saving CRU tem de sair 700.
    await seedEspelho("v2a", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "10/07/2026",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "1000",
      "Receita Incremental": "300", "Impacto Líquido Mensal": "820",
    });
    // v1: a MESMA célula não inclui receita — nada pode ser descontado dela.
    await seedEspelho("v1a", {
      Status: "Aprovado", "Área": "Fiscal", "Data Submissão": "11/07/2026",
      "Freq. Custo Evitado": "mensal", "Impacto Bruto": "1000",
      "Receita Incremental": "300",
    });
  });

  it("v2 desconta a receita do bruto; v1 fica intacta", async () => {
    await recalcularRollupBackfill();
    const linhas = await lerRollupMensal();
    const julho = linhas.filter((l) => l.periodo === "2026-07" && l.area === "Fiscal");
    const saving = julho.reduce((s, l) => s + (l.saving_reais ?? 0), 0);
    const receita = julho.reduce((s, l) => s + (l.receita_reais ?? 0), 0);
    // 700 (v2, já sem a receita) + 1000 (v1, intacta) = 1700 — e NÃO 2000.
    expect(saving).toBe(1700);
    // A receita segue CRUA e SEPARADA, uma vez de cada linha.
    expect(receita).toBe(600);
  });
});
