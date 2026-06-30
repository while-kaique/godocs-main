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

export type GodocsEnv = 'production' | 'staging'

/** Lê `GODOCS_ENV`. Default `'production'` (qualquer valor != 'staging'). */
export function getGodocsEnv(): GodocsEnv {
  const raw = (process.env.GODOCS_ENV || '').trim().toLowerCase()
  return raw === 'staging' ? 'staging' : 'production'
}

export function isStaging(): boolean {
  return getGodocsEnv() === 'staging'
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
