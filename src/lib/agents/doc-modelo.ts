// Roteamento de modelo para a doc MECÂNICA (extrator + compilador) — OPT-IN, env LAZY.
//
// Extração de campos e compilação da doc são trabalho essencialmente mecânico, mas hoje
// herdam o `LLM_MODEL` (o modelo forte `sol`) por não passarem `model`. Este helper deixa
// rotear as duas para um modelo leve + `reasoning_effort` baixo SEM mudar nada por padrão:
// com as envs ausentes o retorno é `{}` → chamada byte-idêntica à de hoje.
//
// ⚠️ Envs DEDICADAS (não reusar `LLM_MODEL_FAST`, que já está setado em prod para o
// roteamento por FASE do orquestrador — reusá-lo quebraria o "default = hoje" aqui).
// ⚠️ NUNCA ler `process.env` em escopo de módulo — só dentro da função (Godeploy).

import { sanitizeEffort } from "@/lib/llm";
import type { LLMOptions } from "@/lib/llm";
import { docCompilacaoAssincronaAtiva } from "@/lib/agents/doc-async";

/**
 * Options de LLM para as chamadas mecânicas da doc. Vazio quando nada foi configurado
 * (comportamento de hoje). `reasoningEffort` passa pelo `sanitizeEffort` — `minimal`,
 * vazio ou desconhecido são OMITIDOS (o `minimal` derruba o gateway com 502).
 */
export function docMecanicoLLMOpts(): { model?: string; reasoningEffort?: string } {
  const opts: { model?: string; reasoningEffort?: string } = {};

  const model = process.env.DOC_MECANICO_MODEL;
  if (model && model.trim()) opts.model = model;

  const effort = sanitizeEffort(process.env.DOC_MECANICO_EFFORT);
  if (effort) opts.reasoningEffort = effort;

  return opts;
}

// Inteiro positivo de env (lazy) com default; ignora vazio/NaN/≤0.
function envIntPositivo(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  const n = bruto ? Number(bruto) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : padrao;
}

/**
 * Opções de LLM para a COMPILAÇÃO da doc (a doc GRANDE, onde o fallback silencioso para o
 * `gpt-5.4-mini` mais degrada). Estende `docMecanicoLLMOpts` garantindo que a doc seja sempre
 * compilada pelo modelo escolhido:
 * - `semFallbackModelo`: em erro/timeout do proxy, retenta o MESMO modelo (nunca o mini);
 * - `timeoutMs` FOLGADO (`DOC_COMPILE_TIMEOUT_MS`, default 180s): lentidão do luna NÃO é cortada;
 * - `retriesModelo` (`DOC_COMPILE_RETRIES`, default 3): retries do luna antes de desistir.
 *
 * ⚠️ Só liga no MODO ASSÍNCRONO (`DOC_COMPILE_ASYNC`): aí a compilação é background/submit e o
 * cliente NÃO bloqueia, então o timeout folgado é seguro. Com a flag OFF (default de hoje) devolve
 * exatamente `docMecanicoLLMOpts()` — byte-idêntico, o fallback de sempre segue disponível. O
 * kill-switch `DOC_COMPILE_PRESERVAR_MODELO=0` restaura o comportamento antigo mesmo no async.
 */
export function docCompiladorLLMOpts(): LLMOptions {
  const base = docMecanicoLLMOpts();
  const preservar = (process.env.DOC_COMPILE_PRESERVAR_MODELO ?? "").trim() !== "0";
  if (!docCompilacaoAssincronaAtiva() || !preservar) return base;
  return {
    ...base,
    semFallbackModelo: true,
    timeoutMs: envIntPositivo("DOC_COMPILE_TIMEOUT_MS", 180_000),
    retriesModelo: envIntPositivo("DOC_COMPILE_RETRIES", 3),
  };
}
