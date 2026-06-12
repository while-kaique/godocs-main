// Wrapper de apiFetch que intercepta e loga todas as chamadas para o API Inspector.

import { apiFetch, ApiError } from '@/lib/api-client';

export type ApiLogEntry = {
  id: string;
  timestamp: number;
  method: 'GET' | 'POST';
  url: string;
  requestBody: unknown | null;
  responseBody: unknown | null;
  status: number | null;
  duration: number;
  error: string | null;
};

export type TestApiFetchOptions = {
  forceError: boolean;
  slowMode: boolean;
  onLog: (entry: ApiLogEntry) => void;
};

export function createTestApiFetch(options: TestApiFetchOptions) {
  return async function testApiFetch<T>(path: string, body?: unknown): Promise<T> {
    const id = crypto.randomUUID();
    const start = performance.now();
    const method: 'GET' | 'POST' = body !== undefined ? 'POST' : 'GET';

    const entry: ApiLogEntry = {
      id,
      timestamp: Date.now(),
      method,
      url: path,
      requestBody: body ?? null,
      responseBody: null,
      status: null,
      duration: 0,
      error: null,
    };

    if (options.slowMode) {
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (options.forceError) {
      entry.duration = Math.round(performance.now() - start);
      entry.status = 500;
      entry.error = 'Erro forçado (modo teste)';
      entry.responseBody = { error: 'Erro forçado (modo teste)' };
      options.onLog(entry);
      throw new ApiError(500, 'Erro forçado (modo teste)');
    }

    try {
      const result = await apiFetch<T>(path, body);
      entry.duration = Math.round(performance.now() - start);
      entry.status = 200;
      entry.responseBody = result;
      options.onLog(entry);
      return result;
    } catch (err) {
      entry.duration = Math.round(performance.now() - start);
      if (err instanceof ApiError) {
        entry.status = err.status;
        entry.error = err.message;
        entry.responseBody = { error: err.message };
      } else {
        entry.status = 0;
        entry.error = err instanceof Error ? err.message : String(err);
      }
      options.onLog(entry);
      throw err;
    }
  };
}
