/**
 * FAQ — leitor do markdown leve dos documentos. Módulo **PURO** (roda no cliente).
 *
 * Cada categoria do FAQ é UM documento no formato "título → explicação → título → explicação".
 * Este arquivo transforma o texto em blocos tipados; quem renderiza monta elementos React a
 * partir deles.
 *
 * ⚠️ **Allowlist FECHADA, e nunca HTML.** A marcação aceita é só esta:
 *
 *   ## Título de seção        → titulo nivel 2
 *   ### Subtítulo             → titulo nivel 3
 *   - item      (ou `• `)     → lista
 *   1. item                   → lista ordenada
 *   > texto                   → destaque (a placa dos avisos)
 *   **negrito**               → ênfase dentro de qualquer texto
 *   linha em branco           → separa parágrafos
 *
 * Qualquer outra coisa é PARÁGRAFO literal — inclusive `<b>` ou `<script>`, que chegam ao
 * React como texto e são escapados por ele. É por isso que este renderer substitui o
 * "texto puro" original (SPEC_FAQ D10) sem reabrir XSS armazenado: não existe caminho que
 * transforme o que o admin digita em HTML. Ver spec-docs/SPEC_FAQ.md (D13).
 */

export type PedacoTexto = { texto: string; forte: boolean };

export type BlocoFaq =
  | { tipo: 'titulo'; nivel: 2 | 3; texto: string }
  | { tipo: 'paragrafo'; texto: string }
  | { tipo: 'lista'; ordenada: boolean; itens: string[] }
  | { tipo: 'destaque'; texto: string };

/** Marcadores de lista aceitos (`-`, `*` e o bullet que as pessoas colam do Word/Sheets). */
const RE_LISTA = /^\s*[-*•]\s+(.*)$/;
const RE_LISTA_ORDENADA = /^\s*(\d{1,2})[.)]\s+(.*)$/;
const RE_TITULO = /^\s*(#{2,3})\s+(.*)$/;
const RE_DESTAQUE = /^\s*>\s?(.*)$/;

/**
 * Quebra `**negrito**` em pedaços. Asterisco solto (ímpar) fica literal — quem escreve
 * "2 ** 3" não vira negrito acidental, e o texto nunca desaparece.
 */
export function partirNegrito(texto: string): PedacoTexto[] {
  const partes = texto.split(/\*\*(.+?)\*\*/gs);
  const pedacos: PedacoTexto[] = [];
  for (const [indice, parte] of partes.entries()) {
    if (parte === '') continue;
    pedacos.push({ texto: parte, forte: indice % 2 === 1 });
  }
  return pedacos.length ? pedacos : [{ texto, forte: false }];
}

/**
 * Texto → blocos. Nunca lança e nunca engole conteúdo: linha que não casa com nada é
 * parágrafo. Linhas consecutivas de parágrafo (quebra simples) viram um parágrafo só,
 * porque quem digita no textarea quebra linha para caber na tela, não para criar bloco.
 */
export function parseFaqMarkdown(md: string | null | undefined): BlocoFaq[] {
  if (!md?.trim()) return [];

  const blocos: BlocoFaq[] = [];
  let paragrafo: string[] = [];
  let lista: { ordenada: boolean; itens: string[] } | null = null;
  let destaque: string[] = [];

  const fecharParagrafo = () => {
    if (paragrafo.length) {
      blocos.push({ tipo: 'paragrafo', texto: paragrafo.join(' ').trim() });
      paragrafo = [];
    }
  };
  const fecharLista = () => {
    if (lista?.itens.length) blocos.push({ tipo: 'lista', ...lista });
    lista = null;
  };
  const fecharDestaque = () => {
    if (destaque.length) {
      blocos.push({ tipo: 'destaque', texto: destaque.join(' ').trim() });
      destaque = [];
    }
  };
  const fecharTudo = () => {
    fecharParagrafo();
    fecharLista();
    fecharDestaque();
  };

  for (const linha of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (!linha.trim()) {
      fecharTudo();
      continue;
    }

    const titulo = RE_TITULO.exec(linha);
    if (titulo) {
      fecharTudo();
      const texto = titulo[2].trim();
      if (texto) blocos.push({ tipo: 'titulo', nivel: titulo[1].length === 2 ? 2 : 3, texto });
      continue;
    }

    const aviso = RE_DESTAQUE.exec(linha);
    if (aviso) {
      fecharParagrafo();
      fecharLista();
      destaque.push(aviso[1].trim());
      continue;
    }

    const ordenada = RE_LISTA_ORDENADA.exec(linha);
    const simples = RE_LISTA.exec(linha);
    if (ordenada || simples) {
      fecharParagrafo();
      fecharDestaque();
      const ehOrdenada = Boolean(ordenada);
      const item = (ordenada ? ordenada[2] : simples![1]).trim();
      if (lista && lista.ordenada !== ehOrdenada) fecharLista();
      if (!lista) lista = { ordenada: ehOrdenada, itens: [] };
      if (item) lista.itens.push(item);
      continue;
    }

    fecharLista();
    fecharDestaque();
    paragrafo.push(linha.trim());
  }

  fecharTudo();
  return blocos;
}

/**
 * Os títulos do documento, para o card da listagem dizer o que tem lá dentro ("Saving
 * operacional · Receita incremental · …") em vez de uma contagem sem significado.
 */
export function titulosDoDocumento(md: string | null | undefined): string[] {
  return parseFaqMarkdown(md)
    .filter((b): b is { tipo: 'titulo'; nivel: 2 | 3; texto: string } => b.tipo === 'titulo')
    .filter((b) => b.nivel === 2)
    .map((b) => b.texto.replace(/\*\*/g, ''));
}
