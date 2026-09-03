import { describe, it, expect, afterEach } from "vitest";
import {
  getGodocsEnv,
  isStaging,
  assertNaoEhDefaultDeProd,
  rotuloAmbienteExterno,
} from "@/lib/env";
import { namespacePinecone } from "@/lib/pinecone";

const ORIG = process.env.GODOCS_ENV;
function restore() {
  if (ORIG === undefined) delete process.env.GODOCS_ENV;
  else process.env.GODOCS_ENV = ORIG;
}

describe("env — GODOCS_ENV", () => {
  afterEach(restore);

  it("default é production quando GODOCS_ENV está ausente", () => {
    delete process.env.GODOCS_ENV;
    expect(getGodocsEnv()).toBe("production");
    expect(isStaging()).toBe(false);
  });

  it("reconhece staging ignorando caixa e espaços", () => {
    process.env.GODOCS_ENV = "  Staging ";
    expect(getGodocsEnv()).toBe("staging");
    expect(isStaging()).toBe(true);
  });

  it("qualquer outro valor cai em production (fail-safe)", () => {
    process.env.GODOCS_ENV = "prod";
    expect(getGodocsEnv()).toBe("production");
  });
});

describe("assertNaoEhDefaultDeProd", () => {
  afterEach(restore);

  it("em produção é no-op, mesmo resolvendo para o ID default de prod", () => {
    delete process.env.GODOCS_ENV;
    expect(() => assertNaoEhDefaultDeProd("ID_PROD", "ID_PROD", "Sheet")).not.toThrow();
  });

  it("em staging LANÇA quando o ID resolvido é o default de prod (env faltando)", () => {
    process.env.GODOCS_ENV = "staging";
    expect(() => assertNaoEhDefaultDeProd("ID_PROD", "ID_PROD", "Sheet")).toThrow(/STAGING/);
  });

  it("em staging NÃO lança quando há um override diferente do default de prod", () => {
    process.env.GODOCS_ENV = "staging";
    expect(() => assertNaoEhDefaultDeProd("ID_STAGING", "ID_PROD", "Sheet")).not.toThrow();
  });
});

// ─── Terceiro ambiente: GODOCS_ENV=v2-staging (T1 do plano godocs-v2) ────────
//
// O v2 é um ambiente de TESTE próprio, distinto da staging atual: precisamos
// saber QUAL dos dois estamos, mas nenhum dos dois pode ser tratado como
// produção (nem no guard dos recursos do Google, nem no namespace do Pinecone).

describe("env — GODOCS_ENV=v2-staging", () => {
  afterEach(restore);

  it("reconhece v2-staging como ambiente PRÓPRIO (nem staging, nem production)", () => {
    process.env.GODOCS_ENV = "v2-staging";
    expect(getGodocsEnv()).toBe("v2-staging");
    expect(getGodocsEnv()).not.toBe("staging");
    expect(getGodocsEnv()).not.toBe("production");
  });

  it("reconhece v2-staging ignorando caixa e espaços (como o staging já é)", () => {
    process.env.GODOCS_ENV = "  V2-Staging ";
    expect(getGodocsEnv()).toBe("v2-staging");
  });

  it("isStaging() é TRUE em v2-staging — o ambiente v2 nunca é produção", () => {
    process.env.GODOCS_ENV = "v2-staging";
    expect(isStaging()).toBe(true);
  });

  it("valor desconhecido vizinho ('v2') continua caindo em production (fail-safe)", () => {
    process.env.GODOCS_ENV = "v2";
    expect(getGodocsEnv()).toBe("production");
    expect(isStaging()).toBe(false);
  });

  it("string vazia continua caindo em production (fail-safe)", () => {
    process.env.GODOCS_ENV = "";
    expect(getGodocsEnv()).toBe("production");
    expect(isStaging()).toBe(false);
  });
});

describe("assertNaoEhDefaultDeProd — v2-staging", () => {
  afterEach(restore);

  it("em v2-staging LANÇA quando o ID resolvido é o default de prod (env faltando)", () => {
    process.env.GODOCS_ENV = "v2-staging";
    expect(() => assertNaoEhDefaultDeProd("ID_PROD", "ID_PROD", "Sheet")).toThrow(/STAGING/);
  });

  it("em v2-staging NÃO lança quando há override diferente do default de prod", () => {
    process.env.GODOCS_ENV = "v2-staging";
    expect(() => assertNaoEhDefaultDeProd("ID_V2", "ID_PROD", "Sheet")).not.toThrow();
  });
});

describe("namespacePinecone — v2-staging não contamina o índice de produção", () => {
  afterEach(restore);

  it("em v2-staging o namespace NÃO é 'prod'", () => {
    process.env.GODOCS_ENV = "v2-staging";
    expect(namespacePinecone()).not.toBe("prod");
  });

  it("os namespaces de hoje continuam: ausente → prod, staging → staging", () => {
    delete process.env.GODOCS_ENV;
    expect(namespacePinecone()).toBe("prod");
    process.env.GODOCS_ENV = "staging";
    expect(namespacePinecone()).toBe("staging");
  });

  it("v2-staging tem namespace PRÓPRIO, distinto do da staging atual", () => {
    process.env.GODOCS_ENV = "v2-staging";
    const nsV2 = namespacePinecone();
    process.env.GODOCS_ENV = "staging";
    expect(nsV2).not.toBe(namespacePinecone());
  });
});

// O rótulo que VIAJA para fora (DM do Gomoon, ingest do rollup do Gabriel).
// É o campo que decide se uma DM cai num líder REAL — o `CLAUDE.md` o declara
// como a ÚNICA proteção do lado do Gomoon. Fonte única para os 2 consumidores.
describe("rotuloAmbienteExterno — o v2 nunca se anuncia como produção", () => {
  afterEach(restore);

  it('em v2-staging o rótulo é "staging", NUNCA "producao"', () => {
    process.env.GODOCS_ENV = "v2-staging";
    expect(rotuloAmbienteExterno()).toBe("staging");
    expect(rotuloAmbienteExterno()).not.toBe("producao");
  });

  it("os 2 ambientes de hoje continuam: staging → staging, ausente → producao", () => {
    process.env.GODOCS_ENV = "staging";
    expect(rotuloAmbienteExterno()).toBe("staging");
    delete process.env.GODOCS_ENV;
    expect(rotuloAmbienteExterno()).toBe("producao");
  });
});
