// Detecção de "versão desatualizada" (version skew) — puro, sem React/DOM no topo.
//
// Contexto: o GoDeploy ACUMULA os assets a cada deploy (chunks antigos nunca são
// removidos), então uma aba aberta há horas continua carregando os próprios chunks
// e conversa com o worker NOVO sem nunca dar 404. Ou seja: o cliente velho nunca
// "quebra" e nunca é forçado a atualizar. Detectamos o skew comparando o entry
// (`<script type="module" src="/assets/index-<hash>.js">`) que ESTE cliente está
// rodando com o entry do `/index.html` atual servido pela borda. Hash diferente =
// existe build novo publicado → oferecemos recarregar (nunca recarrega sozinho).
//
// O `index.html` é a fonte canônica do build atual: muda exatamente quando o código
// do cliente muda. Em dev (Vite serve /src/main.tsx, sem hash) o entry não casa o
// padrão → tudo vira no-op e a faixa nunca aparece.

/**
 * Extrai o `src` do <script type="module"> (o entry do SPA) de um HTML.
 * Tolera as duas ordens de atributo (type antes/depois de src). Ignora os
 * <link rel="modulepreload"> (são <link>, não <script>). Retorna null se não achar.
 */
export function extractEntrySrc(html: string): string | null {
  if (!html) return null;
  const m =
    html.match(/<script[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i) ??
    html.match(/<script[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i);
  return m ? m[1] : null;
}

/**
 * Decide se há atualização disponível comparando o entry em execução com o entry
 * do HTML remoto recém-buscado. Conservador: se qualquer um dos lados não for
 * identificável (ex.: dev, HTML de erro/edge), retorna false — nunca cutuca à toa.
 */
export function isUpdateAvailable(currentEntrySrc: string | null, remoteHtml: string): boolean {
  if (!currentEntrySrc) return false;
  const remote = extractEntrySrc(remoteHtml);
  if (!remote) return false;
  return remote !== currentEntrySrc;
}

/**
 * Lê o entry que ESTE cliente está rodando, direto do DOM. Fora do browser (SSR/
 * testes) ou sem o script hasheado (dev) → null. Injetável p/ teste.
 */
export function getCurrentEntrySrc(doc?: Document): string | null {
  const d = doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!d) return null;
  const el = d.querySelector('script[type="module"][src]');
  const src = el?.getAttribute("src") ?? null;
  // Só consideramos um entry hasheado de build (assets/…-<hash>.js). Em dev o src
  // é /src/main.tsx (ou /@vite/…) → ignora, pra faixa nunca aparecer localmente.
  if (!src || !/\/assets\/.+\.js(\?|$)/.test(src)) return null;
  return src;
}
