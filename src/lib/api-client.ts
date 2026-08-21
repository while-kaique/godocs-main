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

export async function apiFetch<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const hasBody = body !== undefined
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

/**
 * Variante de apiFetch para as rotas de chat que PODEM streamar (SSE). Chama `onDelta` com
 * cada pedaço de PROSA à medida que chega e devolve o ENVELOPE final — o OrchestratorResult
 * já passado pelos gates do backend, canônico. Transparente ao transporte: se o servidor
 * responder `application/json` (streaming desligado, ou o edge devolveu HTML de erro), lê o
 * corpo de uma vez como envelope — então o cliente NÃO precisa saber se a flag está ligada.
 */
export async function apiStream<T>(
  path: string,
  body: unknown,
  opts?: { onDelta?: (chunk: string) => void },
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const ct = response.headers.get('content-type') ?? ''
  if (!ct.includes('text/event-stream') || !response.body) {
    // Transporte json (flag desligada / HTML de erro do edge): mesma semântica do apiFetch.
    const text = await response.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      if (response.status === 401 || response.status === 403)
        throw new ApiError(response.status, 'Sua sessão expirou. Recarregue a página e entre novamente.')
      if (response.status >= 500 || response.status === 0)
        throw new ApiError(
          response.status,
          'O servidor demorou ou falhou ao responder. Aguarde alguns segundos e tente novamente.',
        )
      throw new ApiError(response.status, `Resposta inválida do servidor (HTTP ${response.status}). Tente novamente.`)
    }
    if (!response.ok) {
      const corpo = data as { error?: string; bloqueio?: BloqueioSubmissao } | null
      throw new ApiError(response.status, corpo?.error ?? 'Erro desconhecido', corpo?.bloqueio)
    }
    return data as T
  }

  // Transporte SSE: eventos "data: {...}\n\n". `delta` = prosa incremental; `envelope` =
  // resultado final canônico; `error` = falha (reconstrói o ApiError com status/bloqueio).
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let envelope: T | null = null
  let envelopeRecebido = false

  const consumir = (evento: string) => {
    for (const line of evento.split('\n')) {
      const trimmed = line.trimStart()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      let msg: { t?: string; c?: string; r?: T; m?: string; status?: number; bloqueio?: BloqueioSubmissao }
      try {
        msg = JSON.parse(payload)
      } catch {
        continue
      }
      if (msg.t === 'delta' && typeof msg.c === 'string') {
        opts?.onDelta?.(msg.c)
      } else if (msg.t === 'envelope') {
        envelope = (msg.r ?? null) as T | null
        envelopeRecebido = true
      } else if (msg.t === 'error') {
        throw new ApiError(msg.status ?? 500, msg.m ?? 'Erro desconhecido', msg.bloqueio)
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const evento = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      consumir(evento)
      idx = buffer.indexOf('\n\n')
    }
  }
  if (buffer.trim()) consumir(buffer)

  if (!envelopeRecebido || envelope === null) {
    throw new ApiError(500, 'O servidor encerrou a resposta sem concluir. Tente novamente.')
  }
  return envelope
}
