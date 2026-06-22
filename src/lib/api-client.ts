export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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
    const msg = (data as { error?: string } | null)?.error ?? 'Erro desconhecido'
    throw new ApiError(response.status, msg)
  }

  return data as T
}
