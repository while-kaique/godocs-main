/**
 * Montagem final do PAINEL (T6) — módulo **PURO**: o que se grava depois que as lentes, o
 * calibrador e o revisor já falaram.
 *
 * Aqui vivem as 3 decisões que não são de nenhuma das peças anteriores:
 * - **a `origem`** da recomendação (é ela que separa o painel do agente único no cartão);
 * - **a confiança** do painel (não é a confiança de uma lente: é quantos olhos responderam e se a
 *   nota sobreviveu ao revisor);
 * - **a leitura determinística** — o texto que se grava quando ninguém quer gastar uma chamada de
 *   LLM só para redigir, ou quando a redação falhou.
 *
 * ⚠️ Nada aqui grava, nada aqui chama LLM e nada aqui toca a coluna "Estrelas".
 */
import type { Confianca } from "@/lib/especiais-regua";
import {
  LENTES,
  LENTE_GATE,
  type AvaliacaoLente,
  type Consolidado,
} from "@/lib/agents/especiais-lentes";
import {
  explicarCalibragem,
  NOTA_EXIGE_PROVA_NOMEADA,
  type LinhaCalibrada,
} from "@/lib/especiais-calibrador";
import { explicarConvergencia, type EstadoConvergencia } from "@/lib/especiais-convergencia";

/**
 * Carimbo da recomendação do painel. ⚠️ `especial_avaliacao` tem **uma linha por projeto**, então
 * gravar pelo painel SUBSTITUI a recomendação do agente único naquele cartão — é por isso que os
 * candidatos padrão são os especiais **sem recomendação nenhuma** e que sobrescrever exige
 * `forcar` (decisão 7 do plano: o painel convive com o classificador, não o atropela).
 */
export const ORIGEM_PAINEL = "painel-agentes";

/**
 * A confiança do PAINEL — quantos olhos responderam e se a nota sobreviveu ao revisor. Régua:
 * - lente faltando → **baixa** (julgou com menos olhos do que se pretendia);
 * - `contestada` (não convergiu) → **baixa**;
 * - nota ≥3 (top 4% da base) → no máximo **média**, a MESMA régua do agente único: nota rara
 *   sempre pede um segundo olhar humano;
 * - todas as lentes responderam e o eixo estrutural tem prova **nomeada** → **alta**;
 * - resto → **média**.
 */
export function confiancaDoPainel(
  avaliacoes: AvaliacaoLente[],
  consolidado: Consolidado,
  estado: EstadoConvergencia,
  notaFinal: number,
): Confianca {
  if (consolidado.faltando.length > 0) return "baixa";
  if (estado.contestada) return "baixa";
  if (notaFinal >= NOTA_EXIGE_PROVA_NOMEADA) return "media";
  const gate = avaliacoes.find((a) => a.lente === LENTE_GATE);
  const todas = avaliacoes.length === LENTES.length;
  return todas && gate?.evidencia === "nomeada" ? "alta" : "media";
}

/** Teto do texto gravado — o cartão da triagem é para escanear (o mesmo espírito do `MAX_LEITURA`). */
export const MAX_LEITURA_PAINEL = 600;

export type PartesLeitura = {
  linha: LinhaCalibrada;
  avaliacoes: AvaliacaoLente[];
  estado: EstadoConvergencia;
  /** O último argumento do revisor, quando houve refutação — é o que a triagem quer ler primeiro. */
  refutacao?: string | null;
};

function rotuloDaLente(chave: string): string {
  return LENTES.find((l) => l.chave === chave)?.rotulo ?? chave;
}

/**
 * A leitura DETERMINÍSTICA do painel: como a nota saiu, o que cada eixo sustentou e como a revisão
 * terminou. É o que se grava sem gastar LLM — e o fallback de `redigirLeituraCalibrada`.
 *
 * ⚠️ Cada lente aparece com **a prova**, não só com a nota: sem isso a triagem lê 4 números e não
 * sabe qual deles tem endereço para conferir.
 */
export function leituraDoPainel(p: PartesLeitura): string {
  const eixos = p.avaliacoes
    .map((a) => `${rotuloDaLente(a.lente)} ${a.nota}★ (prova ${a.evidencia})`)
    .join(" · ");

  const partes = [
    explicarCalibragem(p.linha),
    eixos ? `Eixos: ${eixos}.` : null,
    p.refutacao ? `Revisor: ${p.refutacao}` : null,
    explicarConvergencia(p.estado),
  ].filter((x): x is string => !!x);

  const texto = partes.join(" ");
  return texto.length > MAX_LEITURA_PAINEL
    ? `${texto.slice(0, MAX_LEITURA_PAINEL - 1).trimEnd()}…`
    : texto;
}
