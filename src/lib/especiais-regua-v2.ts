/**
 * RÉGUA DE ESTRELAS 0–10 — validada pelo Luis em 02/09/2026, depois de ~8 tentativas
 * rejeitadas. Módulo PURO e FONTE ÚNICA: os prompts interpolam daqui, não redigitam.
 *
 * ⚠️ **Por que a régua ANTERIOR não funcionava**: ela era CIRCULAR (`10 = "topo absoluto"`,
 * `6 = "o mesmo do 5, com alcance acima da média"`). Um critério que se define pela posição
 * não é verificável — o agente não tinha como decidir entre 5 e 7 a não ser por impressão,
 * e na dúvida descia. É por isso que, em 734 projetos, **nunca houve um 6★ nem um 9★**.
 *
 * Esta régua troca posição por VERBO: cada nível diz o que o projeto ASSUME, e o escape
 * (6–10) exige dois gatilhos que se checam contra a documentação.
 */

// ─── 0★: o que DERRUBA, por melhor que seja o memorial ───────────────────────

export const DERRUBADORES_ZERO: readonly string[] = [
  'tem ganho MENSURÁVEL (saving ou receita) — aí a régua é o impacto financeiro, não a estrela',
  'só o AUTOR usa: ninguém além dele o usa de forma recorrente',
  'é tarefa simples e local, que uma planilha resolveria sem mudar decisão nenhuma',
  'não está em uso — descontinuado, POC ou parado',
  'é RESSUBMISSÃO do mesmo escopo de um projeto que já existe',
] as const;

// ─── 1★ a 5★: a faixa do AGENTE ──────────────────────────────────────────────

export type NivelRegua = { estrela: number; verbo: string; criterio: string };

/**
 * Princípio ordenador: **quanto da cadeia `informação → ação → consequência` o projeto
 * assume**. Não é tamanho, não é sofisticação, não é quanto dinheiro move.
 */
export const NIVEIS_AGENTE: readonly NivelRegua[] = [
  {
    estrela: 1,
    verbo: 'Informa',
    criterio:
      'Produz o insumo, não a ação. Entrega dado, visibilidade, alerta, registro ou esforço poupado; alguém lê e age. Sem ele, a informação volta a ser buscada à mão.',
  },
  {
    estrela: 2,
    verbo: 'Executa',
    criterio:
      'Assume a ação recorrente ponta a ponta e roda sem alguém iniciar. Não escolhe o que fazer — faz. VOLUME NÃO MUDA O NÍVEL.',
  },
  {
    estrela: 3,
    verbo: 'Garante',
    criterio:
      'Assume a barreira: impede que o erro passe (valida, bloqueia, exige registro, torna auditável o que era julgamento de cada um). A consequência evitada recai sobre OUTRA pessoa ou área, não sobre quem fez.',
  },
  {
    estrela: 4,
    verbo: 'Decide',
    criterio:
      'Assume a escolha que compromete recurso da empresa, por regra explícita e auditável. O erro dele tem consequência direta, mesmo que alguém aprove no fim.',
  },
  {
    estrela: 5,
    verbo: 'Responde pelo resultado',
    criterio:
      'Está no caminho pelo qual o resultado chega ao cliente, ao fornecedor ou ao mercado, e NÃO há intermediário humano entre a falha dele e o prejuízo. Seu alcance passa da área que o criou.',
  },
] as const;

/**
 * O único bônus da faixa do agente, com TETO em 5★.
 * ⚠️ Exige o dependente NOMEADO: "poderá ser consultado" e "abre portas para" não valem.
 */
export const BONUS_DEPENDENCIA =
  '+1 nível (teto 5★) quando outro processo ou projeto passa a depender dele como FONTE, com o dependente NOMEADO. "Poderá ser consultado" e "abre portas para" NÃO valem.';

// ─── 6★ a 10★: o escape (agente indica, comitê humano decide) ────────────────

/**
 * ⚠️ Os DOIS gatilhos têm de ser verdade. Faltando um, a nota é 5★ — não 6.
 * É esta conjunção que impede o escape de virar entusiasmo.
 */
export const GATILHOS_ESCAPE: readonly string[] = [
  'Existe atividade em curso HOJE que NÃO EXISTIRIA sem ele. Não "seria mais lenta": não existiria.',
  'Removê-lo NÃO DEVOLVE o estado anterior — o jeito antigo deixou de existir como opção.',
] as const;

export const NIVEIS_ESCAPE: readonly NivelRegua[] = [
  { estrela: 6, verbo: 'Habilita', criterio: 'Torna possível um processo que não existia. Há gente fazendo algo NOVO por causa dele, não algo antigo melhor.' },
  { estrela: 7, verbo: 'Suporta', criterio: 'Vários processos já rodam sobre ele, e nenhum deles tem alternativa em uso.' },
  { estrela: 8, verbo: 'Concentra', criterio: 'Virou o ÚNICO ponto por onde aquilo acontece na empresa. Não há caminho paralelo, nem manual.' },
  { estrela: 9, verbo: 'Redefine', criterio: 'O padrão de operação mudou por causa dele — o jeito anterior deixou de ser referência para quem entra hoje.' },
  { estrela: 10, verbo: 'Funda', criterio: 'Outros projetos existem só porque ele existe, e a empresa passa a organizar decisões em torno dele.' },
] as const;

/**
 * ⚠️ Sem evidência CITADA da documentação o escape não vale. É o que impede o agente de
 * mandar tudo ao comitê por entusiasmo — e o que torna o escape auditável depois.
 */
export const SAIDA_ESCAPE =
  'faixa 6-10 · sugestão N★ · os 2 gatilhos, CADA UM com a evidência CITADA da doc · o que falta para N+1 · confiança';

export const ESCAPE_MINIMO = 6;

// ─── Renderização para os prompts (fonte única: não redigitar nos agentes) ────

export function descreverRegua(): string {
  const linha = (n: NivelRegua) => `${n.estrela}★ **${n.verbo}** — ${n.criterio}`;
  return [
    'O QUE DERRUBA PARA 0★ (verifique ANTES de qualquer coisa):',
    ...DERRUBADORES_ZERO.map((d) => `- ${d}`),
    '',
    'FAIXA 1★–5★ — princípio ordenador: quanto da cadeia informação → ação → consequência o projeto ASSUME.',
    ...NIVEIS_AGENTE.map((n) => `- ${linha(n)}`),
    `- ${BONUS_DEPENDENCIA}`,
    '',
    'FAIXA 6★–10★ — o ESCAPE. Muda o que se mede: não é mais quanto de UM processo ele assume,',
    'e sim QUANTOS processos existem por causa dele e quão IRREVERSÍVEL é a dependência.',
    'Os DOIS gatilhos têm de ser verdade; faltando um, a nota é 5★:',
    ...GATILHOS_ESCAPE.map((g, i) => `  ${i + 1}. ${g}`),
    ...NIVEIS_ESCAPE.map((n) => `- ${linha(n)}`),
    `⚠️ No escape, a saída OBRIGATÓRIA é: ${SAIDA_ESCAPE}. Sem evidência citada da documentação, o escape NÃO vale e a nota volta para 5★.`,
  ].join('\n');
}

// ─── Guards determinísticos ──────────────────────────────────────────────────

export type SinaisEscape = {
  /** O agente afirmou o gatilho 1 (atividade que não existiria)? */
  atividade_nova?: boolean | null;
  /** O agente afirmou o gatilho 2 (remover não devolve o estado anterior)? */
  irreversivel?: boolean | null;
  /** Trecho da doc citado como evidência. Vazio = escape sem lastro. */
  evidencia?: string | null;
};

/** Piso de caracteres para a evidência contar como CITAÇÃO, e não como paráfrase vazia. */
export const MIN_EVIDENCIA = 40;

/**
 * ⚠️ **Só REBAIXA, nunca promove** — a mesma disciplina de `normalizarClassificacao`. Uma nota
 * de escape sem os dois gatilhos afirmados E sem evidência citada volta para 5★.
 *
 * Por que rebaixar e não recusar: o trabalho do agente na faixa 1–5 continua válido; o que
 * não se sustenta é o salto. E por que NÃO existe promoção automática: um falso 8★ entra na
 * régua de todo mundo como âncora, e âncora errada contamina as notas seguintes.
 */
export function rebaixarEscapeSemLastro(
  estrela: number,
  sinais: SinaisEscape,
): { estrela: number; ajuste: string | null } {
  if (estrela < ESCAPE_MINIMO) return { estrela, ajuste: null };
  const evidencia = String(sinais.evidencia ?? '').trim();
  if (sinais.atividade_nova !== true)
    return { estrela: 5, ajuste: 'escape sem o gatilho 1 (atividade que não existiria) — voltou para 5★' };
  if (sinais.irreversivel !== true)
    return { estrela: 5, ajuste: 'escape sem o gatilho 2 (remover não devolve o estado anterior) — voltou para 5★' };
  if (evidencia.length < MIN_EVIDENCIA)
    return { estrela: 5, ajuste: 'escape sem evidência citada da documentação — voltou para 5★' };
  return { estrela, ajuste: null };
}

// ─── Sinal de GUARDA-CHUVA (vem da aglutinação) ──────────────────────────────

/**
 * Quantas features declaradas ou aceitas um projeto precisa ter para que o guarda-chuva
 * conte como evidência do gatilho 1 do escape.
 *
 * ⚠️ **Por que 2, e por que isto NÃO é um bônus de nota.** Um projeto que virou guarda-chuva
 * de outros é a evidência mais objetiva que temos do gatilho "existe atividade que não
 * existiria sem ele" — as features são essa atividade, com nome e linha na planilha. Mas ele
 * NÃO soma estrela sozinho: some-se e o caminho para inflar a nota passa a ser cadastrar
 * features, que é gameável e barato. O que ele faz é SATISFAZER um gatilho que, sem ele,
 * dependeria de o agente acreditar na prosa do memorial.
 *
 * Com 1 feature não vale: um filho é um incremento. A partir de 2, há um padrão.
 */
export const MIN_FEATURES_GUARDA_CHUVA = 2;

export type SinalGuardaChuva = {
  /** Ids das features que apontam para este projeto (declaradas ou aceitas no painel). */
  features: string[];
};

/**
 * O guarda-chuva satisfaz o gatilho 1? Devolve também a frase que serve de EVIDÊNCIA CITADA,
 * porque o escape exige evidência e esta é verificável na planilha, não no texto.
 */
export function guardaChuvaSatisfazGatilho(s: SinalGuardaChuva): { satisfaz: boolean; evidencia: string } {
  const n = s.features.filter((f) => String(f ?? '').trim()).length;
  if (n < MIN_FEATURES_GUARDA_CHUVA) return { satisfaz: false, evidencia: '' };
  return {
    satisfaz: true,
    evidencia: `${n} projetos foram submetidos como feature deste, e existem por causa dele: ${s.features.slice(0, 5).join(', ')}`,
  };
}
