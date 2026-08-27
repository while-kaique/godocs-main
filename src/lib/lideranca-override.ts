// Correções MANUAIS da relação líder↔liderado (módulo PURO — sem rede, sem env).
//
// A relação vem derivada da árvore da TeamGuide (`areas/teamguide.server.ts`), que é a
// fonte da verdade. Quando o cadastro LÁ está errado e ninguém pode arrumar na hora, a
// correção mora AQUI — declarada, com nome, motivo e data — em vez de virar um `if` solto
// no meio do fluxo de submissão.
//
// ⚠️ Isto é remendo com prazo: ao arrumar o cadastro na TeamGuide, APAGUE a entrada
// correspondente (a lista precisa dizer a verdade sobre o que ainda está torto).
//
// ⚠️ O override só sabe REMOVER um líder errado, nunca inventar um: quem fica no lugar é
// o próximo líder que a árvore já devolve. E se remover esvaziasse a lista, o override é
// IGNORADO (ver `filtrarLideresOverride`) — "sem líder" ISENTA o projeto de
// pré-aprovação, e ninguém pode ser isento por causa de um remendo nosso.
//
// ⚠️ O remendo é por PESSOA, mas a realidade nem sempre é: alguém pode responder ao líder
// A no dia a dia e ao líder B em UM projeto específico. Daí `exceto_projetos` — a lista de
// IDs em que aquela entrada NÃO vale e a árvore volta a mandar sozinha. É EXCEÇÃO À
// EXCEÇÃO: quem não passa `projetoId` (índice geral, scripts de diagnóstico) segue vendo o
// override inteiro, e só o caminho que SABE de qual projeto se trata enxerga a ressalva.

/** Um par (liderado, líderes a ignorar) com o porquê — auditoria e prazo de validade. */
export type OverrideLideranca = {
  /** E-mail do LIDERADO (minúsculo). */
  liderado: string;
  /** E-mails de líderes que a TeamGuide devolve e que NÃO valem no GoDocs. */
  ignorar: readonly string[];
  /**
   * IDs de projeto em que esta entrada NÃO se aplica (a árvore volta a mandar).
   * Serve para o caso "o líder dele é o A, MENOS neste projeto, que é do B".
   */
  exceto_projetos?: readonly string[];
  motivo: string;
};

export const OVERRIDES_LIDERANCA: readonly OverrideLideranca[] = [
  {
    liderado: 'lucas.braide@gocase.com',
    ignorar: ['wellington.brito@gobeaute.com.br'],
    // "Quiz de Vendas Apice" (27/08/2026, pedido do próprio Lucas): NESTE projeto quem
    // acompanha é o Wellington mesmo, então aqui o remendo se cala e a fila sai como a
    // árvore manda (Wellington + Eughenio — D4: o primeiro que decidir resolve).
    exceto_projetos: ['4790ee41286dffa0b9ff13117596295f'],
    // A TeamGuide pendura o Lucas (Product Manager SR) dentro do
    // "[TECNOLOGIA] TIME WELLINGTON", cujo líder é um Tech Lead. O líder dele é o
    // Eughenio (líder do nó "TECNOLOGIA"), que a árvore já devolve pelo time
    // "PM (Gocase)" — criado em 19/08/2026, DEPOIS da submissão do projeto
    // "Automação de Report de CRO", que por isso caiu na fila do Wellington.
    motivo:
      'TeamGuide ainda aloca o Lucas no time do Tech Lead; o líder dele é o Eughenio (TECNOLOGIA). Remendo de 26/08/2026 — remover quando o cadastro for corrigido lá.',
  },
];

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

/**
 * Aplica os overrides à lista de líderes que a árvore devolveu para UMA pessoa.
 *
 * Genérico no formato do líder (só precisa do `email`) para servir a `PessoaLideranca`
 * (com `email: string | null`) e a qualquer projeção futura.
 *
 * ⚠️ FAIL-SAFE: se a remoção deixaria a pessoa SEM líder nenhum, devolve a lista
 * original intacta. Sem isso, um remendo aqui viraria isenção silenciosa de
 * pré-aprovação (`sem_lider`) — o oposto do que ele existe para fazer.
 *
 * `projetoId` é OPCIONAL de propósito: sem ele o override vale inteiro (é o índice geral
 * da liderança, que não é de projeto nenhum). Com ele, as entradas que listam esse projeto
 * em `exceto_projetos` ficam de fora — é o único jeito de o remendo ter exceção por
 * projeto sem virar um `if` no meio do fluxo de submissão.
 */
export function filtrarLideresOverride<T extends { email: string | null }>(
  emailLiderado: string,
  lideres: readonly T[],
  projetoId?: string | null,
): T[] {
  const alvo = norm(emailLiderado);
  if (!alvo || !lideres.length) return [...lideres];

  const projeto = norm(projetoId);
  const ignorar = new Set(
    OVERRIDES_LIDERANCA.filter(
      (o) =>
        norm(o.liderado) === alvo &&
        !(projeto && (o.exceto_projetos ?? []).some((p) => norm(p) === projeto)),
    ).flatMap((o) => o.ignorar.map((e) => norm(e))),
  );
  if (!ignorar.size) return [...lideres];

  const restantes = lideres.filter((l) => !ignorar.has(norm(l.email)));
  return restantes.length ? restantes : [...lideres];
}
