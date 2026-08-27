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

/**
 * Funde a doc compilada no conteúdo atual PRESERVANDO o financeiro (`saving`/`receita`) e
 * removendo as chaves de pendência. Os campos compilados vencem os antigos. O sinal
 * `tem_ia_como_funcionalidade` vem do `coletado` (se presente), senão do `atual`, senão null.
 * Aceita `atual` null/undefined (funde sobre {}).
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
    ...docCompilada, // campos compilados vencem (a doc compilada não traz saving/receita)
    tem_ia_como_funcionalidade:
      coletado.tem_ia_como_funcionalidade ??
      (resto as { tem_ia_como_funcionalidade?: unknown }).tem_ia_como_funcionalidade ??
      null,
  };
}
