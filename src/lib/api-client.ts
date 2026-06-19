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

  const data = await response.json()

  if (!response.ok) {
    const msg = (data as { error?: string }).error ?? 'Erro desconhecido'
    throw new ApiError(response.status, msg)
  }

  return data as T
}
