// Executa trabalho fire-and-forget sem perder a entrega no runtime do worker.
//
// No Godeploy (estilo Cloudflare Worker), uma promise iniciada e NÃO aguardada
// é cancelada quando a Response retorna — o isolate é recuperado e qualquer I/O
// pendente (ex.: sync para Google Sheets/Chat) morre no meio. O jeito correto é
// registrar a promise no `ctx.waitUntil()`, que mantém o isolate vivo até ela
// terminar. O worker expõe esse waitUntil em `globalThis.__waitUntil`.
//
// Em dev (better-sqlite3, sem worker) o shim não existe — a promise só roda
// solta mesmo, o que é suficiente fora de produção.

type WaitUntil = (p: Promise<unknown>) => void;

export function runBackground(p: Promise<unknown>): void {
  const safe = Promise.resolve(p).catch((e) =>
    console.error('[background] tarefa em segundo plano falhou:', e),
  );
  const wu = (globalThis as unknown as { __waitUntil?: WaitUntil }).__waitUntil;
  if (wu) wu(safe);
}
