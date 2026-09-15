/**
 * O que o TIME DE AGENTES decidiu, por janela de tempo — módulo PURO.
 *
 * Pedido do dono do produto (15/09/2026): *"quero uma view temporal dos agentes no frontend
 * também: quero saber o que foi aprovado pelos agentes hoje, ontem e esta semana"*.
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

export type ResumoJanela = {
  janela: JanelaAgente;
  rotulo: string;
  aprovados: number;
  reprovados: number;
  /** Os projetos da janela, do mais recente para o mais antigo. */
  itens: { projeto_id: string; nome: string; status: string; quando: string }[];
};

/**
 * Agrupa as decisões nas três janelas. PURA — é o que os testes exercitam.
 *
 * ⚠️ **"Esta semana" INCLUI hoje e ontem, de propósito.** Não são fatias exclusivas: a
 * pergunta "o que foi aprovado esta semana" quer o total da semana, e subtrair hoje dela
 * produziria um número que ninguém pediu e que não bate com nenhum relatório.
 *
 * ⚠️ **Só `Aprovado` e `Reprovado` entram — nas contagens E na lista.** É o que o agente
 * grava hoje (`agenteDeveGravar`), e o painel promete "decisões": mostrar ali um
 * `Pré-aprovado` ou um `Pendente` de escrita antiga (as que existiam antes da trava de
 * 15/09) seria chamar de decisão o que não é. Eles continuam no `admin_status_log`, que é a
 * auditoria — esta view é um recorte, não o log.
 */
export function resumirPorJanela(
  decisoes: readonly DecisaoDoAgente[],
  agora: Date,
): ResumoJanela[] {
  const hoje = diaBrasilia(agora);
  const comDia = decisoes.map((d) => ({ d, dia: diaDaDecisao(d) }));

  return JANELAS.map(({ chave, rotulo }) => {
    const daJanela = comDia.filter(
      ({ d, dia }) => naJanela(dia, chave, hoje) && ehDecisao(d.status_novo),
    );
    const itens = daJanela
      .map(({ d }) => ({
        projeto_id: d.projeto_id,
        nome: (d.projeto_nome ?? "").trim() || d.projeto_id,
        status: d.status_novo,
        quando: String(d.created_at ?? ""),
      }))
      .sort((a, b) => b.quando.localeCompare(a.quando));
    return {
      janela: chave,
      rotulo,
      aprovados: itens.filter((i) => i.status === "Aprovado").length,
      reprovados: itens.filter((i) => i.status === "Reprovado").length,
      itens,
    };
  });
}
