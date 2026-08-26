// Push OUTBOUND do rollup histórico de saving/receita para o app do squad Intelli (João
// Gabriel) — mesmo modelo do Gomoon (`gomoon-lideres.functions.ts`): POST com o token no
// header `Authorization: Bearer`, NUNCA lança (quem chama é cron/rota admin), `ambiente`
// derivado do `GODOCS_ENV` (fonte única) para o lado deles rotear staging × produção.
//
// ⚠️ Contrato (decisões do Luis): série MENSAL, POR ÁREA, saving e receita CRUS e SEPARADOS
// (nunca somados num "ganho total"), `tipo_saving` cru (o Gabriel normaliza), SEM total geral
// da empresa. O token vai no HEADER, jamais no corpo.
//
// ⚠️ Envs lidas em RUNTIME (nunca no topo do módulo — o Godeploy não tem `process` na
// avaliação do módulo). Sem `JG_INGEST_URL` o push fica INERTE (dry de fato) e diz por quê —
// é o estado esperado até o Gabriel preparar o endpoint dele e passar a URL.

import { recalcularRollupBackfill } from "@/lib/rollup-backfill";
import { lerRollupMensal } from "@/integrations/db/client.server";
import { derivarTotaisPorArea } from "@/lib/rollup-financeiro";
import { getGodocsEnv } from "@/lib/env";

const TIMEOUT_MS = 20_000;
const log = (...a: unknown[]) => console.log("[rollupPush]", ...a);

export type PayloadRollup = {
  origem: "godocs";
  ambiente: "producao" | "staging";
  gerado_em: string;
  grao: "mensal";
  celulas: Array<{
    periodo: string;
    area: string;
    tipo_saving: string;
    saving_reais: number;
    receita_reais: number;
    num_projetos: number;
  }>;
  totais_area: Array<{
    periodo: string;
    area: string;
    saving_reais: number;
    receita_reais: number;
    num_projetos: number;
  }>;
};

export type ResultadoPush = {
  ok: boolean;
  dry: boolean;
  ambiente: "producao" | "staging";
  gerado_em: string;
  celulas: number;
  areas: number;
  status?: number;
  erro?: string;
  payload?: PayloadRollup;
};

/** Monta o contrato a partir das células do rollup (PURA — sem I/O, sem token). */
export function montarPayloadRollup(
  celulas: PayloadRollup["celulas"],
  ambiente: "producao" | "staging",
  geradoEm: string,
): PayloadRollup {
  const totais = derivarTotaisPorArea(
    celulas.map((c) => ({ ...c, grao: "mensal" as const })),
  ).map(({ periodo, area, saving_reais, receita_reais, num_projetos }) => ({
    periodo,
    area,
    saving_reais,
    receita_reais,
    num_projetos,
  }));
  return {
    origem: "godocs",
    ambiente,
    gerado_em: geradoEm,
    grao: "mensal",
    celulas,
    totais_area: totais,
  };
}

/**
 * Recomputa o rollup (do espelho, para mandar dado FRESCO) e empurra para o Gabriel.
 * `dry:true` monta e devolve o payload SEM enviar. Nunca lança.
 */
export async function enviarRollupParaJG(opts: { dry: boolean }): Promise<ResultadoPush> {
  const ambiente = getGodocsEnv() === "staging" ? "staging" : "producao";
  const geradoEm = new Date().toISOString();

  // Dado fresco: recomputa do espelho antes de enviar (idempotente).
  try {
    await recalcularRollupBackfill();
  } catch (e) {
    // Se o recompute falhar, ainda enviamos o que estiver persistido (não trava o push).
    log("recompute falhou, seguindo com o rollup persistido:", e instanceof Error ? e.message : e);
  }

  const celulasRaw = await lerRollupMensal();
  const celulas = celulasRaw.map((c) => ({
    periodo: c.periodo,
    area: c.area,
    tipo_saving: c.tipo_saving,
    saving_reais: c.saving_reais,
    receita_reais: c.receita_reais,
    num_projetos: c.num_projetos,
  }));
  const payload = montarPayloadRollup(celulas, ambiente, geradoEm);
  const areas = new Set(celulas.map((c) => c.area)).size;
  const base: ResultadoPush = {
    ok: false,
    dry: opts.dry,
    ambiente,
    gerado_em: geradoEm,
    celulas: celulas.length,
    areas,
  };

  if (opts.dry) return { ...base, ok: true, payload };

  const url = (process.env.JG_INGEST_URL || "").trim();
  const token = (process.env.JG_INGEST_TOKEN || "").trim();
  if (!url) {
    // Estado ESPERADO até o Gabriel entregar a URL — inerte, não é erro de execução.
    log("JG_INGEST_URL não configurada — payload NÃO enviado (aguardando o endpoint do Gabriel).");
    return { ...base, erro: "JG_INGEST_URL não configurada." };
  }
  if (!token) {
    log("JG_INGEST_TOKEN não configurado — payload NÃO enviado.");
    return { ...base, erro: "JG_INGEST_TOKEN não configurado." };
  }

  const resp = await postJG(url, token, payload);
  if (resp.erro) return { ...base, status: resp.status, erro: resp.erro };
  log(
    `enviado (${ambiente}): ${celulas.length} célula(s), ${areas} área(s) — HTTP ${resp.status}`,
  );
  return { ...base, ok: true, status: resp.status };
}

/** POST ao endpoint do Gabriel — NUNCA lança (devolve o erro no campo `erro`). */
async function postJG(
  url: string,
  token: string,
  payload: PayloadRollup,
): Promise<{ status?: number; erro?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const texto = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.error(`[rollupPush] POST recusado (${resp.status}): ${texto.slice(0, 500)}`);
      return { status: resp.status, erro: texto.slice(0, 500) || `HTTP ${resp.status}` };
    }
    return { status: resp.status };
  } catch (e) {
    const abortou = e instanceof Error && e.name === "AbortError";
    const msg = abortou ? `timeout de ${TIMEOUT_MS}ms` : e instanceof Error ? e.message : String(e);
    console.error("[rollupPush] falha no POST:", msg);
    return { erro: msg };
  } finally {
    clearTimeout(timer);
  }
}
