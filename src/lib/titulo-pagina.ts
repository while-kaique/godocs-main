/**
 * Título da aba do navegador — FONTE ÚNICA.
 *
 * Antes desta feature TODA página do GoDocs mostrava "Hub de Projetos · GoGroup":
 * as rotas até declaravam `head: () => ({ meta: [{ title }] })`, mas o `<HeadContent />`
 * do TanStack Router NUNCA foi renderizado no `__root.tsx` — os títulos eram código
 * morto e o `<title>` do `index.html` valia para sempre. Com várias abas abertas
 * (triagem, investigador, a ficha de um projeto) não dava para distinguir uma da outra.
 *
 * A escolha aqui foi NÃO ressuscitar o `HeadContent`: metade dos títulos úteis depende
 * de estado da PÁGINA, não da rota — o projeto aberto no overlay da triagem, o card
 * aberto no investigador, o projeto atual do slider de pré-aprovação. Isso o `head:`
 * da rota não enxerga. Então o título passa por um hook (`useTituloPagina`) que escreve
 * em `document.title`, e este módulo guarda a parte PURA (testável, sem DOM).
 *
 * ⚠️ Ao criar rota nova, chame `useTituloPagina` nela. E ao mexer no formato, lembre que
 * a aba do navegador mostra ~15–20 caracteres: a SEÇÃO vem primeiro, o detalhe depois.
 */

/** Sufixo de marca — só aparece quando não há detalhe para mostrar no lugar dele. */
export const MARCA = "GoDocs";

/** Separador do app (o mesmo do `index.html` e dos títulos antigos). */
const SEP = " · ";

/**
 * Teto do detalhe. Nome de projeto no GoDocs passa de 80 caracteres e a aba corta
 * sozinha — mas o título também vai para o histórico e para a lista de janelas, onde
 * um nome quilométrico polui. 60 + reticências basta para reconhecer o projeto.
 */
export const LIMITE_DETALHE = 60;

/** Corta no limite sem quebrar palavra no meio quando dá para evitar. */
export function encurtarDetalhe(detalhe: string, limite = LIMITE_DETALHE): string {
  const limpo = detalhe.replace(/\s+/g, " ").trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const ultimoEspaco = corte.lastIndexOf(" ");
  // Só respeita a palavra se sobrar texto suficiente para o nome continuar reconhecível.
  const base = ultimoEspaco > limite * 0.6 ? corte.slice(0, ultimoEspaco) : corte;
  return `${base.trimEnd()}…`;
}

/**
 * Monta o título: `Seção · detalhe`, ou `Seção · GoDocs` quando não há detalhe.
 *
 * O detalhe ocupa o lugar da marca de propósito — com os dois ("Investigador · Bot de
 * Faturamento · GoDocs") a aba corta antes de chegar ao nome do projeto, que é
 * justamente a informação que faltava.
 */
export function montarTitulo(secao: string, detalhe?: string | null): string {
  const s = secao.trim();
  const d = detalhe?.replace(/\s+/g, " ").trim();
  if (!s) return MARCA;
  if (!d) return `${s}${SEP}${MARCA}`;
  return `${s}${SEP}${encurtarDetalhe(d)}`;
}

/**
 * Rótulos de seção — curtos, na linguagem falada das telas ("Dash", "Investigador").
 * ⚠️ A nomenclatura da fila do líder é **pré-aprovação**, nunca "Aprovado"
 * (regra de nomenclatura no CLAUDE.md); por isso "Aprovações", não "Aprovados".
 */
export const SECAO = {
  inicio: "Início",
  meusProjetos: "Meus Projetos",
  submeter: "Nova submissão",
  projeto: "Projeto",
  /** Projeto marcado como especial (sem memorial financeiro) — rótulo próprio na aba. */
  especial: "Especial",
  editar: "Editando",
  /** Fila do LÍDER (`/aprovacoes`) — pré-aprovação, um projeto por vez. */
  aprovacoes: "Aprovações",
  /** Painel ADMIN de aprovação dos pendentes (`/aprovacoes-pendentes`). */
  aprovacoesPendentes: "Aprovados",
  /** Comparador de projetos especiais (`/especiais`). */
  especiais: "Especiais",
  dashboard: "Dash",
  investigador: "Investigador",
  areas: "Áreas",
  usuarios: "Usuários",
  emails: "E-mails",
  faq: "Ajuda",
  fluxos: "Demonstração",
  testes: "Testes",
  prompts: "Prompts da IA",
  aglutinacao: "Aglutinação",
  cenarios: "Cenários",
} as const;
