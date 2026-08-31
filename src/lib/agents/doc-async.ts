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
 * Flag opt-in da REORDENAÇÃO do wizard (fatia C): a doc compila em background desde o anexo,
 * o usuário responde saving/receita PRIMEIRO (com todos os gates) e o refino conversacional da
 * doc acontece por ÚLTIMO. Só liga com "1"/"true" (case-insensitive); ausente/outro → false =
 * ordem de hoje (doc → financeiro), byte-idêntico. ⚠️ Lida LAZY (nunca em escopo de módulo).
 * ⚠️ Reorder EXIGE `docCompilacaoAssincronaAtiva` ligado (o financeiro roda antes da doc existir).
 */
export function reorderDocFinal(): boolean {
  const v = (process.env.REORDER_DOC_FINAL ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

// Campos de SUBSTÂNCIA da doc (os que a fase `doc`/refino coleta). `nome_projeto` fica de fora:
// vem sempre do formulário, então não sinaliza "a fase doc rodou".
const CAMPOS_SUBSTANCIA_DOC = [
  "o_que_faz",
  "execucao",
  "dependencias",
  "fluxo",
  "configurar_antes",
  "atencao",
] as const;

/**
 * true quando o `coletado` não tem NENHUM campo de substância preenchido — i.e., a fase `doc`
 * ainda não rodou (só o `nome_projeto` do formulário, que é ignorado). É o gatilho do fallback
 * que relê o `coletado_inicial` do blob quando `extrairEstado` volta vazio (fluxo reordenado).
 */
export function coletadoVazio(c: DocumentacaoColetada): boolean {
  return CAMPOS_SUBSTANCIA_DOC.every((k) => {
    const v = c[k];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}

/**
 * Recupera o `coletado_inicial` durável do blob da doc — a saída do extrator gravada em
 * `iniciarSubmissao` no fluxo reordenado. Diferente de `coletado_pendente`, este SOBREVIVE ao
 * `mergeDocCompilada` (não está na lista de deleção), então segue legível depois que o bg-compile
 * aterrissa. null quando ausente/inválido.
 */
export function coletadoInicialDoBlob(
  conteudo: Record<string, unknown> | null | undefined,
): DocumentacaoColetada | null {
  return lerColetadoDoBlob(conteudo, "coletado_inicial");
}

// Campos do `coletado` que a fase doc/refino coleta e que a compilação consome. Ordem fixa: a
// comparação abaixo é campo a campo, então NÃO depende da ordem de inserção das chaves.
const CAMPOS_COLETADO_DOC = [
  "nome_projeto",
  "o_que_faz",
  "execucao",
  "dependencias",
  "fluxo",
  "configurar_antes",
  "atencao",
  "tem_ia_como_funcionalidade",
] as const;

/**
 * Decide qual `coletado` alimenta o preview financeiro (saving/receita): o do CHAT quando tem
 * substância (fluxo normal, a fase doc rodou), senão o `coletado_inicial` do BLOB (fluxo
 * reordenado, a fase doc só roda no fim). Sem nenhum dos dois com substância, devolve o do chat
 * (não piora). PURO — a leitura do blob fica no chamador. Impede o memorial financeiro em branco.
 */
export function resolverColetadoFinanceiro(
  coletadoDoChat: DocumentacaoColetada,
  coletadoDoBlob: DocumentacaoColetada | null,
): DocumentacaoColetada {
  if (!coletadoVazio(coletadoDoChat)) return coletadoDoChat;
  if (coletadoDoBlob && !coletadoVazio(coletadoDoBlob)) return coletadoDoBlob;
  return coletadoDoChat;
}

/**
 * Igualdade de `coletado` para a doc — campo a campo (estável, independente da ordem das chaves).
 * Usada para decidir se o REFINO mudou algo e a doc precisa recompilar. ⚠️ `JSON.stringify` NÃO
 * serve: `coletadoAntes` (do blob) e `coletadoAgora` (echo do LLM) nascem de caminhos diferentes e
 * podem serializar com chaves em ordem distinta → falso "mudou" → recompilação de ~64s à toa.
 * `null`/`undefined`: só iguais se AMBOS ausentes (um só ausente = mudou → recompila, direção segura).
 */
export function coletadoIgual(
  a: DocumentacaoColetada | null | undefined,
  b: DocumentacaoColetada | null | undefined,
): boolean {
  if (!a || !b) return a == null && b == null;
  return CAMPOS_COLETADO_DOC.every((k) => (a[k] ?? null) === (b[k] ?? null));
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

/** Leitor único de um `coletado` gravado no blob da doc, por CHAVE. null quando ausente/inválido. */
function lerColetadoDoBlob(
  conteudo: Record<string, unknown> | null | undefined,
  chave: string,
): DocumentacaoColetada | null {
  const c = conteudo?.[chave];
  if (c && typeof c === "object") return c as DocumentacaoColetada;
  return null;
}

/** Recupera o `coletado` snapshotado no placeholder; null quando ausente/inválido. */
export function coletadoDePendente(
  conteudo: Record<string, unknown> | null | undefined,
): DocumentacaoColetada | null {
  return lerColetadoDoBlob(conteudo, "coletado_pendente");
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
