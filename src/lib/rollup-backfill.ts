// Backfill do ROLLUP histórico de saving/receita (`rollup_saving_receita`).
//
// Orquestração fina (espelha `reconciliarSnapshots`): lê os projetos aprovados, delega a
// matemática ao agregador PURO `rollup-financeiro.ts` e substitui inteiramente o rollup
// mensal persistido. Idempotente e convergente — recomputa o conjunto todo, então rodar
// duas vezes seguidas dá o mesmo resultado e remove células que deixaram de existir.
//
// Grão MENSAL por mês de `submitted_at`. É a rede que popula a fonte durável do histórico
// consumido pelo squad Intelli (a série é reconstruída "sem inventar" a partir da data de
// submissão de cada projeto aprovado).

import {
  getProjetosAprovadosParaRollup,
  substituirRollupMensal,
} from "@/integrations/db/client.server";
import { agregarRollupMensal } from "@/lib/rollup-financeiro";

const log = (...a: unknown[]) => console.log("[rollupBackfill]", ...a);

export type RollupBackfillResultado = {
  projetos: number;
  celulas: number;
  periodos: number;
  areas: number;
};

export async function recalcularRollupBackfill(): Promise<RollupBackfillResultado> {
  const projetos = await getProjetosAprovadosParaRollup();
  const celulas = agregarRollupMensal(projetos);
  await substituirRollupMensal(celulas);

  const resultado: RollupBackfillResultado = {
    projetos: projetos.length,
    celulas: celulas.length,
    periodos: new Set(celulas.map((c) => c.periodo)).size,
    areas: new Set(celulas.map((c) => c.area)).size,
  };
  log(JSON.stringify(resultado));
  return resultado;
}
