/**
 * Cliente Pinecone (REST puro) — o índice vetorial dos especiais.
 *
 * **Pinecone é a plataforma oficial de busca vetorial deste pipeline** (decisão fechada em
 * 26/08/2026, ver `docs/plans/rag-especiais-pinecone-reauditoria.md`). Ele substitui o
 * cosseno-em-JS sobre a tabela INTEIRA como caminho de LEITURA — não porque o cosseno errava,
 * mas porque `getEmbeddingsEspeciais()` carregava o corpus inteiro por classificação e, com
 * 3072 dims (~16 KB por vetor), o teto de **32 MiB de serialização RPC do Godeploy** bate em
 * ~1.900 especiais. É o mesmo teto que já derrubou o `/edicoes` do Investigador.
 *
 * ⚠️ **O SQLite (`especial_embedding`) continua sendo a FONTE DA VERDADE e o FALLBACK**
 * (decisão 6). O Pinecone é índice de leitura: fora do ar, a recuperação cai no cosseno-em-JS e
 * a submissão NUNCA quebra. Nada aqui lança — em qualquer falha devolve `null`/`ok:false` e
 * quem chama degrada.
 *
 * ⚠️ **Namespace por AMBIENTE** (decisão 3): `prod` × `staging`. Dados de staging são simulados
 * e não podem contaminar a recuperação nem a re-auditoria de produção. Derivado do `GODOCS_ENV`
 * pelo mesmo `getGodocsEnv()` de todo o resto — não há env própria para isso de propósito
 * (uma env a mais é uma chance a mais de staging escrever em prod).
 *
 * ⚠️ **A dimensão do índice é IMUTÁVEL** no Pinecone. O índice nasce com **3072**
 * (`text-embedding-3-large`, cravado pelo `a1fe406`); trocar o modelo de embedding para um de
 * outra dimensão exige índice NOVO, não um `ALTER`.
 *
 * ⚠️ Envs lidas LAZY, dentro de função — `process` não existe na avaliação do módulo no Godeploy
 * (regra do CLAUDE.md). Só `fetch` (roda no Worker; sem SDK, sem Node).
 */

/** Plano de controle (criar/descrever índice). Fixo — não é por índice. */
const PINECONE_CONTROL_URL = 'https://api.pinecone.io';

/** Versão da API do Pinecone enviada em todo request. Override por `PINECONE_API_VERSION`. */
const API_VERSION_PADRAO = '2025-04';

/** Nome do índice quando `PINECONE_INDEX` não está setada. */
export const INDICE_PADRAO = 'godocs-especiais';

/** Dimensão do índice — `text-embedding-3-large`. IMUTÁVEL depois de criado. */
export const DIMENSAO_INDICE = 3072;

/** Onde o índice serverless nasce. Override por `PINECONE_CLOUD` / `PINECONE_REGION`. */
const CLOUD_PADRAO = 'aws';
const REGION_PADRAO = 'us-east-1';

/**
 * Teto de vetores por upsert. Com 3072 floats o JSON de um vetor passa de 50 KB — o limite de
 * 2 MB por request do Pinecone cai em ~35. 20 deixa folga sem virar dezenas de round-trips.
 */
export const CHUNK_UPSERT = 20;

export type PineconeConfig = {
  apiKey: string;
  indice: string;
  apiVersion: string;
  cloud: string;
  region: string;
};

function envDo(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}

/** Lê a config LAZY. `null` quando não há `PINECONE_API_KEY` — o app degrada para o SQLite. */
export function pineconeConfig(): PineconeConfig | null {
  const env = envDo();
  const apiKey = (env?.PINECONE_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    indice: (env?.PINECONE_INDEX || INDICE_PADRAO).trim(),
    apiVersion: (env?.PINECONE_API_VERSION || API_VERSION_PADRAO).trim(),
    cloud: (env?.PINECONE_CLOUD || CLOUD_PADRAO).trim(),
    region: (env?.PINECONE_REGION || REGION_PADRAO).trim(),
  };
}

/**
 * Namespace do ambiente corrente: `prod` ou `staging` (decisão 3). Deriva do `GODOCS_ENV` —
 * a MESMA env que separa Sheet, Drive e Chat. Não aceita override próprio de propósito.
 */
export function namespacePinecone(): 'prod' | 'staging' {
  const raw = (envDo()?.GODOCS_ENV || '').trim().toLowerCase();
  return raw === 'staging' ? 'staging' : 'prod';
}

function cabecalhos(cfg: PineconeConfig): Record<string, string> {
  return {
    'Api-Key': cfg.apiKey,
    'Content-Type': 'application/json',
    'X-Pinecone-Api-Version': cfg.apiVersion,
  };
}

// ─── Plano de controle: descrever / criar o índice ────────────────────────────

export type DescricaoIndice = {
  nome: string;
  host: string;
  dimensao: number;
  metrica: string;
  pronto: boolean;
};

/**
 * Cache do host do índice POR ISOLATE. O host não muda enquanto o índice existir, e resolvê-lo
 * custa um round-trip ao plano de controle antes de CADA query — no caminho quente da submissão
 * isso dobraria a latência da recuperação à toa.
 */
let hostCache: { indice: string; descricao: DescricaoIndice } | null = null;

/** Esquece o host memorizado (índice recriado, teste, troca de env). */
export function limparCachePinecone(): void {
  hostCache = null;
}

/**
 * Descreve o índice. `null` = sem chave, índice inexistente ou Pinecone fora do ar — os três
 * levam ao mesmo lugar (degradar para o SQLite), e o motivo vai para o log.
 */
export async function descreverIndice(
  opts: { semCache?: boolean } = {},
): Promise<DescricaoIndice | null> {
  const cfg = pineconeConfig();
  if (!cfg) return null;
  if (!opts.semCache && hostCache?.indice === cfg.indice) return hostCache.descricao;
  try {
    const resp = await fetch(`${PINECONE_CONTROL_URL}/indexes/${encodeURIComponent(cfg.indice)}`, {
      method: 'GET',
      headers: cabecalhos(cfg),
    });
    if (resp.status === 404) {
      console.warn(`[pinecone] índice "${cfg.indice}" não existe — rode a rota de setup`);
      return null;
    }
    if (!resp.ok) {
      console.error(`[pinecone] describe HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      return null;
    }
    const json = (await resp.json()) as {
      name?: string;
      host?: string;
      dimension?: number;
      metric?: string;
      status?: { ready?: boolean };
    };
    if (!json.host) return null;
    const descricao: DescricaoIndice = {
      nome: json.name || cfg.indice,
      host: json.host,
      dimensao: json.dimension ?? 0,
      metrica: json.metric || 'cosine',
      pronto: json.status?.ready === true,
    };
    hostCache = { indice: cfg.indice, descricao };
    return descricao;
  } catch (e) {
    console.error('[pinecone] falha ao descrever índice:', e);
    return null;
  }
}

export type ResultadoSetup = {
  ok: boolean;
  criado: boolean;
  indice: string;
  namespace: string;
  descricao?: DescricaoIndice;
  motivo?: string;
};

/**
 * Garante o índice serverless (T1). Idempotente: existindo, só descreve. Só cria quando
 * `criar:true` — criar índice é ação de infraestrutura, não efeito colateral de uma leitura.
 *
 * ⚠️ Índice com dimensão DIFERENTE de `DIMENSAO_INDICE` é reportado como erro em vez de ser
 * usado: consultar 3072 dims num índice de 1536 devolve 400, e silenciar isso daria "sem
 * vizinhos" para sempre, sem ninguém saber por quê.
 */
export async function garantirIndice(opts: { criar?: boolean } = {}): Promise<ResultadoSetup> {
  const cfg = pineconeConfig();
  const namespace = namespacePinecone();
  if (!cfg) {
    return {
      ok: false,
      criado: false,
      indice: INDICE_PADRAO,
      namespace,
      motivo: 'PINECONE_API_KEY não configurada nos secrets',
    };
  }

  const existente = await descreverIndice({ semCache: true });
  if (existente) {
    const dimensaoOk = existente.dimensao === DIMENSAO_INDICE;
    return {
      ok: dimensaoOk,
      criado: false,
      indice: cfg.indice,
      namespace,
      descricao: existente,
      motivo: dimensaoOk
        ? undefined
        : `índice "${cfg.indice}" tem dimensão ${existente.dimensao}, mas o modelo gera ` +
          `${DIMENSAO_INDICE} — a dimensão é IMUTÁVEL, crie um índice novo`,
    };
  }

  if (!opts.criar) {
    return {
      ok: false,
      criado: false,
      indice: cfg.indice,
      namespace,
      motivo: `índice "${cfg.indice}" não existe — reenvie com {"criar":true} para criá-lo`,
    };
  }

  try {
    const resp = await fetch(`${PINECONE_CONTROL_URL}/indexes`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({
        name: cfg.indice,
        dimension: DIMENSAO_INDICE,
        metric: 'cosine',
        spec: { serverless: { cloud: cfg.cloud, region: cfg.region } },
      }),
    });
    if (!resp.ok && resp.status !== 409) {
      return {
        ok: false,
        criado: false,
        indice: cfg.indice,
        namespace,
        motivo: `criação falhou: HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`,
      };
    }
    limparCachePinecone();
    const descricao = await descreverIndice({ semCache: true });
    return {
      ok: descricao != null,
      criado: resp.status !== 409,
      indice: cfg.indice,
      namespace,
      descricao: descricao ?? undefined,
      motivo: descricao
        ? undefined
        : 'índice criado, mas ainda não está pronto — repita a chamada em alguns segundos',
    };
  } catch (e) {
    return {
      ok: false,
      criado: false,
      indice: cfg.indice,
      namespace,
      motivo: e instanceof Error ? e.message : 'erro ao criar índice',
    };
  }
}

// ─── Plano de dados: upsert / query / delete ──────────────────────────────────

/**
 * Metadata de cada vetor (decisão 4). Só escalares — o Pinecone não aceita `null`, e chave com
 * valor nulo é OMITIDA por `limparMetadata`.
 *
 * ⚠️ `tem_nota_humana` é o campo que justifica o índice: é ele que permite filtrar, NO SERVIDOR,
 * os vizinhos com rótulo de gente — o anti-feedback-loop do `rotuloExemplar` (aprender das
 * próprias saídas é como o classificador deriva). A re-auditoria usa esse filtro.
 *
 * ⚠️ A `leitura` (o texto que justifica a nota) NÃO vem para cá de propósito: ela é longa, muda
 * a cada reavaliação e mora no SQLite (`especial_avaliacao`). O Pinecone devolve id + score; o
 * resto é hidratado da fonte da verdade.
 */
export type MetadataEspecial = {
  projeto_id: string;
  tem_nota_humana: boolean;
  estrela_humana?: number | null;
  estrela_recomendada?: number | null;
  area?: string | null;
  texto_hash?: string | null;
  modelo?: string | null;
};

export type VetorParaUpsert = {
  id: string;
  vetor: number[];
  metadata: MetadataEspecial;
};

function limparMetadata(m: MetadataEspecial): Record<string, string | number | boolean> {
  const saida: Record<string, string | number | boolean> = {
    projeto_id: m.projeto_id,
    tem_nota_humana: m.tem_nota_humana,
  };
  if (m.estrela_humana != null) saida.estrela_humana = m.estrela_humana;
  if (m.estrela_recomendada != null) saida.estrela_recomendada = m.estrela_recomendada;
  if (m.area) saida.area = m.area;
  if (m.texto_hash) saida.texto_hash = m.texto_hash;
  if (m.modelo) saida.modelo = m.modelo;
  return saida;
}

export type ResultadoUpsert = {
  ok: boolean;
  enviados: number;
  namespace: string;
  motivo?: string;
};

/** Envia vetores em lotes de `CHUNK_UPSERT`. Nunca lança; para no primeiro lote que falhar. */
export async function upsertVetores(
  vetores: VetorParaUpsert[],
  opts: { namespace?: string } = {},
): Promise<ResultadoUpsert> {
  const namespace = opts.namespace ?? namespacePinecone();
  if (vetores.length === 0) return { ok: true, enviados: 0, namespace };
  const cfg = pineconeConfig();
  const descricao = await descreverIndice();
  if (!cfg || !descricao) {
    return { ok: false, enviados: 0, namespace, motivo: 'Pinecone indisponível (sem chave ou sem índice)' };
  }

  let enviados = 0;
  for (let i = 0; i < vetores.length; i += CHUNK_UPSERT) {
    const lote = vetores.slice(i, i + CHUNK_UPSERT);
    try {
      const resp = await fetch(`https://${descricao.host}/vectors/upsert`, {
        method: 'POST',
        headers: cabecalhos(cfg),
        body: JSON.stringify({
          namespace,
          vectors: lote.map((v) => ({
            id: v.id,
            values: v.vetor,
            metadata: limparMetadata(v.metadata),
          })),
        }),
      });
      if (!resp.ok) {
        return {
          ok: false,
          enviados,
          namespace,
          motivo: `upsert HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
        };
      }
      enviados += lote.length;
    } catch (e) {
      return {
        ok: false,
        enviados,
        namespace,
        motivo: e instanceof Error ? e.message : 'erro no upsert',
      };
    }
  }
  return { ok: true, enviados, namespace };
}

/** Um vizinho como o Pinecone devolve: id + score + metadata. */
export type MatchPinecone = {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
};

/**
 * Consulta os `topK` mais próximos.
 *
 * ⚠️ **`null` (indisponível) é DIFERENTE de `[]` (índice vazio)** — e a diferença é o fallback:
 * `null` manda a recuperação cair no cosseno-em-JS do SQLite; `[]` é uma resposta legítima
 * ("não há vizinho"), e cair no SQLite ali só gastaria RPC para chegar à mesma lista vazia.
 */
export async function consultarVizinhos(
  vetor: number[],
  opts: {
    topK?: number;
    namespace?: string;
    /** Filtro de metadata resolvido NO SERVIDOR — ex.: `{ tem_nota_humana: { $eq: true } }`. */
    filtro?: Record<string, unknown>;
  } = {},
): Promise<MatchPinecone[] | null> {
  const cfg = pineconeConfig();
  if (!cfg || vetor.length === 0) return null;
  const descricao = await descreverIndice();
  if (!descricao) return null;
  const namespace = opts.namespace ?? namespacePinecone();
  try {
    const resp = await fetch(`https://${descricao.host}/query`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({
        namespace,
        vector: vetor,
        topK: opts.topK ?? 10,
        includeMetadata: true,
        includeValues: false,
        ...(opts.filtro ? { filter: opts.filtro } : {}),
      }),
    });
    if (!resp.ok) {
      console.error(`[pinecone] query HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      return null;
    }
    const json = (await resp.json()) as {
      matches?: { id?: string; score?: number; metadata?: Record<string, unknown> }[];
    };
    return (json.matches ?? [])
      .filter((m): m is { id: string; score: number; metadata?: Record<string, unknown> } =>
        typeof m.id === 'string' && typeof m.score === 'number',
      )
      .map((m) => ({ id: m.id, score: m.score, metadata: m.metadata }));
  } catch (e) {
    console.error('[pinecone] falha na query:', e);
    return null;
  }
}

/** Remove vetores do namespace (projeto excluído / reindexação). Nunca lança. */
export async function deletarVetores(
  ids: string[],
  opts: { namespace?: string } = {},
): Promise<{ ok: boolean; removidos: number; motivo?: string }> {
  if (ids.length === 0) return { ok: true, removidos: 0 };
  const cfg = pineconeConfig();
  const descricao = await descreverIndice();
  if (!cfg || !descricao) return { ok: false, removidos: 0, motivo: 'Pinecone indisponível' };
  try {
    const resp = await fetch(`https://${descricao.host}/vectors/delete`, {
      method: 'POST',
      headers: cabecalhos(cfg),
      body: JSON.stringify({ namespace: opts.namespace ?? namespacePinecone(), ids }),
    });
    if (!resp.ok) {
      return {
        ok: false,
        removidos: 0,
        motivo: `delete HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
      };
    }
    return { ok: true, removidos: ids.length };
  } catch (e) {
    return { ok: false, removidos: 0, motivo: e instanceof Error ? e.message : 'erro no delete' };
  }
}
