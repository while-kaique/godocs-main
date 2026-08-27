// Compilação ASSÍNCRONA da documentação — tira os ~88s de `compilarDocumentacao` do
// caminho crítico da submissão. Funções PURAS (sem I/O) + a flag opt-in; o wiring
// (runBackground no turno de aprovação + reconciliação no submit) vive em chat.functions.ts.
//
// Achado que destrava tudo: a fase saving/receita consome só `coletado`
// (buildDetalhesAprovados) — NÃO a doc compilada. `documentacao.conteudo` só é preciso no
// submit (Drive/analisador). Então, com a flag ligada, a aprovação grava um PLACEHOLDER e
// dispara a compilação em segundo plano; o submit RECONCILIA (compila síncrono se ainda
// pendente) preservando o financeiro. Default: flag OFF = síncrono de hoje.
//
// ⚠️ NUNCA ler `process.env` em escopo de módulo — só dentro da função (Godeploy).

import type { DocumentacaoColetada } from "@/lib/agents/types";

/** Flag opt-in: só liga com "1"/"true" (case-insensitive). Ausente/outro → false (síncrono). */
export function docCompilacaoAssincronaAtiva(): boolean {
  const v = (process.env.DOC_COMPILE_ASYNC ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Conteúdo PLACEHOLDER gravado na aprovação da doc quando a compilação vai para background.
 * Carrega a flag de pendência, um snapshot do `coletado` (para o submit recompilar sem o
 * estado do chat) e o sinal `tem_ia_como_funcionalidade` (o analisador o lê pós-submit).
 */
export function placeholderDocPendente(coletado: DocumentacaoColetada): Record<string, unknown> {
  return {
    compilacao_pendente: true,
    coletado_pendente: coletado,
    tem_ia_como_funcionalidade: coletado.tem_ia_como_funcionalidade ?? null,
  };
}

/** true só quando a doc ainda está marcada como pendente de compilação (flag estritamente true). */
export function precisaCompilarDoc(conteudo: Record<string, unknown> | null | undefined): boolean {
  return conteudo?.compilacao_pendente === true;
}

/** Recupera o `coletado` snapshotado no placeholder; null quando ausente/inválido. */
export function coletadoDePendente(
  conteudo: Record<string, unknown> | null | undefined,
): DocumentacaoColetada | null {
  const c = conteudo?.coletado_pendente;
  if (c && typeof c === "object") return c as DocumentacaoColetada;
  return null;
}

// Chaves que a doc COMPILADA (output do LLM) NUNCA pode contribuir ao blob: o financeiro
// (`saving`/`receita`) é autoritativo (turno `completo` + `recomputarSavingFinanceiro`) e as
// flags de controle são nossas. Um `saving`/`receita` alucinado pelo LLM não pode contaminar
// o financeiro real — no fluxo assíncrono a doc pode aterrissar DEPOIS do `completo`, sem
// self-heal, então blindar na fonte é a defesa. Ver §9.B.
const CHAVES_PROTEGIDAS_DOC = [
  "saving",
  "receita",
  "compilacao_pendente",
  "coletado_pendente",
] as const;

/** Remove da doc compilada as chaves protegidas (financeiro/controle) — nunca vão ao blob por essa via. */
export function soCamposDaDoc(docCompilada: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = { ...docCompilada };
  for (const k of CHAVES_PROTEGIDAS_DOC) delete limpo[k];
  return limpo;
}

/**
 * Funde a doc compilada no conteúdo atual PRESERVANDO o financeiro (`saving`/`receita`) e
 * removendo as chaves de pendência. Os campos compilados vencem os antigos. O sinal
 * `tem_ia_como_funcionalidade` vem do `coletado` (se presente), senão do `atual`, senão null.
 * ⚠️ A doc compilada é filtrada por `soCamposDaDoc` — um `saving`/`receita` alucinado pelo LLM
 * NÃO sobrescreve o financeiro real. Aceita `atual` null/undefined (funde sobre {}).
 */
export function mergeDocCompilada(
  atual: Record<string, unknown> | null | undefined,
  docCompilada: Record<string, unknown>,
  coletado: DocumentacaoColetada,
): Record<string, unknown> {
  const resto: Record<string, unknown> = { ...(atual ?? {}) };
  delete resto.compilacao_pendente;
  delete resto.coletado_pendente;

  return {
    ...resto, // preserva saving/receita e o que houver
    ...soCamposDaDoc(docCompilada), // campos compilados vencem, MENOS o financeiro/controle
    tem_ia_como_funcionalidade:
      coletado.tem_ia_como_funcionalidade ??
      (resto as { tem_ia_como_funcionalidade?: unknown }).tem_ia_como_funcionalidade ??
      null,
  };
}
