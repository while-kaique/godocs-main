import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * GUARDA DE REGRESSÃO do hotfix de streaming (24/08/2026).
 *
 * As 4 rotas de conversa respondem `text/event-stream` quando `LLM_STREAMING` está ON.
 * Chamá-las via `apiFetch` (que faz `JSON.parse` do corpo inteiro) estoura
 * "Resposta inválida do servidor (HTTP 200)" — o bug que chegou em prod porque só
 * `enviar-mensagem` havia migrado para `apiStream`. TODAS as 4 têm de usar `apiStream`
 * (que trata SSE E JSON, cobrindo a flag ON e OFF).
 *
 * Este teste varre o `submeter.tsx` e falha se qualquer uma das 4 rotas SSE for
 * chamada por um `apiFetch(`/`apiFetchComRetry(` em vez de `apiStream(`.
 */
const SRC = readFileSync(
  fileURLToPath(new URL("../src/routes/submeter.tsx", import.meta.url)),
  "utf8",
);

const ROTAS_SSE = [
  "iniciar-submissao",
  "enviar-mensagem",
  "iniciar-saving",
  "iniciar-receita",
];

describe("submeter.tsx — rotas SSE só podem ser chamadas via apiStream", () => {
  for (const rota of ROTAS_SSE) {
    it(`"/api/chat/${rota}" usa apiStream (nunca apiFetch)`, () => {
      const marcador = `"/api/chat/${rota}"`;
      let idx = SRC.indexOf(marcador);
      // A rota TEM de existir no arquivo (pega renomeações/remoções acidentais).
      expect(idx, `rota ${rota} não encontrada em submeter.tsx`).toBeGreaterThan(-1);

      // Cada ocorrência do marcador da rota deve ter `apiStream` como o chamador mais
      // próximo ANTES dela — nunca `apiFetch`/`apiFetchComRetry`.
      while (idx !== -1) {
        const antes = SRC.slice(Math.max(0, idx - 400), idx);
        const posStream = antes.lastIndexOf("apiStream");
        // `apiFetchComRetry` contém `apiFetch`, então lastIndexOf("apiFetch") cobre os dois.
        const posFetch = antes.lastIndexOf("apiFetch");
        expect(
          posStream,
          `"/api/chat/${rota}" (offset ${idx}) está sendo chamada via apiFetch — ` +
            `com LLM_STREAMING ON isso estoura "Resposta inválida do servidor". Use apiStream.`,
        ).toBeGreaterThan(posFetch);
        idx = SRC.indexOf(marcador, idx + 1);
      }
    });
  }

  it("as 3 rotas migradas neste hotfix aparecem com apiStream", () => {
    // Sanidade extra: garante que a correção (e não só a ausência de apiFetch) está lá.
    for (const rota of ["iniciar-submissao", "iniciar-saving", "iniciar-receita"]) {
      const re = new RegExp(`apiStream[\\s\\S]{0,120}?"/api/chat/${rota}"`);
      expect(re.test(SRC), `esperava apiStream(...) para ${rota}`).toBe(true);
    }
  });
});
