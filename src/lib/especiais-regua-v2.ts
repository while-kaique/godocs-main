/**
 * RÉGUA DE ESTRELAS 0–10 — fechada pelo Luis em 03/09/2026, depois de ~8 versões rejeitadas.
 * Módulo PURO e FONTE ÚNICA: os prompts interpolam daqui, não redigitam.
 *
 * ⚠️ **Por que a régua ANTERIOR não funcionava**: ela era CIRCULAR (`10 = "topo absoluto"`,
 * `6 = "o mesmo do 5, com alcance acima da média"`). Um critério que se define pela posição
 * não é verificável — o agente não tinha como decidir entre 5 e 7 a não ser por impressão,
 * e na dúvida descia. É por isso que, em 734 projetos, **nunca houve um 6★ nem um 9★**.
 *
 * Esta régua troca posição por VERBO, e cada nível carrega EXEMPLOS REAIS da base — a âncora
 * que faz o agente reconhecer o nível em vez de estimá-lo.
 *
 * ⚠️ **A faixa 6–10 é UM critério só, de propósito** (decisão do Luis, 03/09). Não há
 * critério por nível ali: o agente julga se o projeto MUDA O JOGO e raciocina, em prosa, onde
 * dentro da faixa ele encaixa. **Quem fecha a nota exata é o humano, por comparação com as
 * âncoras já decididas.** Detalhar 6, 7, 8, 9 e 10 separadamente foi tentado e descartado:
 * cinco definições vizinhas viram cinco maneiras de errar, e a distinção real entre um 7 e um
 * 8 é comparativa — depende de quem já está lá —, não descritiva.
 */

export type NivelRegua = {
  estrela: number;
  verbo: string;
  criterio: string;
  /** Projetos REAIS da base que ancoram o nível. É o que faz o agente reconhecer, não estimar. */
  exemplos: readonly string[];
};

// ─── 0★ a 5★: a faixa em que o AGENTE decide sozinho ─────────────────────────

/**
 * Princípio ordenador: **quanto da cadeia `informação → ação → consequência` o projeto
 * assume**. Não é tamanho, não é sofisticação, não é quanto dinheiro move.
 */
export const NIVEIS_AGENTE: readonly NivelRegua[] = [
  {
    estrela: 0,
    verbo: 'Experimenta',
    criterio:
      'Apenas ganho mensurável, ou só o autor usa, ou é simples/local, ou está parado, ou tem impacto marginal, ou é pouco relevante para a empresa como um todo, ou é experimentação. Dashboards, apps e skills simples.',
    exemplos: ['Automação de mimos de aniversário', 'Cruzamento de XML'],
  },
  {
    estrela: 1,
    verbo: 'Informa',
    criterio:
      'Produz o insumo, não a ação. Alguém lê e age. Dashboards e apps gerenciais. Skills mais complexas com rotina informativa.',
    exemplos: ['Damidash', 'Godash'],
  },
  {
    estrela: 2,
    verbo: 'Executa',
    criterio:
      'Assume a ação recorrente e roda sem ninguém iniciar. Não escolhe, faz. Rotinas mais complexas com execução automática. Bots em geral.',
    exemplos: ['Tiktok Scraper', 'Live Machine'],
  },
  {
    estrela: 3,
    verbo: 'Garante',
    criterio:
      'Impede o erro de passar. A consequência evitada é de outra área e tem impacto. Alertas de alto impacto na operação da empresa. Painéis gerenciais com autonomia de bloqueio de erros.',
    exemplos: ['SAIBBI', 'Checklist de turno'],
  },
  {
    estrela: 4,
    verbo: 'Decide',
    criterio:
      'Assume escolha que compromete recurso, por regra auditável. Agentes mais complexos, necessariamente com inteligência agregada. Envolve aprendizado de máquina. Toma decisões estocásticas, não determinísticas.',
    exemplos: ['GoPrice', 'Cases IA'],
  },
  {
    estrela: 5,
    verbo: 'Assume',
    criterio:
      'Está no caminho até o cliente, o fornecedor ou o mercado, sem humano entre a falha e o prejuízo. Assume responsabilidade pela entrega final. Agentes complexos com claws, graph engineering, auto-cura. Metas claras e auditáveis sendo entregadas.',
    exemplos: ['CX - Ticket Creator', 'Robo orçamento', 'GoBrands', 'CTR Machine'],
  },
] as const;

// ─── 6★ a 10★: UM critério só ────────────────────────────────────────────────

export const ESCAPE_MINIMO = 6;
export const ESCAPE_VERBO = 'Muda o Jogo';

/**
 * ⚠️ **Critério ÚNICO da faixa inteira.** Não desdobrar em 6, 7, 8, 9, 10 — ver o cabeçalho
 * do arquivo. O agente decide se o projeto está NA FAIXA e argumenta onde; o humano fecha.
 */
export const ESCAPE_CRITERIO =
  'Revoluciona como a área (ou a empresa) trabalha. Sistemas agênticos com impactos diretos nos KPIs e nos resultados financeiros. Abrem novas frentes de receitas ou de savings. Substituem humanos de maneira clara e inequívoca.';

/** O que o agente DEVE devolver quando joga o projeto na faixa. */
export const SAIDA_ESCAPE =
  'faixa 6-10 · onde dentro dela você acha que encaixa e POR QUÊ · a evidência CITADA da documentação · confiança';

/**
 * Quem fecha a nota exata. Fica como constante porque o texto vai no prompt E na tela —
 * o agente precisa saber que não é ele quem crava o número.
 */
export const ESCAPE_DECISOR =
  'Se o agente decidir que é 6-10, a nota final é decidida por um HUMANO, por critério comparativo com os projetos já ancorados na faixa.';

// ─── Renderização para os prompts (fonte única: não redigitar nos agentes) ────

export function descreverRegua(): string {
  const linha = (n: NivelRegua) =>
    `${n.estrela}★ **${n.verbo}** — ${n.criterio} Ex.: ${n.exemplos.join(' · ')}`;
  return [
    'FAIXA 0★–5★ — princípio ordenador: quanto da cadeia informação → ação → consequência o projeto ASSUME.',
    ...NIVEIS_AGENTE.map((n) => `- ${linha(n)}`),
    '',
    `FAIXA 6★–10★ — **${ESCAPE_VERBO}**. É UM critério só; não há definição por nível.`,
    ESCAPE_CRITERIO,
    `⚠️ ${ESCAPE_DECISOR}`,
    `⚠️ Saída obrigatória no escape: ${SAIDA_ESCAPE}. Sem evidência citada da documentação, o escape NÃO vale e a nota volta para 5★.`,
  ].join('\n');
}

// ─── Guards determinísticos ──────────────────────────────────────────────────

export type SinaisEscape = {
  /** Trecho da doc citado como evidência. Vazio = escape sem lastro. */
  evidencia?: string | null;
};

/** Piso de caracteres para a evidência contar como CITAÇÃO, e não como paráfrase vazia. */
export const MIN_EVIDENCIA = 40;

/**
 * ⚠️ **Só REBAIXA, nunca promove** — a mesma disciplina de `normalizarClassificacao`. Uma nota
 * de escape sem evidência citada volta para 5★.
 *
 * ⚠️ **É o ÚNICO guard determinístico da faixa**, e de propósito: o critério do escape é um só
 * e a nota exata é humana, então não há o que checar por regra além do lastro documental.
 * Guard sobre "é mesmo um 8?" seria justamente o julgamento que ficou com a pessoa.
 *
 * Por que rebaixar e não recusar: o trabalho do agente na faixa 0–5 continua válido; o que
 * não se sustenta é o salto. E por que NÃO existe promoção automática: um falso 8★ entra na
 * régua de todo mundo como âncora, e âncora errada contamina as notas seguintes.
 */
export function rebaixarEscapeSemLastro(
  estrela: number,
  sinais: SinaisEscape,
): { estrela: number; ajuste: string | null } {
  if (estrela < ESCAPE_MINIMO) return { estrela, ajuste: null };
  const evidencia = String(sinais.evidencia ?? '').trim();
  if (evidencia.length < MIN_EVIDENCIA)
    return { estrela: 5, ajuste: 'escape sem evidência citada da documentação — voltou para 5★' };
  return { estrela, ajuste: null };
}

// ─── Sinal de GUARDA-CHUVA (vem da aglutinação) ──────────────────────────────

/**
 * Quantas features declaradas ou aceitas um projeto precisa ter para que o guarda-chuva
 * conte como evidência do escape.
 *
 * ⚠️ **Por que 2, e por que isto NÃO é um bônus de nota.** Um projeto que virou guarda-chuva
 * de outros é a evidência mais objetiva que temos de que ele mudou o jogo — as features são
 * a atividade nova, com nome e linha na planilha. Mas ele NÃO soma estrela sozinho: some-se e
 * o caminho para inflar a nota passa a ser cadastrar features, que é gameável e barato. O que
 * ele faz é dar LASTRO documental a um escape que, sem ele, dependeria de o agente acreditar
 * na prosa do memorial.
 *
 * Com 1 feature não vale: um filho é um incremento. A partir de 2, há um padrão.
 */
export const MIN_FEATURES_GUARDA_CHUVA = 2;

export type SinalGuardaChuva = {
  /** Ids das features que apontam para este projeto (declaradas ou aceitas no painel). */
  features: string[];
};

/**
 * O guarda-chuva dá lastro ao escape? Devolve também a frase que serve de EVIDÊNCIA CITADA,
 * porque o escape exige evidência e esta é verificável na planilha, não no texto.
 */
export function guardaChuvaSustentaEscape(s: SinalGuardaChuva): {
  satisfaz: boolean;
  evidencia: string;
} {
  const n = s.features.filter((f) => String(f ?? '').trim()).length;
  if (n < MIN_FEATURES_GUARDA_CHUVA) return { satisfaz: false, evidencia: '' };
  return {
    satisfaz: true,
    evidencia: `${n} projetos foram submetidos como feature deste, e existem por causa dele: ${s.features.slice(0, 5).join(', ')}`,
  };
}
