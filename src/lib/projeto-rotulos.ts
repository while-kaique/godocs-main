// Rótulos e formatação PT-BR dos números do projeto — módulo PURO, sem import de
// servidor e sem React.
//
// Existe porque duas telas passaram a falar dos MESMOS números: a fila de pré-aprovação
// (`routes/aprovacoes.tsx`) e a comparação entre versões (`lib/diff-versoes.ts`, o card de
// EDIÇÃO). Sem fonte única, "h/trimestre" e "Recorrente (mensal)" seriam redigitados nos
// dois lugares e um dia divergiriam — o mesmo erro que a régua de tipos de projeto já
// cometeu no passado.
//
// ⚠️ Ao adicionar recorrência (`tipo_saving`) ou tipo de projeto, altere AQUI.

/** Tipos de projeto como o usuário os vê (chave = valor gravado em `tipos_projeto`). */
export const TIPOS_PROJETO_LABEL: Record<string, string> = {
  saving: "Saving",
  receita_incremental: "Receita incremental",
  especial: "Especial",
};

/** Recorrência do ganho, com o mesmo vocabulário do formulário (Etapa 2). */
export const TIPO_SAVING_LABEL: Record<string, string> = {
  mensal: "Recorrente (mensal)",
  pontual: "Pontual (uma vez)",
  trimestral: "A cada trimestre",
  semestral: "A cada semestre",
};

/**
 * Unidade das horas conforme a recorrência — trimestral/semestral mostram o ACUMULADO do
 * período (o valor gravado é o do período cheio, sem ÷3/÷6) e pontual é total único.
 */
export function unidadeHoras(tipo: string | null | undefined): string {
  if (tipo === "trimestral") return "h/trimestre";
  if (tipo === "semestral") return "h/semestre";
  if (tipo === "pontual") return "h (total único)";
  return "h/mês";
}

/** Sufixo de recorrência dos valores em R$ ("/mês" só quando é mensal). */
export function sufixoReais(tipo: string | null | undefined): string {
  return tipo === "mensal" || !tipo ? "/mês" : "";
}

/** "120 h/mês" — null quando não há valor útil (0 conta como "não declarado"). */
export function fmtHoras(
  h: number | null | undefined,
  tipo: string | null | undefined,
): string | null {
  if (typeof h !== "number" || !isFinite(h) || h <= 0) return null;
  return `${h.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unidadeHoras(tipo)}`;
}

/** "R$ 5.400" — sem centavos (a fila é para decidir, não para conferir centavo). */
export function fmtReais(v: number | null | undefined, sufixo = ""): string | null {
  if (typeof v !== "number" || !isFinite(v) || v <= 0) return null;
  return `${v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}${sufixo}`;
}

/** "Sim" / "Não" a partir dos valores gravados no banco. */
export function fmtSimNao(v: unknown): string | null {
  if (v === "sim" || v === true || v === 1) return "Sim";
  if (v === "nao" || v === "não" || v === false || v === 0) return "Não";
  if (v === "externo") return "Não — havia contrato externo";
  return null;
}

/** "Saving · Receita incremental" a partir da lista de tipos. */
export function fmtTiposProjeto(tipos: unknown): string | null {
  if (!Array.isArray(tipos) || tipos.length === 0) return null;
  const nomes = tipos
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .map((t) => TIPOS_PROJETO_LABEL[t] ?? t);
  return nomes.length > 0 ? nomes.join(" · ") : null;
}
