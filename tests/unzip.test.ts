// Testes do módulo NOVO de descompactação de .zip no formulário de submissão
// (`src/lib/submeter/unzip.ts`). O usuário poderá subir um .zip e o cliente o
// expande em arquivos individuais antes de montar o payload.
// Encoda o comportamento correto do plano: detecção de .zip, filtro de entradas
// internas (diretório/vazio/.DS_Store/__MACOSX), expansão com prefixo em
// webkitRelativePath e o pipeline `expandirZips` (não-zip intactos, zip grande
// ignorado, zip corrompido em `falharam`, contadores).
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  MAX_ZIP_MB,
  ehZip,
  entradaZipVira,
  descompactarZip,
  expandirZips,
} from "@/lib/submeter/unzip";

// Monta um File .zip real a partir de um mapa caminho→conteúdo.
function zipFile(nome: string, entradas: Record<string, string>): File {
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(entradas).map(([k, v]) => [k, strToU8(v)]),
    ),
  );
  return new File([bytes], nome);
}

describe("MAX_ZIP_MB", () => {
  it("é 50", () => {
    expect(MAX_ZIP_MB).toBe(50);
  });
});

describe("ehZip", () => {
  it("true para nome terminando em .zip", () => {
    expect(ehZip("projeto.zip")).toBe(true);
  });

  it("true case-insensitive (.ZIP)", () => {
    expect(ehZip("X.ZIP")).toBe(true);
  });

  it("false para não-zip", () => {
    expect(ehZip("a.tsx")).toBe(false);
  });
});

describe("entradaZipVira", () => {
  it("false para diretório (path termina em /)", () => {
    expect(entradaZipVira("src/app/", 0)).toBe(false);
  });

  it("false para arquivo vazio (tamanho 0)", () => {
    expect(entradaZipVira("src/vazio.ts", 0)).toBe(false);
  });

  it("false para .DS_Store", () => {
    expect(entradaZipVira("src/.DS_Store", 1234)).toBe(false);
  });

  it("false quando algum segmento é __MACOSX", () => {
    expect(entradaZipVira("__MACOSX/src/page.tsx", 1057)).toBe(false);
  });

  it("true para arquivo comum não-vazio", () => {
    expect(entradaZipVira("src/app/page.tsx", 1057)).toBe(true);
  });
});

describe("descompactarZip", () => {
  it("expande arquivos internos com webkitRelativePath prefixado pelo nome do zip (sem ext)", async () => {
    const zip = zipFile("projeto.zip", { "index.ts": "export const x = 1;" });
    const files = await descompactarZip(zip);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("index.ts");
    expect(files[0].webkitRelativePath).toBe("projeto/index.ts");
  });

  it("descarta diretórios, arquivos vazios, .DS_Store e __MACOSX", async () => {
    const zip = zipFile("projeto.zip", {
      "index.ts": "conteudo",
      "pasta/": "", // diretório
      "vazio.ts": "", // vazio
      ".DS_Store": "lixo",
      "__MACOSX/index.ts": "resource fork",
    });
    const files = await descompactarZip(zip);

    expect(files.map((f) => f.webkitRelativePath)).toEqual(["projeto/index.ts"]);
  });
});

describe("expandirZips", () => {
  it("passa arquivos não-zip INTACTOS na saída", async () => {
    const naoZip = new File([strToU8("body")], "a.tsx");
    const res = await expandirZips([naoZip]);

    expect(res.files).toContain(naoZip);
    expect(res.zipsExpandidos).toBe(0);
    expect(res.arquivosExtraidos).toBe(0);
    expect(res.grandes).toEqual([]);
    expect(res.falharam).toEqual([]);
  });

  it("expande um zip válido e conta zips/arquivos", async () => {
    const zip = zipFile("projeto.zip", {
      "index.ts": "a",
      "lib/util.ts": "b",
    });
    const res = await expandirZips([zip]);

    expect(res.zipsExpandidos).toBe(1);
    expect(res.arquivosExtraidos).toBe(2);
    expect(res.files.map((f) => f.webkitRelativePath).sort()).toEqual([
      "projeto/index.ts",
      "projeto/lib/util.ts",
    ]);
  });

  it("NÃO expande zip acima do limite e coloca o nome em `grandes`", async () => {
    const zip = zipFile("grande.zip", { "index.ts": "conteudo longo o suficiente" });
    const res = await expandirZips([zip], { maxZipBytes: 5 });

    expect(res.grandes).toEqual(["grande.zip"]);
    expect(res.zipsExpandidos).toBe(0);
    expect(res.arquivosExtraidos).toBe(0);
    expect(res.files.some((f) => f.webkitRelativePath?.startsWith("grande/"))).toBe(false);
  });

  it("coloca zip corrompido em `falharam` sem lançar", async () => {
    const ruim = new File([new Uint8Array([1, 2, 3, 4])], "ruim.zip");
    const res = await expandirZips([ruim]);

    expect(res.falharam).toEqual(["ruim.zip"]);
    expect(res.zipsExpandidos).toBe(0);
  });
});
