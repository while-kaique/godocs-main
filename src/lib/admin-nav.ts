/**
 * Menu lateral do admin — FONTE ÚNICA dos itens e do estado recolhido (módulo PURO).
 *
 * Por que uma lista declarada em vez de JSX solto no layout: o menu é a única superfície que
 * diz quais telas existem, e ele encolheu de 8 itens para 4 (14/09/2026). Com os itens
 * digitados dentro do `<nav>`, "remover Áreas do menu" e "remover a rota" viram a mesma
 * edição por acidente — e não são a mesma coisa: `/areas`, `/email-legados` e `/testes`
 * CONTINUAM no ar e alcançáveis por URL, só saíram da navegação porque não são trabalho do
 * dia a dia da triagem.
 *
 * ⚠️ `/especiais` e `/aprovacoes-pendentes` saíram por outro motivo: o `/dashboard` passou a
 * fazer as duas coisas (quadro por nota e quadro por autor são dois EIXOS do mesmo quadro,
 * ver `dashboard-kanban.ts`). As rotas seguem de pé enquanto os links antigos circulam por
 * aí; o menu é que deixou de oferecer três portas para a mesma fila.
 */

/** Item do menu. `icone` é o NOME do ícone, resolvido na tela (este módulo é puro). */
export type ItemNav = {
  to: string;
  rotulo: string;
  icone: "dashboard" | "aglutinacao" | "investigador" | "fluxos";
  /**
   * `false` desliga o preload no hover. Só o Dashboard usa: navegar para lá dispara
   * `iniciarPrefetchDashboard()` no `beforeLoad` do layout e o mouse passando pelo item
   * viraria uma leitura da planilha, cuja cota é compartilhada com produção.
   */
  preload?: false;
  /** Uma linha sobre o que a tela faz — vira `title` e texto do menu recolhido. */
  descricao: string;
};

export const ITENS_NAV: readonly ItemNav[] = [
  {
    to: "/dashboard",
    rotulo: "Triagem",
    icone: "dashboard",
    preload: false,
    descricao: "A esteira inteira: quadro, lista, filas e decisão",
  },
  {
    to: "/aglutinacao",
    rotulo: "Aglutinação",
    icone: "aglutinacao",
    descricao: "Projetos que são o mesmo projeto",
  },
  {
    to: "/investigador",
    rotulo: "Investigador",
    icone: "investigador",
    descricao: "Como a submissão aconteceu, passo a passo",
  },
  {
    to: "/fluxos",
    rotulo: "Fluxos",
    icone: "fluxos",
    descricao: "O formulário real em modo demonstração",
  },
] as const;

/** Chave do estado recolhido. Versionada como as demais chaves de cliente do repo. */
export const CHAVE_MENU_RECOLHIDO = "godocs:menu-recolhido-v1";

/**
 * Lê o estado recolhido do `localStorage`.
 *
 * ⚠️ Nunca lança: aba anônima, armazenamento bloqueado e captura de miniatura fazem o
 * acessor jogar, e o menu tem de desenhar do mesmo jeito.
 *
 * ⚠️ **Sem preferência gravada, o menu nasce RECOLHIDO** (decisão do Luis, 14/09/2026). São
 * 4 itens de destino conhecido, e a tela ao lado é uma esteira que ganha em largura: a
 * navegação aberta cobra 232 px permanentes de quem já sabe onde clicar. Quem quiser os
 * rótulos abre uma vez e a escolha fica. Por isso o padrão é `true`, e só o valor `"0"`
 * explícito (alguém que ABRIU) devolve aberto.
 */
export function lerMenuRecolhido(): boolean {
  try {
    return globalThis.localStorage?.getItem(CHAVE_MENU_RECOLHIDO) !== "0";
  } catch {
    return true;
  }
}

/** Grava a preferência. Falha de armazenamento é silenciosa, pelo mesmo motivo da leitura. */
export function gravarMenuRecolhido(recolhido: boolean): void {
  try {
    globalThis.localStorage?.setItem(CHAVE_MENU_RECOLHIDO, recolhido ? "1" : "0");
  } catch {
    /* preferência de conveniência: perder não quebra nada */
  }
}
