import { useEffect } from "react";
import { montarTitulo } from "@/lib/titulo-pagina";

/**
 * Escreve o título da aba. Uma linha por tela:
 *
 *   useTituloPagina(SECAO.investigador, detalhes?.projeto.nome)
 *
 * O `detalhe` pode ser `undefined` enquanto carrega — nesse instante a aba mostra
 * "Investigador · GoDocs" e troca para o nome do projeto assim que ele chega, que é o
 * comportamento desejado (nunca fica em branco, nunca fica preso no genérico).
 *
 * ⚠️ Não restaura o título anterior ao desmontar de propósito: quem entra na tela
 * seguinte escreve o dela no mesmo tick, e restaurar aqui criaria um piscar
 * "Investigador → Hub de Projetos → Dash" na navegação.
 */
export function useTituloPagina(
  secao: string,
  detalhe?: string | null,
  /**
   * `false` = esta tela cede o título a outra. Serve para quem renderiza DENTRO de si
   * um componente que já tem título próprio (`/fluxos` embutindo o formulário de
   * submissão): sem isto, o efeito do PAI roda depois do efeito do filho na montagem e
   * apagaria o título do filho. Sempre `ativo`, nunca um `if` em volta do hook.
   */
  ativo = true,
): void {
  const titulo = montarTitulo(secao, detalhe);
  useEffect(() => {
    if (!ativo) return;
    document.title = titulo;
  }, [titulo, ativo]);
}
