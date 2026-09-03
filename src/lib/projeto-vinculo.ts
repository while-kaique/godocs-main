// Projeto como FEATURE de outro projeto — helpers PUROS do vínculo pai↔filho.
//
// O FILHO guarda o id do PAI (`projeto_pai_id`); o PAI acumula os ids dos filhos
// (`projeto_filhos_ids`, JSON no SQLite; coluna "ID Feature" no Sheets, uma lista).
// O nome do filho ganha o prefixo "[feature de <NOME do pai>]".
//
// ⚠️ Módulo PURO (sem I/O): a persistência mora em client.server.ts/chat.functions.ts;
// aqui ficam só as transformações, para o teste exercitar dedup/ordem/idempotência.

/** Separador da coluna "ID Feature" no Sheets (mesmo padrão das colunas de lista). */
export const SEP_ID_FEATURE = ', ';

/** Prefixo aplicado ao nome do FILHO. A régua de idempotência casa por este começo. */
const PREFIXO_FEATURE_INICIO = '[feature de ';

/**
 * Nome do filho com o prefixo "[feature de <NOME do pai>]". Idempotente: se o nome já
 * começa com "[feature de " (reenvio, ou nome já prefixado), NÃO reprefixar. Sem nome do
 * pai, devolve o nome como está (não inventa "[feature de ]").
 */
export function prefixarNomeFeature(
  nomeFilho: string | null | undefined,
  nomePai: string | null | undefined,
): string {
  const filho = (nomeFilho ?? '').trim();
  const pai = (nomePai ?? '').trim();
  if (!pai) return filho;
  if (filho.startsWith(PREFIXO_FEATURE_INICIO)) return filho; // já prefixado
  return `${PREFIXO_FEATURE_INICIO}${pai}] ${filho}`.trim();
}

/** Parseia a lista de ids-feature de uma célula "ID Feature" (CSV) ou de um JSON array. */
export function parseIdsFeature(bruto: string | null | undefined): string[] {
  const txt = (bruto ?? '').trim();
  if (!txt || txt === '—') return [];
  // Aceita JSON array (do SQLite `projeto_filhos_ids`) OU a lista CSV (célula do Sheets).
  if (txt.startsWith('[')) {
    try {
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) return normalizarIds(arr.map((v) => String(v ?? '')));
    } catch {
      // cai no split por separador
    }
  }
  return normalizarIds(txt.split(/[;,]/));
}

/**
 * Acumula um novo id de filho numa lista existente, sem duplicar (case-insensitive) e
 * preservando a ordem (o novo entra no fim). Devolve o array normalizado.
 */
export function acumularIdFeature(
  listaAtual: string | string[] | null | undefined,
  novoId: string,
): string[] {
  const atual = Array.isArray(listaAtual) ? normalizarIds(listaAtual) : parseIdsFeature(listaAtual);
  const novo = (novoId ?? '').trim();
  if (!novo) return atual;
  if (atual.some((id) => id.toLowerCase() === novo.toLowerCase())) return atual;
  return [...atual, novo];
}

/** Serializa a lista para a célula "ID Feature" do Sheets. Vazia → "" (vira "—" no sync). */
export function serializarIdsFeatureSheet(lista: string[]): string {
  return normalizarIds(lista).join(SEP_ID_FEATURE);
}

/** Item da busca do projeto PAI (autocomplete da Etapa 1). */
export type ProjetoBusca = { id: string; nome: string; autor: string };

/** Normaliza para busca: minúsculas, sem acento, espaços colapsados. */
export function normalizarBusca(txt: string | null | undefined): string {
  return (txt ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // tira os acentos (marcas combinantes do NFD)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Filtra projetos por nome (sem acento, substring) para o autocomplete do PAI. PURA.
 * `q` com menos de 2 chars devolve []. `limite` corta o resultado (default 20).
 */
export function filtrarProjetosPorNome(
  projetos: ProjetoBusca[],
  q: string,
  limite = 20,
): ProjetoBusca[] {
  const alvo = normalizarBusca(q);
  if (alvo.length < 2) return [];
  // ⚠️ Busca por TERMOS, não substring única (03/09/2026). A 1ª versão usava
  // `nome.includes(q)`, então "hub cx" não achava «CX Hub — Plataforma Central»: quem
  // digita raramente acerta a ordem exata das palavras. Agora cada palavra da busca vale
  // um `%termo%` e TODAS precisam aparecer — o mesmo efeito de um `ILIKE` por termo.
  const termos = alvo.split(/\s+/).filter((t) => t.length >= 2);
  if (termos.length === 0) return [];

  const pontuados: Array<{ p: ProjetoBusca; peso: number }> = [];
  for (const p of projetos) {
    const nome = normalizarBusca(p.nome);
    if (!termos.every((t) => nome.includes(t))) continue;
    // Ordena por RELEVÂNCIA, não pela ordem da planilha: quem começa com o que a pessoa
    // digitou vem primeiro, depois o nome mais curto (mais específico ao termo).
    const peso =
      (nome.startsWith(alvo) ? 0 : nome.startsWith(termos[0]) ? 1 : 2) * 1000 + nome.length;
    pontuados.push({ p, peso });
  }
  return pontuados.sort((a, b) => a.peso - b.peso).slice(0, limite).map((x) => x.p);
}

function normalizarIds(ids: string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const bruto of ids) {
    const id = String(bruto ?? '').trim();
    if (!id) continue;
    const chave = id.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(id);
  }
  return out;
}
