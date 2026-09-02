// Push OUTBOUND do rollup histórico de saving/receita para o app do squad Intelli (João
// Gabriel) — mesmo modelo do Gomoon (`gomoon-lideres.functions.ts`): POST não-bloqueante que
// NUNCA lança (quem chama é cron/rota admin).
//
// ⚠️ O que o Gabriel quer é a VISÃO HISTÓRICA CUMULATIVA por ÁREA (27/08): um saving mensal
// de R$2.000 que começou no mês 5 já rendeu R$6.000 até o 3º mês. Então NÃO mandamos o
// snapshot "quanto entrou de novo naquele mês" — mandamos, por (mês, área), o ACUMULADO
// realizado até aquele mês (`montarSerieCumulativa`). Regras de acúmulo por cadência:
//   • mensal      → valor × (nº de meses desde o início, inclusive)
//   • pontual     → valor uma vez (fica plano)
//   • trimestral  → valor × (nº de trimestres decorridos)
//   • semestral   → valor × (nº de semestres decorridos)
//   • desconhecido→ uma vez (conservador — nunca infla)
//   • receita     → mensal recorrente (valor_ganho_mensal acumula todo mês)
// O mês de INÍCIO é aproximado pelo mês de `submitted_at` (mesma aproximação já documentada).
//
// ⚠️ CONTRATO REAL do endpoint do Gabriel (`POST /api/ingest/godocs-metrics`, sondado 27/08):
//   • DOIS headers, ambos obrigatórios:
//       - `Authorization: Bearer <gdk_…>`  → fura o OAuth do EDGE do GoDeploy. Secret `JG_INGEST_PLATFORM_TOKEN`.
//       - `X-Godocs-Token: <godocs_…>`     → autoriza o INGEST no app dele. Secret `JG_INGEST_TOKEN`.
//   • Corpo: `{ granularity: "month", rollups: [ { period_key, period_start(ISO), area, … } ] }`.
//     Por item, VALIDADOS: `period_key` ("2026-07"), `period_start` (ISO), `area`. Os valores
//     NÃO são validados (coerção silenciosa lá) — mandamos `saving_reais`/`receita_reais`
//     (ACUMULADOS) + `num_projetos` (ativos até o mês). `source:"godocs"` ele deriva do token.
//
// ⚠️ Envs lidas em RUNTIME. Sem `JG_INGEST_URL` (ou sem um dos 2 tokens) o push fica INERTE.

import { recalcularRollupBackfill } from "@/lib/rollup-backfill";
import { lerRollupMensal } from "@/integrations/db/client.server";
import { rotuloAmbienteExterno } from "@/lib/env";

// O endpoint de ingest do Gabriel processa o lote inteiro na resposta (upsert por
// (period_key,area,tipo_saving)) e leva ~30s para ~150 linhas (medido 27/08: 147 linhas → 29,5s,
// `gravados:147`). Com 20s o push (e o cron diário) abortava SEMPRE por timeout embora o lado dele
// gravasse. 60s dá margem sem prender o isolate indefinidamente.
const TIMEOUT_MS = 60_000;
const log = (...a: unknown[]) => console.log("[rollupPush]", ...a);

/** Célula bruta do rollup mensal (o que `lerRollupMensal` devolve). `periodo` = mês de início. */
export type CelulaRollup = {
  periodo: string; // "YYYY-MM" (mês de submissão ≈ início do ganho)
  area: string;
  tipo_saving: string;
  saving_reais: number;
  receita_reais: number;
  num_projetos: number;
};

/** Linha da série CUMULATIVA por (mês, área) — o acumulado realizado até aquele mês. */
export type LinhaCumulativa = {
  periodo: string; // "YYYY-MM"
  area: string;
  saving_reais: number; // ACUMULADO até este mês
  receita_reais: number; // ACUMULADO até este mês
  num_projetos: number; // projetos ativos até este mês
};

/** Uma linha no formato que o app do Gabriel valida/persiste. */
export type RollupItem = {
  period_key: string; // "2026-07"
  period_start: string; // "2026-07-01" (ISO, VALIDADO no lado dele)
  area: string;
  saving_reais: number; // acumulado
  receita_reais: number; // acumulado
  num_projetos: number;
};

export type PayloadRollup = {
  granularity: "month";
  rollups: RollupItem[];
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

/** "2026-07" → índice absoluto de mês (ano*12 + mês0). */
function indiceMes(periodo: string): number {
  const [y, m] = periodo.split("-").map(Number);
  return y * 12 + (m - 1);
}
/** índice → "YYYY-MM". */
function mesDeIndice(i: number): string {
  const y = Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
/** "2026-07" → "2026-07-01" (primeiro dia do mês, ISO). Idempotente. */
export function inicioDoMesIso(periodo: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(periodo);
  return m ? `${m[1]}-${m[2]}-01` : periodo;
}
const arred2 = (x: number) => Math.round(x * 100) / 100;

/** Quantas vezes o valor de uma cadência já foi realizado após `dm` meses desde o início. */
function fatorAcumulo(tipoSaving: string, dm: number): number {
  switch (tipoSaving) {
    case "mensal":
      return dm + 1;
    case "trimestral":
      return Math.floor(dm / 3) + 1;
    case "semestral":
      return Math.floor(dm / 6) + 1;
    case "pontual":
      return 1;
    default:
      return 1; // cadência desconhecida → conta uma vez, nunca infla
  }
}

/**
 * Expande as células do rollup na série CUMULATIVA por (mês, área): para cada mês do início da
 * área até `mesCorrente`, soma o ganho realizado até ali. PURA — sem I/O. Meses sem projeto
 * ainda ativo (acúmulo zero e sem projeto) são omitidos.
 */
export function montarSerieCumulativa(
  celulas: CelulaRollup[],
  mesCorrente: string,
): LinhaCumulativa[] {
  if (celulas.length === 0) return [];
  const fim = indiceMes(mesCorrente);
  const areas = [...new Set(celulas.map((c) => c.area))];
  const linhas: LinhaCumulativa[] = [];
  for (const area of areas) {
    const daArea = celulas.filter((c) => c.area === area);
    const inicio = Math.min(...daArea.map((c) => indiceMes(c.periodo)));
    for (let mi = inicio; mi <= fim; mi++) {
      let saving = 0;
      let receita = 0;
      let projetos = 0;
      for (const c of daArea) {
        const si = indiceMes(c.periodo);
        if (si > mi) continue;
        const dm = mi - si;
        saving += c.saving_reais * fatorAcumulo(c.tipo_saving, dm);
        receita += c.receita_reais * (dm + 1); // receita é mensal recorrente
        projetos += c.num_projetos;
      }
      if (projetos === 0 && saving === 0 && receita === 0) continue;
      linhas.push({
        periodo: mesDeIndice(mi),
        area,
        saving_reais: arred2(saving),
        receita_reais: arred2(receita),
        num_projetos: projetos,
      });
    }
  }
  return linhas;
}

/** Monta o contrato do endpoint do Gabriel a partir da série cumulativa (PURA). */
export function montarPayloadRollup(linhas: LinhaCumulativa[]): PayloadRollup {
  return {
    granularity: "month",
    rollups: linhas.map((l) => ({
      period_key: l.periodo,
      period_start: inicioDoMesIso(l.periodo),
      area: l.area,
      saving_reais: l.saving_reais,
      receita_reais: l.receita_reais,
      num_projetos: l.num_projetos,
    })),
  };
}

/**
 * Recomputa o rollup (do espelho, dado FRESCO), expande na série cumulativa até o mês corrente
 * e empurra para o Gabriel. `dry:true` monta e devolve o payload SEM enviar. Nunca lança.
 */
export async function enviarRollupParaJG(opts: { dry: boolean }): Promise<ResultadoPush> {
  const ambiente = rotuloAmbienteExterno();
  const agora = new Date();
  const geradoEm = agora.toISOString();
  const mesCorrente = `${agora.getUTCFullYear()}-${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;

  // Dado fresco: recomputa do espelho antes de enviar (idempotente).
  try {
    await recalcularRollupBackfill();
  } catch (e) {
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
  const serie = montarSerieCumulativa(celulas, mesCorrente);
  const payload = montarPayloadRollup(serie);
  const areas = new Set(serie.map((l) => l.area)).size;
  const base: ResultadoPush = {
    ok: false,
    dry: opts.dry,
    ambiente,
    gerado_em: geradoEm,
    celulas: serie.length,
    areas,
  };

  if (opts.dry) return { ...base, ok: true, payload };

  const url = (process.env.JG_INGEST_URL || "").trim();
  const platformToken = (process.env.JG_INGEST_PLATFORM_TOKEN || "").trim(); // gdk_… (Authorization)
  const ingestToken = (process.env.JG_INGEST_TOKEN || "").trim(); // godocs_… (X-Godocs-Token)
  if (!url) {
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
  log(`enviado (${ambiente}): ${serie.length} linha(s), ${areas} área(s) — HTTP ${resp.status}`);
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
