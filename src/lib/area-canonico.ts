// Canonicalização da dimensão `area` do rollup histórico enviado ao squad Intelli (João Gabriel).
//
// PURO, sem I/O. O nome da área no espelho da planilha vem com variantes de caixa/acento da MESMA
// área (`GENTE E GESTÃO` × `Gente e Gestão`), renomes legado (`LOJAS`/`LOJAS - ADM`,
// `SUPPLY CHAIN`/`SUPPLY GOGROUP`) e grafias diferentes da lista canônica que o Gabriel consome.
// `canonicalizarArea` dobra tudo numa grafia só ANTES de o `agregarRollupMensal` agrupar — como ele
// agrupa por `${periodo} ${area} ${tipo}`, as variantes que viram o mesmo nome SOMAM (total preservado).
//
// ⚠️ Decisões do Luis (27/08) — não "corrigir" por engano:
//  - NÃO fatiar genéricos: `Produto`/`Operações`/`Finanças` ficam como estão (não dá pra separar
//    Gocase×Gobeaute a partir do nome sem inventar).
//  - NÃO descartar nada: `ÁREA NÃO IDENTIFICADA` e `N1 - LUIS LIVERI` seguem no rollup (o total geral
//    fica idêntico ao de hoje). A limpeza é só de NOME, nunca de valor.
//  - Slug DESCONHECIDO → passthrough (trim do nome cru): área nova futura nunca é dropada nem mangled.
//  - Vazio/nulo → "" (o `agregarRollupMensal` aplica o default `ÁREA NÃO IDENTIFICADA`, como já faz).

const DIACRITICS = /[̀-ͯ]/g;

/** slug estável (sem acento, minúsculo, kebab) — a chave do de-para. `&`→`e`. */
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/&/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * De-para slug → nome canônico. FONTE ÚNICA do mapeamento. Cobre TODAS as áreas presentes hoje
 * no rollup de prod; slug fora daqui cai no passthrough de `canonicalizarArea`.
 */
export const ALIAS_AREA: Record<string, string> = {
  // — dedup de caixa/acento + alinhar grafia às 23 do Gabriel —
  az: "AZ Buy",
  csc: "Projetos/CSC",
  juridico: "Jurídico/Compliance",
  fpea: "FP&A e Tesouraria",
  "b2b-gobeaute": "B2B Gobeaute",
  "b2b-gocase": "B2B Gocase",
  "gente-e-gestao": "Gente & Gestão",
  "sourcing-e-procurement-gobeaute": "Sourcing & Procurement Gobeaute",
  transportes: "Transportes",
  growth: "Growth",
  cx: "CX",
  dados: "Dados",
  marketing: "Marketing",
  "operacoes-gobeaute": "Operações Gobeaute",
  // — renomes legado que FUNDEM em um só canônico —
  "supply-chain": "Supply Chain",
  "supply-gogroup": "Supply Chain",
  "operacoes-gocase": "Operações Gocase",
  "operacoes-gocase-administrativo": "Operações Gocase",
  lojas: "Lojas",
  "lojas-adm": "Lojas",
  tecnologia: "Tecnologia",
  "tecnologia-projetos": "Tecnologia",
  "desenvolvimento-produto-gobeaute": "Produto Gobeaute",
  // — mantidos por decisão (grafia própria; não fatiar, não dropar) —
  produto: "Produto",
  operacoes: "Operações",
  financas: "Finanças",
  contabilidade: "Contabilidade",
  producao: "Produção",
  bizops: "BIZOPS",
  "gente-e-gestao-cx": "GENTE E GESTÃO | CX",
  rpa: "RPA",
  "pos-venda": "Pós-venda",
  "squad-b2b": "Squad B2B",
  "area-nao-identificada": "ÁREA NÃO IDENTIFICADA",
  "n1-luis-liveri": "N1 - LUIS LIVERI",
};

/**
 * Nome canônico da área para o rollup. Vazio/nulo → "". Slug conhecido → o canônico do de-para.
 * Slug desconhecido → o nome cru trimado (passthrough — nunca dropa nem mangle área futura).
 */
export function canonicalizarArea(area: string | null | undefined): string {
  const cru = (area ?? "").trim();
  if (!cru) return "";
  return ALIAS_AREA[slug(cru)] ?? cru;
}
