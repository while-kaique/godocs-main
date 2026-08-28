/**
 * Parte LLM do CALIBRADOR (T4): a **redação da leitura**. A reescala é pura e mora em
 * `src/lib/especiais-calibrador.ts` — aqui só se escreve o texto que a triagem lê.
 *
 * ## Por que a redação é separada da conta
 * O número não pode depender do humor do modelo: quem decide a nota é a função pura (pisos de
 * prova + cota). O LLM recebe a decisão **já tomada** e escreve o "por que esta faixa · por que não
 * sobe · o que faria subir" com as palavras do projeto. Se ele falhar, o painel grava o texto
 * determinístico (`explicarCalibragem`) e a nota é exatamente a mesma.
 *
 * ⚠️ O prompt **proíbe** o modelo de propor outra nota: ele não é uma 5ª lente. Se ele mandar um
 * número, o campo é ignorado por construção (a saída dele é só texto).
 */
import { llmChat } from "@/lib/llm";
import { definicaoDe, raridadeDe } from "@/lib/especiais-regua";
import {
  explicarCalibragem,
  type LinhaCalibrada,
  type ResumoCalibragem,
} from "@/lib/especiais-calibrador";
import type { AvaliacaoLente } from "@/lib/agents/especiais-lentes";

export type EntradaLeitura = {
  nome: string | null;
  linha: LinhaCalibrada;
  avaliacoes: AvaliacaoLente[];
  /** Uma linha do resumo da rodada — o que dá contexto de "esta rodada saiu generosa". */
  resumo?: Pick<ResumoCalibragem, "total" | "curva_referencia" | "mais_generosa">;
};

/** Teto de tamanho da leitura — o cartão da triagem é para escanear, não para ler ensaio. */
export const MAX_LEITURA = 500;

export function buildSystemPromptLeitura(): string {
  return `Você REDIGE a leitura de uma nota de estrelas que JÁ FOI DECIDIDA por um cálculo determinístico. Você não julga e não propõe nota.

O QUE VOCÊ ESCREVE (até ${MAX_LEITURA} caracteres, texto corrido, sem títulos e sem JSON):
1. por que esta faixa — usando o que as lentes acharam, com as palavras do projeto;
2. por que não sobe — o eixo que faltou, nomeado;
3. o que faria subir — uma condição concreta e verificável.

REGRAS:
- NUNCA sugira outra nota, nem escreva "deveria ser", "poderia chegar a X★".
- Não repita a definição genérica da régua: cite o que ESTE projeto tem ou não tem.
- Se um eixo ficou sem prova, diga qual prova falta (o relatório, painel, base ou pessoa que se iria conferir).
- Português do Brasil com acentuação. Nada de bullets, nada de markdown.`;
}

export function buildUserMessageLeitura(e: EntradaLeitura): string {
  const lentes = e.avaliacoes
    .map(
      (a) =>
        `- ${a.lente}: ${a.nota}★ · prova ${a.evidencia} · ${a.justificativa}${
          a.sustentacao ? ` [trecho: ${a.sustentacao}]` : ""
        }`,
    )
    .join("\n");

  const raridade = raridadeDe(e.linha.nota_depois);
  const contexto = e.resumo
    ? `\nRODADA: ${e.resumo.total} projetos, referência ${e.resumo.curva_referencia}${
        e.resumo.mais_generosa ? " (a rodada saiu mais generosa que a referência)" : ""
      }.`
    : "";

  return `PROJETO: ${e.nome ?? e.linha.projeto_id}

NOTA DECIDIDA: ${e.linha.nota_depois}★${raridade ? ` (${raridade})` : ""}
DEFINIÇÃO DESTA FAIXA: ${definicaoDe(e.linha.nota_depois) ?? "—"}
COMO A NOTA SAIU: ${explicarCalibragem(e.linha)}

O QUE CADA LENTE ACHOU:
${lentes || "- nenhuma lente respondeu"}
${contexto}

Escreva a leitura desta nota.`;
}

/**
 * Redige a leitura. **Nunca lança e nunca fica sem texto**: erro de rede, resposta vazia ou texto
 * gigante caem no determinístico (`explicarCalibragem`), que já explica a nota sem LLM.
 */
export async function redigirLeituraCalibrada(e: EntradaLeitura): Promise<string> {
  const reserva = explicarCalibragem(e.linha);
  try {
    const raw = await llmChat(
      [
        { role: "system", content: buildSystemPromptLeitura() },
        { role: "user", content: buildUserMessageLeitura(e) },
      ],
      { temperature: 0.2, maxTokens: 400 },
    );
    const texto = (raw ?? "").trim();
    if (!texto) return reserva;
    return texto.length > MAX_LEITURA ? `${texto.slice(0, MAX_LEITURA - 1).trimEnd()}…` : texto;
  } catch {
    return reserva;
  }
}
