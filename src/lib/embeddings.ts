/**
 * Camada de EMBEDDINGS — a memória vetorial do agente classificador de especiais.
 *
 * ⚠️ **Vai SEMPRE direto na OpenAI, NUNCA no proxy.** O gateway GoGroup (`LLM_BASE_URL`) é uma
 * subscription do Codex e **não expõe `/embeddings`** (probe 25/08/2026 → `404 not_found`). Só o
 * chat passa por ele; o embedding usa `api.openai.com` com uma chave direta.
 *
 * Chave: `LLM_EMBEDDINGS_KEY` se existir, senão `LLM_FALLBACK` (já está nos secrets do Godeploy
 * como chave OpenAI direta, usada pelo fallback do `llm.ts`). Sem nenhuma das duas, a função
 * devolve `null` — o classificador degrada para recuperação sem vizinhos, nunca quebra.
 *
 * Modelo: `text-embedding-3-large` (3072 dims) por padrão — o `-small` (1536) diluía siblings de
 * função em áreas diferentes (caso GoPrice × Agente precificador, 25/08/2026); o `-large` separa
 * melhor o sinal distintivo. Override por `LLM_EMBEDDINGS_MODEL`. ⚠️ Trocar o modelo muda a
 * dimensão — vetores de dims diferentes têm cosseno 0 (ver `cosseno`), então durante a transição
 * os vetores antigos ficam invisíveis até o reembedding (o backfill `forcar` regrava tudo; e
 * `garantirEmbeddings` já considera vetor de modelo diferente como "velho").
 *
 * ⚠️ Envs lidas LAZY (dentro de função). `process` não existe na avaliação do módulo no Godeploy
 * (regra do CLAUDE.md) — nada de `const X = process.env...` no topo.
 */

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const MODELO_PADRAO = 'text-embedding-3-large';

export type EmbeddingConfig = {
  apiKey: string;
  modelo: string;
};

/** Lê a config LAZY. `null` quando não há chave direta configurada. */
export function embeddingConfig(): EmbeddingConfig | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const apiKey = env?.LLM_EMBEDDINGS_KEY || env?.LLM_FALLBACK || '';
  if (!apiKey) return null;
  return { apiKey, modelo: env?.LLM_EMBEDDINGS_MODEL || MODELO_PADRAO };
}

export type Embedding = {
  vetor: number[];
  modelo: string;
  dim: number;
};

/**
 * Gera o embedding de UM texto. Nunca lança: em qualquer falha (sem chave, rede, cota) loga e
 * devolve `null`, e quem chama segue sem vizinho vetorial.
 */
export async function gerarEmbedding(texto: string): Promise<Embedding | null> {
  const cfg = embeddingConfig();
  if (!cfg) {
    console.warn('[embeddings] sem LLM_EMBEDDINGS_KEY/LLM_FALLBACK — seguindo sem memória vetorial');
    return null;
  }
  const [emb] = await gerarEmbeddingsLote([texto], cfg);
  return emb ?? null;
}

/**
 * Gera embeddings de VÁRIOS textos numa chamada (a OpenAI aceita `input` como array). Devolve o
 * array ALINHADO à entrada; em falha do lote inteiro devolve `null` em cada posição.
 *
 * Recorta cada texto num teto de caracteres — para agrupar por escopo não é preciso o memorial
 * inteiro, e textos longos só encarecem sem melhorar a vizinhança.
 */
export async function gerarEmbeddingsLote(
  textos: string[],
  cfgExplicita?: EmbeddingConfig,
): Promise<(Embedding | null)[]> {
  const cfg = cfgExplicita ?? embeddingConfig();
  if (!cfg) return textos.map(() => null);
  if (textos.length === 0) return [];

  const input = textos.map((t) => recortarTexto(t));
  try {
    const resp = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.modelo, input }),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      console.error(`[embeddings] HTTP ${resp.status}: ${corpo.slice(0, 300)}`);
      return textos.map(() => null);
    }
    const json = (await resp.json()) as {
      model?: string;
      data?: { index: number; embedding: number[] }[];
    };
    const modelo = json.model || cfg.modelo;
    const saida: (Embedding | null)[] = textos.map(() => null);
    for (const item of json.data ?? []) {
      const vetor = item.embedding;
      if (Array.isArray(vetor) && vetor.length > 0) {
        saida[item.index] = { vetor, modelo, dim: vetor.length };
      }
    }
    return saida;
  } catch (e) {
    console.error('[embeddings] falha ao gerar lote:', e);
    return textos.map(() => null);
  }
}

/** Teto de caracteres do texto que vai para o embedding (evita gastar à toa em memoriais longos). */
export const TETO_TEXTO_EMBEDDING = 6000;

export function recortarTexto(texto: string): string {
  const limpo = (texto ?? '').trim();
  return limpo.length > TETO_TEXTO_EMBEDDING ? limpo.slice(0, TETO_TEXTO_EMBEDDING) : limpo;
}

// ─── Similaridade ────────────────────────────────────────────────────────────

/**
 * Cosseno entre dois vetores. Vetores de dimensão diferente (modelos diferentes) devolvem 0 —
 * comparar 1536 com 3072 dims não tem sentido, e 0 os afasta da vizinhança em vez de dar erro.
 */
export function cosseno(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ─── (De)serialização compacta ────────────────────────────────────────────────
// Guarda o vetor como base64 de Float32Array (1536 floats → ~8 KB, 4× menor que JSON). O Worker
// não tem Buffer, então usa btoa/atob (mesmo motivo do cursor do drawer de Histórico).

export function vetorParaBase64(vetor: number[]): string {
  const f32 = new Float32Array(vetor);
  const bytes = new Uint8Array(f32.buffer);
  let bin = '';
  // Em blocos para não estourar o stack do String.fromCharCode com argumentos demais.
  const BLOCO = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(bin);
}

export function base64ParaVetor(b64: string): number[] {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return Array.from(new Float32Array(bytes.buffer));
}
