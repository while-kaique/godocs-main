/**
 * Régua de ESTRELAS 0–10 — módulo PURO e **FONTE ÚNICA** dos critérios.
 *
 * Validada pelo dono do produto (Luis, 02/09/2026) depois de sete desenhos rejeitados e
 * **revisada por ele em 03/09/2026** à luz do T1 (§6.1 do plano). O registro da decisão, o que foi
 * descartado e por quê, e as tarefas estão em `docs/plans/regua-estrelas-e-time-unificado.md`.
 * ⚠️ **Não redigite critério em prompt nem em tela — altere estas constantes.**
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
 * ## O que a revisão de 03/09 mudou (e por quê)
 * - **0★ ganhou nome — `Experimenta` — e deixou de ser só uma lista de exclusões.** O piso agora
 *   inclui *impacto marginal*, *pouco relevante para a empresa como um todo* e *experimentação*,
 *   que é o que a base realmente tem no fundo da escala.
 * - **O item do piso que zerava tudo passou a exigir o "APENAS".** O T1 mediu o texto antigo (*"o
 *   ganho é mensurável"*) disparando em **484 de 484** não-especiais — por construção, todo
 *   não-especial tem ganho medido. Zera quem **se resume** ao número, não quem tem número.
 * - **Cada nível carrega CLASSE DE ARTEFATO típica e EXEMPLOS REAIS da base.** É a âncora que
 *   faltava: no T1 a régua sem exemplos achatou 60% do lote em 1★. ⚠️ Classe de artefato é
 *   **pista, nunca gate** — "é um dashboard" não decide a nota sozinho (um painel que bloqueia
 *   erro é 3★). Isto não contradiz o descarte de *classe de artefato como CAMPO do formulário*:
 *   o agente INFERE a classe, o autor não a declara.
 * - **5★ virou `Assume`** e recebeu como âncoras `Robo orçamento`, `GoBrands` e `CTR Machine` —
 *   que estavam em 7★–8★. Isso **resolve a pendência (1)** do plano na direção "caem para 5★".
 * - **6★–10★ virou UMA caixa, `Muda o Jogo`.** Os cinco verbos (Habilita/Suporta/Concentra/
 *   Redefine/Funda) saíram: o agente não sugere mais a POSIÇÃO dentro da faixa — ele indica a
 *   faixa e **o comitê humano define o número por critério comparativo** contra os projetos que
 *   já estão nela.
 *
 * ## Fronteiras que não podem regredir
 * - **0★ a 5★ é do agente; 6★ a 10★ é ESCAPE para comitê humano** — o agente indica a faixa,
 *   nunca concede (`TETO_AGENTE`).
 * - **Projeto com nota humana não é reclassificado.** Discordância vira CONTESTAÇÃO (D11): no
 *   máximo duas frases, com o gatilho que falhou NOMEADO e a evidência citada da doc.
 * - **Queda em massa para o mesmo nível é suspeita da RÉGUA, não dos projetos** (D12) — foi o
 *   defeito do desenho de "10 critérios somados", que empatava um projeto de milhões com um
 *   dashboard. Daí `detectarAchatamento`.
 * - **A forma esperada da distribuição é declarada** (`DISTRIBUICAO_ESPERADA`), porque lote que
 *   sobe demais é tão suspeito quanto lote que achata.
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

// ─── Forma dos níveis ────────────────────────────────────────────────────────

export type NivelEstrela = {
  nota: number;
  /** O verbo é o nome do critério: é assim que o time se refere a ele em voz alta. */
  verbo: string;
  criterio: string;
  /**
   * Classes de artefato típicas do nível. ⚠️ **Pista, NUNCA gate** — serve para o agente
   * reconhecer a prateleira, não para decidir a nota. Um painel que bloqueia erro é 3★ mesmo
   * sendo "um dashboard".
   */
  artefatos: string;
  /** Projetos REAIS da base que ancoram o nível (nomes como estão na planilha). */
  exemplos: string[];
};

// ─── 0★ — o piso ─────────────────────────────────────────────────────────────

/**
 * Desqualificadores do piso: basta UM para a nota ser 0★. Declarados como lista para o prompt e a
 * tela lerem a mesma coisa, e para o agente poder DIZER qual deles aplicou.
 */
export const PISO_ZERO = [
  {
    chave: 'apenas_mensuravel',
    texto:
      'O projeto se RESUME ao ganho mensurável: tudo o que ele entrega já está capturado pelo saving/receita declarado. ⚠️ Ter número NÃO zera — zera quando não sobra nada além do número.',
  },
  { chave: 'so_o_autor', texto: 'Ninguém além do autor usa de forma recorrente.' },
  {
    chave: 'simples_local',
    texto:
      'É simples e local: resolve uma tarefa pontual que uma planilha ou consulta manual resolveria, sem mudar decisão de ninguém.',
  },
  { chave: 'fora_de_uso', texto: 'Não está em uso — parado, descontinuado ou POC.' },
  {
    chave: 'marginal',
    texto:
      'O impacto é marginal, ou pouco relevante para a empresa como um todo — atende um caso de borda ou um punhado de pessoas.',
  },
  {
    chave: 'experimentacao',
    texto:
      'É experimentação: existe para testar uma ideia ou aprender uma ferramenta, não para sustentar uma rotina. ' +
      '⚠️ FALTA DE COMPROVAÇÃO NÃO É EXPERIMENTAÇÃO. "O memorial não comprova uso recorrente", "traz apenas o ' +
      'resultado esperado" ou "não mostra quem usa" são motivos para a NOTA BAIXA do seu eixo, nunca para o piso. ' +
      'Só marque aqui se o material disser que o projeto EXISTE para testar ou aprender: piloto declarado, POC, ' +
      'prova de conceito, dados sintéticos, "estamos testando". Sustentar uma rotina sem prova documentada ' +
      'continua sendo sustentar uma rotina.',
  },
  { chave: 'ressubmissao', texto: 'É ressubmissão do mesmo escopo já documentado.' },
] as const;

export type ChavePisoZero = (typeof PISO_ZERO)[number]['chave'];

/** A caixa do 0★ — tem nome e exemplos como qualquer outro nível. */
export const NIVEL_ZERO: NivelEstrela = {
  nota: 0,
  verbo: 'Experimenta',
  criterio:
    'Não recebe estrela: basta UM dos desqualificadores do piso ser verdade. É o fundo da escala e é onde a maior parte da base cai.',
  artefatos: 'Dashboards, apps e skills simples.',
  exemplos: ['Automação de mimos de aniversário', 'Cruzamento de XML'],
};

// ─── 1★ a 5★ — a faixa do agente ─────────────────────────────────────────────

export const CRITERIOS_ESTRELA: NivelEstrela[] = [
  {
    nota: 1,
    verbo: 'Informa',
    criterio:
      'Produz o insumo, não a ação: entrega dado, visibilidade, alerta ou registro, e alguém lê e age. Sem ele, a informação volta a ser buscada à mão.',
    artefatos: 'Dashboards e apps gerenciais. Skills mais complexas, com rotina informativa.',
    exemplos: ['Damidash', 'Godash'],
  },
  {
    nota: 2,
    verbo: 'Executa',
    criterio:
      'Assume a ação recorrente ponta a ponta e roda sem ninguém iniciar. Não escolhe o que fazer — faz. Volume não muda o nível.',
    artefatos: 'Rotinas mais complexas, com execução automática. Bots em geral.',
    exemplos: ['Tiktok Scraper', 'Live Machine'],
  },
  {
    nota: 3,
    verbo: 'Garante',
    criterio:
      'Impede o erro de passar: valida, bloqueia, exige registro, torna auditável o que era julgamento de cada um. A consequência evitada recai sobre OUTRA área e tem impacto na operação.',
    artefatos:
      'Alertas de alto impacto na operação. Painéis gerenciais com autonomia de bloqueio de erro.',
    exemplos: ['SAIBBI', 'Checklist de turno'],
  },
  {
    nota: 4,
    verbo: 'Decide',
    criterio:
      'Assume a escolha que compromete recurso da empresa, por regra auditável. Decide de forma estocástica, não determinística — há inteligência agregada, não uma tabela de "se isto, então aquilo". O erro dele tem consequência direta, mesmo que alguém aprove no fim.',
    artefatos:
      'Agentes mais complexos, necessariamente com inteligência agregada; envolve aprendizado de máquina.',
    exemplos: ['GoPrice', 'Cases IA'],
  },
  {
    nota: 5,
    verbo: 'Assume',
    criterio:
      'Está no caminho até o cliente, o fornecedor ou o mercado, sem humano entre a falha dele e o prejuízo. Assume a responsabilidade pela entrega final, com meta clara e auditável sendo entregue.',
    artefatos:
      'Agentes complexos, com claws, graph engineering e auto-cura. Metas claras e auditáveis sendo entregues.',
    // ⚠️ 11/09/2026: `Robo orçamento` (8★ humano), `GoBrands` (7★) e `CTR Machine` (7★) SAÍRAM daqui.
    // Estavam listados como âncoras de 5★ e o cérebro da estrela os copiava: nos canários da rodada
    // de calibragem, Robô orçamento e GoBrands saíram 5★ sem escape, contra 8 e 7 de gente. A
    // verdade da base é a coluna "Estrelas" humana, e ela os põe na faixa 6-10 — hoje são exemplos
    // de `ESCAPE_MUDA_O_JOGO.exemplos`. Um exemplo em nível errado é a forma mais barata de ancorar
    // errado a base inteira.
    exemplos: ['CX - Ticket Creator', 'Plataforma Smartonline - Pagamento de DIFAL'],
  },
];

/**
 * A única promoção da régua: +1 nível quando outro processo ou projeto depende dele como fonte.
 * ⚠️ O dependente tem de ser NOMEADO — "poderá ser consultado" e "abre portas para" não valem (era
 * o que fazia meia base se declarar plataforma).
 *
 * ⚠️ **Medida no T1: letra morta hoje** — apareceu em 4 de 484 e promoveu 1. Só volta a existir
 * quando o dado do dependente nomeado for coletado; não é motivo para afrouxar o critério.
 */
export const PROMOCAO_DEPENDENTE_NOMEADO =
  'Outro processo ou projeto depende dele como fonte, com o dependente NOMEADO. Não vale "poderá ser consultado" nem "abre portas para".';

// ─── O SEGUNDO EIXO: o TAMANHO do impacto ────────────────────────────────────

/**
 * ⚠️ **Por que este eixo existe (10/09/2026, dono do produto).** A régua acima mede UMA coisa:
 * quanto da cadeia `informação → ação → consequência` o projeto assume. É uma régua de FUNÇÃO, e
 * ela é cega ao tamanho — então um projeto pode responder, sozinho, por um sexto do ganho mensal
 * de toda a empresa e ainda sair «Executa», porque "assume a ação recorrente e roda sem ninguém
 * iniciar" descreve exatamente o que ele faz.
 *
 * Não era desafinação de prompt: o «SendApp» saiu **2★ em três rodadas de produção** (2, 2, 2),
 * com o critério "executa" aplicado e evidência citada do dossiê. A nota estava certa PARA A RÉGUA
 * que existia. Palavras dele: *"pelo o que esta escrito e pelo impacto do prjoeto, ele claramente
 * é um muda o jogo… tem um impacto liqudio de ~100mil por mes. É 20% de todos os projetos da
 * empresa em ganho liquido mensal"* e, antes, *"devemos garantir de que as estrelas sejam dadas
 * por nivel de complexidade do projeto e o quao impactante ele é"* — duas dimensões, e só uma
 * estava implementada.
 *
 * ⚠️ **É PISO, nunca teto, e nunca desce nota.** A nota final é o MAIOR entre o que a régua da
 * função concluiu e o piso do tamanho: dinheiro grande não pode segurar um projeto embaixo, e
 * dinheiro pequeno não derruba projeto que garante, decide ou assume (é o mesmo princípio já
 * medido nas lentes: *um eixo fraco não desmente a caixa; para baixo existe só o piso*).
 *
 * ⚠️ **É CALCULADO, não julgado.** O corte é share do impacto líquido mensal da base aprovada, em
 * número, e não uma frase no prompt pedindo "considere o impacto" — porque prompt não segura (este
 * repo já pagou por isso três vezes). O prompt recebe o eixo para RACIOCINAR; o piso é aplicado
 * por fora, determinístico, e diz qual faixa aplicou.
 */
export const PRINCIPIO_SEGUNDO_EIXO =
  'Quanto do ganho mensal da empresa depende deste projeto sozinho.';

/**
 * O denominador: soma do `Impacto Líquido Mensal` de TODOS os projetos aprovados.
 *
 * ⚠️ **Medido, datado e declarado** — R$ 630.566/mês em 10/09/2026, sobre 561 aprovados de
 * produção (a mediana da base é R$ 284/mês, o que é a razão de os cortes abaixo serem pequenos em
 * percentual e enormes em posição). Serve como referência quando o total real não é passado; quem
 * tem a base em mãos deve passar `totalBase` e o cálculo usa o número do dia.
 * ⚠️ Reancorar isto é DECISÃO (muda nota na base inteira), não manutenção.
 */
export const BASE_IMPACTO_MENSAL_REFERENCIA = 630_566;
export const BASE_IMPACTO_MEDIDA_EM = '10/09/2026';

/**
 * As faixas do segundo eixo, em share da base. Ordem: da maior para a menor (a primeira que casa
 * vence). Os cortes foram escolhidos pela FORMA da base medida, não por gosto:
 * `≥4%` = 3 projetos · `≥1,5%` = 11 · `≥0,5%` = 37 (6,6% dos aprovados, dentro do teto de 20%
 * acima de 3★ que a `DISTRIBUICAO_ESPERADA` declara).
 */
export const EIXO_IMPACTO = [
  {
    chave: 'dominante',
    shareMin: 0.04,
    piso: 5,
    texto:
      'Sozinho responde por 4% ou mais do impacto líquido mensal de toda a base aprovada. Nessa altura o projeto não é "uma automação da área": desligá-lo tira um pedaço visível do resultado da empresa no mês.',
  },
  {
    chave: 'material',
    shareMin: 0.015,
    piso: 4,
    texto:
      'Responde por 1,5% ou mais do impacto líquido mensal da base — dezenas de vezes a mediana. O ganho dele aparece no consolidado da empresa, não só no da área.',
  },
  {
    chave: 'relevante',
    shareMin: 0.005,
    piso: 3,
    texto:
      'Responde por 0,5% ou mais do impacto líquido mensal da base. Está entre as poucas dezenas de projetos que carregam o número da empresa.',
  },
] as const;

export type ChaveEixoImpacto = (typeof EIXO_IMPACTO)[number]['chave'];

/**
 * Share a partir do qual o projeto é CANDIDATO NATURAL à faixa 6–10.
 *
 * ⚠️ **Candidato, não promovido.** A entrada na faixa continua exigindo os dois gatilhos citados
 * (`GATILHOS_ESCAPE`) e o número final continua sendo do comitê humano. O que o tamanho faz é
 * obrigar o agente a olhar: um projeto que é 10% do ganho da empresa e não é "muda o jogo" precisa
 * de uma frase dizendo qual gatilho falta — que é o que o `escape.por_que_nao` já cobra.
 */
export const CANDIDATO_ESCAPE_SHARE = 0.1;

/**
 * O piso NÃO vale quando o projeto está fora de uso ou é ressubmissão.
 *
 * ⚠️ São os dois desqualificadores que dizem *"isto não é um projeto vivo"* — e é o único jeito de
 * um número grande num projeto parado não virar 5★. Os outros cinco itens do `PISO_ZERO` (marginal,
 * só o autor, apenas mensurável…) NÃO bloqueiam: eles falam do tamanho ou do alcance, e é
 * justamente sobre isso que este eixo tem dado novo — um projeto que é 15% do ganho da empresa não
 * é "marginal", e afirmar as duas coisas juntas é contradição, não critério.
 */
export const PISO_IMPACTO_NAO_VALE_COM: readonly ChavePisoZero[] = ['fora_de_uso', 'ressubmissao'];

export type PisoDeImpacto = {
  chave: ChaveEixoImpacto;
  /** A nota mínima que este tamanho garante. */
  piso: number;
  /** Fração da base que este projeto representa (0..1). */
  share: number;
  shareMin: number;
  texto: string;
  /** O tamanho é grande o bastante para o projeto ser candidato à faixa 6–10? */
  candidatoAoEscape: boolean;
};

/**
 * A régua do segundo eixo, PURA e determinística. `null` = o tamanho não garante piso nenhum.
 *
 * ⚠️ **Impacto ausente, zero ou negativo devolve `null`** — e isso é deliberado: especial e ganho
 * imensurável não têm número, e "sem número" não pode virar nem piso nem castigo (é a mesma
 * disciplina de `notaParaOPiso`, onde nota ausente não reprova).
 * ⚠️ `totalBase` inválido cai na referência medida em vez de dividir por zero.
 */
export function pisoPorImpacto(args: {
  impactoMensal: number | null | undefined;
  totalBase?: number | null;
}): PisoDeImpacto | null {
  const v = typeof args.impactoMensal === 'number' && Number.isFinite(args.impactoMensal) ? args.impactoMensal : 0;
  if (v <= 0) return null;
  const totalCru = typeof args.totalBase === 'number' && Number.isFinite(args.totalBase) ? args.totalBase : 0;
  const total = totalCru > 0 ? totalCru : BASE_IMPACTO_MENSAL_REFERENCIA;
  const share = v / total;
  const faixa = EIXO_IMPACTO.find((f) => share >= f.shareMin);
  if (!faixa) return null;
  return {
    chave: faixa.chave,
    piso: faixa.piso,
    share,
    shareMin: faixa.shareMin,
    texto: faixa.texto,
    candidatoAoEscape: share >= CANDIDATO_ESCAPE_SHARE,
  };
}

/** Como o share aparece para gente ler: "15,4% do impacto mensal da base". */
export function descreverShare(share: number): string {
  const pct = share * 100;
  const casas = pct >= 10 ? 1 : pct >= 1 ? 1 : 2;
  return `${pct.toFixed(casas).replace('.', ',')}% do impacto líquido mensal da base`;
}

/**
 * Renderiza o segundo eixo para o prompt, com o tamanho DESTE projeto já calculado quando ele
 * existe. Fonte única — não redigitar percentual nem corte no prompt.
 */
export function descreverEixoImpacto(piso?: PisoDeImpacto | null): string {
  const faixas = EIXO_IMPACTO.map(
    (f) => `  - ${f.piso}★ no mínimo: ${f.texto}`,
  ).join('\n');
  const linhas = [
    `SEGUNDO EIXO — TAMANHO DO IMPACTO: ${PRINCIPIO_SEGUNDO_EIXO}`,
    '',
    'A régua de 0★–5★ acima mede FUNÇÃO (quanto da cadeia o projeto assume) e é cega ao tamanho.',
    'Um projeto pode "só executar" e ainda ser uma das maiores fontes de ganho da empresa — nesse caso',
    'a caixa dele não é 2★. O tamanho entra como PISO, calculado, nunca como teto:',
    '',
    faixas,
    '',
    `Fora de uso e ressubmissão NÃO recebem piso por tamanho (projeto parado não sobe por dinheiro).`,
    'Alcance também é tamanho: um projeto usado por VÁRIAS empresas do grupo carrega mais processos',
    'que um usado por uma área, e isso pesa no seu racional.',
  ];
  if (piso) {
    linhas.push(
      '',
      `TAMANHO DESTE PROJETO: ${descreverShare(piso.share)} — piso ${piso.piso}★ (faixa "${piso.chave}").`,
      `A sua nota não pode ficar abaixo de ${piso.piso}★, e ela será elevada automaticamente se ficar. Justifique a partir daí.`,
    );
    if (piso.candidatoAoEscape) {
      linhas.push(
        `⚠️ Nessa altura o projeto é CANDIDATO NATURAL à faixa ${FAIXA_ESCAPE.min}★–${FAIXA_ESCAPE.max}★: examine os dois gatilhos do PASSO 1 com cuidado e, se recusar, diga qual falta.`,
      );
    }
  }
  return linhas.join('\n');
}

// ─── 6★ a 10★ — o escape ("Muda o Jogo") ─────────────────────────────────────

/** A faixa inteira, que o agente indica mas não fatia. */
export const FAIXA_ESCAPE = { min: TETO_AGENTE + 1, max: NOTA_MAX } as const;

/**
 * ⚠️ **Revisão de 03/09/2026:** os cinco verbos que existiam aqui (Habilita · Suporta · Concentra ·
 * Redefine · Funda) foram REMOVIDOS. O agente não sugere mais a posição dentro de 6★–10★: ele
 * indica a faixa, e **o comitê humano define o número por critério comparativo** contra os
 * projetos que já estão nela. Não reintroduzir os cinco níveis sem decisão do dono do produto.
 */
/**
 * ⚠️ **Revisão de 03/09/2026 (Luis):** saiu o traço *"Substitui humanos de maneira clara e
 * inequívoca"*. Ele era o mais duro de provar — quase nenhum projeto da base substitui gente de
 * forma inequívoca, e o traço acabava lido como requisito, empurrando candidatos legítimos para
 * fora da faixa. O que ficou descreve o EFEITO (revoluciona o trabalho, move KPI e resultado,
 * abre frente nova), não a contrapartida em pessoas.
 */
export const ESCAPE_MUDA_O_JOGO = {
  verbo: 'Muda o Jogo',
  criterio:
    'Revoluciona como a área — ou a empresa — trabalha. O agente INDICA a faixa; quem define o número é o comitê humano, comparando com os projetos que já estão em 6★–10★.',
  /** Os traços que descrevem a faixa. São a leitura do dono do produto, não um checklist somado. */
  tracos: [
    'Revoluciona como a área — ou a empresa — trabalha.',
    'Sistema agêntico com impacto direto nos KPIs e no resultado financeiro.',
    'Abre novas frentes de receita ou de saving.',
  ],
  /**
   * Projetos REAIS que o comitê humano já colocou na faixa (nota humana ≥ 6 na base, 11/09/2026).
   * São a âncora de comparação do PASSO 1: "este projeto se parece mais com estes ou com os de 5★?".
   * ⚠️ Nomes como estão na planilha. Quem confere a nota humana ao vivo é `ancorasDe` (espelho); esta
   * lista é o mínimo que o prompt carrega mesmo sem espelho.
   */
  exemplos: ['PIAPP', 'Robo orçamento', 'GoBrands', 'CTR Machine', 'SendApp'],
} as const;

/**
 * Os dois gatilhos de ENTRADA na faixa. **Ambos** têm de ser verdade; faltando um, a nota é 5★.
 * São o que a torna RARA — na base inteira só 4 projetos já estiveram nela — e cada um exige
 * evidência citada da doc (`escapeValido`). Vieram da régua validada em 02/09 e a revisão de 03/09
 * não os contradisse.
 */
export const GATILHOS_ESCAPE = [
  {
    chave: 'nao_existiria',
    texto:
      'Existe atividade em curso hoje que NÃO existiria sem ele. Não "seria mais lenta": não existiria. Ter existido uma versão MANUAL de parte do trabalho não nega o gatilho: ele pergunta pela atividade NOVA (volume, horário, alcance, produto) que só existe por causa dele.',
  },
  {
    chave: 'sem_volta',
    texto: 'Removê-lo não devolve o estado anterior — o jeito antigo deixou de existir como opção.',
  },
] as const;

export type ChaveGatilhoEscape = (typeof GATILHOS_ESCAPE)[number]['chave'];

// ─── Distribuição esperada (calibragem declarada) ────────────────────────────

/**
 * A forma que o dono do produto espera da base. Existe para MEDIR o lote (T1/T7/T9), não para ser
 * despejada no prompt como cota: dizer ao modelo "a maioria é 0★" convida-o a zerar tudo, que foi
 * exatamente o defeito que o T1 encontrou pelo outro caminho.
 */
export const DISTRIBUICAO_ESPERADA = {
  texto:
    'A maioria dos projetos cai entre 0★ e 3★, e dentro dessa faixa a concentração é em 0★ e 1★. 4★ e 5★ são raros; 6★–10★ é excepcional.',
  /** Piso da proporção que se espera em 0★–3★. */
  minAte3: 0.8,
  /** Teto da proporção que se espera acima de 3★ — acima disso o lote está inflado. */
  maxAcimaDe3: 0.2,
} as const;

export type Calibragem = {
  ok: boolean;
  /** `inflado` (nota alta demais), `achatado` (um só destino domina) ou `null`. */
  desvio: 'inflado' | 'achatado' | null;
  proporcaoAte3: number;
  proporcaoAcimaDe3: number;
  total: number;
};

/**
 * Confere a FORMA de um lote de notas contra `DISTRIBUICAO_ESPERADA`. Complementa o
 * `detectarAchatamento`: aquele acusa a régua que não discrimina, este acusa a que infla.
 */
export function conferirCalibragem(notas: number[]): Calibragem {
  const total = notas.length;
  if (total === 0)
    return { ok: true, desvio: null, proporcaoAte3: 0, proporcaoAcimaDe3: 0, total: 0 };
  const ate3 = notas.filter((n) => n <= 3).length / total;
  const acima = 1 - ate3;
  const achatado = detectarAchatamento(notas).suspeito;
  if (acima > DISTRIBUICAO_ESPERADA.maxAcimaDe3)
    return { ok: false, desvio: 'inflado', proporcaoAte3: ate3, proporcaoAcimaDe3: acima, total };
  if (achatado)
    return { ok: false, desvio: 'achatado', proporcaoAte3: ate3, proporcaoAcimaDe3: acima, total };
  return { ok: true, desvio: null, proporcaoAte3: ate3, proporcaoAcimaDe3: acima, total };
}

// ─── Leitura da régua ────────────────────────────────────────────────────────

export function nivelDe(nota: number): NivelEstrela | null {
  return [NIVEL_ZERO, ...CRITERIOS_ESTRELA].find((n) => n.nota === nota) ?? null;
}

export function ehEscape(nota: number): boolean {
  return nota >= FAIXA_ESCAPE.min && nota <= FAIXA_ESCAPE.max;
}

/** Clampa a nota em [0, NOTA_MAX] e arredonda — a saída do LLM não é confiável como número. */
export function normalizarNota(bruta: unknown): number | null {
  const n = Number(bruta);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(NOTA_MAX, Math.round(n)));
}

/**
 * Aplica a promoção do dependente nomeado. Teto no `TETO_AGENTE`: a promoção NUNCA leva ao escape
 * (entrar em 6★ exige os dois gatilhos, não uma dependência).
 */
export function aplicarPromocao(nota: number, temDependenteNomeado: boolean): number {
  if (!temDependenteNomeado || nota < 1) return nota;
  return Math.min(TETO_AGENTE, nota + 1);
}

function renderNivel(n: NivelEstrela): string {
  return [
    `${n.nota}★ — ${n.verbo}. ${n.criterio}`,
    `   Costuma ser: ${n.artefatos}`,
    `   Exemplos reais: ${n.exemplos.join(' · ')}`,
  ].join('\n');
}

/** Renderiza a faixa do agente para o prompt. Fonte única — não redigitar no prompt. */
export function descreverReguaAgente(): string {
  const piso = PISO_ZERO.map((p) => `  - ${p.texto}`).join('\n');
  const niveis = CRITERIOS_ESTRELA.map(renderNivel).join('\n\n');
  return [
    `PRINCÍPIO ORDENADOR: ${PRINCIPIO_ORDENADOR_AGENTE}`,
    '',
    'A classe do artefato ("é um dashboard", "é um bot") é PISTA da prateleira, nunca a decisão:',
    'o que define o nível é quanto da cadeia o projeto assume.',
    '',
    renderNivel(NIVEL_ZERO),
    '   Basta UM destes ser verdade:',
    piso,
    '',
    niveis,
    '',
    `PROMOÇÃO (+1 nível, teto ${TETO_AGENTE}★): ${PROMOCAO_DEPENDENTE_NOMEADO}`,
  ].join('\n');
}

/** Renderiza o escape para o prompt: gatilhos de entrada + o que a faixa é. */
export function descreverEscape(): string {
  const gatilhos = GATILHOS_ESCAPE.map((g, i) => `  ${i + 1}. ${g.texto}`).join('\n');
  const tracos = ESCAPE_MUDA_O_JOGO.tracos.map((t) => `  - ${t}`).join('\n');
  return [
    `ESCAPE ${FAIXA_ESCAPE.min}★–${FAIXA_ESCAPE.max}★ — ${ESCAPE_MUDA_O_JOGO.verbo}.`,
    ESCAPE_MUDA_O_JOGO.criterio,
    `PRINCÍPIO ORDENADOR: ${PRINCIPIO_ORDENADOR_ESCAPE}`,
    '',
    'PARA ENTRAR NA FAIXA — os DOIS têm de ser verdade (faltando um, a nota é 5★):',
    gatilhos,
    '',
    'Como a faixa se parece:',
    tracos,
    '',
    `Projetos que o comitê humano JÁ colocou nesta faixa (compare com eles): ${ESCAPE_MUDA_O_JOGO.exemplos.join(' · ')}.`,
    '',
    'O CASO DA PLATAFORMA — leia com atenção, é onde mais se erra:',
    'Quando OUTRO projeto ou processo, NOMEADO, roda em cima deste (consome API, MCP, integração)',
    'e nasceu depois dele, os DOIS gatilhos estão satisfeitos por esse mesmo fato:',
    '  · gatilho 1 — o projeto dependente É a atividade que não existiria sem ele;',
    '  · gatilho 2 — o dependente não tem "jeito antigo" para onde voltar, porque nunca existiu sem ele.',
    'A citação é a frase do dossiê que NOMEIA o dependente. NÃO exija uma confissão literal do tipo',
    '"o processo antigo foi abandonado": memorial nenhum escreve isso, e cobrá-la reprova plataforma',
    'legítima. Um dependente nomeado basta; dois ou mais tornam o caso evidente.',
    '⚠️ Isso NÃO vale para "poderá ser usado por", "abre portas para" ou dependente sem nome — aí',
    'não há atividade em curso, e a nota fica em 5★.',
    '',
    `O VEREDITO é a FAIXA ${FAIXA_ESCAPE.min}-${FAIXA_ESCAPE.max}, e ela é um NÍVEL inteiro, não um trecho de escala.`,
    `⚠️ NÃO escolha um número dentro da faixa. Não recomende ${FAIXA_ESCAPE.min}, nem ${FAIXA_ESCAPE.max}, nem nada no meio.`,
    `Responda exatamente ${NOTA_ESCAPE} no campo da nota: aqui esse ${NOTA_ESCAPE} NÃO quer dizer "${NOTA_ESCAPE} estrelas", é a marca de que o`,
    'projeto caiu neste nível. Quem crava o número final é o comitê humano, comparando com quem já está lá.',
    'No porquê, explique por que o projeto MUDA O JOGO. Não escreva por que seria um número e não outro.',
    'Cite a evidência de cada gatilho.',
  ].join('\n');
}

/**
 * Como o PORQUÊ é escrito — **FONTE ÚNICA**, interpolada pelos prompts que produzem texto lido
 * por gente (classificador, cérebro da estrela, lentes do painel).
 *
 * ⚠️ Estava DIGITADA DUAS VEZES, palavra por palavra, em `agents/especial-classificador.ts` e
 * em `avaliacao/cerebro-estrela.ts`. Duas cópias divergem na primeira vez que alguém melhora uma
 * frase — e este texto é a única coisa que a pessoa da triagem realmente lê. Não redigite: altere
 * a constante.
 *
 * ⚠️ **Regras de 03/09/2026 (Luis):** linguagem natural, fácil, que um leigo entenda de primeira,
 * e **sem travessão nem hífen como pontuação**. "Quem entende o que é complexo explica fácil" —
 * mas sem ser prolixo: explicar fácil é escrever CURTO, não escrever mais.
 */
export const REGRAS_DO_PORQUE = `COMO ESCREVER O PORQUÊ (quem lê não conhece a régua por dentro e não vai perguntar):
- Escreva 2 a 3 frases curtas, nesta ordem: o que o projeto FAZ · por que é essa nota e não a de cima · o que faria subir, em termos concretos deste projeto.
- LINGUAGEM NATURAL, de conversa. Quem entende de verdade explica fácil: escreva como explicaria a alguém de outra área, que nunca viu este sistema. Se uma frase precisa ser relida para ser entendida, reescreva.
- CURTO. Explicar fácil é escrever menos, não mais. Nada de rodeio, preâmbulo ou repetir com outras palavras o que já foi dito.
- ⚠️ NÃO use travessão (—) nem hífen (-) como pontuação no meio da frase. Separe com vírgula, ponto ou dois pontos. Hífen só dentro de palavra composta.
- PROIBIDO usar o vocabulário interno da régua. Nunca escreva: "gatilho", "escape", "piso", "critério aplicado", "desqualificador", "faixa", "promoção", "dependente nomeado", "modo anterior deixou de existir", "irreversibilidade", "não existiria sem ele". Essas são as palavras do CÓDIGO, não do leitor.
- Diga a mesma coisa em português comum. Em vez de "falta prova de que o modo anterior deixou de existir", escreva "para subir, faltaria mostrar que ninguém mais faz esse trabalho do jeito antigo". Em vez de "sem dependente nomeado", escreva "nenhum outro projeto é citado como dependente deste".
- Nada de "conforme a régua", "de acordo com o critério", "alinhado ao nível". Fale do PROJETO, não do instrumento.
- Citar um projeto de comparação é bom e ajuda ("faz o mesmo que o Godash, que é 1"). Citar o número do critério não é.`;

// ─── Escape: validação da saída ──────────────────────────────────────────────

export type IndicacaoEscape = {
  /**
   * MARCA de que o agente indicou a faixa — não é posição dentro dela (ver `NOTA_ESCAPE`).
   * Qualquer valor DENTRO da faixa vale como "indico o escape", e é colapsado em `NOTA_ESCAPE`
   * antes de virar nota, porque a faixa é um nível único.
   */
  sugestao: number;
  /** Cada gatilho com a frase da doc que o sustenta. Sem citação, o escape não vale. */
  evidencias: Partial<Record<ChaveGatilhoEscape, string>>;
};

/**
 * A marca da faixa de escape — **um valor só para todo o nível**.
 *
 * ⚠️ Isto NÃO é "6 estrelas". A faixa é um SÉTIMO NÍVEL, ao lado de 0..5 e não acima deles por
 * gradação: o projeto que cai aqui não se classificou em nenhuma das seis caixas. Guardar 6, 7 ou
 * 8 daria a impressão de posição dentro de uma escala que não tem degrau nenhum definido — a
 * régua descreve os cinco verbos de 0 a 5 e, de propósito, NÃO descreve o que separa um 7 de um 8.
 *
 * ⚠️ **Pedir a sugestão ao agente foi tentado e revertido (04/09/2026).** O prompt mandava
 * recomendar um número e justificar "por que esse e não o vizinho"; como não existe critério que
 * separe os vizinhos, o modelo preenchia com prosa plausível e sem lastro, e o número aparecia ao
 * lado do rótulo da faixa competindo com ele. Não voltar a pedir: quem crava 6, 7, 8, 9 ou 10 é o
 * comitê humano, comparando com quem já está na faixa.
 */
export const NOTA_ESCAPE = FAIXA_ESCAPE.min;

/** Colapsa qualquer valor da faixa na marca única, para que o nível seja UM balde e não cinco. */
export function normalizarEscape(nota: number): number {
  return ehEscape(nota) ? NOTA_ESCAPE : nota;
}

/**
 * O escape só vale com os DOIS gatilhos evidenciados por citação da doc e a indicação dentro da
 * faixa. É o que impede o agente de mandar tudo ao comitê por entusiasmo.
 */
export function escapeValido(ind: IndicacaoEscape): boolean {
  if (!ehEscape(ind.sugestao)) return false;
  return GATILHOS_ESCAPE.every((g) => {
    const ev = ind.evidencias[g.chave];
    return typeof ev === 'string' && ev.trim().length > 0;
  });
}

/**
 * Como a nota do agente APARECE para quem decide.
 *
 * ⚠️ Dentro de 0 a ${TETO_AGENTE} o agente dá uma nota. Na faixa de escape ele **declara a
 * FAIXA** e o número que ele devolve é SUGESTÃO, não veredito: quem crava 6, 7, 8, 9 ou 10 é o
 * comitê humano, comparando com quem já está lá. Mostrar "6★" na tela apaga essa diferença e
 * convida a triagem a aplicar o número com um clique, que é exatamente o que não pode acontecer.
 */
export function rotuloNotaAgente(nota: number, escape?: boolean | null): { rotulo: string; sugestao: number | null } {
  // ⚠️ O time NUNCA produz nota ≥ 6: o cérebro é travado em `TETO_AGENTE` e o escape viaja num
  // booleano à parte. Sem este parâmetro a coluna dizia "5" enquanto o funil dizia 6-10 para o
  // MESMO projeto (caso AVD Central v2, 10/09/2026).
  return escape === true || ehEscape(nota)
    ? { rotulo: `${FAIXA_ESCAPE.min}-${FAIXA_ESCAPE.max}`, sugestao: null }
    : { rotulo: String(nota), sugestao: null };
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
 * de propósito: confiança que sai de julgamento do LLM não é auditável — medido no T1, o modelo
 * auto-declarou `alta` em 456 de 484.
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
