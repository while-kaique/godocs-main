import { describe, it, expect, afterEach } from "vitest";
import { getGodocsEnv, isStaging, assertNaoEhDefaultDeProd } from "@/lib/env";

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
