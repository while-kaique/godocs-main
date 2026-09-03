import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * GUARDA DE REGRESSÃO do hotfix de streaming (24/08/2026).
 *
 * Rota que responde `text/event-stream` (com `LLM_STREAMING` ON) chamada via `apiFetch`
 * — que faz `JSON.parse` do corpo inteiro — estoura "Resposta inválida do servidor
 * (HTTP 200)". Foi o bug que chegou em prod porque só `enviar-mensagem` havia migrado
 * para `apiStream`. Quem chama rota SSE tem de usar `apiStream`, que trata SSE E JSON e
 * portanto cobre a flag ligada e desligada.
 *
 * ⚠️ ESCOPO REDUZIDO na v2, e o motivo é o que importa: eram QUATRO rotas de conversa
 * chamadas por esta tela (`iniciar-submissao` · `enviar-mensagem` · `iniciar-saving` ·
 * `iniciar-receita`). Com o agente fora do caminho do usuário (D4), as três últimas
 * deixaram de ser chamadas pelo formulário — não há conversa, não há formulário de
 * saving/receita conduzido pelo agente. Sobrou `iniciar-submissao`, que é como a
 * documentação em BACKGROUND (D6) é disparada, e essa segue respondendo SSE.
 *
 * Não é o guard afrouxando: ele continua exigindo `apiStream` em toda ocorrência de rota
 * SSE neste arquivo. O que mudou é que 3 dos 4 sujeitos saíram do arquivo. Se alguma
 * delas voltar a ser chamada daqui, ela entra em `ROTAS_SSE` no mesmo commit.
 *
 * ⚠️ O painel admin de simulação (`src/lib/testes/chat-simulation.tsx`) chama as 3 rotas
 * antigas, mas por um helper próprio (não `apiFetch`/`apiStream`) — a régua nunca valeu
 * lá, e ele sai junto com o orquestrador na limpeza.
 */
const SRC = readFileSync(
  fileURLToPath(new URL("../src/routes/submeter.tsx", import.meta.url)),
  "utf8",
);

const ROTAS_SSE = ["iniciar-submissao"];

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

  it("a rota que sobrou aparece com apiStream, não só sem apiFetch", () => {
    // Sanidade extra: garante que a correção está lá de fato, e não que a rota
    // simplesmente desapareceu do arquivo.
    const re = /apiStream[\s\S]{0,200}?"\/api\/chat\/iniciar-submissao"/;
    expect(re.test(SRC), "esperava apiStream(...) para iniciar-submissao").toBe(true);
  });

  it("o formulário NÃO voltou a conversar com o agente", () => {
    // A contrapartida do escopo reduzido: se alguém religar o chat na tela do usuário,
    // este caso falha e obriga a decisão a ser explícita (D4 — o agente saiu do caminho).
    for (const rota of ["enviar-mensagem", "iniciar-saving", "iniciar-receita"]) {
      expect(
        SRC.includes(`"/api/chat/${rota}"`),
        `${rota} voltou a ser chamada pelo formulário — o agente saiu do caminho do usuário (D4)`,
      ).toBe(false);
    }
  });
});
