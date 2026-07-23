import { unzip as fflateUnzip } from "fflate";

// Guarda contra .zip patológico (o navegador descompacta em memória). Os arquivos
// INTERNOS ainda passam pelos limites normais (MAX_FILE_MB por arquivo + orçamento
// de tokens) no pipeline de addFiles; este teto é só para o .zip em si.
export const MAX_ZIP_MB = 50;

/** É um arquivo .zip? (só pela extensão do nome — igual ao resto do gate) */
export function ehZip(nome: string): boolean {
  return nome.toLowerCase().endsWith(".zip");
}

/**
 * Decide se uma ENTRADA do zip deve virar arquivo. Diretórios (terminam em "/"),
 * entradas vazias (0 bytes) e lixo de empacotamento (.DS_Store, __MACOSX/) são
 * descartados aqui. O filtro de node_modules, a whitelist de extensão e o dedup
 * ficam a cargo do pipeline de addFiles a jusante. Pura e testável sem DOM.
 */
export function entradaZipVira(path: string, tamanho: number): boolean {
  if (path.endsWith("/")) return false; // diretório
  if (tamanho === 0) return false; // vazio (o addFiles também trata, mas evita ruído)
  const segmentos = path.split("/");
  if (segmentos.includes("__MACOSX")) return false; // lixo de zip do macOS
  const base = segmentos.pop() ?? "";
  if (base === "" || base === ".DS_Store") return false;
  return true;
}

/** File "sintético" com webkitRelativePath = caminho interno (para o filtro por caminho). */
function fileDeEntrada(path: string, bytes: Uint8Array): File {
  const nome = path.split("/").pop() || path;
  const f = new File([bytes as unknown as BlobPart], nome);
  // webkitRelativePath é read-only no protótipo; define na instância para pathOf()/filtros.
  Object.defineProperty(f, "webkitRelativePath", { value: path, configurable: true });
  return f;
}

/** Descompacta 1 .zip em File[]. Prefixa cada caminho com o nome do zip (contexto + anti-colisão). */
export async function descompactarZip(zip: File): Promise<File[]> {
  const buf = new Uint8Array(await zip.arrayBuffer());
  const entradas = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    fflateUnzip(buf, (err, data) => (err ? reject(err) : resolve(data)));
  });
  const zipBase = zip.name.replace(/\.zip$/i, "");
  const out: File[] = [];
  for (const [path, bytes] of Object.entries(entradas)) {
    if (!entradaZipVira(path, bytes.length)) continue;
    out.push(fileDeEntrada(`${zipBase}/${path}`, bytes));
  }
  return out;
}

export type ResultadoExpansao = {
  files: File[];
  zipsExpandidos: number;
  arquivosExtraidos: number;
  grandes: string[]; // .zip acima do teto, ignorados
  falharam: string[]; // .zip que não abriram
};

/**
 * Expande qualquer .zip da lista em seus arquivos internos; não-zip passam intactos.
 * Não aplica whitelist/node_modules — isso é do pipeline de addFiles a jusante.
 */
export async function expandirZips(
  incoming: File[],
  opts?: { maxZipBytes?: number },
): Promise<ResultadoExpansao> {
  const maxZipBytes = opts?.maxZipBytes ?? MAX_ZIP_MB * 1024 * 1024;
  const files: File[] = [];
  let zipsExpandidos = 0;
  let arquivosExtraidos = 0;
  const grandes: string[] = [];
  const falharam: string[] = [];

  for (const f of incoming) {
    if (!ehZip(f.name)) {
      files.push(f);
      continue;
    }
    if (f.size > maxZipBytes) {
      grandes.push(f.name);
      continue;
    }
    try {
      const internos = await descompactarZip(f);
      files.push(...internos);
      zipsExpandidos++;
      arquivosExtraidos += internos.length;
    } catch {
      falharam.push(f.name);
    }
  }

  return { files, zipsExpandidos, arquivosExtraidos, grandes, falharam };
}
