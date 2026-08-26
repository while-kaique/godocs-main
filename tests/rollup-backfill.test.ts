import { describe, it, expect, beforeAll } from "vitest";
import { criarDbMemoria } from "./helpers/db-memoria";
import { insertProjetoRaw, upsertDocumentacao } from "@/integrations/db/client.server";
import {
  getProjetosAprovadosParaRollup,
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

describe("rollup histórico — backfill (integração)", () => {
  beforeAll(async () => {
    await criarDbMemoria();

    // aprovados que DEVEM entrar
    await insertProjetoRaw(base({ id: "ap1", status: "aprovado", area: "Fiscal", saving_reais: 100 }));
    await insertProjetoRaw(base({ id: "ap2", status: "validado", area: "Fiscal", saving_reais: 200 }));
    await insertProjetoRaw(base({ id: "ap3", status: "aprovado", area: "Contábil", saving_reais: 50 }));

    // ap3 tem receita via documentação
    await upsertDocumentacao("ap3", { receita: { valor_ganho_mensal: 500 } });

    // NÃO aprovados / descontinuados → devem ficar de fora
    await insertProjetoRaw(base({ id: "rej", status: "rejeitado", saving_reais: 999 }));
    await insertProjetoRaw(base({ id: "rasc", status: "rascunho", saving_reais: 999 }));
    await insertProjetoRaw(base({ id: "emval", status: "em_validacao", saving_reais: 999 }));
    await insertProjetoRaw(
      base({ id: "desc", status: "aprovado", descontinuado: 1, saving_reais: 999 }),
    );
  });

  it("getProjetosAprovadosParaRollup traz só aprovados/validados, exclui os demais e descontinuados", async () => {
    const aprovados = await getProjetosAprovadosParaRollup();

    const savings = aprovados.map((p) => p.saving_reais).filter((v) => v === 999);
    // nenhum dos excluídos (todos com saving 999) pode ter passado
    expect(savings).toHaveLength(0);

    // a receita de ap3 vem da documentação
    const doPeriodo = aprovados.filter((p) => p.area === "Contábil" && p.receita_reais === 500);
    expect(doPeriodo.length).toBeGreaterThanOrEqual(1);

    // aprovados sem doc têm receita 0
    const semDoc = aprovados.find((p) => p.saving_reais === 100);
    expect(semDoc).toBeDefined();
    expect(semDoc!.receita_reais).toBe(0);
  });

  it("recalcularRollupBackfill persiste células coerentes com o conjunto aprovado", async () => {
    const resumo = await recalcularRollupBackfill();
    expect(resumo.projetos).toBeGreaterThan(0);
    expect(resumo.celulas).toBeGreaterThan(0);
    expect(resumo.periodos).toBeGreaterThan(0);
    expect(resumo.areas).toBeGreaterThan(0);

    const celulas = await lerRollupMensal();

    // célula de Fiscal/2026-06/mensal soma ap1 (100) + ap2 (200) = 300, 2 projetos
    const fiscal = celulas.find(
      (c) => c.periodo === "2026-06" && c.area === "Fiscal" && c.tipo_saving === "mensal",
    );
    expect(fiscal).toBeDefined();
    expect(fiscal!.saving_reais).toBe(300);
    expect(fiscal!.num_projetos).toBe(2);

    // célula de Contábil traz a receita da documentação
    const contabil = celulas.find(
      (c) => c.periodo === "2026-06" && c.area === "Contábil" && c.tipo_saving === "mensal",
    );
    expect(contabil).toBeDefined();
    expect(contabil!.saving_reais).toBe(50);
    expect(contabil!.receita_reais).toBe(500);

    // os excluídos (saving 999) nunca viram célula
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
    expect(fiscal).toBeDefined();
    expect(fiscal!.saving_reais).toBe(300);
    expect(fiscal!.num_projetos).toBe(2);
  });
});
