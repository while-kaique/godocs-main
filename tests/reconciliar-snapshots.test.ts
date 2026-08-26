import { describe, it, expect, beforeAll } from "vitest";
import { criarDbMemoria } from "./helpers/db-memoria";
import { reconciliarSnapshots } from "@/lib/reconciliar-snapshots";
import { montarSnapshotProjeto } from "@/lib/snapshot-projeto";
import {
  insertProjetoRaw,
  gravarVersaoProjeto,
  getVersionsByProjeto,
} from "@/integrations/db/client.server";

const baseProjeto = (over: Record<string, unknown>) => ({
  responsavel_nome: "Fulano",
  responsavel_email: "fulano@gocase.com",
  ferramenta: "Python",
  status: "aprovado",
  submitted_at: "2026-06-15T12:00:00.000Z",
  ...over,
});

describe("reconciliarSnapshots", () => {
  beforeAll(async () => {
    await criarDbMemoria();

    // p1: submetido, SEM nenhuma versão → deve nascer v1 reconciliada.
    await insertProjetoRaw(baseProjeto({ id: "p1", nome: "Sem versão", saving_reais: 100 }));

    // p2: submetido, COM versão real que bate com o estado atual → nada a fazer.
    await insertProjetoRaw(baseProjeto({ id: "p2", nome: "Ok", saving_reais: 200 }));
    await gravarVersaoProjeto(
      "p2",
      "submit_inicial",
      montarSnapshotProjeto(baseProjeto({ id: "p2", nome: "Ok", saving_reais: 200 })),
      null,
      "fulano@gocase.com",
      null,
      "real",
    );

    // p3: submetido, COM versão real ANTIGA (saving diferente) → deve gerar reenvio reconciliado.
    await insertProjetoRaw(baseProjeto({ id: "p3", nome: "Editado", saving_reais: 500 }));
    await gravarVersaoProjeto(
      "p3",
      "submit_inicial",
      montarSnapshotProjeto(baseProjeto({ id: "p3", nome: "Editado", saving_reais: 999 })),
      null,
      "fulano@gocase.com",
      null,
      "real",
    );

    // rascunho: NÃO submetido → deve ser ignorado.
    await insertProjetoRaw({
      id: "draft",
      responsavel_nome: "F",
      responsavel_email: "f@x.com",
      ferramenta: "Python",
      status: "rascunho",
      nome: "Rascunho",
    });
  });

  it("fecha os furos: cria v1 faltante e reenvio para estado divergente, ignora rascunho", async () => {
    const r = await reconciliarSnapshots();
    // (initSchema semeia legados submetidos → contam no scan; asseguramos o específico)
    expect(r.v1_criadas).toBeGreaterThanOrEqual(1); // p1 (+ legados sem versão)
    expect(r.reenvios_reconciliados).toBe(1); // só p3 diverge (legados não têm versão prévia)
    expect(r.falhas).toBe(0);

    const v1 = await getVersionsByProjeto("p1");
    expect(v1).toHaveLength(1);
    expect(v1[0].acao).toBe("submit_inicial");
    expect(v1[0].origem).toBe("reconciliado");

    const v3 = await getVersionsByProjeto("p3");
    expect(v3).toHaveLength(2);
    expect(v3[1].acao).toBe("reenvio");
    expect(v3[1].origem).toBe("reconciliado");
    // a versão REAL original nunca é tocada
    expect(v3[0].origem).toBe("real");

    // rascunho não ganhou versão
    expect(await getVersionsByProjeto("draft")).toHaveLength(0);
  });

  it("é idempotente: a segunda passada não escreve nada", async () => {
    const r = await reconciliarSnapshots();
    expect(r.v1_criadas).toBe(0);
    expect(r.reenvios_reconciliados).toBe(0);
    expect(r.falhas).toBe(0);
    expect(r.ja_ok).toBeGreaterThanOrEqual(3); // p1, p2, p3 (+ legados) todos batem agora
  });
});
