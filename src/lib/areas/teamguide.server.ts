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
  const teams = teamsRaw.filter((t) => !t.deleted);
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

  return { teams, areaNodes, areaByTeamId };
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
  const refs = await tgGet<TGEmployeeRef[]>('/employees/refs?unpaged=true&page=0', token);

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

// A API TeamGuide NÃO tem busca por email: `?text=` casa por NOME (recursivo na
// org). Estratégia: buscar pelos tokens do local-part do email (firstname,
// lastname, "firstname lastname") a partir das raízes e filtrar por contactEmail
// EXATO. Achado o membro, resolvemos teamsIds → nome do nó-área pela árvore.
async function fetchMembersByText(rootId: string, text: string, token: string): Promise<TGMember[]> {
  const out: TGMember[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const path = `/teams/${rootId}/members?text=${encodeURIComponent(text)}&directOnly=false&page=${page}`;
    const batch = await tgGet<TGMember[]>(path, token);
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const m of batch) {
      if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    }
    if (batch.length < 25) break; // página parcial = última
  }
  return out;
}

/**
 * Resolve o nome do nó-área canônico de uma pessoa pelo email cadastrado na
 * TeamGuide. Retorna `null` se a pessoa não for encontrada (ou não cair em
 * nenhuma área mapeada) — o chamador decide o aviso ("ÁREA NÃO IDENTIFICADA").
 */
export async function deriveAreaFromEmail(email: string): Promise<string | null> {
  const alvo = (email ?? '').trim().toLowerCase();
  if (!alvo) return null;
  const token = getToken();

  const teamsRaw = await tgGet<TGTeam[]>('/teams', token);
  const { teams, areaByTeamId } = buildAreaIndex(teamsRaw);

  // Raízes de topo (sem pai) — a busca recursiva por text varre os descendentes.
  const topRoots = teams.filter((t) => t.teamParent == null).map((t) => t.id);
  if (topRoots.length === 0) return null;

  // Tokens de busca por NOME a partir do local-part (ex.: "luis.albuquerque").
  const local = alvo.split('@')[0];
  const partes = local.split(/[._-]+/).filter(Boolean);
  const tentativas = [partes[0], partes[partes.length - 1], partes.join(' ')]
    .filter((t, i, arr): t is string => !!t && arr.indexOf(t) === i);

  for (const text of tentativas) {
    for (const rootId of topRoots) {
      const membros = await fetchMembersByText(rootId, text, token);
      const hit = membros.find((m) => (m.contactEmail ?? '').toLowerCase() === alvo);
      if (hit) {
        for (const tid of hit.teamsIds ?? []) {
          const area = areaByTeamId.get(tid);
          if (area) return area;
        }
        return null; // pessoa achada mas fora dos 3 domínios mapeados
      }
    }
  }
  return null;
}
