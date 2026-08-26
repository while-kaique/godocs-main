// Backfill do ROLLUP histórico de saving/receita (`rollup_saving_receita`).
//
// Orquestração fina (espelha `reconciliarSnapshots`): lê o ESPELHO da planilha, delega a
// matemática ao agregador PURO `rollup-financeiro.ts` e substitui inteiramente o rollup
// mensal persistido. Idempotente e convergente — recomputa o conjunto todo, então rodar
// duas vezes seguidas dá o mesmo resultado e remove células que deixaram de existir.
//
// ⚠️ **Tudo sai do ESPELHO da planilha, o MESMO que o /dashboard lê** (decisão do Luis,
// 26/08/2026): "aprovado" = coluna "Status"="Aprovado" (a triagem decide na planilha, e o
// sync reverso NÃO devolve `status` para `projetos.status`); saving = "Saving Reais",
// receita = "Receita Mensal", área = "Área", cadência = "Tipo de Saving", mês = "Data
// Submissão". Ler de `projetos`/`documentacao` divergia do que a empresa vê: o status
// interno subcontava os aprovados (~7×) e a receita de legado mora na planilha, não em
// `documentacao`. Assim o rollup BATE com o dashboard por construção. Grão MENSAL, "sem
// inventar" (a data de submissão é a melhor aproximação de quando o ganho passou a valer).

import { substituirRollupMensal } from "@/integrations/db/client.server";
import { agregarRollupMensal, type ProjetoRollupInput } from "@/lib/rollup-financeiro";
import { lerResumosEspelho } from "@/lib/sheet-espelho";
import { chaveStatus, texto, numero } from "@/lib/dashboard-resumo";
import { parseDataFlexivel } from "@/lib/format-date";

const log = (...a: unknown[]) => console.log("[rollupBackfill]", ...a);

export type RollupBackfillResultado = {
  projetos: number;
  celulas: number;
  periodos: number;
  areas: number;
};

export async function recalcularRollupBackfill(): Promise<RollupBackfillResultado> {
  const { linhas } = await lerResumosEspelho();

  const aprovados: ProjetoRollupInput[] = [];
  for (const row of linhas) {
    if (chaveStatus(row["Status"]) !== "aprovado") continue;
    const data = parseDataFlexivel(texto(row["Data Submissão"]) ?? undefined);
    aprovados.push({
      // ISO derivado da data da planilha — `periodoMensal` fatia o `YYYY-MM` dela. Projeto
      // sem data cai como `null` e o agregador o exclui do tempo (não dá para posicioná-lo).
      submitted_at: data ? data.toISOString() : null,
      area: texto(row["Área"]),
      tipo_saving: texto(row["Tipo de Saving"]),
      saving_reais: numero(row["Saving Reais"]),
      receita_reais: numero(row["Receita Mensal"]),
    });
  }

  const celulas = agregarRollupMensal(aprovados);
  await substituirRollupMensal(celulas);

  const resultado: RollupBackfillResultado = {
    projetos: aprovados.length,
    celulas: celulas.length,
    periodos: new Set(celulas.map((c) => c.periodo)).size,
    areas: new Set(celulas.map((c) => c.area)).size,
  };
  log(JSON.stringify(resultado));
  return resultado;
}
