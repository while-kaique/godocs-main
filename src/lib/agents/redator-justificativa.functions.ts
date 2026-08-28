/**
 * REDATOR de justificativa humanizada — server-side (chama o LLM). Frente 2 do time de avaliação.
 *
 * Recebe os FATOS DETERMINÍSTICOS, monta o prompt (`redator-justificativa.ts`), chama o `llmChat`
 * no modelo LEVE (`gpt-5.6-luna`, reasoning_effort `low`), aplica o GUARD `semTracos` na saída e
 * devolve o texto humanizado. FAIL-SAFE: LLM que falha/vem vazio → cai no motivo determinístico
 * (nunca trava a mesa — mesma disciplina do resto do time).
 *
 * ⚠️ Envs lidas LAZY (nunca em escopo de módulo: no Godeploy `process` não existe na avaliação do
 * módulo). ⚠️ Modelo id canônico `gpt-5.6-luna` (não "luna").
 */
import { llmChat, sanitizeEffort } from '@/lib/llm';
import {
  buildJustificativaPrompt,
  motivoDeterministico,
  semTracos,
  type FatosJustificativa,
} from '@/lib/agents/redator-justificativa';

/** Modelo leve canônico (o mesmo do roteamento por fase das fases mecânicas). */
const MODELO_LEVE_PADRAO = 'gpt-5.6-luna';
/** reasoning_effort do turno leve (o modelo pesado do memorial não roda aqui). */
const EFFORT_PADRAO = 'low';

function envLazy(): Record<string, string | undefined> {
  return (
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
  );
}

/**
 * A Frente 2 (redator) está ligada? Env `AVALIACAO_REDATOR` truthy. DEFAULT OFF — sem ela, o time
 * mantém o motivo determinístico de hoje (byte-idêntico). Gate SEPARADO da flag mestra do time
 * (`AVALIACAO_NORMAIS`), mas só faz efeito quando a mesa já está ativa (é ela quem chama daqui).
 * Lido LAZY.
 */
export function redatorJustificativaLigado(): boolean {
  const raw = (envLazy().AVALIACAO_REDATOR ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'sim';
}

/**
 * Redige a justificativa humanizada a partir dos FATOS. Chama o LLM leve, aplica `semTracos` e
 * devolve o texto. NUNCA lança: LLM erro/vazio → motivo determinístico (já sem traços).
 */
export async function redigirJustificativa(fatos: FatosJustificativa): Promise<string> {
  const fallback = motivoDeterministico(fatos);
  try {
    const env = envLazy();
    const model = env.LLM_MODEL_FAST || MODELO_LEVE_PADRAO;
    const effort = sanitizeEffort(env.LLM_REASONING_EFFORT_FAST || EFFORT_PADRAO);
    const raw = await llmChat(buildJustificativaPrompt(fatos), {
      model,
      reasoningEffort: effort,
      temperature: 0.4,
      maxTokens: 700,
    });
    const txt = semTracos((raw ?? '').trim());
    return txt || fallback;
  } catch {
    return fallback;
  }
}
