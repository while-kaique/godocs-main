import { describe, it, expect } from "vitest";
import { extractEntrySrc, isUpdateAvailable, getCurrentEntrySrc } from "@/lib/version-check";

// index.html real do build (Vite): 1 <script type="module"> + <link modulepreload>.
const HTML_BUILD = `<!doctype html><html><head>
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-1nUGj7wz.js">
  <script type="module" crossorigin src="/assets/index-DWTXmzVW.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-DYBmOeD5.css">
</head><body><div id="root"></div></body></html>`;

const fakeDoc = (src: string | null): Document =>
  ({
    querySelector: (_sel: string) =>
      src == null ? null : ({ getAttribute: (_a: string) => src } as unknown as Element),
  }) as unknown as Document;

describe("version-check: extração do entry", () => {
  it("pega o src do <script type=module>, ignorando modulepreload/css", () => {
    expect(extractEntrySrc(HTML_BUILD)).toBe("/assets/index-DWTXmzVW.js");
  });

  it("tolera a ordem invertida dos atributos (src antes de type)", () => {
    const html = `<script crossorigin src="/assets/index-XYZ.js" type="module"></script>`;
    expect(extractEntrySrc(html)).toBe("/assets/index-XYZ.js");
  });

  it("retorna null quando não há script de módulo (ex.: HTML de erro do edge)", () => {
    expect(extractEntrySrc("<html><body>502 Bad Gateway</body></html>")).toBeNull();
    expect(extractEntrySrc("")).toBeNull();
  });
});

describe("version-check: decisão de atualização", () => {
  it("hash diferente → há atualização", () => {
    const antigo = "/assets/index-OLD00000.js";
    expect(isUpdateAvailable(antigo, HTML_BUILD)).toBe(true);
  });

  it("mesmo hash → sem atualização", () => {
    expect(isUpdateAvailable("/assets/index-DWTXmzVW.js", HTML_BUILD)).toBe(false);
  });

  it("conservador: entry atual nulo (dev) → nunca cutuca", () => {
    expect(isUpdateAvailable(null, HTML_BUILD)).toBe(false);
  });

  it("conservador: HTML remoto sem entry legível → não cutuca", () => {
    expect(isUpdateAvailable("/assets/index-DWTXmzVW.js", "erro do edge")).toBe(false);
  });
});

describe("version-check: entry em execução (DOM)", () => {
  it("lê o entry hasheado do build", () => {
    expect(getCurrentEntrySrc(fakeDoc("/assets/index-DWTXmzVW.js"))).toBe(
      "/assets/index-DWTXmzVW.js",
    );
  });

  it("em dev (src=/src/main.tsx, sem hash) → null (faixa nunca aparece)", () => {
    expect(getCurrentEntrySrc(fakeDoc("/src/main.tsx"))).toBeNull();
  });

  it("sem <script> de módulo → null", () => {
    expect(getCurrentEntrySrc(fakeDoc(null))).toBeNull();
  });
});
