import { describe, it, expect, beforeAll } from "vitest";
import { criarDbMemoria } from "./helpers/db-memoria";
import {
  insertProjetoRaw,
  upsertDocumentacao,
  upsertEspelhoLinha,
  getProjetosParaRollupPorIds,
  lerRollupMensal,
} from "@/integrations/db/client.server";
import { recalcularRollupBackfill } from "@/lib/rollup-backfill";

const base = (over: Record<string, unknown>) => ({
  responsavel_nome: "Fulano",
  responsavel_email: "fulano@gocase.com",
  ferramenta: "Python",
  submitted_at: "2026-06-15T12:00:00.000Z",
  area: "Fiscal",
  tipo_saving: "mensal",
  saving_reais: 0,
  ...over,
});

// Semeia a linha do espelho com o "Status" que a TRIAGEM daria na planilha — é ele, e não
// `projetos.status`, que decide "aprovado" (decisão do Luis, 26/08/2026).
async function seedEspelho(id: string, status: string) {
  const linha = JSON.stringify({ "ID Projeto": id, Status: status });
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

describe("rollup histórico — backfill (integração)", () => {
  beforeAll(async () => {
    await criarDbMemoria();

    // ── Entram (espelho = "Aprovado") ──
    await insertProjetoRaw(base({ id: "ap1", status: "em_validacao", area: "Fiscal", saving_reais: 100 }));
    await insertProjetoRaw(base({ id: "ap2", status: "em_validacao", area: "Fiscal", saving_reais: 200 }));
    await insertProjetoRaw(base({ id: "ap3", status: "aprovado", area: "Contábil", saving_reais: 50 }));
    await upsertDocumentacao("ap3", { receita: { valor_ganho_mensal: 500 } });
    // `promovido`: interno em_validacao, mas a triagem aprovou na planilha → DEVE entrar
    // (prova que o espelho vence o status interno — o cerne da mudança).
    await insertProjetoRaw(base({ id: "promovido", status: "em_validacao", area: "Logística", saving_reais: 70 }));
    await seedEspelho("ap1", "Aprovado");
    await seedEspelho("ap2", "Aprovado");
    await seedEspelho("ap3", "Aprovado");
    await seedEspelho("promovido", "Aprovado");

    // ── Ficam de fora ──
    // `pend`: interno "aprovado", mas planilha "Pendente" → NÃO entra (espelho manda).
    await insertProjetoRaw(base({ id: "pend", status: "aprovado", saving_reais: 999 }));
    await seedEspelho("pend", "Pendente");
    // `desc`: planilha "Aprovado", mas descontinuado → excluído por segurança.
    await insertProjetoRaw(base({ id: "desc", status: "aprovado", descontinuado: 1, saving_reais: 999 }));
    await seedEspelho("desc", "Aprovado");
    // `semesp`: interno "aprovado", mas sem linha no espelho → NÃO entra.
    await insertProjetoRaw(base({ id: "semesp", status: "aprovado", saving_reais: 999 }));
  });

  it("getProjetosParaRollupPorIds traz só os ids pedidos, exclui descontinuados e ausentes", async () => {
    const linhas = await getProjetosParaRollupPorIds(["ap1", "ap3", "desc", "inexistente"]);
    const savings = linhas.map((p) => p.saving_reais).sort((a, b) => (a ?? 0) - (b ?? 0));
    // ap1 (100) + ap3 (50); desc é descontinuado e "inexistente" não existe → fora.
    expect(savings).toEqual([50, 100]);
    // a receita de ap3 vem da documentação
    const contabil = linhas.find((p) => p.area === "Contábil");
    expect(contabil?.receita_reais).toBe(500);
    // id vazio / lista vazia não quebra
    expect(await getProjetosParaRollupPorIds([])).toEqual([]);
  });

  it("recalcularRollupBackfill usa o STATUS DO ESPELHO, não projetos.status", async () => {
    const resumo = await recalcularRollupBackfill();
    expect(resumo.projetos).toBe(4); // ap1, ap2, ap3, promovido
    expect(resumo.celulas).toBeGreaterThan(0);

    const celulas = await lerRollupMensal();

    // Fiscal/2026-06/mensal = ap1 (100) + ap2 (200) = 300, 2 projetos
    const fiscal = celulas.find(
      (c) => c.periodo === "2026-06" && c.area === "Fiscal" && c.tipo_saving === "mensal",
    );
    expect(fiscal?.saving_reais).toBe(300);
    expect(fiscal?.num_projetos).toBe(2);

    // Contábil traz a receita da documentação
    const contabil = celulas.find(
      (c) => c.periodo === "2026-06" && c.area === "Contábil" && c.tipo_saving === "mensal",
    );
    expect(contabil?.saving_reais).toBe(50);
    expect(contabil?.receita_reais).toBe(500);

    // `promovido` (interno em_validacao, planilha Aprovado) ENTROU — espelho vence.
    const log = celulas.find((c) => c.area === "Logística");
    expect(log?.saving_reais).toBe(70);

    // os de fora (saving 999: pend/desc/semesp) nunca viram célula
    expect(celulas.every((c) => c.saving_reais !== 999)).toBe(true);
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
