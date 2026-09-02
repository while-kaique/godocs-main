// Leituras da TeamGuide (server-only) — cargo, área, liderança, nome, lista de pessoas.
//
// ⚠️ REFATORADO (espelho, 02/09/2026): estas 9 funções NÃO falam mais com a rede. Elas leem
// o ESPELHO SQLite (`teamguide-espelho.ts`, que o SYNC enche por cron) e derivam os índices
// com as funções PURAS de `teamguide-derivacao.ts`. Cada uma é FAIL-SAFE: qualquer falha
// (espelho vazio, JSON corrompido, banco fora) devolve o default seguro (`null`/`[]`/`false`)
// e NUNCA lança — antes, `getCargoDe`/`ehLideranca` re-lançavam o 401 do token expirado e
// derrubavam a submissão de líderes (incidente 01–02/09/2026). O molde do fail-safe já
// existia em `getNomeDe`; agora vale para todas.
//
// Quando o espelho está vazio (bootstrap), a leitura dispara um sync em background
// (`garantirEspelhoTeamGuide`, single-flight) e devolve o default seguro até ele encher.

import { ehCargoDeLideranca } from '@/lib/cargo-lideranca';
import { filtrarLideresOverride } from '@/lib/lideranca-override';
import {
  buildAreaIndex,
  construirIndiceLideranca,
  pessoasComoMembros,
  slug,
  type TGTeam,
  type TGPessoa,
  type IndiceLideranca,
  type PessoaLideranca,
  type PessoaTeamGuide,
} from '@/lib/areas/teamguide-derivacao';
import {
  lerEspelhoTimes,
  lerEspelhoPessoas,
  garantirEspelhoTeamGuide,
} from '@/lib/teamguide-espelho';

// Re-exporta os tipos que outros módulos importam daqui (participantes.functions).
export type { PessoaTeamGuide, PessoaLideranca } from '@/lib/areas/teamguide-derivacao';

// ── Snapshot por isolate (times + pessoas do espelho) ────────────────────────
//
// Substitui os caches de árvore/membros/refs de antes. TTL curto: a árvore muda devagar e o
// espelho já é uma cópia local barata, mas re-parsear o JSON a cada chamada no caminho quente
// da submissão seria desperdício. Snapshot VAZIO não é cacheado — assim, logo que o sync de
// auto-cura enche o espelho, a próxima leitura já o enxerga.
type Snapshot = { times: TGTeam[]; pessoas: TGPessoa[]; em: number };
const SNAP_TTL_MS = 60 * 1000;
let snap: Snapshot | null = null;
let indiceLideranca: { valor: IndiceLideranca; em: number } | null = null;

/** SÓ para testes: zera o snapshot por isolate (cada teste tem um banco novo). */
export function __resetTeamguideSnapshotCache(): void {
  snap = null;
  indiceLideranca = null;
}

async function carregarSnapshot(): Promise<Snapshot> {
  if (snap && Date.now() - snap.em < SNAP_TTL_MS) return snap;
  const [times, pessoas] = await Promise.all([lerEspelhoTimes(), lerEspelhoPessoas()]);
  if (times.length === 0 && pessoas.length === 0) {
    // Espelho vazio → enche em background e serve o default seguro até lá.
    garantirEspelhoTeamGuide('sob-demanda');
    return { times, pessoas, em: 0 };
  }
  snap = { times, pessoas, em: Date.now() };
  indiceLideranca = null; // invalida o índice derivado junto com o snapshot
  return snap;
}

// ── Cargo / liderança por cargo ──────────────────────────────────────────────

/** Cargo cadastrado na TeamGuide (`position`), ou `null` se a pessoa não está lá / TG fora. */
export async function getCargoDe(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  try {
    const { pessoas } = await carregarSnapshot();
    const p = pessoas.find((x) => x.email === alvo);
    return (p?.cargo ?? '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * A pessoa é ISENTA de pré-aprovação? A régua é o CARGO — coordenador para cima (D20,
 * `ehCargoDeLideranca`). FAIL-SAFE: sem cargo/TG fora → `false` (o seguro é passar pelo líder).
 */
export async function ehLideranca(email: string): Promise<boolean> {
  return ehCargoDeLideranca(await getCargoDe(email));
}

/** Nome REAL cadastrado na TeamGuide (`name`), ou `null`. Fail-safe (roda no `/api/auth/me`). */
export async function getNomeDe(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  try {
    const { pessoas } = await carregarSnapshot();
    const p = pessoas.find((x) => x.email === alvo);
    return (p?.nome ?? '').trim() || null;
  } catch {
    return null;
  }
}

// ── Lista de pessoas (autocomplete de participantes) ─────────────────────────

/** Todos os funcionários com e-mail (nome, e-mail, cargo), ordenados por nome. `[]` se TG fora. */
export async function listarPessoasTeamGuide(): Promise<PessoaTeamGuide[]> {
  try {
    const { pessoas } = await carregarSnapshot();
    const porEmail = new Map<string, PessoaTeamGuide>();
    for (const p of pessoas) {
      const email = (p.email ?? '').trim().toLowerCase();
      const nome = (p.nome ?? '').trim();
      if (!email || !nome || porEmail.has(email)) continue;
      porEmail.set(email, { nome, email, cargo: p.cargo });
    }
    return [...porEmail.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  } catch {
    return [];
  }
}

// ── Áreas ────────────────────────────────────────────────────────────────────

/** Lista canônica de nomes de área a partir da árvore. `[]` se TG fora. */
export async function deriveAreasFromTeamGuide(): Promise<string[]> {
  try {
    const { times } = await carregarSnapshot();
    if (times.length === 0) return [];
    const { areaNodes } = buildAreaIndex(times);
    const bySlug = new Map<string, string>();
    for (const node of areaNodes) {
      const nome = (node.name ?? '').trim();
      if (!nome) continue;
      const s = slug(nome);
      if (s && !bySlug.has(s)) bySlug.set(s, nome);
    }
    return [...bySlug.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  } catch {
    return [];
  }
}

/**
 * Nome do nó-área canônico de uma pessoa pelo e-mail. `null` se a pessoa não for encontrada,
 * estiver fora dos 3 domínios, ou o TG estiver fora.
 *
 * ⚠️ FAIL-SAFE, mas o chamador (`submeterParaValidacao`) trata `null` preservando a área já
 * gravada — ver o `?? projeto.area ??` lá: com o espelho vazio, `null` NÃO sobrescreve uma
 * área boa para "ÁREA NÃO IDENTIFICADA".
 */
export async function deriveAreaFromEmail(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  try {
    const { times, pessoas } = await carregarSnapshot();
    if (times.length === 0) return null;
    const pessoa = pessoas.find((x) => x.email === alvo);
    if (!pessoa) return null;
    const { areaByTeamId, fallbackByTeamId } = buildAreaIndex(times);
    const tids = (pessoa.teamsIds ?? []).map(String);
    // 1ª passada: área REAL. O guarda-chuva só entra se NENHUM time real resolver.
    for (const tid of tids) {
      const area = areaByTeamId.get(tid);
      if (area) return area;
    }
    for (const tid of tids) {
      const guardaChuva = fallbackByTeamId.get(tid);
      if (guardaChuva) return guardaChuva;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Liderança (líder↔liderado) ───────────────────────────────────────────────

const INDICE_VAZIO: IndiceLideranca = {
  lideresPorEmail: new Map(),
  lideresBrutosPorEmail: new Map(),
  lideradosPorEmail: new Map(),
  liderancasPorEmail: new Set(),
};

/** Índice de liderança da org inteira, derivado do espelho e memoizado por isolate. */
export async function buildLiderancaIndex(): Promise<IndiceLideranca> {
  try {
    const { times, pessoas, em } = await carregarSnapshot();
    if (times.length === 0 && pessoas.length === 0) return INDICE_VAZIO;
    if (indiceLideranca && indiceLideranca.em === em && em !== 0) return indiceLideranca.valor;
    const valor = construirIndiceLideranca(times, pessoasComoMembros(pessoas));
    if (em !== 0) indiceLideranca = { valor, em };
    return valor;
  } catch {
    return INDICE_VAZIO;
  }
}

/**
 * Líderes diretos de um e-mail. `[]` quando não há (CEO), é desconhecido, ou TG fora.
 * `opts.projetoId` só serve às exceções por projeto dos overrides.
 */
export async function getLideresDe(
  email: string,
  opts?: { projetoId?: string | null },
): Promise<PessoaLideranca[]> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return [];
  try {
    const { lideresBrutosPorEmail } = await buildLiderancaIndex();
    return filtrarLideresOverride(alvo, lideresBrutosPorEmail.get(alvo) ?? [], opts?.projetoId);
  } catch {
    return [];
  }
}

/** O outro lado: quem responde a este e-mail. `[]` se TG fora. */
export async function getLideradosDe(email: string): Promise<{ nome: string; email: string }[]> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return [];
  try {
    const { lideradosPorEmail } = await buildLiderancaIndex();
    return lideradosPorEmail.get(alvo) ?? [];
  } catch {
    return [];
  }
}
