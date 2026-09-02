// Expiração do token da TeamGuide (JWT de 90 dias) — puro, sem I/O.
//
// O `TG_API_TOKEN` é um JWT com validade curta: quando ele expira, a integração cai
// (o incidente 01–02/09/2026 derrubou a submissão de líderes). Aqui só LEMOS o `exp`
// do payload para avisar ANTES de expirar (~14 dias) — NÃO verificamos a assinatura
// (não temos a chave; e a intenção é só ler a data, não autenticar).

/**
 * Dias inteiros restantes até o token expirar, ou `null` se ilegível.
 *
 * Decodifica só o 2º segmento do JWT (base64url do payload), lê `exp` (epoch em
 * SEGUNDOS) e devolve `floor((exp*1000 - agora) / 1 dia)`. Token expirado → número
 * NEGATIVO (o chamador decide o limiar). `null` para: token ausente/não-string, sem os
 * 2 pontos do JWT, base64 quebrada, JSON inválido ou `exp` ausente/não-numérico.
 */
export function diasParaExpirarTokenTG(token?: string | null): number | null {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length < 2 || !partes[1]) return null;
  try {
    let b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    // `atob` existe no runtime do Godeploy (Cloudflare) e no Node dos testes; o payload de
    // um JWT é ASCII, então Latin-1 basta.
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (globalThis as any).Buffer?.from(b64, 'base64').toString('binary');
    if (!json) return null;
    const payload = JSON.parse(json) as { exp?: unknown };
    const exp = payload?.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
    const restanteMs = exp * 1000 - Date.now();
    return Math.floor(restanteMs / (24 * 60 * 60 * 1000));
  } catch {
    return null;
  }
}
