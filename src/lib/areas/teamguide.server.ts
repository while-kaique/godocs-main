// Derivação de áreas organizacionais via API TeamGuide (server-only).
//
// Replica a lógica do gomoon-dash (ver doc teamguide-derivacao-areas.md):
// a árvore tem 3 domínios (raízes), achados pelo NOME DO LÍDER (não por id, que
// muda quando recriam o time). Os filhos diretos da raiz (L1) são áreas, EXCETO
// 4 nós "passthrough" (guarda-chuva de diretor) cujos filhos L2 é que viram área.
//
// Aqui enumeramos os nós-área direto da árvore (não por pessoa), o que dá a lista
// canônica de áreas mesmo as sem gente alocada.

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

const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(DIACRITICS, '').trim();

// slug (sem acento, minúsculo, kebab) é a chave de área — funde duplicatas (ex.: as duas "TECNOLOGIA").
const slug = (s?: string | null) =>
  (s ?? '').normalize('NFD').replace(DIACRITICS, '').toLowerCase()
    .replace(/&/g, 'e').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Líderes dos 3 domínios (raízes) e dos 4 nós passthrough — achados por líder (estável).
const DOMAIN_LEADERS: [string, string][] = [['rafael', 'lobo'], ['guilherme', 'nobrega'], ['luis', 'liveri']];
const PASSTHROUGH_LEADERS: [string, string][] = [['bruno', 'bezerra'], ['pedro', 'glycerio'], ['rafael', 'menezes'], ['joaquim', 'quindere']];

async function tgGet<T>(path: string, token: string): Promise<T> {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`TeamGuide GET ${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json() as Promise<T>;
}

/** Deriva a lista canônica de nomes de área a partir da árvore da TeamGuide. */
export async function deriveAreasFromTeamGuide(): Promise<string[]> {
  const token = process.env.TG_API_TOKEN;
  if (!token) throw new Error('TG_API_TOKEN não configurado nas variáveis de ambiente.');

  const teamsRaw = await tgGet<TGTeam[]>('/teams', token);
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

  const isPassthrough = (leader?: { name: string } | null) => {
    const n = norm(leader?.name);
    return !!leader && PASSTHROUGH_LEADERS.some(([a, b]) => n.includes(a) && n.includes(b));
  };

  // Nós-área: filhos L1 da raiz; se o L1 é passthrough, seus filhos L2 é que viram área (regra v3).
  const areaNodes: TGTeam[] = [];
  for (const root of roots) {
    for (const l1 of children(root!.id)) {
      if (isPassthrough(l1.leader)) areaNodes.push(...children(l1.id));
      else areaNodes.push(l1);
    }
  }

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
