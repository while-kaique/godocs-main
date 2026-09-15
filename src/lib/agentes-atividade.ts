/**
 * O que o TIME DE AGENTES decidiu, por janela de tempo — módulo PURO.
 *
 * Pedido do dono do produto (15/09/2026): *"quero saber o que foi aprovado pelos agentes hoje,
 * ontem e esta semana"* — e, depois de ver a 1ª versão em popover, a forma foi fechada: *"eu
 * acho melhor uma view em lista, vai ser um filtro para que eu consiga ter a visão completa e
 * fácil do que o agente aprovou e reprovou no tempo"*. Por isso o que este módulo entrega é a
 * MARCA por projeto (em que janelas a decisão dele cai), consumida como mais uma dimensão de
 * `dashboard-filtros` — a lista inteira, com todas as colunas, em vez de um resumo à parte.
 *
 * A fonte é o `admin_status_log`, que já registra TODA escrita de status com o ator e o
 * carimbo — não há dado novo a coletar, só a leitura certa. O ator do agente é o
 * `ATOR_TIME_AGENTES`, gravado de propósito com um e-mail que não é de ninguém, para a
 * decisão da máquina nunca ser atribuída a uma pessoa.
 *
 * ⚠️ **As janelas são em BRASÍLIA, não em UTC.** O `created_at` do log é UTC, e "hoje" para
 * quem lê a tela é o dia dele: às 21h de Brasília o UTC já virou, e uma janela ingênua
 * mostraria as decisões da noite como "amanhã" — ou, pior, esvaziaria o "hoje" no fim da
 * tarde. É a mesma régua que o disparo do Gomoon já usa para a chave do dia.
 */

/**
 * O ator com que o time grava no `admin_status_log`.
 *
 * ⚠️ Mora AQUI, num módulo puro, e não no `.functions.ts` do time: quem precisa dele é também
 * a listagem do `/dashboard`, e importar o arquivo do time de lá arrastaria o LLM inteiro para
 * o caminho quente da triagem. O `avaliacao-completa.functions.ts` re-exporta.
 *
 * ⚠️ É um e-mail que não é de ninguém, de propósito: atribuir a decisão da máquina a uma pessoa
 * apaga a resposta que o log existe para dar.
 */
export const ATOR_TIME_AGENTES = "time-de-agentes@godocs";

/** Janelas que a tela oferece. `semana` é a semana CORRENTE, começando na segunda. */
export type JanelaAgente = "hoje" | "ontem" | "semana";

export const JANELAS: readonly { chave: JanelaAgente; rotulo: string }[] = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "semana", rotulo: "Esta semana" },
];

/** O dia de Brasília (`YYYY-MM-DD`) de um instante. PURA. */
export function diaBrasilia(quando: Date): string {
  return quando.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Uma decisão do agente, como o log a guarda.
 *
 * ⚠️ `created_at` vem do SQLite no formato `YYYY-MM-DD HH:MM:SS` e é **UTC** (o `datetime('now')`
 * do SQLite não tem fuso). Quem converte é `diaDaDecisao`.
 */
export type DecisaoDoAgente = {
  projeto_id: string;
  projeto_nome: string | null;
  status_novo: string;
  created_at: string | null;
};

/**
 * O dia de Brasília em que a decisão aconteceu. `null` quando o carimbo é ilegível.
 *
 * ⚠️ O `+ "Z"` é obrigatório: sem ele o JS lê `"2026-09-15 16:24:26"` como hora LOCAL da
 * máquina, e o servidor roda em UTC — o erro passaria despercebido em produção e apareceria
 * só para quem estivesse em outro fuso.
 */
export function diaDaDecisao(d: DecisaoDoAgente): string | null {
  const bruto = String(d.created_at ?? "").trim();
  if (!bruto) return null;
  const ms = Date.parse(bruto.includes("T") ? bruto : bruto.replace(" ", "T") + "Z");
  return Number.isFinite(ms) ? diaBrasilia(new Date(ms)) : null;
}

/** O `YYYY-MM-DD` de N dias antes de um dia de Brasília. PURA. */
export function diaAnterior(dia: string, dias = 1): string {
  const [a, m, d] = dia.split("-").map(Number);
  const base = Date.UTC(a, m - 1, d) - dias * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

/**
 * A segunda-feira da semana de `dia`. PURA.
 *
 * ⚠️ Semana começa na SEGUNDA, não no domingo: "esta semana" para quem tria é a semana de
 * trabalho, e um domingo de virada jogaria as decisões de sexta na "semana passada".
 */
export function segundaDaSemana(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  const dow = base.getUTCDay(); // 0=dom … 6=sáb
  const recuo = dow === 0 ? 6 : dow - 1;
  return diaAnterior(dia, recuo);
}

/** A decisão cai na janela? PURA. `hoje` é o dia de Brasília de referência. */
export function naJanela(diaDaLinha: string | null, janela: JanelaAgente, hoje: string): boolean {
  if (!diaDaLinha) return false;
  if (janela === "hoje") return diaDaLinha === hoje;
  if (janela === "ontem") return diaDaLinha === diaAnterior(hoje);
  return diaDaLinha >= segundaDaSemana(hoje) && diaDaLinha <= hoje;
}

/** O agente só decide aprovando ou reprovando — o resto não é decisão. PURA. */
export function ehDecisao(status: string | null | undefined): boolean {
  const t = String(status ?? "").trim();
  return t === "Aprovado" || t === "Reprovado";
}

/**
 * Em quais janelas a decisão daquele dia cai. PURA.
 *
 * ⚠️ **As janelas se SOBREPÕEM de propósito**: "esta semana" inclui hoje e ontem. A pergunta
 * "o que foi aprovado esta semana" quer o total da semana; fatias exclusivas produziriam um
 * número que ninguém pediu e que não bate com relatório nenhum.
 */
export function janelasDaDecisao(dia: string | null, hoje: string): JanelaAgente[] {
  if (!dia) return [];
  return JANELAS.map((j) => j.chave).filter((chave) => naJanela(dia, chave, hoje));
}

/** O que a listagem recebe por projeto decidido — mapa lateral, nunca campo do espelho. */
export type DecisaoDoAgenteResumo = { id: string; status: string; quando: string };

/** A marca que a tela pendura em cada projeto para o filtro temporal poder ser PURO. */
export type MarcaDecisaoAgente = {
  status: string;
  quando: string;
  janelas: JanelaAgente[];
};

/**
 * Indexa as decisões por id de projeto, já com as janelas resolvidas. PURA.
 *
 * ⚠️ **Só `Aprovado` e `Reprovado` entram.** É o que o agente grava hoje (`agenteDeveGravar`),
 * e o filtro promete "o que o agente DECIDIU": as escritas de `Pré-aprovado`/`Pendente` com o
 * ator do time (anteriores à trava de 15/09) são justamente o defeito que a trava fechou —
 * recortar a lista por elas as carimbaria como veredito. Elas continuam no `admin_status_log`,
 * que é a auditoria; este filtro é um recorte.
 *
 * ⚠️ Quando o mesmo projeto foi decidido mais de uma vez na janela (rerodada, correção), vale
 * a decisão MAIS RECENTE — é a que está na tela, e o filtro tem de concordar com a coluna.
 * A chave é canonizada (`trim`+`lower`) porque o log guarda id de legado em MAIÚSCULA.
 */
export function indexarDecisoes(
  decisoes: readonly DecisaoDoAgenteResumo[],
  agora: Date,
): Map<string, MarcaDecisaoAgente> {
  const hoje = diaBrasilia(agora);
  const mapa = new Map<string, MarcaDecisaoAgente>();
  for (const d of decisoes) {
    if (!ehDecisao(d.status)) continue;
    const chave = String(d.id ?? "")
      .trim()
      .toLowerCase();
    if (!chave) continue;
    const anterior = mapa.get(chave);
    if (anterior && anterior.quando >= d.quando) continue;
    const dia = diaDaDecisao({
      projeto_id: chave,
      projeto_nome: null,
      status_novo: d.status,
      created_at: d.quando,
    });
    mapa.set(chave, { status: d.status, quando: d.quando, janelas: janelasDaDecisao(dia, hoje) });
  }
  return mapa;
}

/**
 * O `desde` (formato do `created_at` do SQLite, UTC) que cobre as três janelas com folga.
 *
 * ⚠️ 10 dias, não 7: a semana corrente começa na segunda, então num domingo o recorte já pede
 * 6 dias para trás — e o fuso de Brasília empurra a fronteira mais 3h. A folga é barata
 * (dezenas de linhas) e a alternativa, calcular a fronteira exata em UTC, erraria no dia da
 * virada sem ninguém perceber.
 */
export function desdeParaJanelas(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 10 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
}
