/**
 * Rótulos e cores da superfície SOMBRA (teste sombra do time de avaliação) — FONTE ÚNICA,
 * PURA e importável pelo bundle do cliente (a coluna "Sombra" da tabela e a ficha dividem
 * estas mesmas traduções, para não terem réguas diferentes de texto e cor).
 *
 * ⚠️ Nada aqui muda status: é só como o admin LÊ a recomendação do agente ao lado da
 * decisão humana. Sem imports de servidor.
 */
import { grauConfianca } from "@/lib/deliberacao";
import type { FaixaConfianca } from "@/lib/avaliacao-calibragem";
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
    // ⚠️ Rótulo PRÓPRIO: `reprovar` nasceu do piso de impacto (D4) e sem esta linha cairia no
    // `default` exibindo a chave crua — a família do `Dispensado` que virou `Pré-reprovado`.
    case "reprovar":
      return "Reprovar";
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
    case "reprovado":
      return "Reprovado pelo piso";
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
    case "reprovacao_indevida":
      return "Reprovação indevida";
    case "sem_base":
      return "Sem base";
    default:
      return r ?? "—";
  }
}

/** Grau da confiança → rótulo por extenso. É o ÚNICO jeito de a tela exibir confiança. */
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
 * ⚠️ **`pctConfianca` SAIU em 08/09/2026 (INV-18 / RF-239).** Ela exibia o float interno como
 * percentual, e esse float é **o placar da votação**, não uma medida: com 4 especialistas a
 * concordância direcional só vale 0,5 · 0,75 · 1,0 e a confiança média é auto-declaração do LLM
 * colada em 0,85-0,95 — daí "71%" e "43%" se repetirem para sempre, com 2 dígitos significativos,
 * como se fossem medição. O que a tela mostra agora é **frequência MEDIDA ou nada**
 * (só o GRAU, ver abaixo). **Não reintroduzir**: o float segue interno, onde a lógica o compara
 * por limiar, e a UI não o traduz mais em número nenhum.
 */

/** Faixa de calibragem de uma confiança numérica. `null` quando não há número. */
export function faixaDeConfianca(conf: number | null | undefined): FaixaConfianca | null {
  return typeof conf === "number" && Number.isFinite(conf) ? grauConfianca(conf) : null;
}

/**
 * ⚠️ **A tela exibe SÓ o grau** (`baixa`/`média`/`alta`) — decisão do Luis, 08/09/2026.
 *
 * Duas coisas foram tentadas e saíram: o **percentual** (`pctConfianca`, removida acima) porque é
 * o placar da votação disfarçado de medida, e a **frequência medida** ("8 de 10 · N casos"), que
 * era honesta mas, nas palavras dele, *"uma boa ideia para contornar a confiança"* — contorno, não
 * solução. O que ele quer é o agente **avaliando bem**, não um número melhor descrevendo um
 * julgamento ruim. Então a tela ficou com a palavra, e a MEDIÇÃO continua onde ela decide algo:
 * `politicaDeLiberacao` (que lê `carregarAcuraciaMedida`) e o relatório do retroativo.
 *
 * ⚠️ Não reintroduzir número de confiança na tela sem que essa decisão mude.
 */

/**
 * Cores por grau de confiança — alta=verde, média=âmbar, baixa=ardósia. Token de aparência
 * consumido pela coluna e pela ficha. ⚠️ A cor NUNCA é o único sinal: quem usa isto sempre
 * mostra também o rótulo do grau em TEXTO.
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

/**
 * A aparência a partir do GRAU já em texto (`"alta"` · `"media"`/`"média"` · `"baixa"`) — é o
 * formato que a coluna `Confiança Agente` e o consenso do time entregam, sem número nenhum.
 *
 * ⚠️ **Pedido do Luis (09/09/2026): alta verde, média amarelo, baixa cinza.** As cores já existiam
 * em `CORES_GRAU` e eram aplicadas só na pílula da MESA (que tem confiança numérica); o grau em
 * TEXTO era desenhado como `text-muted-foreground`, cinza para os três.
 * ⚠️ **A palavra continua na tela** — a cor acompanha o rótulo, nunca o substitui (piso de a11y do
 * repo: estado nunca só por cor).
 * ⚠️ Tolerante a acento e caixa: a planilha e o LLM já escreveram "média" e "Alta".
 */
export function aparenciaGrauTexto(grau: string | null | undefined) {
  const t = String(grau ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (t === "alta") return CORES_GRAU.alta;
  if (t === "media") return CORES_GRAU.media;
  if (t === "baixa") return CORES_GRAU.baixa;
  return CORES_GRAU_NEUTRO;
}

/** Escolhe a aparência a partir da confiança numérica (deriva o grau internamente). */
export function aparenciaConfianca(conf: number | null | undefined) {
  const g = typeof conf === "number" && Number.isFinite(conf) ? grauConfianca(conf) : null;
  return g ? CORES_GRAU[g] : CORES_GRAU_NEUTRO;
}
