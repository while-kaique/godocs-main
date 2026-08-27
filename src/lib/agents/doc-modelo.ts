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
