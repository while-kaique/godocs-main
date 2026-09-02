// ESPELHO da TeamGuide dentro do SQLite (server-only). Molde: `sheet-espelho.ts`.
//
// ## Por que existe
// Antes, TODAS as leituras (cargo, liderança, área, participantes, nome) batiam AO VIVO na
// `api.teamguide.app`, com cache só em memória por isolate. Quando o `TG_API_TOKEN` (JWT de
// 90d) expirou (incidente 01–02/09/2026), não havia snapshot de reserva e a submissão de
// LÍDERES caiu (`ehLideranca` re-lançava o 401). Aqui a árvore/pessoas viram um espelho no
// SQLite; a TeamGuide só é tocada por ESTE sync (fora do caminho quente), e as leituras
// (`teamguide.server.ts`) leem daqui — fail-safe.
//
// ## O que NÃO muda
// A TeamGuide continua fonte da verdade. O espelho é DERIVADO/INTERNO: pode ser apagado e o
// próximo sync o reconstrói; fora de `SAFE_UPDATE_FIELDS`, o sync reverso do Sheets não o toca.
//
// ## Invariante de segurança
// Leitura que FALHA ou vem VAZIA nunca espelha nem apaga (conjunto vazio = suspeito) — o
// snapshot anterior é preservado, e o `catch` dispara um alerta proativo no Chat de Ajuda.

import {
  getTeamguideEspelho,
  upsertTeamguideEspelho,
  insertTeamguideSyncRun,
  getUltimaTeamguideSyncRun,
  getUltimaTeamguideSyncRunOk,
} from '@/integrations/db/client.server';
import {
  normalizarTimes,
  raizesDeCobertura,
  montarPessoas,
  type TGTeam,
  type TGMember,
  type TGEmployeeRef,
  type TGPessoa,
} from '@/lib/areas/teamguide-derivacao';
import { alertarErroIntegracao } from '@/lib/alertas.functions';
import { runBackground } from '@/lib/background';
// Reuso do canônico (o parser 'datetime do SQLite → epoch ms' já existe e é exportado).
import { carimboEspelhoMs } from '@/lib/sheet-espelho';

const BASE = 'https://api.teamguide.app';
// Teto real do `pageSize` da API (pedir 1000 devolve 100).
const PAGE_SIZE = 100;
// Trava de segurança do loop de páginas (com pageSize=100 cobre 2000 pessoas).
const MAX_PAGINAS = 20;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
// Teto por requisição: a `api.teamguide.app` pendurada (TLS travado, lentidão) nunca resolve
// o `fetch`, e sem isto o `.finally()` de `garantirEspelhoTeamGuide` não roda → `syncEmVoo`
// fica preso `true` e a auto-cura morre no isolate. Com o abort, o request vira erro e o
// fluxo fail-safe segue (retry transitório ou catch → alerta).
const TG_FETCH_TIMEOUT_MS = 20_000;

function getToken(): string {
  const token = process.env.TG_API_TOKEN;
  if (!token) throw new Error('TG_API_TOKEN não configurado nas variáveis de ambiente.');
  return token;
}

// GET com RETRY para falhas TRANSITÓRIAS (rede, 429, 5xx). Erros permanentes (401/403/404)
// NÃO são re-tentados. É o ÚNICO ponto de I/O na TeamGuide de todo o app (`teamguide.server`
// não fala mais com a rede).
async function tgGet<T>(path: string, token: string): Promise<T> {
  const MAX = 3;
  for (let attempt = 1; ; attempt++) {
    let r: Response;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TG_FETCH_TIMEOUT_MS);
    try {
      r = await fetch(BASE + path, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
    } catch (netErr) {
      // Erro de rede E abort por timeout caem aqui: são transitórios → retry/backoff.
      if (attempt >= MAX) throw netErr;
      await sleep(250 * attempt);
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (r.ok) return (await r.json()) as T;
    const transitorio = r.status === 429 || r.status >= 500;
    if (transitorio && attempt < MAX) {
      await sleep(250 * attempt);
      continue;
    }
    throw new Error(`TeamGuide GET ${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

/**
 * Membros de um time (recursivo nos descendentes), paginando pelos nomes REAIS do parâmetro
 * (`pageNumber`/`pageSize`). Para por página sem id novo ANTES de olhar o tamanho — o `?page`
 * antigo era ignorado pela API.
 */
async function fetchTeamMembers(teamId: string, token: string): Promise<TGMember[]> {
  const out: TGMember[] = [];
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < MAX_PAGINAS; pageNumber++) {
    const path = `/teams/${teamId}/members?directOnly=false&pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}`;
    const batch = await tgGet<TGMember[]>(path, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    let novos = 0;
    for (const m of batch) {
      const id = String(m.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(m);
      novos++;
    }
    if (novos === 0) break; // página repetida (parâmetro ignorado) ou fim
    if (batch.length < PAGE_SIZE) break; // página parcial = última
  }
  return out;
}

/** Coleta as 2 coleções cruas da TeamGuide (times + pessoas). Pode lançar (I/O). */
async function coletarDaTeamGuide(token: string): Promise<{ times: TGTeam[]; pessoas: TGPessoa[] }> {
  const teamsRaw = await tgGet<TGTeam[]>('/teams', token);
  const refs = await tgGet<TGEmployeeRef[]>('/employees/refs?unpaged=true&page=0', token);

  const ativos = normalizarTimes(teamsRaw).filter((t) => !t.deleted);
  const porId = new Map<string, TGMember>();
  for (const raiz of raizesDeCobertura(ativos)) {
    for (const m of await fetchTeamMembers(raiz.id, token)) {
      const id = String(m.id);
      if (!porId.has(id)) porId.set(id, m);
    }
  }
  const membros = [...porId.values()];

  return { times: normalizarTimes(teamsRaw), pessoas: montarPessoas(refs, membros) };
}

/**
 * Impressão do conteúdo de uma coleção — evita reescrever a linha quando nada mudou. FNV-1a
 * em 2 variantes (~64 bits), não-criptográfico de propósito (mesma escolha do `sheet-espelho`).
 */
function hashDados(json: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

async function gravarColecaoSeMudou(chave: 'times' | 'pessoas', arr: unknown[]): Promise<void> {
  const json = JSON.stringify(arr);
  const hash = hashDados(json);
  const atual = await getTeamguideEspelho(chave);
  if (atual && atual.hash === hash) return; // hash-skip: nada mudou
  await upsertTeamguideEspelho({ chave, dados: json, hash, atualizado_em: Date.now() });
}

export type ResultadoSyncTG = {
  ok: boolean;
  times: number;
  pessoas: number;
  detalhe: string | null;
};

/**
 * Sincroniza o espelho da TeamGuide. É o ÚNICO chamador de `tgGet` no app.
 *
 * ⚠️ NUNCA lança: um erro de sync não pode derrubar o cron nem a auto-cura. Em falha (token
 * ausente, 401/timeout, ou conjunto VAZIO — suspeito) preserva o espelho anterior (não
 * escreve nada), registra a corrida como `ok=0` e dispara um alerta proativo no Chat de Ajuda.
 */
export async function sincronizarTeamGuide(gatilho: string): Promise<ResultadoSyncTG> {
  const inicio = Date.now();
  try {
    const token = getToken();
    const { times, pessoas } = await coletarDaTeamGuide(token);
    if (times.length === 0 && pessoas.length === 0) {
      throw new Error('TeamGuide devolveu conjunto vazio — espelho preservado.');
    }
    await gravarColecaoSeMudou('times', times);
    await gravarColecaoSeMudou('pessoas', pessoas);
    await insertTeamguideSyncRun({
      gatilho,
      ok: 1,
      total: pessoas.length,
      duracao_ms: Date.now() - inicio,
      detalhe: null,
    });
    return { ok: true, times: times.length, pessoas: pessoas.length, detalhe: null };
  } catch (e) {
    const detalhe = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    try {
      await insertTeamguideSyncRun({
        gatilho,
        ok: 0,
        total: 0,
        duracao_ms: Date.now() - inicio,
        detalhe,
      });
    } catch (e2) {
      console.error('[teamguide-espelho] falha ao registrar corrida:', e2);
    }
    await alertarErroIntegracao('teamguide-sync', 'falha ao sincronizar a TeamGuide', detalhe);
    return { ok: false, times: 0, pessoas: 0, detalhe };
  }
}

// ─── Leitura pelas 9 funções de `teamguide.server.ts` ───────────────────────

function parseArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Times crus do espelho. `[]` se ainda não sincronizou ou o JSON está corrompido. */
export async function lerEspelhoTimes(): Promise<TGTeam[]> {
  try {
    return parseArray<TGTeam>((await getTeamguideEspelho('times'))?.dados);
  } catch {
    return [];
  }
}

/** Pessoas normalizadas do espelho. `[]` se ainda não sincronizou. */
export async function lerEspelhoPessoas(): Promise<TGPessoa[]> {
  try {
    return parseArray<TGPessoa>((await getTeamguideEspelho('pessoas'))?.dados);
  } catch {
    return [];
  }
}

/** O espelho já tem dados? (usado para preservar o motivo `teamguide_indisponivel`.) */
export async function espelhoTeamGuideDisponivel(): Promise<boolean> {
  try {
    const [t, p] = await Promise.all([getTeamguideEspelho('times'), getTeamguideEspelho('pessoas')]);
    return (t?.dados?.length ?? 0) > 2 || (p?.dados?.length ?? 0) > 2; // '[]' tem 2 chars
  } catch {
    return false;
  }
}

// ─── Auto-cura (bootstrap) ───────────────────────────────────────────────────

let syncEmVoo = false;

/**
 * Garante que o espelho encha em background quando está vazio/estagnado, SEM bloquear a
 * leitura (que devolve o default seguro até o espelho encher). Single-flight por isolate: um
 * sync em voo suprime novos disparos. `sincronizarTeamGuide` nunca lança, então o `finally`
 * sempre libera a trava.
 */
export function garantirEspelhoTeamGuide(gatilho = 'sob-demanda'): void {
  if (syncEmVoo) return;
  syncEmVoo = true;
  runBackground(
    sincronizarTeamGuide(gatilho).finally(() => {
      syncEmVoo = false;
    }),
  );
}

// ─── Saúde do espelho ────────────────────────────────────────────────────────

export type StatusTeamGuide = {
  ultimoSyncOkMs: number | null;
  idadeMs: number | null;
  ultimaFalhou: boolean;
  pessoas: number;
  times: number;
  ultimaRun: {
    gatilho: string;
    ok: boolean;
    total: number | null;
    duracaoMs: number | null;
    detalhe: string | null;
    iniciadoEm: string | null;
  } | null;
};

/** Saúde do espelho da TeamGuide — alimenta `GET /api/admin/integracoes-status`. */
export async function statusTeamGuideEspelho(): Promise<StatusTeamGuide> {
  const [ultima, ultimaOk, times, pessoas] = await Promise.all([
    getUltimaTeamguideSyncRun(),
    getUltimaTeamguideSyncRunOk(),
    lerEspelhoTimes(),
    lerEspelhoPessoas(),
  ]);
  const ultimoSyncOkMs = carimboEspelhoMs(ultimaOk?.iniciado_em);
  return {
    ultimoSyncOkMs,
    idadeMs: ultimoSyncOkMs == null ? null : Math.max(0, Date.now() - ultimoSyncOkMs),
    ultimaFalhou: ultima != null && ultima.ok !== 1,
    pessoas: pessoas.length,
    times: times.length,
    ultimaRun: ultima
      ? {
          gatilho: ultima.gatilho,
          ok: ultima.ok === 1,
          total: ultima.total,
          duracaoMs: ultima.duracao_ms,
          detalhe: ultima.detalhe,
          iniciadoEm: ultima.iniciado_em,
        }
      : null,
  };
}
