// Push OUTBOUND do rollup histórico de saving/receita para o app do squad Intelli (João
// Gabriel) — mesmo modelo do Gomoon (`gomoon-lideres.functions.ts`): POST não-bloqueante que
// NUNCA lança (quem chama é cron/rota admin).
//
// ⚠️ CONTRATO REAL do endpoint do Gabriel (`POST /api/ingest/godocs-metrics`), levantado por
// sondagem em 27/08/2026 — NÃO é o contrato que a gente tinha codado antes (`grao`/`celulas`):
//   • DOIS headers, camadas distintas e AMBOS obrigatórios:
//       - `Authorization: Bearer <gdk_…>`  → fura o OAuth do EDGE do GoDeploy (chave de
//         PLATAFORMA; sem ela o app dele responde 302 pro login). Secret `JG_INGEST_PLATFORM_TOKEN`.
//       - `X-Godocs-Token: <godocs_…>`     → autoriza o INGEST dentro do app dele (sem ela, 401).
//         Secret `JG_INGEST_TOKEN`.
//   • Corpo: `{ granularity: "month", rollups: [ { period_key, period_start, area, … } ] }`.
//       - `granularity` ∈ {"month","week"} (só temos mensal).
//       - por item, VALIDADOS: `period_key` ("2026-07"), `period_start` (ISO "2026-07-01"),
//         `area`. Os campos de VALOR NÃO são validados (coerção silenciosa lá) — mantemos os
//         nomes que combinamos (`saving_reais`/`receita_reais`/`num_projetos`/`tipo_saving`).
//       - `source: "godocs"` é derivado do TOKEN no lado dele — não mandamos no corpo.
//   • saving e receita CRUS e SEPARADOS (nunca somados), `tipo_saving` cru (o Gabriel normaliza),
//     SEM total geral da empresa.
//
// ⚠️ Envs lidas em RUNTIME (nunca no topo do módulo — o Godeploy não tem `process` na avaliação
// do módulo). Sem `JG_INGEST_URL` (ou sem um dos 2 tokens) o push fica INERTE e diz por quê.

import { recalcularRollupBackfill } from "@/lib/rollup-backfill";
import { lerRollupMensal } from "@/integrations/db/client.server";
import { getGodocsEnv } from "@/lib/env";

const TIMEOUT_MS = 20_000;
const log = (...a: unknown[]) => console.log("[rollupPush]", ...a);

/** Uma linha do rollup no formato que o app do Gabriel valida/persiste. */
export type RollupItem = {
  period_key: string; // "2026-07"
  period_start: string; // "2026-07-01" (ISO, VALIDADO no lado dele)
  area: string;
  tipo_saving: string; // cru — o Gabriel normaliza
  saving_reais: number;
  receita_reais: number;
  num_projetos: number;
};

export type PayloadRollup = {
  granularity: "month";
  rollups: RollupItem[];
};

/** Célula bruta do rollup mensal (o que `lerRollupMensal` devolve). */
export type CelulaRollup = {
  periodo: string; // "YYYY-MM"
  area: string;
  tipo_saving: string;
  saving_reais: number;
  receita_reais: number;
  num_projetos: number;
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

/** "2026-07" → "2026-07-01" (primeiro dia do mês, ISO). Idempotente se já vier com dia. */
export function inicioDoMesIso(periodo: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(periodo);
  return m ? `${m[1]}-${m[2]}-01` : periodo;
}

/** Monta o contrato do endpoint do Gabriel a partir das células (PURA — sem I/O, sem token). */
export function montarPayloadRollup(celulas: CelulaRollup[]): PayloadRollup {
  return {
    granularity: "month",
    rollups: celulas.map((c) => ({
      period_key: c.periodo,
      period_start: inicioDoMesIso(c.periodo),
      area: c.area,
      tipo_saving: c.tipo_saving,
      saving_reais: c.saving_reais,
      receita_reais: c.receita_reais,
      num_projetos: c.num_projetos,
    })),
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
  const celulas: CelulaRollup[] = celulasRaw.map((c) => ({
    periodo: c.periodo,
    area: c.area,
    tipo_saving: c.tipo_saving,
    saving_reais: c.saving_reais,
    receita_reais: c.receita_reais,
    num_projetos: c.num_projetos,
  }));
  const payload = montarPayloadRollup(celulas);
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
  const platformToken = (process.env.JG_INGEST_PLATFORM_TOKEN || "").trim(); // gdk_… (Authorization)
  const ingestToken = (process.env.JG_INGEST_TOKEN || "").trim(); // godocs_… (X-Godocs-Token)
  if (!url) {
    // Estado ESPERADO até o Gabriel entregar a URL — inerte, não é erro de execução.
    log("JG_INGEST_URL não configurada — payload NÃO enviado (aguardando o endpoint do Gabriel).");
    return { ...base, erro: "JG_INGEST_URL não configurada." };
  }
  if (!platformToken) {
    log("JG_INGEST_PLATFORM_TOKEN (gdk_) não configurado — payload NÃO enviado.");
    return { ...base, erro: "JG_INGEST_PLATFORM_TOKEN não configurado." };
  }
  if (!ingestToken) {
    log("JG_INGEST_TOKEN (godocs_) não configurado — payload NÃO enviado.");
    return { ...base, erro: "JG_INGEST_TOKEN não configurado." };
  }

  const resp = await postJG(url, platformToken, ingestToken, payload);
  if (resp.erro) return { ...base, status: resp.status, erro: resp.erro };
  log(
    `enviado (${ambiente}): ${celulas.length} célula(s), ${areas} área(s) — HTTP ${resp.status}`,
  );
  return { ...base, ok: true, status: resp.status };
}

/** POST ao endpoint do Gabriel (2 headers) — NUNCA lança (devolve o erro no campo `erro`). */
async function postJG(
  url: string,
  platformToken: string,
  ingestToken: string,
  payload: PayloadRollup,
): Promise<{ status?: number; erro?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${platformToken}`,
        "X-Godocs-Token": ingestToken,
        "Content-Type": "application/json",
      },
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
