// Derivação de áreas organizacionais via API TeamGuide (server-only).
//
// Replica a lógica do gomoon-dash (ver doc teamguide-derivacao-areas.md):
// a árvore tem 3 domínios (raízes), achados pelo NOME DO LÍDER (não por id, que
// muda quando recriam o time). Os filhos diretos da raiz (L1) são áreas, EXCETO
// 4 nós "passthrough" (guarda-chuva de diretor) cujos filhos L2 é que viram área.
//
// Aqui enumeramos os nós-área direto da árvore (não por pessoa), o que dá a lista
// canônica de áreas mesmo as sem gente alocada. A mesma árvore também resolve a
// área de UMA pessoa pelo email (deriveAreaFromEmail).

import { ehCargoDeLideranca } from '@/lib/cargo-lideranca';
import { filtrarLideresOverride } from '@/lib/lideranca-override';

const BASE = 'https://api.teamguide.app';

// Range de marcas diacríticas combinantes (para remover acentos após NFD).
const DIACRITICS = /[̀-ͯ]/g;

type TGTeam = {
  id: string;
  name: string;
  teamParent: string | null;
  leader?: { id: string; name: string } | null;
  deleted?: boolean;
};

type TGMember = {
  id: string;
  name: string;
  contactEmail?: string | null;
  teams?: string[];
  teamsIds?: string[];
};

/** Uma pessoa na relação de liderança (o e-mail pode faltar no cadastro). */
export type PessoaLideranca = { nome: string; email: string | null };

const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(DIACRITICS, '').trim();

// slug (sem acento, minúsculo, kebab) é a chave de área — funde duplicatas (ex.: as duas "TECNOLOGIA").
const slug = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(DIACRITICS, '').toLowerCase()
    .replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Líderes dos 3 domínios (raízes) e dos 4 nós passthrough — achados por líder (estável).
const DOMAIN_LEADERS: [string, string][] = [['rafael', 'lobo'], ['guilherme', 'nobrega'], ['luis', 'liveri']];
const PASSTHROUGH_LEADERS: [string, string][] = [['bruno', 'bezerra'], ['pedro', 'glycerio'], ['rafael', 'menezes'], ['joaquim', 'quindere']];

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// GET com RETRY para falhas TRANSITÓRIAS (erro de rede, 429, 5xx) — um soluço
// momentâneo da TeamGuide não deve derrubar a derivação de área (que caía no
// fallback "ÁREA NÃO IDENTIFICADA"). Erros permanentes (401/403/404) NÃO são
// re-tentados. Até 3 tentativas com backoff curto.
async function tgGet<T>(path: string, token: string): Promise<T> {
  const MAX = 3;
  for (let attempt = 1; ; attempt++) {
    let r: Response;
    try {
      r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
    } catch (netErr) {
      if (attempt >= MAX) throw netErr; // rede caiu nas 3 tentativas
      await sleep(250 * attempt);
      continue;
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

// ⚠️ A API devolve os ids como NÚMERO (`id: 43685`), mas eles circulam aqui como
// chave de Map e casam com `teamsIds` de membros — normalizamos na FRONTEIRA para
// string, senão `map.get(String(id))` erra por tipo e tudo vira null (silencioso).
function normalizarTimes(raw: TGTeam[]): TGTeam[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    ...t,
    id: String(t.id),
    teamParent: t.teamParent == null ? null : String(t.teamParent),
    leader: t.leader ? { ...t.leader, id: String(t.leader.id) } : t.leader,
  }));
}

function getToken(): string {
  const token = process.env.TG_API_TOKEN;
  if (!token) throw new Error('TG_API_TOKEN não configurado nas variáveis de ambiente.');
  return token;
}

// ── Índice de áreas a partir da árvore ───────────────────────────────────────
//
// `areaNodes`: os nós-área canônicos (L1 normal ou L2 de passthrough).
// `areaByTeamId`: mapa de QUALQUER time (o nó-área e todos os seus descendentes)
//   para o nome do nó-área que o cobre — é o que resolve a área de uma pessoa.
function buildAreaIndex(teamsRaw: TGTeam[]) {
  const teams = normalizarTimes(teamsRaw).filter((t) => !t.deleted);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const children = (pid: string) => teams.filter((t) => t.teamParent === pid);

  const ancestors = (id: string) => {
    const out: TGTeam[] = [];
    const seen = new Set<string>();
    let c: TGTeam | undefined = byId.get(id);
    while (c && !seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
      c = c.teamParent != null ? byId.get(c.teamParent) : undefined;
    }
    return out;
  };
  const depth = (id: string) => Math.max(0, ancestors(id).length - 1);

  // raiz do domínio: entre os times do líder, o de MENOR profundidade.
  const rootFor = ([f, l]: [string, string]): TGTeam | null => {
    let best: TGTeam | null = null;
    let bd = Infinity;
    for (const t of teams) {
      const n = norm(t.leader?.name);
      if (n.includes(f) && n.includes(l)) {
        const d = depth(t.id);
        if (d < bd) { bd = d; best = t; }
      }
    }
    return best;
  };

  const roots = DOMAIN_LEADERS.map(rootFor);
  if (roots.some((r) => !r)) throw new Error('TeamGuide: não encontrei as 3 raízes de domínio por líder.');

  // As 3 raízes de domínio podem estar aninhadas entre si (ex.: "N1 - Guilherme"
  // e "N1 - Luis" são filhas L1 da raiz "N1" do Rafael). Uma raiz NÃO é área —
  // suas áreas são enumeradas quando a processamos como raiz. Sem isso, os nós de
  // diretoria (N1) vazam como "áreas".
  const rootIds = new Set(roots.map((r) => r!.id));

  const isPassthrough = (leader?: { name: string } | null) => {
    const n = norm(leader?.name);
    return !!leader && PASSTHROUGH_LEADERS.some(([a, b]) => n.includes(a) && n.includes(b));
  };

  // Nós-área: filhos L1 da raiz; se o L1 é passthrough, seus filhos L2 é que viram área (regra v3).
  const areaNodes: TGTeam[] = [];
  for (const root of roots) {
    for (const l1 of children(root!.id)) {
      if (rootIds.has(l1.id)) continue; // outra raiz de domínio — não é área
      if (isPassthrough(l1.leader)) areaNodes.push(...children(l1.id));
      else areaNodes.push(l1);
    }
  }

  // Mapa time→área: cada nó-área e TODOS os seus descendentes apontam para o nome do nó-área.
  const areaByTeamId = new Map<string, string>();
  for (const node of areaNodes) {
    const nome = (node.name ?? '').trim();
    if (!nome) continue;
    const stack = [node];
    const visited = new Set<string>();
    while (stack.length) {
      const c = stack.pop()!;
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      if (!areaByTeamId.has(c.id)) areaByTeamId.set(c.id, nome);
      stack.push(...children(c.id));
    }
  }

  // 2ª camada (D5): nó que a regra acima declara "não é área" — as raízes de
  // domínio e os passthrough — mapeia para o NOME DE SI MESMO. Quem está alocado
  // NO nó guarda-chuva (10 pessoas na base real) caía no vazio e virava
  // "ÁREA NÃO IDENTIFICADA".
  //
  // ⚠️ Fica num mapa SEPARADO, não mesclado no `areaByTeamId`: quem está em 2+
  // times (um guarda-chuva + uma área real) tem que continuar resolvendo a ÁREA
  // REAL. Se as duas camadas dividissem o mapa, o "primeiro `teamsIds` que
  // resolver" faria o guarda-chuva vencer — mudaria gente que HOJE já resolve.
  const fallbackByTeamId = new Map<string, string>();
  for (const t of teams) {
    const nome = (t.name ?? '').trim();
    if (nome && !areaByTeamId.has(t.id)) fallbackByTeamId.set(t.id, nome);
  }

  return { teams, areaNodes, areaByTeamId, fallbackByTeamId };
}

// ── Raízes de cobertura ──────────────────────────────────────────────────────
//
// Conjunto mínimo de times que, com `directOnly=false` (recursivo), cobre TODA a
// árvore — é a partir deles que listamos os membros. Normalmente é só quem não
// tem pai (`Gogroup`); a varredura genérica existe porque um ciclo na árvore
// deixaria a lista de "sem pai" vazia e ninguém seria lido.
function raizesDeCobertura(teams: TGTeam[]): TGTeam[] {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const filhos = new Map<string, TGTeam[]>();
  for (const t of teams) {
    if (t.teamParent == null) continue;
    filhos.set(t.teamParent, [...(filhos.get(t.teamParent) ?? []), t]);
  }

  const cobrir = (raiz: TGTeam, destino: Set<string>) => {
    const pilha = [raiz];
    while (pilha.length) {
      const c = pilha.pop()!;
      if (destino.has(c.id)) continue;
      destino.add(c.id);
      pilha.push(...(filhos.get(c.id) ?? []));
    }
  };

  const cobertos = new Set<string>();
  const raizes: TGTeam[] = [];
  const semPai = teams.filter((t) => t.teamParent == null || !byId.has(t.teamParent));
  for (const t of [...semPai, ...teams]) {
    if (cobertos.has(t.id)) continue;
    raizes.push(t);
    cobrir(t, cobertos);
  }
  return raizes;
}

/** Deriva a lista canônica de nomes de área a partir da árvore da TeamGuide. */
export async function deriveAreasFromTeamGuide(): Promise<string[]> {
  const token = getToken();
  const teamsRaw = await tgGet<TGTeam[]>('/teams', token);
  const { areaNodes } = buildAreaIndex(teamsRaw);

  // Dedup por slug (mantém o nome cru), ordena alfabeticamente.
  const bySlug = new Map<string, string>();
  for (const node of areaNodes) {
    const nome = (node.name ?? '').trim();
    if (!nome) continue;
    const s = slug(nome);
    if (s && !bySlug.has(s)) bySlug.set(s, nome);
  }
  return [...bySlug.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// ── Lista de pessoas (autocomplete de participantes) ─────────────────────────

type TGEmployeeRef = {
  id: number;
  name: string;
  contactEmail?: string | null;
  position?: string | null;
  teams?: string[];
};

export type PessoaTeamGuide = { nome: string; email: string; cargo: string | null };

/**
 * Lista todos os funcionários ativos da TeamGuide (nome, e-mail, cargo) para o
 * autocomplete do campo de participantes. `/employees/refs?unpaged=true` devolve
 * a base inteira numa chamada (~440 pessoas); dedup por e-mail, ordenado por nome.
 */
export async function listarPessoasTeamGuide(): Promise<PessoaTeamGuide[]> {
  const token = getToken();
  expirarCachesVencidos();
  const refs = await carregarRefs(token);

  const porEmail = new Map<string, PessoaTeamGuide>();
  for (const r of refs) {
    const email = (r.contactEmail ?? '').trim().toLowerCase();
    const nome = (r.name ?? '').trim();
    if (!email || !nome || porEmail.has(email)) continue;
    porEmail.set(email, { nome, email, cargo: (r.position ?? '').trim() || null });
  }
  return [...porEmail.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ── Resolução de área por email ──────────────────────────────────────────────

// Teto real do `pageSize` da API (pedir 1000 devolve 100).
const PAGE_SIZE = 100;
// Trava de segurança do loop de páginas (com pageSize=100 cobre 2000 pessoas).
const MAX_PAGINAS = 20;

/**
 * Lista os membros de um time (recursivo nos descendentes), paginando pelos
 * nomes REAIS do parâmetro — `pageNumber`/`pageSize`.
 *
 * ⚠️ O `?page=N` que estava aqui é **ignorado** pela API (no OpenAPI `page` é o
 * objeto `{pageNumber,pageSize}`): toda listagem relia a 1ª página e o `break`
 * de página parcial nunca disparava. Por isso o loop para por **página sem id
 * novo** ANTES de olhar o tamanho — se o parâmetro voltar a ser ignorado um dia,
 * o pior caso é 1 requisição extra, não um giro até o limite com dado repetido.
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

// ── Base cacheada por isolate (árvore + membros) ─────────────────────────────
//
// A árvore e a lista de pessoas mudam devagar e a cota da API é compartilhada:
// carregamos uma vez por isolate (mesma vida do cache de token) e derivamos
// TODOS os índices em memória. Só o resultado de SUCESSO é cacheado.

let cacheTimes: Promise<TGTeam[]> | null = null;
let cacheMembros: Promise<TGMember[]> | null = null;
let cacheRefs: Promise<TGEmployeeRef[]> | null = null;

// ⚠️ TTL curto e OBRIGATÓRIO. Sem ele, um isolate quente serve o retrato velho da
// org para sempre: quem foi cadastrado (ou trocou de time) depois do aquecimento
// não é achado e a submissão grava "ÁREA NÃO IDENTIFICADA" na planilha — o
// próprio sintoma que esta fatia veio corrigir. Antes de haver cache, cada
// submissão relia ao vivo.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cacheEm = 0;

/** Derruba os 3 caches JUNTOS (área e liderança não podem divergir entre si). */
function expirarCachesVencidos() {
  if (cacheEm && Date.now() - cacheEm > CACHE_TTL_MS) {
    cacheTimes = null;
    cacheMembros = null;
    cacheRefs = null;
    cacheLideranca = null;
    cacheEm = 0;
  }
}

/**
 * Base de funcionários com CARGO (`/employees/refs`, ~440 pessoas numa chamada),
 * cacheada junto com a árvore. É a fonte do cargo que decide a isenção (D20) — e
 * como isso roda no caminho quente da submissão, não pode ser uma leitura por vez.
 */
function carregarRefs(token: string): Promise<TGEmployeeRef[]> {
  if (!cacheRefs) {
    if (!cacheEm) cacheEm = Date.now();
    cacheRefs = tgGet<TGEmployeeRef[]>('/employees/refs?unpaged=true&page=0', token).catch((e) => {
      cacheRefs = null;
      throw e;
    });
  }
  return cacheRefs;
}

function carregarTimes(token: string): Promise<TGTeam[]> {
  if (!cacheTimes) {
    cacheEm = Date.now();
    cacheTimes = tgGet<TGTeam[]>('/teams', token).catch((e) => {
      cacheTimes = null;
      throw e;
    });
  }
  return cacheTimes;
}

function carregarMembros(teams: TGTeam[], token: string): Promise<TGMember[]> {
  if (!cacheMembros) {
    cacheMembros = (async () => {
      const ativos = normalizarTimes(teams).filter((t) => !t.deleted);
      const porId = new Map<string, TGMember>();
      for (const raiz of raizesDeCobertura(ativos)) {
        for (const m of await fetchTeamMembers(raiz.id, token)) {
          const id = String(m.id);
          if (!porId.has(id)) porId.set(id, m);
        }
      }
      return [...porId.values()];
    })().catch((e) => {
      cacheMembros = null;
      throw e;
    });
  }
  return cacheMembros;
}

const emailDe = (m: TGMember) => (m.contactEmail ?? '').trim().toLowerCase();

/** Resolve a pessoa pelo e-mail EXATO (`/employees/emails/{email}` + índice). */
async function resolverMembroPorEmail(
  alvo: string,
  membros: TGMember[],
  token: string,
): Promise<TGMember | null> {
  const porEmail = new Map(membros.filter((m) => emailDe(m)).map((m) => [emailDe(m), m]));
  const porId = new Map(membros.map((m) => [String(m.id), m]));

  try {
    const r = await tgGet<{ exists?: boolean; employeeId?: string | number | null }>(
      `/employees/emails/${encodeURIComponent(alvo)}`,
      token,
    );
    if (r?.exists && r.employeeId != null) {
      const achado = porId.get(String(r.employeeId));
      if (achado) return achado;
    }
  } catch {
    // E-mail desconhecido pode responder erro — o índice por contactEmail decide.
  }
  return porEmail.get(alvo) ?? null;
}

/**
 * Resolve o nome do nó-área canônico de uma pessoa pelo email cadastrado na
 * TeamGuide. Retorna `null` se a pessoa não for encontrada — o chamador decide o
 * aviso ("ÁREA NÃO IDENTIFICADA").
 *
 * ⚠️ Resolve pelo **e-mail exato**, não mais por busca de NOME a partir do
 * local-part: aquilo errava em homônimo e em e-mail fora do padrão
 * `nome.sobrenome@`, silenciosamente.
 */
export async function deriveAreaFromEmail(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  const token = getToken();
  expirarCachesVencidos();

  const teamsRaw = await carregarTimes(token);
  const { areaByTeamId, fallbackByTeamId } = buildAreaIndex(teamsRaw);
  const membros = await carregarMembros(teamsRaw, token);

  const membro = await resolverMembroPorEmail(alvo, membros, token);
  if (!membro) return null;

  const times = (membro.teamsIds ?? []).map(String);
  // 1ª passada: área REAL. Só se NENHUM time dela resolver é que o guarda-chuva
  // entra — assim ninguém que já tinha área passa a exibir "BIZOPS"/"N1".
  for (const tid of times) {
    const area = areaByTeamId.get(tid);
    if (area) return area;
  }
  for (const tid of times) {
    const guardaChuva = fallbackByTeamId.get(tid);
    if (guardaChuva) return guardaChuva;
  }
  return null; // pessoa achada mas fora dos 3 domínios mapeados
}

// ── Liderança (D7): líder↔liderado derivados de /teams + membros ─────────────
//
// Os endpoints "óbvios" da TeamGuide (`/employees/{id}/leaders`, `/leaders/{id}/led`,
// `/employees/{id}/teams`) devolvem **403** com o nosso token — não tentar de novo
// (ver `spec-docs/SPEC_APROVACAO_LIDER.md` §2). A regra derivada:
//
//   líder de P = líder do time de P; se P **é** o líder daquele time, sobe pro
//   time pai e repete. Pessoa em 2+ times devolve TODOS os líderes (D4).
//
// Quem chega ao topo sem líder fica com lista vazia (D6 — o CEO).

type IndiceLideranca = {
  /** e-mail (minúsculo) → líderes diretos */
  lideresPorEmail: Map<string, PessoaLideranca[]>;
  /** e-mail do líder (minúsculo) → liderados */
  lideradosPorEmail: Map<string, { nome: string; email: string }[]>;
  /**
   * E-mails (minúsculos) de quem **É liderança**: aparece como `leader` de pelo
   * menos um time ATIVO da árvore. Base da ISENÇÃO de pré-aprovação (decisão do
   * Luis, 03/08/2026): uma liderança não precisa que o líder dela aprove o
   * projeto — só o liderado "de fato" precisa. Deriva do `leader` do time (e não
   * de "tem liderados no índice"), porque um time recém-criado pode ter líder e
   * ainda nenhum membro — e o coordenador continua sendo liderança.
   */
  liderancasPorEmail: Set<string>;
};

function construirIndiceLideranca(teamsRaw: TGTeam[], membros: TGMember[]): IndiceLideranca {
  const teams = normalizarTimes(teamsRaw).filter((t) => !t.deleted);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const membroPorId = new Map(membros.map((m) => [String(m.id), m]));

  const lideresDoMembro = (membro: TGMember): PessoaLideranca[] => {
    const achados = new Map<string, PessoaLideranca>();
    for (const tid of membro.teamsIds ?? []) {
      let atual = byId.get(String(tid));
      const visitados = new Set<string>(); // ciclo na árvore não trava
      while (atual && !visitados.has(atual.id)) {
        visitados.add(atual.id);
        const lider = atual.leader;
        // Sem líder, ou a própria pessoa lidera este time → sobe pro pai.
        if (lider && String(lider.id) !== String(membro.id)) {
          const cadastro = membroPorId.get(String(lider.id));
          achados.set(String(lider.id), {
            nome: (cadastro?.name ?? lider.name ?? '').trim(),
            email: cadastro ? emailDe(cadastro) || null : null,
          });
          break;
        }
        atual = atual.teamParent != null ? byId.get(atual.teamParent) : undefined;
      }
    }
    return [...achados.values()];
  };

  const lideresPorEmail = new Map<string, PessoaLideranca[]>();
  const lideradosPorEmail = new Map<string, { nome: string; email: string }[]>();

  for (const membro of membros) {
    const email = emailDe(membro);
    if (!email) continue;
    // Remendo declarado para cadastro torto na TeamGuide (fonte única em
    // `@/lib/lideranca-override`). Aplicado AQUI, no único ponto que constrói o
    // índice, para os DOIS lados ficarem coerentes: quem some da lista de líderes
    // dele também não recebe ele como liderado.
    const lideres = filtrarLideresOverride(email, lideresDoMembro(membro));
    lideresPorEmail.set(email, lideres);
    for (const lider of lideres) {
      if (!lider.email) continue;
      const lista = lideradosPorEmail.get(lider.email) ?? [];
      lista.push({ nome: (membro.name ?? '').trim(), email });
      lideradosPorEmail.set(lider.email, lista);
    }
  }

  // Quem É liderança: e-mail do `leader` de qualquer time ativo (resolvido no
  // cadastro de membros pelo id do líder). Líder sem e-mail cadastrado não entra —
  // sem e-mail não há como casar com o autor da submissão.
  const liderancasPorEmail = new Set<string>();
  for (const t of teams) {
    const liderId = t.leader?.id;
    if (!liderId) continue;
    const cadastro = membroPorId.get(String(liderId));
    const email = cadastro ? emailDe(cadastro) : '';
    if (email) liderancasPorEmail.add(email);
  }

  return { lideresPorEmail, lideradosPorEmail, liderancasPorEmail };
}

let cacheLideranca: IndiceLideranca | null = null;

/** Índice de liderança da org inteira, cacheado por isolate (~6 chamadas). */
export async function buildLiderancaIndex(): Promise<IndiceLideranca> {
  const token = getToken();
  expirarCachesVencidos();
  const teamsRaw = await carregarTimes(token);
  const membros = await carregarMembros(teamsRaw, token);
  if (!cacheLideranca) cacheLideranca = construirIndiceLideranca(teamsRaw, membros);
  return cacheLideranca;
}

/** Líderes diretos de um e-mail. Lista vazia quando não há (CEO, D6) ou é desconhecido. */
export async function getLideresDe(email: string): Promise<PessoaLideranca[]> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return [];
  const { lideresPorEmail } = await buildLiderancaIndex();
  return lideresPorEmail.get(alvo) ?? [];
}

/** O outro lado da mesma relação: quem responde a este e-mail. */
export async function getLideradosDe(email: string): Promise<{ nome: string; email: string }[]> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return [];
  const { lideradosPorEmail } = await buildLiderancaIndex();
  return lideradosPorEmail.get(alvo) ?? [];
}

/** Cargo cadastrado na TeamGuide (`position`), ou `null` se a pessoa não está lá. */
export async function getCargoDe(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  const token = getToken();
  expirarCachesVencidos();
  const refs = await carregarRefs(token);
  const achado = refs.find((r) => (r.contactEmail ?? '').trim().toLowerCase() === alvo);
  return (achado?.position ?? '').trim() || null;
}

/**
 * Nome REAL cadastrado na TeamGuide (`name`, ex. "João Victor Esteves"), ou `null`.
 * É a fonte confiável do nome de exibição: o edge Godeploy só injeta o e-mail, então
 * sem isto o nome vira o local-part do e-mail em Title Case (`joaovictor.esteves`
 * → "Joaovictor Esteves"), perdendo espaços e acentos.
 *
 * ⚠️ FAIL-SAFE: roda no `/api/auth/me` (caminho crítico); qualquer falha da TeamGuide
 * (token ausente, 403, timeout) devolve `null` para o chamador cair no fallback — o
 * login NUNCA pode quebrar por causa desta consulta. Usa o mesmo cache do `getCargoDe`.
 */
export async function getNomeDe(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  try {
    const token = getToken();
    expirarCachesVencidos();
    const refs = await carregarRefs(token);
    const achado = refs.find((r) => (r.contactEmail ?? '').trim().toLowerCase() === alvo);
    return (achado?.name ?? '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * A pessoa é ISENTA de pré-aprovação? A régua é o **CARGO** — coordenador para cima
 * (D20, `ehCargoDeLideranca`, fonte única em `@/lib/cargo-lideranca`).
 *
 * ⚠️ NÃO é mais "aparece como `leader` de um time ativo" (D11 original): a TeamGuide
 * pendura um nó por pessoa na árvore, então analista com nó próprio saía isenta sem
 * ninguém aprovar (caso Fablícia Lima, "Analista de Logistica PL", 05/08/2026).
 * ⚠️ Também NÃO é "tem liderado": quem lidera time grande com cargo de IC (ex.
 * "Team Líder Cx", 12 liderados) segue em fila de propósito — decide o cargo.
 * ⚠️ Nunca lança por e-mail vazio/desconhecido: sem cargo, o seguro é passar pelo
 * líder (`false`).
 */
export async function ehLideranca(email: string): Promise<boolean> {
  return ehCargoDeLideranca(await getCargoDe(email));
}
