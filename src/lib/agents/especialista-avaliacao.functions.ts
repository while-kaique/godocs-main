/**
 * ESPECIALISTA da mesa de avaliação — camada LLM (T1). Irmão PURO em `especialista-avaliacao.ts`.
 *
 * Aqui mora a única parte com I/O: a chamada ao LLM. `julgarComEspecialista` NUNCA lança — erro de
 * rede, timeout ou resposta ilegível caem no voto determinístico (fail-closed), porque isto roda em
 * lote de background (crons da mesa) onde uma exceção derrubaria a corrida inteira.
 *
 * ⚠️ Este arquivo SÓ chama o LLM. A decisão de USAR o LLM (em vez do determinístico de sempre) é do
 * chamador, via `especialistasMesaLlmLigados()`. Gate SEPARADO da flag mestra `AVALIACAO_NORMAIS`
 * (igual o redator ter `AVALIACAO_REDATOR`): permite ligar o raciocínio dos especialistas sem mexer
 * no resto da mesa. DEFAULT OFF — sem a flag, a mesa segue byte-idêntica à determinística de hoje.
 */
import { llmChat } from "@/lib/llm";
import { extrairJson } from "@/lib/agents/especial-classificador";
import {
  buildPromptEspecialista,
  fallbackDeterministico,
  normalizarJulgamento,
  type EntradaEspecialista,
  type JulgamentoEspecialista,
} from "@/lib/agents/especialista-avaliacao";

/**
 * Os especialistas LLM da mesa estão ligados? Env `AVALIACAO_MESA_LLM` truthy, lida LAZY (nunca em
 * escopo de módulo — no Godeploy `process` não existe na avaliação do módulo). DEFAULT OFF.
 */
export function especialistasMesaLlmLigados(): boolean {
  const raw = (process.env.AVALIACAO_MESA_LLM ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "sim";
}

/**
 * Roda UM especialista. Chama o LLM em `jsonMode`, parseia por `extrairJson` (Structured Outputs
 * está morta no proxy) e normaliza fail-closed. Qualquer falha → `fallbackDeterministico`.
 *
 * ⚠️ Sem `model` explícito → cai no `LLM_MODEL` (o `sol`, forte). É de propósito: o parecer é
 * trabalho de RACIOCÍNIO crítico (o cético precisa refutar de verdade), não turno mecânico como a
 * `doc`. O roteamento por fase/modelo desta mesa é decisão do T5 (orquestração) — aqui a chamada é
 * neutra e não afirma "leve".
 */
export async function julgarComEspecialista(
  entrada: EntradaEspecialista,
): Promise<JulgamentoEspecialista> {
  try {
    const raw = await llmChat(buildPromptEspecialista(entrada), {
      jsonMode: true,
      temperature: 0.1,
      maxTokens: 600,
    });
    return normalizarJulgamento(extrairJson(raw), entrada);
  } catch {
    return fallbackDeterministico(entrada);
  }
}
