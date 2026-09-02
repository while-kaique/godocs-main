/**
 * Régua de ESTRELAS 0–10 — módulo PURO e **FONTE ÚNICA** dos critérios.
 *
 * Validada pelo dono do produto (Luis, 02/09/2026) depois de sete desenhos rejeitados. O registro
 * da decisão, o que foi descartado e por quê, e as tarefas estão em
 * `docs/plans/regua-estrelas-e-time-unificado.md`. ⚠️ **Não redigite critério em prompt nem em
 * tela — altere estas constantes.**
 *
 * ## O que a estrela é
 * Nota qualitativa dada na auditoria, nunca pelo autor. Ela existe para o impacto **difícil de
 * mensurar**: ganho com número tem fórmula própria (`impacto.ts`) e não precisa de estrela.
 *
 * ## Por que a régua não cita R$
 * São projetos imensuráveis por definição — faixa de valor por estrela foi tentada e descartada
 * (os limiares saíram errados por uma ordem de grandeza: "< 60k/ano" cobria 95% da base). O que
 * discrimina é a NATUREZA do impacto.
 *
 * ## Fronteiras que não podem regredir
 * - **1★ a 5★ é do agente; 6★ a 10★ é ESCAPE para comitê humano** — o agente indica e sugere a
 *   posição, nunca concede (`TETO_AGENTE`).
 * - **Projeto com nota humana não é reclassificado.** Discordância vira CONTESTAÇÃO (D11): no
 *   máximo duas frases, com o gatilho que falhou NOMEADO e a evidência citada da doc.
 * - **Queda em massa para o mesmo nível é suspeita da RÉGUA, não dos projetos** (D12) — foi o
 *   defeito do desenho de "10 critérios somados", que empatava um projeto de milhões com um
 *   dashboard. Daí `detectarAchatamento`.
 */

/** Teto do que o agente pode conceder sozinho. Acima disso é escape para o comitê. */
export const TETO_AGENTE = 5;

/** Teto da escala. Acima disso é erro de digitação, não nota. */
export const NOTA_MAX = 10;

/** Por que 3 vale mais que 2 — sem isto a ordem dos níveis seria arbitrária. */
export const PRINCIPIO_ORDENADOR_AGENTE =
  'Quanto da cadeia informação → ação → consequência o projeto assume.';

/** O princípio muda de dimensão no escape: não é mais quanto de UM processo ele assume. */
export const PRINCIPIO_ORDENADOR_ESCAPE =
  'Quantos processos existem por causa dele, e quão irreversível é essa dependência.';

// ─── 0★ — o piso ─────────────────────────────────────────────────────────────

/**
 * Desqualificadores do piso: basta UM para a nota ser 0. Declarados como lista para o prompt e a
 * tela lerem a mesma coisa, e para o agente poder DIZER qual deles aplicou.
 */
export const PISO_ZERO = [
  {
    chave: 'mensuravel',
    texto: 'O ganho é mensurável com o que está descrito — volta como saving/receita.',
  },
  {
    chave: 'so_o_autor',
    texto: 'Ninguém além do autor usa de forma recorrente.',
  },
  {
    chave: 'simples_local',
    texto:
      'É tarefa simples e local, que uma planilha ou consulta manual resolveria sem mudar decisão nenhuma.',
  },
  { chave: 'fora_de_uso', texto: 'Não está em uso — descontinuado, POC ou parado.' },
  { chave: 'ressubmissao', texto: 'É ressubmissão do mesmo escopo já documentado.' },
] as const;

export type ChavePisoZero = (typeof PISO_ZERO)[number]['chave'];

// ─── 1★ a 5★ — a faixa do agente ─────────────────────────────────────────────

export type NivelEstrela = {
  nota: number;
  /** O verbo é o nome do critério: é assim que o time se refere a ele em voz alta. */
  verbo: string;
  criterio: string;
};

export const CRITERIOS_ESTRELA: NivelEstrela[] = [
  {
    nota: 1,
    verbo: 'Informa',
    criterio:
      'Produz o insumo, não a ação. Entrega dado, visibilidade, alerta, registro ou esforço poupado; alguém lê e age. Sem ele, a informação volta a ser buscada à mão.',
  },
  {
    nota: 2,
    verbo: 'Executa',
    criterio:
      'Assume a ação recorrente ponta a ponta e roda sem alguém iniciar. Não escolhe o que fazer — faz. Volume não muda o nível.',
  },
  {
    nota: 3,
    verbo: 'Garante',
    criterio:
      'Assume a barreira: impede que o erro passe (valida, bloqueia, exige registro, torna auditável o que era julgamento de cada um). A consequência evitada recai sobre outra pessoa ou área, não sobre quem fez.',
  },
  {
    nota: 4,
    verbo: 'Decide',
    criterio:
      'Assume a escolha que compromete recurso da empresa, por regra explícita e auditável. O erro dele tem consequência direta, mesmo que alguém aprove no fim.',
  },
  {
    nota: 5,
    verbo: 'Responde pelo resultado',
    criterio:
      'Está no caminho pelo qual o resultado chega ao cliente, ao fornecedor ou ao mercado, e não há intermediário humano entre a falha dele e o prejuízo. Seu alcance passa da área que o criou.',
  },
];

/**
 * A única promoção da régua: +1 nível quando outro processo ou projeto depende dele como fonte.
 * ⚠️ O dependente tem de ser NOMEADO — "poderá ser consultado" e "abre portas para" não valem (era
 * o que fazia meia base se declarar plataforma).
 */
export const PROMOCAO_DEPENDENTE_NOMEADO =
  'Outro processo ou projeto depende dele como fonte, com o dependente NOMEADO. Não vale "poderá ser consultado" nem "abre portas para".';

// ─── 6★ a 10★ — o escape ─────────────────────────────────────────────────────

/**
 * Os dois gatilhos do escape. **Ambos** têm de ser verdade; faltando um, a nota é 5★. São o que
 * torna a faixa RARA — e cada um exige evidência citada da doc (`escapeValido`).
 */
export const GATILHOS_ESCAPE = [
  {
    chave: 'nao_existiria',
    texto:
      'Existe atividade em curso hoje que NÃO existiria sem ele. Não "seria mais lenta": não existiria.',
  },
  {
    chave: 'sem_volta',
    texto:
      'Removê-lo não devolve o estado anterior — o jeito antigo deixou de existir como opção.',
  },
] as const;

export type ChaveGatilhoEscape = (typeof GATILHOS_ESCAPE)[number]['chave'];

/** O ranking que o agente SUGERE ao comitê. Ele nunca concede estes níveis. */
export const NIVEIS_ESCAPE: NivelEstrela[] = [
  {
    nota: 6,
    verbo: 'Habilita',
    criterio:
      'Torna possível um processo que não existia. Há gente fazendo algo novo por causa dele, não algo antigo melhor.',
  },
  {
    nota: 7,
    verbo: 'Suporta',
    criterio: 'Vários processos já rodam sobre ele, e nenhum deles tem alternativa em uso.',
  },
  {
    nota: 8,
    verbo: 'Concentra',
    criterio:
      'Virou o único ponto por onde aquilo acontece na empresa. Não há caminho paralelo, nem manual.',
  },
  {
    nota: 9,
    verbo: 'Redefine',
    criterio:
      'O padrão de operação mudou por causa dele — o jeito anterior deixou de ser referência para quem entra hoje.',
  },
  {
    nota: 10,
    verbo: 'Funda',
    criterio:
      'Outros projetos existem só porque ele existe, e a empresa passa a organizar decisões em torno dele.',
  },
];

// ─── Leitura da régua ────────────────────────────────────────────────────────

export function nivelDe(nota: number): NivelEstrela | null {
  return [...CRITERIOS_ESTRELA, ...NIVEIS_ESCAPE].find((n) => n.nota === nota) ?? null;
}

export function ehEscape(nota: number): boolean {
  return nota > TETO_AGENTE && nota <= NOTA_MAX;
}

/** Clampa a nota em [0, NOTA_MAX] e arredonda — a saída do LLM não é confiável como número. */
export function normalizarNota(bruta: unknown): number | null {
  const n = Number(bruta);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(NOTA_MAX, Math.round(n)));
}

/**
 * Aplica a promoção do dependente nomeado. Teto no `TETO_AGENTE`: a promoção NUNCA leva ao escape
 * (subir para 6★ exige os dois gatilhos, não uma dependência).
 */
export function aplicarPromocao(nota: number, temDependenteNomeado: boolean): number {
  if (!temDependenteNomeado || nota < 1) return nota;
  return Math.min(TETO_AGENTE, nota + 1);
}

/** Renderiza a faixa do agente para o prompt. Fonte única — não redigitar no prompt. */
export function descreverReguaAgente(): string {
  const piso = PISO_ZERO.map((p) => `  - ${p.texto}`).join('\n');
  const niveis = CRITERIOS_ESTRELA.map((n) => `${n.nota}★ — ${n.verbo}. ${n.criterio}`).join('\n');
  return [
    `PRINCÍPIO ORDENADOR: ${PRINCIPIO_ORDENADOR_AGENTE}`,
    '',
    '0★ — não recebe estrela. Basta UM destes:',
    piso,
    '',
    niveis,
    '',
    `PROMOÇÃO (+1 nível, teto ${TETO_AGENTE}★): ${PROMOCAO_DEPENDENTE_NOMEADO}`,
  ].join('\n');
}

/** Renderiza o escape para o prompt: gatilhos + ranking sugerido. */
export function descreverEscape(): string {
  const gatilhos = GATILHOS_ESCAPE.map((g, i) => `  ${i + 1}. ${g.texto}`).join('\n');
  const niveis = NIVEIS_ESCAPE.map((n) => `${n.nota}★ — ${n.verbo}. ${n.criterio}`).join('\n');
  return [
    `ESCAPE 6★–10★ — você NÃO concede, apenas indica ao comitê humano e sugere a posição.`,
    `PRINCÍPIO ORDENADOR: ${PRINCIPIO_ORDENADOR_ESCAPE}`,
    '',
    'GATILHO — os DOIS têm de ser verdade (faltando um, a nota é 5★):',
    gatilhos,
    '',
    niveis,
  ].join('\n');
}

// ─── Escape: validação da saída ──────────────────────────────────────────────

export type IndicacaoEscape = {
  sugestao: number;
  /** Cada gatilho com a frase da doc que o sustenta. Sem citação, o escape não vale. */
  evidencias: Partial<Record<ChaveGatilhoEscape, string>>;
};

/**
 * O escape só vale com os DOIS gatilhos evidenciados por citação da doc e a sugestão dentro de
 * 6–10. É o que impede o agente de mandar tudo ao comitê por entusiasmo.
 */
export function escapeValido(ind: IndicacaoEscape): boolean {
  if (!ehEscape(ind.sugestao)) return false;
  return GATILHOS_ESCAPE.every((g) => {
    const ev = ind.evidencias[g.chave];
    return typeof ev === 'string' && ev.trim().length > 0;
  });
}

// ─── Confiança (declarada, não sentida) ──────────────────────────────────────

export type Confianca = 'alta' | 'media' | 'baixa';

export type SinaisConfianca = {
  /** Os dois cérebros (mérito e estrela) concordam. */
  cerebrosConcordam: boolean;
  /** O critério aplicado vem com citação da doc. */
  temEvidenciaCitada: boolean;
  /** Há vizinhos no RAG acima do piso de similaridade. */
  temVizinhos: boolean;
};

/**
 * `alta` só com os três sinais; falta um → `media`; faltam dois ou mais → `baixa`. Regra explícita
 * de propósito: confiança que sai de julgamento do LLM não é auditável.
 */
export function confiancaDe(s: SinaisConfianca): Confianca {
  const ok = [s.cerebrosConcordam, s.temEvidenciaCitada, s.temVizinhos].filter(Boolean).length;
  if (ok === 3) return 'alta';
  if (ok === 2) return 'media';
  return 'baixa';
}

/** Escape e confiança baixa vão SEMPRE ao humano — o consenso nunca fecha na dúvida. */
export function deveIrParaHumano(nota: number, confianca: Confianca): boolean {
  return ehEscape(nota) || confianca === 'baixa';
}

// ─── D11 — contestação de âncora ─────────────────────────────────────────────

/** Teto do racional da contestação. Duas frases: é pauta de comitê, não ensaio. */
export const CONTESTACAO_MAX_FRASES = 2;

export type Contestacao = {
  notaHumana: number;
  notaRegua: number;
  criterioAplicado: string;
  /** O gatilho (ou critério) que falhou, nomeado. */
  gatilhoQueFalhou: string;
  racional: string;
  /** A frase da doc que sustenta a discordância. */
  evidencia: string;
};

export function contarFrases(texto: string): number {
  return texto
    .split(/[.!?]+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0).length;
}

/**
 * Projeto com nota humana NUNCA é reclassificado — a discordância vira contestação. Devolve `null`
 * quando não há o que contestar (a régua concorda ou dá nota MAIOR: nota humana é âncora, e subir
 * âncora é decisão do comitê, não achado do agente).
 */
export function montarContestacao(c: Contestacao): Contestacao | null {
  if (c.notaRegua >= c.notaHumana) return null;
  if (!c.evidencia.trim() || !c.gatilhoQueFalhou.trim()) return null;
  if (contarFrases(c.racional) > CONTESTACAO_MAX_FRASES) return null;
  return c;
}

// ─── D12 — achatamento (suspeita da régua, não dos projetos) ──────────────────

/** Acima disso, a concentração das quedas acusa a régua. */
export const LIMIAR_ACHATAMENTO = 0.5;

export type Achatamento = {
  suspeito: boolean;
  /** O nível de destino que concentra as quedas. `null` quando não houve queda. */
  destino: number | null;
  proporcao: number;
  total: number;
};

/**
 * Recebe o nível de DESTINO de cada queda do lote e acusa achatamento quando um único destino
 * concentra mais de `LIMIAR_ACHATAMENTO` delas. Muitos projetos convergindo para a mesma prateleira
 * é o sintoma de régua que não discrimina — não de projetos ruins.
 */
export function detectarAchatamento(destinos: number[]): Achatamento {
  if (destinos.length === 0) return { suspeito: false, destino: null, proporcao: 0, total: 0 };
  const contagem = new Map<number, number>();
  for (const d of destinos) contagem.set(d, (contagem.get(d) ?? 0) + 1);
  let destino = destinos[0];
  let maior = 0;
  for (const [nivel, qtd] of contagem) {
    if (qtd > maior || (qtd === maior && nivel < destino)) {
      maior = qtd;
      destino = nivel;
    }
  }
  const proporcao = maior / destinos.length;
  return { suspeito: proporcao > LIMIAR_ACHATAMENTO, destino, proporcao, total: destinos.length };
}
