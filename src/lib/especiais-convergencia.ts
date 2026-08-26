/**
 * Máquina de CONVERGÊNCIA do painel (T5) — módulo **PURO**, sem LLM e sem banco.
 *
 * O revisor adversarial refuta toda nota ≥3 (é o que a força-tarefa fez, e 3★ já é top 4%). Esta
 * máquina é o que decide quando parar. ⚠️ **Este repo já queimou 3× com loop de gate** (as 38
 * perguntas do `[1.4]`, o forçamento do carga×escala, as ~15 voltas do ganho projetado), então ela
 * repete as travas que funcionaram lá, agora sobre voltas de agente em vez de turnos de chat:
 *
 * 1. **teto ABSORVENTE** (`TETO_VOLTAS = 3`): chegou no teto, encerra e grava `contestada`;
 * 2. **estritamente MONOTÔNICA**: `volta` só cresce e a nota só DESCE (decisão 4 do plano — "empate
 *    mantém a nota MENOR"). Nenhum ramo anda para trás;
 * 3. **terminal é NO-OP**: `aplicarRevisao` sobre estado encerrado devolve o MESMO estado — é o que
 *    torna impossível reabrir a discussão por acidente na fiação do T6;
 * 4. **não converge ≠ trava**: sem consenso a nota do calibrador é gravada com `contestada: true`
 *    (campo que já existe em `especial_avaliacao`) e o painel segue para o próximo projeto.
 *
 * ⚠️ A nota nunca SOBE aqui. Revisor que "defende" o projeto seria um 2º avaliador com nome de
 * revisor — e a régua diz que, na dúvida entre duas faixas, fica a menor.
 */
import { NOTA_MAX } from "@/lib/especiais-regua";
import { LIMIARES_GENEROSIDADE } from "@/lib/especiais-concordancia";

/** Voltas no máximo. Absorvente: no teto encerra, não recomeça. */
export const TETO_VOLTAS = 3;

/** Nota a partir da qual a revisão adversarial acontece (≥3 = top 4% da base). */
export const NOTA_REVISAO_ADVERSARIAL = LIMIARES_GENEROSIDADE[0];

/** Nota abaixo do corte não precisa de revisor: refutar 1★ é gastar chamada para nada. */
export function deveRevisar(nota: number): boolean {
  return Number.isFinite(nota) && nota >= NOTA_REVISAO_ADVERSARIAL;
}

/** O que o revisor devolve. `nota_sugerida` só é considerada quando é MENOR que a atual. */
export type VeredictoRevisor = {
  refutada: boolean;
  nota_sugerida: number | null;
  motivo: string;
};

export type MotivoEncerramento = "sem_revisao" | "aceita" | "abaixo_do_corte" | "teto_de_voltas";

export type PassoConvergencia = {
  volta: number;
  nota_antes: number;
  nota_depois: number;
  refutada: boolean;
  motivo: string;
};

export type EstadoConvergencia = {
  /** Quantas revisões já foram aplicadas (0 = nenhuma ainda). Só cresce. */
  volta: number;
  nota: number;
  encerrado: boolean;
  contestada: boolean;
  motivo: MotivoEncerramento | null;
  historico: PassoConvergencia[];
};

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(NOTA_MAX, Math.round(n)));
}

/**
 * Estado inicial. Nota abaixo do corte já nasce **encerrada** (`sem_revisao`) — o T6 não deve
 * gastar chamada de revisor com ela.
 */
export function iniciarConvergencia(nota: number): EstadoConvergencia {
  const n = clamp(nota);
  const revisar = deveRevisar(n);
  return {
    volta: 0,
    nota: n,
    encerrado: !revisar,
    contestada: false,
    motivo: revisar ? null : "sem_revisao",
    historico: [],
  };
}

/**
 * Aplica UMA revisão. Estado encerrado é **terminal absorvente**: devolve o mesmo objeto sem
 * mexer em nada (nem no histórico), então chamar de novo por engano não reabre a discussão.
 *
 * Desfechos:
 * - revisor **não** refutou → encerra, `aceita`, sem contestação;
 * - refutou e a nota caiu **abaixo do corte** → encerra, `abaixo_do_corte` (não há mais nota rara
 *   a defender; contestar aqui só sujaria o cartão);
 * - refutou e ainda há volta disponível → segue aberto, `volta + 1`;
 * - refutou na ÚLTIMA volta → encerra com **`contestada: true`** e `teto_de_voltas`.
 */
export function aplicarRevisao(
  estado: EstadoConvergencia,
  veredicto: VeredictoRevisor,
): EstadoConvergencia {
  if (estado.encerrado) return estado;

  const volta = estado.volta + 1;
  const sugerida = veredicto.nota_sugerida == null ? null : clamp(veredicto.nota_sugerida);
  // Só desce: empate ou sugestão maior mantém a nota atual (decisão 4).
  const nota = sugerida != null && sugerida < estado.nota ? sugerida : estado.nota;

  const passo: PassoConvergencia = {
    volta,
    nota_antes: estado.nota,
    nota_depois: nota,
    refutada: veredicto.refutada === true,
    motivo: veredicto.motivo?.trim() || "sem motivo declarado",
  };
  const historico = [...estado.historico, passo];

  if (!passo.refutada) {
    return { volta, nota, encerrado: true, contestada: false, motivo: "aceita", historico };
  }
  if (!deveRevisar(nota)) {
    return {
      volta,
      nota,
      encerrado: true,
      contestada: false,
      motivo: "abaixo_do_corte",
      historico,
    };
  }
  if (volta >= TETO_VOLTAS) {
    return {
      volta,
      nota,
      encerrado: true,
      contestada: true,
      motivo: "teto_de_voltas",
      historico,
    };
  }
  return { volta, nota, encerrado: false, contestada: false, motivo: null, historico };
}

/** Ainda cabe uma revisão? É o predicado que o laço do T6 consulta — nunca um `while (true)`. */
export function podeRevisarDeNovo(estado: EstadoConvergencia): boolean {
  return !estado.encerrado && estado.volta < TETO_VOLTAS;
}

const TEXTO_ENCERRAMENTO: Record<MotivoEncerramento, string> = {
  sem_revisao: "nota abaixo do corte de revisão — não passou pelo revisor adversarial",
  aceita: "o revisor adversarial tentou refutar e não conseguiu",
  abaixo_do_corte: "a revisão baixou a nota para fora do corte de raridade",
  teto_de_voltas: `sem consenso em ${TETO_VOLTAS} voltas — fica a nota do calibrador, marcada para um segundo olhar humano`,
};

/** Uma linha sobre como a convergência terminou — vai para a leitura gravada. */
export function explicarConvergencia(estado: EstadoConvergencia): string {
  if (!estado.encerrado) {
    return `Revisão em curso (volta ${estado.volta} de ${TETO_VOLTAS}).`;
  }
  const base = TEXTO_ENCERRAMENTO[estado.motivo ?? "sem_revisao"];
  const voltas = estado.volta === 0 ? "" : ` (${estado.volta} volta${estado.volta > 1 ? "s" : ""})`;
  return `${base}${voltas}.`;
}
