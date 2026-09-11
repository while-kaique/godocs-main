// Roteamento de MODELO por PAPEL do time de avaliação — módulo PURO (sem I/O, env lida em RUNTIME).
//
// ⚠️ Extraído de `time.functions.ts` em 11/09/2026 porque a MESA passou a usar a MESMA régua
// (`especialista-avaliacao.functions.ts`) e importar de lá criava um ciclo
// mesa → especialista → time.functions → avaliacao-normais → mesa. Uma chave só serve todos os
// modelos: o modelo é o campo `model` do body, por chamada.
//
// Papéis: `especialista` (checagem estruturada com os dados na mão → LEVE) · `estrela` e `cetico`
// (produzem o número/refutação que vira decisão → FORTE). Sem env fica `undefined` = `LLM_MODEL`.
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function modelosDoTime(env?: Record<string, string | undefined>): {
  especialista: string | undefined;
  estrela: string | undefined;
  cetico: string | undefined;
  effortEspecialista: string | undefined;
} {
  const e = env ?? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {});
  const leve = e.AVALIACAO_MODELO_LEVE?.trim() || undefined;
  const forte = e.AVALIACAO_MODELO_FORTE?.trim() || undefined;
  const effortCru = e.AVALIACAO_REASONING_EFFORT_LEVE?.trim().toLowerCase() || '';
  return {
    especialista: leve,
    estrela: forte,
    cetico: forte,
    effortEspecialista: EFFORTS.has(effortCru) ? effortCru : undefined,
  };
}
