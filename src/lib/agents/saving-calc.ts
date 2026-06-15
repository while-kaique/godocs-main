import { CARGOS, type SavingColetado, type SavingLinha } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Re-deriva os valores em R$ do saving a partir das HORAS de cada linha × tabela
 * CARGOS. A ÚNICA fonte de verdade do dinheiro é o backend.
 *
 * Durante o chat, o orquestrador pode reajustar `horas_antes`/`horas_depois` de uma
 * linha (ex: "estava 0h, na verdade eram 30h") e é instruído a NUNCA mexer em R$
 * (não expomos cálculo monetário ao usuário) — então `economia_reais_mes` volta
 * zerado/defasado no JSON do LLM. Sem este recálculo, o 0 vaza para a planilha
 * (saving_reais=0 → ganho_total_mensal=null).
 *
 * `valor_hora` por linha vem da tabela CARGOS pelo `cargo`; cai no valor_hora já
 * presente na linha se o cargo não for encontrado. O total líquido abate o custo
 * externo mensal (mesma fórmula de `iniciarSaving`).
 */
export function recomputarSavingFinanceiro(
  saving: SavingColetado,
  custoExternoMensal = 0,
): SavingColetado {
  const linhasRaw = Array.isArray(saving?.linhas) ? saving.linhas : [];
  const linhas: SavingLinha[] = linhasRaw.map((l) => {
    const valorHora = CARGOS.find((c) => c.label === l.cargo)?.valor_hora ?? l.valor_hora ?? 0;
    const economiaHoras = Math.max(0, (Number(l.horas_antes) || 0) - (Number(l.horas_depois) || 0));
    return {
      ...l,
      valor_hora: valorHora,
      economia_horas_mes: economiaHoras,
      economia_reais_mes: round2(economiaHoras * valorHora),
    };
  });
  const totalHoras = round2(linhas.reduce((s, l) => s + l.economia_horas_mes, 0));
  const totalReaisBruto = round2(linhas.reduce((s, l) => s + l.economia_reais_mes, 0));
  return {
    ...saving,
    linhas,
    economia_horas_mes: totalHoras,
    economia_reais_mes: round2(totalReaisBruto - (custoExternoMensal || 0)),
  };
}
