// Ferramentas dos agentes de avaliação — catálogo, protocolo e loop (T12, plano §11.2/§11.3).
// Módulo PURO: sem I/O. Quem EXECUTA cada ferramenta é o `executar` injetado pelo server.
//
// Por quê um loop próprio em modo JSON e não tool-calling nativo: `llm.ts` não expõe `tools` e o
// proxy já matou Structured Outputs — o padrão que funciona neste repo é JSON + parse tolerante.
// O agente responde `{"acao":"tool",...}` para pedir uma ferramenta ou `{"acao":"concluir",...}`
// para terminar; o loop executa server-side, devolve `tool_result` no turno seguinte e para no
// teto de chamadas (sem teto, "agente autônomo" vira gasto sem fim — este repo já viu 38 turnos).
//
// As ferramentas PURAS (teto 220 h, gate 44 h, receita ÷10, duplicata por nome) repetem réguas
// que já existem no repo — divergir delas daria ao agente um número diferente do da planilha.

export type NomeFerramenta =
  | 'consultar_vizinhos'
  | 'consultar_cargo'
  | 'historico_versoes'
  | 'buscar_duplicata'
  | 'checar_plausibilidade_horas'
  | 'calcular_impacto'
  | 'ler_evidencia';

export type Ferramenta = { nome: NomeFerramenta; descricao: string; parametros: Record<string, string> };

export const CATALOGO_FERRAMENTAS: readonly Ferramenta[] = [
  {
    nome: 'consultar_vizinhos',
    descricao:
      'Projetos parecidos JÁ avaliados por humanos (nota, status, resumo, similaridade). Use para ancorar a comparação — nunca copie a nota do vizinho sem justificar a diferença.',
    parametros: { k: 'quantos vizinhos (1–6, default 6)', so_com_nota_humana: 'true/false (default true)' },
  },
  {
    nome: 'consultar_cargo',
    descricao: 'Cargo e time de uma pessoa na TeamGuide (fail-safe: null quando não encontrada).',
    parametros: { email: 'e-mail @gocase da pessoa' },
  },
  {
    nome: 'historico_versoes',
    descricao: 'Versões do projeto (submissão e reenvios) e o que mudou entre as duas mais recentes.',
    parametros: {},
  },
  {
    nome: 'buscar_duplicata',
    descricao:
      'Procura na base outro projeto com o MESMO nome/escopo que já tenha ganho medido (regra D8: ressubmissão do mesmo escopo não pontua).',
    parametros: { nome: 'nome do projeto a procurar (default: o próprio)' },
  },
  {
    nome: 'checar_plausibilidade_horas',
    descricao:
      'Confere as linhas de horas contra o teto CLT de 220 h por pessoa e o gate de economia alta (≥44 h/mês, só no saving mensal).',
    parametros: {
      linhas: 'lista de {cargo, horas_antes, horas_depois} (default: as linhas do dossiê)',
      tipo_saving: 'mensal|pontual|trimestral|semestral',
    },
  },
  {
    nome: 'calcular_impacto',
    descricao:
      'Ganho total mensal pela fórmula do repo: saving + custo evitado + receita ÷ 10 − custo externo − custo do projeto.',
    parametros: {
      saving_reais: 'número',
      custo_evitado_reais: 'número',
      custo_externo_mensal: 'número',
      custo_projeto_mensal: 'número',
      receita_mensal: 'número',
    },
  },
  {
    nome: 'ler_evidencia',
    descricao:
      'Lê o texto de um anexo/evidência do projeto pelo link. Hoje o texto NÃO é persistido — a ferramenta devolve o link e o aviso; quando a v2 guardar o texto, passa a devolvê-lo.',
    parametros: { link: 'URL do anexo (um dos links do dossiê)' },
  },
];

export const MAX_CHAMADAS_TOOL = 4;

const PROTOCOLO = [
  'PROTOCOLO DE RESPOSTA (responda SEMPRE com um único objeto JSON, sem texto fora dele):',
  '- Para usar uma ferramenta: {"acao":"tool","nome":"<nome>","args":{...}}',
  '- Para terminar: {"acao":"concluir","resultado":{...}}',
  `Você tem no máximo ${MAX_CHAMADAS_TOOL} chamadas de ferramenta. Use-as quando o dossiê não responde a pergunta; não use por hábito.`,
].join('\n');

export function descreverFerramentas(permitidas?: NomeFerramenta[]): string {
  const lista = CATALOGO_FERRAMENTAS.filter((f) => !permitidas || permitidas.includes(f.nome));
  const linhas = lista.map((f) => {
    const params = Object.entries(f.parametros)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    return `- ${f.nome} — ${f.descricao}${params ? ` Parâmetros: ${params}.` : ' Sem parâmetros.'}`;
  });
  return ['FERRAMENTAS DISPONÍVEIS:', ...linhas, '', PROTOCOLO].join('\n');
}

export type PedidoTool = { acao: 'tool'; nome: NomeFerramenta; args: Record<string, unknown> };
export type Conclusao = { acao: 'concluir'; resultado: unknown };
export type RespostaInvalida = { acao: 'invalida'; motivo: string };
export type Mensagem = { role: 'system' | 'user' | 'assistant'; content: string };

/** Primeiro objeto JSON BALANCEADO do texto (ciente de strings/escapes), ou null. */
export function extrairPrimeiroObjetoJson(raw: string): unknown | null {
  let inicio = raw.indexOf('{');
  while (inicio >= 0) {
    let depth = 0;
    let emString = false;
    let escapando = false;
    for (let i = inicio; i < raw.length; i++) {
      const c = raw[i];
      if (emString) {
        if (escapando) escapando = false;
        else if (c === '\\') escapando = true;
        else if (c === '"') emString = false;
        continue;
      }
      if (c === '"') emString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(inicio, i + 1));
          } catch {
            break;
          }
        }
      }
    }
    inicio = raw.indexOf('{', inicio + 1);
  }
  return null;
}

const NOMES = new Set<string>(CATALOGO_FERRAMENTAS.map((f) => f.nome));

export function interpretarResposta(
  raw: string,
  permitidas?: NomeFerramenta[],
): PedidoTool | Conclusao | RespostaInvalida {
  const obj = extrairPrimeiroObjetoJson(raw ?? '');
  if (!obj || typeof obj !== 'object') return { acao: 'invalida', motivo: 'resposta sem objeto JSON' };
  const o = obj as Record<string, unknown>;
  if (o.acao === 'concluir') return { acao: 'concluir', resultado: o.resultado ?? null };
  if (o.acao === 'tool') {
    const nome = String(o.nome ?? '');
    if (!NOMES.has(nome)) return { acao: 'invalida', motivo: `ferramenta desconhecida: ${nome || '(vazio)'}` };
    if (permitidas && !permitidas.includes(nome as NomeFerramenta)) {
      return { acao: 'invalida', motivo: `ferramenta não permitida neste agente: ${nome}` };
    }
    const args = o.args && typeof o.args === 'object' && !Array.isArray(o.args) ? (o.args as Record<string, unknown>) : {};
    return { acao: 'tool', nome: nome as NomeFerramenta, args };
  }
  return { acao: 'invalida', motivo: `ação desconhecida: ${String(o.acao ?? '(ausente)')}` };
}

export type PassoLoop = {
  nome: NomeFerramenta;
  args: Record<string, unknown>;
  retorno: unknown;
  erro: string | null;
  duracao_ms: number;
};

export type ResultadoLoop = {
  resultado: unknown | null;
  passos: PassoLoop[];
  motivo_fim: 'concluiu' | 'teto' | 'invalida' | 'erro_llm';
  chamadas_llm: number;
  mensagens: Mensagem[];
};

const MSG_CORRETIVA =
  'Sua resposta não seguiu o protocolo. Responda APENAS com um objeto JSON válido: {"acao":"tool","nome":"...","args":{...}} para usar uma ferramenta ou {"acao":"concluir","resultado":{...}} para terminar.';
const MSG_ENCERRAMENTO =
  'Você atingiu o limite de chamadas de ferramenta — sem mais ferramentas. Com o que já tem, conclua agora com {"acao":"concluir","resultado":{...}}.';

/**
 * Loop agentic bounded. NUNCA lança: LLM que rejeita → `erro_llm`; ferramenta que lança → o erro
 * volta ao LLM como `tool_result: {erro}` e o loop segue; 2 respostas inválidas consecutivas →
 * `invalida`; no teto manda UMA mensagem de encerramento e dá a última chance de concluir.
 */
export async function loopComFerramentas(opts: {
  chamarLlm: (mensagens: Mensagem[]) => Promise<string>;
  mensagensIniciais: Mensagem[];
  executar: (nome: NomeFerramenta, args: Record<string, unknown>) => Promise<unknown>;
  maxChamadas?: number;
  permitidas?: NomeFerramenta[];
}): Promise<ResultadoLoop> {
  const max = opts.maxChamadas ?? MAX_CHAMADAS_TOOL;
  const mensagens: Mensagem[] = [...opts.mensagensIniciais];
  const passos: PassoLoop[] = [];
  let chamadas = 0;
  let invalidasSeguidas = 0;
  let encerrado = false;

  const fim = (motivo_fim: ResultadoLoop['motivo_fim'], resultado: unknown | null = null): ResultadoLoop => ({
    resultado,
    passos,
    motivo_fim,
    chamadas_llm: chamadas,
    mensagens,
  });

  // Teto duro de iterações (defesa contra loop de correção infinito): pedidos + inválidas + encerramento.
  const tetoIteracoes = max * 2 + 4;
  for (let iter = 0; iter < tetoIteracoes; iter++) {
    let raw: string;
    try {
      raw = await opts.chamarLlm(mensagens);
      chamadas++;
    } catch {
      chamadas++;
      return fim('erro_llm');
    }
    mensagens.push({ role: 'assistant', content: raw });
    const r = interpretarResposta(raw, opts.permitidas);

    if (r.acao === 'concluir') return fim('concluiu', r.resultado);

    if (r.acao === 'invalida') {
      invalidasSeguidas++;
      if (invalidasSeguidas >= 2) return fim('invalida');
      mensagens.push({ role: 'user', content: `${MSG_CORRETIVA} (motivo: ${r.motivo})` });
      continue;
    }
    invalidasSeguidas = 0;

    if (encerrado) return fim('teto');

    const t0 = Date.now();
    let retorno: unknown = null;
    let erro: string | null = null;
    try {
      retorno = await opts.executar(r.nome, r.args);
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
    passos.push({ nome: r.nome, args: r.args, retorno, erro, duracao_ms: Math.max(0, Date.now() - t0) });
    mensagens.push({
      role: 'user',
      content: JSON.stringify({ nome: r.nome, tool_result: erro ? { erro } : retorno }),
    });

    if (passos.length >= max) {
      mensagens.push({ role: 'user', content: MSG_ENCERRAMENTO });
      encerrado = true;
    }
  }
  return fim('teto');
}

// ─── Ferramentas PURAS ────────────────────────────────────────────────────────

/** Teto CLT por pessoa (22 dias úteis ≈ 220 h) — a mesma régua dos gates do chat. */
export const TETO_HORAS_PESSOA = 220;
/** Economia mensal a partir da qual o repo cobra "o que mudou após a automação". */
export const LIMITE_ECONOMIA_ALTA_HORAS = 44;

export function checarPlausibilidadeHoras(args: {
  linhas: { cargo: string; horas_antes: number | null; horas_depois: number | null }[];
  tipo_saving?: string | null;
  saving_horas?: number | null;
}): {
  teto_por_pessoa: number;
  total_antes: number;
  total_depois: number;
  economia: number;
  linhas_acima_teto: { cargo: string; horas_antes: number }[];
  economia_alta: boolean;
  alerta: boolean;
  mensagem: string;
} {
  const linhas = Array.isArray(args.linhas) ? args.linhas : [];
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const total_antes = linhas.reduce((s, l) => s + n(l.horas_antes), 0);
  const total_depois = linhas.reduce((s, l) => s + n(l.horas_depois), 0);
  const economia = Math.max(0, total_antes - total_depois);
  const linhas_acima_teto = linhas
    .filter((l) => n(l.horas_antes) > TETO_HORAS_PESSOA)
    .map((l) => ({ cargo: l.cargo, horas_antes: n(l.horas_antes) }));
  const mensal = (args.tipo_saving ?? '') === 'mensal';
  const economia_alta =
    mensal &&
    (economia >= LIMITE_ECONOMIA_ALTA_HORAS ||
      linhas.some((l) => n(l.horas_antes) - n(l.horas_depois) >= LIMITE_ECONOMIA_ALTA_HORAS));
  const alerta = linhas_acima_teto.length > 0 || economia_alta;
  const partes: string[] = [];
  if (linhas_acima_teto.length) {
    partes.push(
      `${linhas_acima_teto.map((l) => `${l.cargo} (${l.horas_antes} h)`).join(', ')} acima do teto de ${TETO_HORAS_PESSOA} h por pessoa: a linha soma várias pessoas/unidades ou o número está errado — perguntar.`,
    );
  }
  if (economia_alta) {
    partes.push(
      `Economia de ${economia} h/mês (≥ ${LIMITE_ECONOMIA_ALTA_HORAS} h): exigir o destino das horas liberadas (mais entrega, menos custo, menos erro, menos risco, menos prazo).`,
    );
  }
  if (!partes.length) partes.push(`Horas plausíveis: ${total_antes} h antes → ${total_depois} h depois (teto ${TETO_HORAS_PESSOA} h/pessoa respeitado).`);
  return { teto_por_pessoa: TETO_HORAS_PESSOA, total_antes, total_depois, economia, linhas_acima_teto, economia_alta, alerta, mensagem: partes.join(' ') };
}

export function calcularImpactoBasico(args: {
  saving_reais?: number | null;
  custo_evitado_reais?: number | null;
  custo_externo_mensal?: number | null;
  custo_projeto_mensal?: number | null;
  receita_mensal?: number | null;
}): {
  ganho_total_mensal: number;
  composicao: { saving: number; custo_evitado: number; receita_ponderada: number; custo_externo: number; custo_projeto: number };
  formula: string;
} {
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const composicao = {
    saving: n(args.saving_reais),
    custo_evitado: n(args.custo_evitado_reais),
    receita_ponderada: n(args.receita_mensal) / 10,
    custo_externo: n(args.custo_externo_mensal),
    custo_projeto: n(args.custo_projeto_mensal),
  };
  const ganho_total_mensal =
    composicao.saving + composicao.custo_evitado + composicao.receita_ponderada - composicao.custo_externo - composicao.custo_projeto;
  return {
    ganho_total_mensal,
    composicao,
    formula: 'ganho_total_mensal = saving + custo_evitado + receita ÷ 10 − custo_externo − custo_projeto (receita entra ÷ 10, regra de negócio do GoDocs)',
  };
}

/** Nome comparável: sem acento, minúsculo, espaços colapsados, sem sufixo de versão (v2, V2, 2.0). */
export function normalizarNomeProjeto(nome: string): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\[\]()"'“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*(?:v(?:ersao)?\s*\d+(?:\.\d+)*|\d+\.\d+)\s*$/i, '')
    .trim();
}

export function buscarDuplicataNaLista(
  alvo: { id: string; nome: string },
  candidatos: { id: string; nome: string; saving_reais: number | null; receita_mensal: number | null; status: string | null }[],
): { id: string; nome: string; motivo: string }[] {
  const chave = normalizarNomeProjeto(alvo.nome);
  if (!chave) return [];
  const out: { id: string; nome: string; motivo: string }[] = [];
  for (const c of candidatos) {
    if (c.id === alvo.id) continue;
    if (normalizarNomeProjeto(c.nome) !== chave) continue;
    const saving = typeof c.saving_reais === 'number' && c.saving_reais > 0 ? c.saving_reais : null;
    const receita = typeof c.receita_mensal === 'number' && c.receita_mensal > 0 ? c.receita_mensal : null;
    if (saving === null && receita === null) continue; // D8: só conta se o outro tem ganho MEDIDO
    const ganho = [saving !== null ? `saving ${saving}` : null, receita !== null ? `receita ${receita}` : null]
      .filter(Boolean)
      .join(' e ');
    out.push({
      id: c.id,
      nome: c.nome,
      motivo: `mesmo nome/escopo («${c.nome}», status ${c.status ?? '—'}) já documentado com ganho medido: ${ganho}`,
    });
  }
  return out;
}
