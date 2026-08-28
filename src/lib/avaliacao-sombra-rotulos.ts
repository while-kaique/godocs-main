/**
 * Rótulos e cores da superfície SOMBRA (teste sombra do time de avaliação) — FONTE ÚNICA,
 * PURA e importável pelo bundle do cliente (a coluna "Sombra" da tabela e a ficha dividem
 * estas mesmas traduções, para não terem réguas diferentes de texto e cor).
 *
 * ⚠️ Nada aqui muda status: é só como o admin LÊ a recomendação do agente ao lado da
 * decisão humana. Sem imports de servidor.
 */
import { grauConfianca } from "@/lib/deliberacao";
import type { Confianca } from "@/lib/especiais-regua";

// Reexporta a formalização da confiança em grau — o piso de `alta` (0.8) e `media` (0.6) é
// FONTE ÚNICA em `deliberacao.ts` (a mesa usa a mesma régua). Não redigitar os limiares aqui.
export { grauConfianca };
export type { Confianca };

/** Veredito do agregador → rótulo curto legível. Desconhecido cai no valor cru. */
export function rotuloVeredito(v: string | null | undefined): string {
  switch (v) {
    case "aprovar":
      return "Aprovar";
    case "em_validacao":
      return "Validar";
    case "isento":
      return "Isento";
    default:
      return v ?? "—";
  }
}

/** Estado da deliberação multi-turno → rótulo. */
export function rotuloEstadoDeliberacao(e: string | null | undefined): string {
  switch (e) {
    case "deliberando":
      return "Deliberando";
    case "consenso":
      return "Consenso";
    case "nao_consenso":
      return "Sem consenso";
    case "isento":
      return "Isento";
    default:
      return e ?? "—";
  }
}

/** Resultado do retroativo (o "confere com o humano?") → rótulo. */
export function rotuloResultadoRetroativo(r: string | null | undefined): string {
  switch (r) {
    case "acerto":
      return "Acerto";
    case "conservador":
      return "Conservador";
    case "erro_grave":
      return "Erro grave";
    case "sem_base":
      return "Sem base";
    default:
      return r ?? "—";
  }
}

/** Grau da confiança → rótulo por extenso (o número vem sempre junto). */
export function rotuloGrau(g: Confianca | null): string {
  switch (g) {
    case "alta":
      return "confiança alta";
    case "media":
      return "confiança média";
    case "baixa":
      return "confiança baixa";
    default:
      return "sem confiança";
  }
}

/**
 * Confiança 0..1 → percentual inteiro exibível ("82%"). `null`/não-finito → "—".
 * Mede a mesma coisa que a barra de confiança, para o número que a coluna destaca.
 */
export function pctConfianca(conf: number | null | undefined): string {
  if (typeof conf !== "number" || !Number.isFinite(conf)) return "—";
  return `${Math.round(conf * 100)}%`;
}

/**
 * Cores por grau de confiança — alta=verde, média=âmbar, baixa=ardósia. Token de aparência
 * consumido pela coluna e pela ficha. ⚠️ A cor NUNCA é o único sinal: quem usa isto sempre
 * mostra também o % em texto e o rótulo do grau.
 */
export const CORES_GRAU: Record<Confianca, { cor: string; fundo: string; borda: string }> = {
  alta: { cor: "#186a3b", fundo: "rgba(24,106,59,0.10)", borda: "rgba(24,106,59,0.35)" },
  media: { cor: "#8a5a00", fundo: "rgba(214,158,46,0.14)", borda: "rgba(214,158,46,0.45)" },
  baixa: { cor: "#475569", fundo: "rgba(71,85,105,0.10)", borda: "rgba(71,85,105,0.32)" },
};

/** Aparência neutra para quando não há grau (sem confiança medida). */
export const CORES_GRAU_NEUTRO = {
  cor: "#5b6470",
  fundo: "rgba(91,100,112,0.08)",
  borda: "rgba(91,100,112,0.30)",
};

/** Escolhe a aparência a partir da confiança numérica (deriva o grau internamente). */
export function aparenciaConfianca(conf: number | null | undefined) {
  const g = typeof conf === "number" && Number.isFinite(conf) ? grauConfianca(conf) : null;
  return g ? CORES_GRAU[g] : CORES_GRAU_NEUTRO;
}
