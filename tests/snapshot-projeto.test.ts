import { describe, it, expect } from "vitest";
import { montarSnapshotProjeto, snapshotDiverge } from "@/lib/snapshot-projeto";

describe("montarSnapshotProjeto", () => {
  it("mantém as chaves de auditoria e parseia tipos_projeto (JSON string → array)", () => {
    const snap = montarSnapshotProjeto({
      nome: "X",
      tipos_projeto: '["saving","receita"]',
      saving_reais: 100,
      status: "aprovado",
    });
    expect(snap.nome).toBe("X");
    expect(snap.tipos_projeto).toEqual(["saving", "receita"]);
    expect(snap.saving_reais).toBe(100);
    expect(snap.status).toBe("aprovado");
    // chaves presentes mesmo quando ausentes na entrada
    expect(Object.keys(snap)).toContain("ganho_total_mensal");
    expect(Object.keys(snap)).toContain("custo_evitado_itens");
  });

  it("tipos_projeto inválido/nulo vira []", () => {
    expect(montarSnapshotProjeto({}).tipos_projeto).toEqual([]);
    expect(montarSnapshotProjeto({ tipos_projeto: "{quebrado" }).tipos_projeto).toEqual([]);
    expect(montarSnapshotProjeto({ tipos_projeto: null }).tipos_projeto).toEqual([]);
  });
});

describe("snapshotDiverge", () => {
  const base = { saving_reais: 1000, ganho_total_mensal: 1000, nome: "A", area: "Fiscal" };

  it("sem snapshot anterior sempre diverge (precisa criar versão)", () => {
    expect(snapshotDiverge(base, null)).toBe(true);
    expect(snapshotDiverge(base, undefined)).toBe(true);
  });

  it("estados iguais não divergem (idempotência do cron)", () => {
    expect(snapshotDiverge(base, { ...base })).toBe(false);
  });

  it("diferença numérica > centavo diverge; ruído de arredondamento não", () => {
    expect(snapshotDiverge({ ...base, saving_reais: 1000.004 }, base)).toBe(false);
    expect(snapshotDiverge({ ...base, saving_reais: 1200 }, base)).toBe(true);
  });

  it("compara escalares vindos de json_extract (string numérica) sem falso positivo", () => {
    // json_extract pode devolver número como string dependendo do adapter
    expect(snapshotDiverge(base, { ...base, saving_reais: "1000", ganho_total_mensal: "1000" })).toBe(
      false,
    );
  });

  it("mudança de nome/área diverge", () => {
    expect(snapshotDiverge({ ...base, nome: "B" }, base)).toBe(true);
    expect(snapshotDiverge({ ...base, area: "CX" }, base)).toBe(true);
  });

  it("mudança APENAS de status NÃO conta como edição (validação humana não é reenvio)", () => {
    expect(snapshotDiverge({ ...base, status: "validado" }, { ...base, status: "aprovado" })).toBe(
      false,
    );
  });
});
