import type { BloqueioSubmissao } from '@/lib/mensagens-submissao'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /**
     * Bloqueio de submissão ESTRUTURADO (veredito + por que + caminhos de correção), quando o
     * servidor manda um. A tela o renderiza no painel `AvisoBloqueio` — o `message` plano é só
     * o fallback. Ver `src/lib/mensagens-submissao.ts`.
     */
    public readonly bloqueio?: BloqueioSubmissao,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Backend de DEMONSTRAÇÃO (sandbox admin `/fluxos`). Quando definido, TODA chamada de
 * `apiFetch` é atendida por ele em vez da rede — sem tocar servidor, banco ou planilha.
 * Serve para percorrer o formulário REAL de submissão (normal/especial/liderança) com
 * loading de botão de verdade e nada persistido. É `null` em produção normal (o guard é
 * um early-return; o caminho de rede fica idêntico). O handler pode lançar `ApiError`
 * para simular um bloqueio de preenchimento. Ver `src/lib/fluxos/demo-backend.ts`.
 */
export type DemoBackend = (path: string, body: unknown, method: string) => Promise<unknown>
let demoBackend: DemoBackend | null = null
export function setDemoBackend(fn: DemoBackend | null): void {
  demoBackend = fn
}

export async function apiFetch<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const hasBody = body !== undefined
  if (demoBackend) {
    return (await demoBackend(path, body, method ?? (hasBody ? 'POST' : 'GET'))) as T
  }
  const response = await fetch(path, {
    method: method ?? (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  })

  // Lê como texto e tenta JSON. O edge do Godeploy responde com PÁGINA HTML
  // (`<!DOCTYPE …>`) em timeout/5xx/redirect de login — fazer response.json() direto
  // estourava "Unexpected token '<'". Tratamos isso com uma mensagem clara.
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(response.status, 'Sua sessão expirou. Recarregue a página e entre novamente.')
    }
    if (response.status >= 500 || response.status === 0) {
      throw new ApiError(
        response.status,
        'O servidor demorou ou falhou ao responder. Aguarde alguns segundos e tente novamente.',
      )
    }
    throw new ApiError(response.status, `Resposta inválida do servidor (HTTP ${response.status}). Tente novamente.`)
  }

  if (!response.ok) {
    const corpo = data as { error?: string; bloqueio?: BloqueioSubmissao } | null
    const msg = corpo?.error ?? 'Erro desconhecido'
    throw new ApiError(response.status, msg, corpo?.bloqueio)
  }

  return data as T
}
