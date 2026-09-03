// Memória e LOG dos agentes avaliadores em ÁRVORE — regras PURAS (T21, plano
// `regua-estrelas-e-time-unificado.md` §11.3). Sem I/O, sem env.
//
// Por quê em árvore: o time de agentes é orquestrador → cérebros → especialistas → tools, e a
// pergunta que o log existe para responder é "quem chamou quem, com que entrada, e o que concluiu"
// numa rodada de terça-feira. Um log plano perde essa amarração; aqui NADA fica solto: só o
// orquestrador do projeto pode ser raiz, todo outro nó aponta para um pai do MESMO ciclo, e o
// `caminho` materializado ("ciclo/orq:a/cerebroA:b/tool:c") deixa a subárvore inteira sair com um
// único `LIKE 'prefixo/%'`.

export type TipoNo =
  | 'orquestrador'
  | 'cerebro'
  | 'especialista'
  | 'cetico'
  | 'consenso'
  | 'tool'
  | 'debate';

export type NoAgenteEntrada = {
  id?: string;
  ciclo_id: string;
  pai_id: string | null;
  projeto_id: string;
  agente: string;
  tipo: TipoNo;
  rodada?: number;
  entrada?: string | null;
  saida?: string | null;
  tools_chamadas?: unknown[] | null;
  confianca?: string | null;
  veredito?: string | null;
  modelo?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  custo_usd?: number | null;
  duracao_ms?: number | null;
  erro?: string | null;
};

export type NoAgente = NoAgenteEntrada & {
  id: string;
  caminho: string;
  profundidade: number;
  created_at: string;
};

/** O que a validação precisa saber do pai (nunca a `saida`, que pode ser longa). */
export type PaiResumo = { id: string; ciclo_id: string; caminho: string; profundidade: number } | null;

export type MotivoRecusa =
  | 'ciclo_ausente'
  | 'projeto_ausente'
  | 'agente_ausente'
  | 'sem_pai'
  | 'pai_inexistente'
  | 'pai_de_outro_ciclo';

export type ArvoreNo = { no: NoAgente; filhos: ArvoreNo[] };

export type ResumoCiclo = {
  total: number;
  por_tipo: Record<string, number>;
  por_veredito: Record<string, number>;
  erros: number;
  custo_usd: number;
  tokens: number;
};

/**
 * Regra de árvore, cobrada ANTES de qualquer escrita. `pai` é o nó que `no.pai_id` aponta, já
 * lido do banco (ou `null` quando não existe / não foi informado).
 */
export function validarNo(
  no: NoAgenteEntrada,
  pai: PaiResumo,
): { ok: true } | { ok: false; motivo: MotivoRecusa } {
  if (!no.ciclo_id?.trim()) return { ok: false, motivo: 'ciclo_ausente' };
  if (!no.projeto_id?.trim()) return { ok: false, motivo: 'projeto_ausente' };
  if (!no.agente?.trim()) return { ok: false, motivo: 'agente_ausente' };
  if (no.pai_id == null) {
    return no.tipo === 'orquestrador' ? { ok: true } : { ok: false, motivo: 'sem_pai' };
  }
  if (!pai) return { ok: false, motivo: 'pai_inexistente' };
  if (pai.ciclo_id !== no.ciclo_id) return { ok: false, motivo: 'pai_de_outro_ciclo' };
  return { ok: true };
}

export function montarCaminho(pai: PaiResumo, cicloId: string, agente: string, id: string): string {
  const folha = `${agente}:${id}`;
  return pai ? `${pai.caminho}/${folha}` : `${cicloId}/${folha}`;
}

export function profundidadeDe(pai: PaiResumo): number {
  return pai ? pai.profundidade + 1 : 0;
}

/** Padrão para `WHERE caminho LIKE ?` — a subárvore estrita (a própria raiz fica de fora). */
export function prefixoSubarvore(caminho: string): string {
  return `${caminho}/%`;
}

function compararNos(a: NoAgente, b: NoAgente): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Lista plana → raízes com filhos aninhados. Raiz = `pai_id` nulo OU pai fora da lista (uma
 * lista filtrada por projeto não pode perder nó). Filhos ordenados por `created_at`, depois `id`.
 */
export function montarArvore(nos: NoAgente[]): ArvoreNo[] {
  const porId = new Map<string, ArvoreNo>();
  for (const n of nos) porId.set(n.id, { no: n, filhos: [] });
  const raizes: ArvoreNo[] = [];
  for (const n of [...nos].sort(compararNos)) {
    const item = porId.get(n.id)!;
    const pai = n.pai_id ? porId.get(n.pai_id) : undefined;
    if (pai && pai !== item) pai.filhos.push(item);
    else raizes.push(item);
  }
  return raizes;
}

export function resumirCiclo(nos: NoAgente[]): ResumoCiclo {
  const r: ResumoCiclo = { total: 0, por_tipo: {}, por_veredito: {}, erros: 0, custo_usd: 0, tokens: 0 };
  for (const n of nos) {
    r.total += 1;
    r.por_tipo[n.tipo] = (r.por_tipo[n.tipo] ?? 0) + 1;
    if (n.veredito) r.por_veredito[n.veredito] = (r.por_veredito[n.veredito] ?? 0) + 1;
    if (n.erro) r.erros += 1;
    r.custo_usd += n.custo_usd ?? 0;
    r.tokens += (n.tokens_in ?? 0) + (n.tokens_out ?? 0);
  }
  return r;
}
