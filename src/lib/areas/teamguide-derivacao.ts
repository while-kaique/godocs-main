// Derivação PURA sobre as 2 coleções cruas da TeamGuide (times + pessoas).
//
// Extraído de `teamguide.server.ts` (que fazia I/O e derivação juntos) para o refactor do
// ESPELHO: agora o SYNC (`teamguide-espelho.ts`) produz as 2 coleções e as LEITURAS
// (`teamguide.server.ts`) derivam os índices a partir delas — as duas metades compartilham
// ESTE módulo, sem tocar a rede nem o banco. Tudo aqui é função pura sobre arrays.
//
// Replica a lógica do gomoon-dash (ver doc teamguide-derivacao-areas.md): a árvore tem 3
// domínios (raízes), achados pelo NOME DO LÍDER (não por id, que muda quando recriam o
// time). Os filhos diretos da raiz (L1) são áreas, EXCETO 4 nós "passthrough" (guarda-chuva
// de diretor) cujos filhos L2 é que viram área.

import { filtrarLideresOverride } from '@/lib/lideranca-override';

// Range de marcas diacríticas combinantes (para remover acentos após NFD).
const DIACRITICS = /[̀-ͯ]/g;

export type TGTeam = {
  id: string;
  name: string;
  teamParent: string | null;
  leader?: { id: string; name: string } | null;
  deleted?: boolean;
};

export type TGMember = {
  id: string;
  name: string;
  contactEmail?: string | null;
  teams?: string[];
  teamsIds?: string[];
};

/** Funcionário como vem de `/employees/refs` (traz o CARGO). */
export type TGEmployeeRef = {
  id: number | string;
  name: string;
  contactEmail?: string | null;
  position?: string | null;
  teams?: string[];
  teamsIds?: (number | string)[];
};

/**
 * Pessoa NORMALIZADA que vive no espelho (`chave='pessoas'`) — união de refs (cargo) +
 * members (teamsIds). É a fonte única de cargo/nome/área-por-email das leituras.
 */
export type TGPessoa = {
  id: string;
  nome: string;
  email: string | null;
  cargo: string | null;
  teamsIds: string[];
};

/** Uma pessoa na relação de liderança (o e-mail pode faltar no cadastro). */
export type PessoaLideranca = { nome: string; email: string | null };

export type PessoaTeamGuide = { nome: string; email: string; cargo: string | null };

export const norm = (s?: string | null) =>
  (s ?? '').toLowerCase().normalize('NFD').replace(DIACRITICS, '').trim();

// slug (sem acento, minúsculo, kebab) é a chave de área — funde duplicatas (ex.: as duas "TECNOLOGIA").
export const slug = (s?: string | null) =>
  (s ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/&/g, 'e')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export const emailDe = (m: { contactEmail?: string | null }) =>
  (m.contactEmail ?? '').trim().toLowerCase();

// Líderes dos 3 domínios (raízes) e dos 4 nós passthrough — achados por líder (estável).
const DOMAIN_LEADERS: [string, string][] = [
  ['rafael', 'lobo'],
  ['guilherme', 'nobrega'],
  ['luis', 'liveri'],
];
const PASSTHROUGH_LEADERS: [string, string][] = [
  ['bruno', 'bezerra'],
  ['pedro', 'glycerio'],
  ['rafael', 'menezes'],
  ['joaquim', 'quindere'],
];

// ⚠️ A API devolve os ids como NÚMERO (`id: 43685`), mas eles circulam aqui como chave de
// Map e casam com `teamsIds` de membros — normalizamos na FRONTEIRA para string, senão
// `map.get(String(id))` erra por tipo e tudo vira null (silencioso).
export function normalizarTimes(raw: TGTeam[]): TGTeam[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t) => ({
    ...t,
    id: String(t.id),
    teamParent: t.teamParent == null ? null : String(t.teamParent),
    leader: t.leader ? { ...t.leader, id: String(t.leader.id) } : t.leader,
  }));
}

/**
 * União refs (cargo) + members (teamsIds) → pessoas normalizadas. É o que o SYNC persiste
 * como `chave='pessoas'`. Chaveia por id (string); o cargo/e-mail vêm dos refs, os teamsIds
 * dos members. Quem só aparece nos members (raro) entra sem cargo.
 */
export function montarPessoas(refs: TGEmployeeRef[], membros: TGMember[]): TGPessoa[] {
  const porId = new Map<string, TGPessoa>();
  const unir = (a: string[], b: string[]) => [...new Set([...a, ...b])];

  // Refs trazem o CARGO (e o nome/e-mail). teamsIds vêm dos MEMBERS (é o que a API popula no
  // /teams/{raiz}/members?directOnly=false); ref.teamsIds, se um dia existir, entra por união.
  for (const r of refs ?? []) {
    const id = String(r.id);
    if (!id) continue;
    porId.set(id, {
      id,
      nome: (r.name ?? '').trim(),
      email: emailDe(r) || null,
      cargo: (r.position ?? '').trim() || null,
      teamsIds: (r.teamsIds ?? []).map(String),
    });
  }
  for (const m of membros ?? []) {
    const id = String(m.id);
    if (!id) continue;
    const tids = (m.teamsIds ?? []).map(String);
    const atual = porId.get(id);
    if (atual) {
      if (tids.length) atual.teamsIds = unir(atual.teamsIds, tids);
      if (!atual.email) atual.email = emailDe(m) || null;
      if (!atual.nome) atual.nome = (m.name ?? '').trim();
    } else {
      porId.set(id, {
        id,
        nome: (m.name ?? '').trim(),
        email: emailDe(m) || null,
        cargo: null,
        teamsIds: tids,
      });
    }
  }
  return [...porId.values()];
}

/** Adapta pessoas do espelho de volta para o shape que `construirIndiceLideranca` consome. */
export function pessoasComoMembros(pessoas: TGPessoa[]): TGMember[] {
  return (pessoas ?? []).map((p) => ({
    id: p.id,
    name: p.nome,
    contactEmail: p.email,
    teamsIds: p.teamsIds,
  }));
}

// ── Índice de áreas a partir da árvore ───────────────────────────────────────
//
// `areaNodes`: os nós-área canônicos (L1 normal ou L2 de passthrough).
// `areaByTeamId`: mapa de QUALQUER time (o nó-área e todos os seus descendentes) para o nome
//   do nó-área que o cobre — é o que resolve a área de uma pessoa.
export function buildAreaIndex(teamsRaw: TGTeam[]) {
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
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
    }
    return best;
  };

  const roots = DOMAIN_LEADERS.map(rootFor);
  if (roots.some((r) => !r))
    throw new Error('TeamGuide: não encontrei as 3 raízes de domínio por líder.');

  // As 3 raízes de domínio podem estar aninhadas entre si (ex.: "N1 - Guilherme" e "N1 -
  // Luis" são filhas L1 da raiz "N1" do Rafael). Uma raiz NÃO é área — suas áreas são
  // enumeradas quando a processamos como raiz. Sem isso, os nós de diretoria (N1) vazam.
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

  // 2ª camada (D5): nó que a regra acima declara "não é área" — as raízes de domínio e os
  // passthrough — mapeia para o NOME DE SI MESMO. Quem está alocado NO nó guarda-chuva (10
  // pessoas na base real) caía no vazio e virava "ÁREA NÃO IDENTIFICADA".
  //
  // ⚠️ Fica num mapa SEPARADO, não mesclado no `areaByTeamId`: quem está em 2+ times (um
  // guarda-chuva + uma área real) tem que continuar resolvendo a ÁREA REAL.
  const fallbackByTeamId = new Map<string, string>();
  for (const t of teams) {
    const nome = (t.name ?? '').trim();
    if (nome && !areaByTeamId.has(t.id)) fallbackByTeamId.set(t.id, nome);
  }

  return { teams, areaNodes, areaByTeamId, fallbackByTeamId };
}

// ── Raízes de cobertura ──────────────────────────────────────────────────────
//
// Conjunto mínimo de times que, com `directOnly=false` (recursivo), cobre TODA a árvore — é
// a partir deles que o SYNC lista os membros. Normalmente é só quem não tem pai (`Gogroup`);
// a varredura genérica existe porque um ciclo na árvore deixaria "sem pai" vazio.
export function raizesDeCobertura(teams: TGTeam[]): TGTeam[] {
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

// ── Liderança (D7): líder↔liderado derivados de /teams + membros ─────────────

export type IndiceLideranca = {
  /** e-mail (minúsculo) → líderes diretos (JÁ com os overrides de `lideranca-override`) */
  lideresPorEmail: Map<string, PessoaLideranca[]>;
  /** e-mail (minúsculo) → líderes diretos CRUS (antes do override; p/ exceção por projeto) */
  lideresBrutosPorEmail: Map<string, PessoaLideranca[]>;
  /** e-mail do líder (minúsculo) → liderados */
  lideradosPorEmail: Map<string, { nome: string; email: string }[]>;
  /** E-mails (minúsculos) de quem É liderança (aparece como `leader` de ≥1 time ativo). */
  liderancasPorEmail: Set<string>;
};

export function construirIndiceLideranca(
  teamsRaw: TGTeam[],
  membros: TGMember[],
): IndiceLideranca {
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
  const lideresBrutosPorEmail = new Map<string, PessoaLideranca[]>();
  const lideradosPorEmail = new Map<string, { nome: string; email: string }[]>();

  for (const membro of membros) {
    const email = emailDe(membro);
    if (!email) continue;
    // Remendo declarado para cadastro torto na TeamGuide (fonte única em
    // `@/lib/lideranca-override`). Aplicado AQUI, no único ponto que constrói o índice, para
    // os DOIS lados ficarem coerentes.
    const brutos = lideresDoMembro(membro);
    const lideres = filtrarLideresOverride(email, brutos);
    lideresBrutosPorEmail.set(email, brutos);
    lideresPorEmail.set(email, lideres);
    for (const lider of lideres) {
      if (!lider.email) continue;
      const lista = lideradosPorEmail.get(lider.email) ?? [];
      lista.push({ nome: (membro.name ?? '').trim(), email });
      lideradosPorEmail.set(lider.email, lista);
    }
  }

  // Quem É liderança: e-mail do `leader` de qualquer time ativo (resolvido no cadastro de
  // membros pelo id do líder). Líder sem e-mail cadastrado não entra.
  const liderancasPorEmail = new Set<string>();
  for (const t of teams) {
    const liderId = t.leader?.id;
    if (!liderId) continue;
    const cadastro = membroPorId.get(String(liderId));
    const email = cadastro ? emailDe(cadastro) : '';
    if (email) liderancasPorEmail.add(email);
  }

  return { lideresPorEmail, lideresBrutosPorEmail, lideradosPorEmail, liderancasPorEmail };
}
