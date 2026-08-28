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

/**
 * Nota a partir da qual a revisão adversarial acontece.
 *
 * ⚠️ **Era `LIMIARES_GENEROSIDADE[0]` (3), e o "3" vinha de "3★ = top 4% da base" — a população
 * ERRADA.** Entre os especiais auditados, ≥3★ é **41,7%** e ≥4★ é **18,8%**: revisar a partir de 3
 * jogava o revisor adversarial em cima de QUASE METADE da população, e como ele refuta o que
 * examina, o corte virou absorvente — 17 de 17 notas ≥3 viraram 2★ e o painel devolveu **0% de
 * ≥3★** contra 41,7% da triagem (medido 28/08/2026).
 *
 * O papel do revisor é "última trava antes da triagem" para nota **RARA**. Na população certa, a
 * raridade equivalente ao que se pretendia começa em **4** — que é também onde a régua deixa de
 * descrever um projeto sólido e passa a descrever reuso multi-área / risco material.
 *
 * ⚠️ **A hipótese "então revise só a partir de 4" foi MEDIDA E DESCARTADA (28/08/2026).** Ela faz
 * exatamente o que promete — o 3★ passa a existir (≥3★ saiu de 0% para 23–31% da rodada) — e o preço
 * é o par: nada mais filtra o falso 3★, o erro na faixa 0★ sobe de +0,76 para +1,41/+1,65 e as duas
 * métricas do critério 1 pioram (com queda livre: MAE 1,69 e ±1 56,2%; com queda limitada: MAE 1,71
 * e ±1 52,1% — contra MAE 1,56 e ±1 62,5% revisando a partir de 3). **Não retentar sozinha**: ela só
 * fará sentido quando as lentes souberem separar o 0 do 3, que é o gargalo aberto.
 *
 * Fica em 3 — o valor da decisão fechada nº 4 —, e o que se corrigiu no revisor foi a POPULAÇÃO que
 * ele lê (ver `especiais-revisor.ts`), não o corte.
 */
export const NOTA_REVISAO_ADVERSARIAL = LIMIARES_GENEROSIDADE[0];

/**
 * Quanto UMA refutação PODERIA derrubar a nota, se o limite estivesse ligado. ⚠️ **NÃO está** — a
 * constante fica aqui como registro de uma hipótese MEDIDA E DESCARTADA (28/08/2026), para não ser
 * retentada: limitar a queda a 1 ponto protegia o topo (o 8★ que virava 0★) mas impedia o revisor de
 * zerar o lixo, e o erro na faixa 0★ subiu de +0,76 para +1,65 — MAE 1,56 → 1,77 e ±1 62,5% → 50%.
 * Com o campo `derruba` para liberar a queda no caso da `DERRUBA`, ainda ficou pior que sem limite
 * (MAE 1,67 · ±1 52,1%). Ver `docs/plans/painel-agentes-especiais.md`.
 *
 * Registro da hipótese, não parâmetro em uso. **1 ponto por volta.**
 *
 * ⚠️ Não é frouxidão — é o que separa "revisar" de "zerar". A decisão 4 diz que a nota **só desce**
 * e que empate mantém a MENOR; ela nunca disse que uma refutação vale queda livre. Sem este limite,
 * o revisor que refuta a condição de 3★ devolvia `nota_sugerida: 0` e o painel gravava **0★ num
 * projeto que a triagem deu 8★** (VERSTA, medido 28/08/2026; CX Ticket Creator 5★→0★ e Robô de
 * vídeos 5★→0★ no mesmo lote). A refutação diz "este eixo não sustenta ESTA altura" — a conclusão
 * é a faixa de baixo, não o chão da escala.
 *
 * O teto de voltas segue sendo a trava de custo: com `TETO_VOLTAS = 3`, a queda máxima de uma
 * rodada é 3 pontos, e ela exige o revisor refutar 3 vezes com argumentos DIFERENTES.
 */
export const MAX_QUEDA_POR_VOLTA = 1;

/** Nota abaixo do corte não precisa de revisor: refutar 1★ é gastar chamada para nada. */
export function deveRevisar(nota: number): boolean {
  return Number.isFinite(nota) && nota >= NOTA_REVISAO_ADVERSARIAL;
}

/** O que o revisor devolve. `nota_sugerida` só é considerada quando é MENOR que a atual. */
export type VeredictoRevisor = {
  refutada: boolean;
  nota_sugerida: number | null;
  motivo: string;
  /**
   * A refutação é um caso da lista **`DERRUBA`** da régua — "isto não é projeto" — e não apenas
   * "isto não é 4★"? Só o `true` explícito conta, e ele **ignora o piso estrutural** (`estado.piso`):
   * é a única forma de o revisor zerar um projeto cujo eixo estrutural trouxe prova nomeada.
   */
  derruba?: boolean;
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
  /**
   * PISO ESTRUTURAL: a nota do eixo estrutural quando ele trouxe prova **NOMEADA** (0 quando não
   * trouxe). O revisor não desce abaixo dele — salvo `derruba`.
   *
   * ⚠️ Existe por um caso real e absurdo: «[VERSTA] Robô orçamento» (nota humana **8★**) teve
   * eixos 3/2/4/1 — estrutural **3 com prova nomeada** — e **UMA volta do revisor fechou em 0★**
   * (medido 28/08/2026). O revisor refutou a ALTURA (o alcance de 4 não se sustentava) e a queda
   * livre transformou isso em "este projeto não vale nada".
   *
   * A régua: o revisor julga **quão alto** o projeto chega, não **se ele existe**. Se o eixo
   * estrutural provou, com nome, que a coisa roda de novo e tem onde conferir, refutar o alcance
   * não apaga a recorrência provada. Quem pode apagá-la é a `DERRUBA` — e para isso existe o
   * `derruba` do veredicto, que ignora este piso.
   *
   * ⚠️ Isto **não** é o `MAX_QUEDA_POR_VOLTA` (limite por volta, medido e descartado): lá o teto era
   * cego e impedia zerar o lixo; aqui o piso é o que a PROVA do estrutural sustenta, e o lixo — que
   * não tem prova nomeada no estrutural — segue caindo até 0.
   */
  piso: number;
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
export function iniciarConvergencia(nota: number, pisoEstrutural = 0): EstadoConvergencia {
  const n = clamp(nota);
  const revisar = deveRevisar(n);
  return {
    volta: 0,
    nota: n,
    piso: Math.min(clamp(pisoEstrutural), n),
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
  // Só desce: empate ou sugestão maior mantém a nota atual (decisão 4). Sem limite de queda por
  // volta (o `MAX_QUEDA_POR_VOLTA` foi medido e descartado) — mas com **PISO ESTRUTURAL**: refutar a
  // ALTURA não apaga o que o eixo estrutural provou. `derruba` ignora o piso (ver `estado.piso`).
  const piso = veredicto.derruba === true ? 0 : estado.piso;
  const nota =
    sugerida != null && sugerida < estado.nota ? Math.max(piso, sugerida) : estado.nota;

  const passo: PassoConvergencia = {
    volta,
    nota_antes: estado.nota,
    nota_depois: nota,
    refutada: veredicto.refutada === true,
    motivo: veredicto.motivo?.trim() || "sem motivo declarado",
  };
  const historico = [...estado.historico, passo];

  if (!passo.refutada) {
    return { volta, nota, piso: estado.piso, encerrado: true, contestada: false, motivo: "aceita", historico };
  }
  if (!deveRevisar(nota)) {
    return {
      volta,
      nota,
      piso: estado.piso,
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
      piso: estado.piso,
      encerrado: true,
      contestada: true,
      motivo: "teto_de_voltas",
      historico,
    };
  }
  return { volta, nota, piso: estado.piso, encerrado: false, contestada: false, motivo: null, historico };
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
