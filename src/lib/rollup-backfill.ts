// Backfill do ROLLUP histórico de saving/receita (`rollup_saving_receita`).
//
// Orquestração fina (espelha `reconciliarSnapshots`): lê o ESPELHO da planilha, delega a
// matemática ao agregador PURO `rollup-financeiro.ts` e substitui inteiramente o rollup
// mensal persistido. Idempotente e convergente — recomputa o conjunto todo, então rodar
// duas vezes seguidas dá o mesmo resultado e remove células que deixaram de existir.
//
// ⚠️ **Tudo sai do ESPELHO da planilha, o MESMO que o /dashboard lê** (decisão do Luis,
// 26/08/2026): "aprovado" = coluna "Status"="Aprovado" (a triagem decide na planilha, e o
// sync reverso NÃO devolve `status` para `projetos.status`); saving = "Impacto Bruto",
// receita = "Receita Incremental", área = "Área", cadência = "Freq. Custo Evitado", mês = "Data
// Submissão". Ler de `projetos`/`documentacao` divergia do que a empresa vê: o status
// interno subcontava os aprovados (~7×) e a receita de legado mora na planilha, não em
// `documentacao`. Assim o rollup BATE com o dashboard por construção. Grão MENSAL, "sem
// inventar" (a data de submissão é a melhor aproximação de quando o ganho passou a valer).

import { substituirRollupMensal } from "@/integrations/db/client.server";
import { agregarRollupMensal, type ProjetoRollupInput } from "@/lib/rollup-financeiro";
import { canonicalizarArea } from "@/lib/area-canonico";
import { lerResumosEspelho } from "@/lib/sheet-espelho";
import { chaveStatus, texto, numero } from "@/lib/dashboard-resumo";
import { parseDataFlexivel } from "@/lib/format-date";
import { divisorDe, type Frequencia } from "@/lib/impacto";

const log = (...a: unknown[]) => console.log("[rollupBackfill]", ...a);

/**
 * O saving CRU da linha — sem a receita dentro, nas duas gerações do formulário.
 *
 * ⚠️ A régua muda com a geração porque a MESMA célula mudou de sentido:
 *  - **v1**: "Saving Reais" (renomeada para "Impacto Bruto") já era só o saving.
 *  - **v2**: `Impacto Bruto = S + CE + R` (D2 do plano) — a receita está DENTRO dele.
 *
 * Somar `Impacto Bruto` com `Receita Incremental` numa linha v2 contaria a receita duas
 * vezes na série empurrada ao app do squad Intelli, cujo contrato é explícito: saving e
 * receita **crus e separados, nunca somados**. Por isso o v2 subtrai.
 *
 * O discriminador é `Impacto Líquido Mensal`: coluna que **só** o caminho v2 escreve
 * (`celulasGanhoV2`) — linha da v1 nunca a preenche. Preferida a "Tipos de Ganho" porque
 * esta guarda um número, não um vocabulário que as duas gerações escrevem com palavras
 * diferentes.
 *
 * Clampa em 0: `Impacto Bruto` menor que a receita significaria célula editada à mão, e
 * saving negativo entraria como abatimento no total da área.
 */
function savingCruDaLinha(row: Record<string, string>): number | null {
  const bruto = numero(row["Impacto Bruto"]);
  const ehV2 = String(row["Impacto Líquido Mensal"] ?? "").trim() !== "";
  if (!ehV2) return bruto;
  // Linha v2: saving efetivado (antes − agora) e custo evitado (horas em R$ + não contratado)
  // são DOIS blocos com frequência própria (D2). Cada um é mensalizado pela sua e só então
  // somados — somar os dois sob a "Freq. Custo Evitado" (como era) multiplicava um saving
  // mensal pela cadência trimestral do outro bloco (achado ALTO da revisão de qualidade).
  const COLS_BLOCO = ["Saving Efetivado", "Saving Efetivado Agora", "Custo Evitado Horas Reais", "Custo Evitado Não Contratado"];
  const temBlocos = COLS_BLOCO.some((c) => String(row[c] ?? "").trim() !== "");
  // Linha v2 sem as células por bloco (espelho antigo/legado): cai na regra anterior, bruto − receita.
  if (!temBlocos) return bruto == null ? null : Math.max(0, bruto - (numero(row["Receita Incremental"]) ?? 0));
  const antes = numero(row["Saving Efetivado"]) ?? 0;
  const agora = numero(row["Saving Efetivado Agora"]) ?? 0;
  const savingEfetivado = mensalizar(Math.max(0, antes - agora), row["Freq. Saving Efetivado"]);
  const custoEvitado = mensalizar(
    (numero(row["Custo Evitado Horas Reais"]) ?? 0) + (numero(row["Custo Evitado Não Contratado"]) ?? 0),
    row["Freq. Custo Evitado"],
  );
  return Math.max(0, savingEfetivado + custoEvitado);
}

/** Valor do período → valor MENSAL pela frequência da célula (texto da planilha). Sem frequência legível, o valor entra como está. */
function mensalizar(valor: number, freqCru: string | undefined): number {
  if (!valor) return 0;
  const f = String(freqCru ?? "").trim().toLowerCase();
  try {
    return f ? valor / divisorDe(f as Frequencia) : valor;
  } catch {
    return valor;
  }
}

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
      // Canonicaliza o nome da área ANTES de agregar (dedup caixa/acento + renomes que fundem +
      // grafia das 23 do Gabriel). Como o agregador agrupa por (periodo, area, tipo), variantes que
      // viram o mesmo nome SOMAM — total preservado, nada descartado. Ver `area-canonico.ts`.
      area: canonicalizarArea(texto(row["Área"])),
      // v2 já sai MENSALIZADA acima → cadência "mensal"; v1 segue com a cadência da célula.
      tipo_saving: String(row["Impacto Líquido Mensal"] ?? "").trim() !== "" ? "mensal" : texto(row["Freq. Custo Evitado"]),
      // ⚠️ O contrato do squad Intelli exige saving e receita CRUS e SEPARADOS — nunca
      // somados. Na v1 isso saía de graça: "Saving Reais" (hoje "Impacto Bruto") já era o
      // saving sozinho. Na v2 NÃO: `Impacto Bruto` é `S + CE + R` (D2), então lê-lo direto
      // ao lado de `Receita Incremental` contaria a receita DUAS vezes na série empurrada.
      // O discriminador é `Impacto Líquido Mensal`, coluna que só o v2 escreve.
      saving_reais: savingCruDaLinha(row),
      receita_reais: numero(row["Receita Incremental"]),
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
