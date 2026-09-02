// Ambiente do GoDocs (produção × staging).
//
// O bundle do SPA e o worker.js são IDÊNTICOS nos dois apps Godeploy
// (`godocs` prod × `godocs-staging`). O ÚNICO discriminador é a variável de
// ambiente `GODOCS_ENV`, setada só no app de staging. Tudo aqui deriva dela.
//
// ⚠️ `process` NÃO existe em escopo de módulo no runtime do Godeploy — sempre
// ler `process.env` DENTRO de função (ver CLAUDE.md). Usamos o `process` GLOBAL
// (sem `import 'node:process'`), igual a sheets.ts/drive.ts — o bundle do worker
// (esbuild, plataforma worker) não resolve o import `node:*`.

export type GodocsEnv = 'production' | 'staging' | 'v2-staging'

/** Ambientes de TESTE — nenhum deles pode ser tratado como produção. */
const AMBIENTES_DE_TESTE = new Set<GodocsEnv>(['staging', 'v2-staging'])

/**
 * Lê `GODOCS_ENV`. Default `'production'` (qualquer valor desconhecido).
 *
 * `'v2-staging'` é o ambiente da frente do GoDocs v2 (app próprio, aba
 * `STAGING-V2`), DISTINTO da staging da v1 — precisamos saber qual dos dois é.
 * ⚠️ Valor desconhecido cai em `'production'` de propósito (fail-safe do
 * parser), mas o cuidado é o oposto nos CONSUMIDORES: quem decide "isto é
 * produção?" deve perguntar `isStaging()`, nunca comparar com a string
 * `'staging'` — a comparação direta trata o v2 como PRODUÇÃO.
 */
export function getGodocsEnv(): GodocsEnv {
  const raw = (process.env.GODOCS_ENV || '').trim().toLowerCase()
  if (raw === 'staging') return 'staging'
  if (raw === 'v2-staging') return 'v2-staging'
  return 'production'
}

/** `true` em QUALQUER ambiente de teste (staging da v1 ou v2). */
export function isStaging(): boolean {
  return AMBIENTES_DE_TESTE.has(getGodocsEnv())
}

/**
 * Guard "staging nunca usa default de produção".
 *
 * Os recursos do Google (Sheet, pasta do Drive) têm um ID DEFAULT hardcoded
 * que aponta para PRODUÇÃO — usado quando a env correspondente não está setada.
 * Em produção isso é o comportamento correto. Em STAGING, cair no default
 * significaria escrever no Sheet/Drive REAIS — exatamente o que a staging não
 * pode fazer. Então: se estamos em staging E o ID resolvido é o default de
 * prod (env faltando), aborta com erro claro em vez de vazar para produção.
 *
 * Em produção é no-op (caminho idêntico ao de hoje).
 */
export function assertNaoEhDefaultDeProd(
  idResolvido: string,
  idPadraoProd: string,
  rotulo: string,
): void {
  if (isStaging() && idResolvido === idPadraoProd) {
    throw new Error(
      `[STAGING] ${rotulo}: variável de ambiente não configurada — recusando ` +
        `usar o recurso de PRODUÇÃO (${idPadraoProd}). Configure o override de ` +
        `staging correspondente antes de subir o app.`,
    )
  }
}

/**
 * Rótulo do ambiente mandado a sistema EXTERNO (a DM do Gomoon, o ingest do
 * rollup do squad Intelli). FONTE ÚNICA — estava digitado igual nos dois.
 *
 * ⚠️ Derivar de `isStaging()`, nunca de `getGodocsEnv() === 'staging'`: com a
 * comparação literal o ambiente v2 se anunciava como **produção**, e é esse
 * campo que faz a DM cair num líder REAL e o rollup escrever na série de prod.
 */
export function rotuloAmbienteExterno(): 'producao' | 'staging' {
  return isStaging() ? 'staging' : 'producao'
}
