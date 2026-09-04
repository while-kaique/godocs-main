/**
 * Avaliadores por LENTE (T3 do painel de agentes) — parte PURA separada da chamada de LLM.
 *
 * ## Por que lentes DISTINTAS e não N cópias do mesmo prompt
 * N cópias do mesmo juiz concordam por construção: a "convergência" mede o prompt, não o projeto.
 * Aqui cada lente recebe **só os critérios do seu eixo** (importados da régua, `CRITERIOS` —
 * ⚠️ **não redigitar a régua aqui**) e uma lista explícita do que ela **NÃO** julga. Duas lentes
 * discordando é informação; duas cópias concordando é teatro.
 *
 * ## Por que a nota de cada lente é um TETO, não um voto
 * Cada lente responde uma pergunta só: **"qual a nota mais alta da régua que ESTE eixo sustenta?"**
 * Isso é o que permite consolidar sem MÉDIA — e a média é justamente o defeito medido do juiz de
 * hoje: no T1 o viés agregado deu −0,06 (leria como calibrado) escondendo **COMPRESSÃO PARA O
 * MEIO** (0★ humano → +1,94; 7★ humano → −7). Média de N lentes FABRICA essa compressão: lente 0
 * + lente 4 = 2, exatamente o erro que se quer matar. Ver `consolidarLentes`.
 *
 * ## O eixo estrutural é GATE, não mais uma opinião
 * A régua é conjuntiva no topo (3★ = "inteligência no fluxo **+** recorrência **+** evidência **+**
 * adoção") e a `DERRUBA` é toda ela sobre o eixo estrutural (peça única, POC, sem ponteiro nem
 * contrafactual → 0–1). Então `recorrencia_rastro` é **teto** das outras: sem recorrência com
 * ponteiro nomeado, complexidade técnica não compra nota. Isso ataca o achado 3 do T1 — **12 dos
 * 17 zeros humanos saíram do zero** com o agente único.
 *
 * ⚠️ Este módulo **não grava nada** e **não reescala a rodada** (isso é o T4, que é cross-projeto).
 * ⚠️ Nada aqui toca a coluna "Estrelas" — invariante do projeto inteiro.
 */
import { llmChat } from "@/lib/llm";
import {
  NIVEL_ZERO,
  CRITERIOS_ESTRELA,
  ESCAPE_MUDA_O_JOGO,
  PISO_ZERO,
  NOTA_MAX,
  TETO_AGENTE,
  REGRAS_DO_PORQUE,
  type ChavePisoZero,
  type Confianca,
} from "@/lib/estrelas-regua";
import { LIMIARES_GENEROSIDADE } from "@/lib/especiais-concordancia";
import { montarBlocoFewShot, type Vizinho } from "@/lib/especial-corpus";
import { definicaoFuncao, rotuloFuncao } from "@/lib/especiais-funcao";
import { extrairJson, type AlvoClassificacao } from "@/lib/agents/especial-classificador";

// ─── As lentes (declaradas; os critérios vêm da régua por TÍTULO) ──────────────

/**
 * Critérios que TODA lente vê: eles não são um eixo de valor, são o modo de LER o memorial
 * (honestidade conta a favor; sem R$ a estrela é o único pagamento). Numa lente só, as outras
 * três julgariam um especial como se fosse um projeto financeiro.
 */
export const CRITERIOS_GLOBAIS = ["Qualidade de execução", "Especiais"] as const;

/**
 * Definição de cada EIXO que as lentes julgam.
 *
 * ⚠️ Mora aqui, e não na régua, porque eixo **não é escala**: a régua (`estrelas-regua.ts`) diz o
 * que uma ESTRELA vale e continua sendo fonte única disso; esta lista diz o que cada lente
 * PERGUNTA. Antes vinha de `especiais-regua.ts`, junto da escala velha (`Ouro`, `Diamante`), que
 * o dono do produto substituiu em 03/09/2026 — arrastar a escala morta junto do eixo vivo era o
 * único motivo de o painel ainda depender daquele arquivo.
 */
export const EIXOS = [
  { titulo: "Função na cadeia", texto: "Quanto da cadeia informação → ação → consequência o projeto assume." },
  { titulo: "Recorrência real", texto: "Roda de novo sozinho (cron, gatilho, uso contínuo), não é peça única." },
  { titulo: "Rastreabilidade", texto: "Existe relatório, painel, base ou log NOMEADO onde conferir o ponteiro movido." },
  { titulo: "Contrafactual", texto: "Se desligar, alguém nomeado sente e o processo piora de forma perceptível." },
  { titulo: "Complexidade técnica", texto: "automação < inteligência (IA no fluxo) < autonomia (decide e age sozinho)." },
  { titulo: "Alcance e reuso", texto: "1 pessoa < 1 time < área < várias áreas ou marcas < grupo." },
  { titulo: "Qualidade de execução", texto: "Em produção, documentado, memorial honesto. Admitir limite conta A FAVOR." },
  { titulo: "Risco evitado", texto: "Fiscal, jurídico, financeiro ou de segurança." },
  { titulo: "Especiais", texto: "Sem R$, a estrela é o ÚNICO pagamento: valor estratégico e uso real mandam." },
] as const;

export type Lente = {
  chave: string;
  rotulo: string;
  /** A pergunta ÚNICA da lente — é ela que a torna diferente das outras. */
  pergunta: string;
  /** Títulos de `CRITERIOS` (régua) que esta lente julga. */
  criterios: string[];
  /**
   * O que cada nota da escala 0–`NOTA_MAX` significa **NO EIXO DESTA LENTE**.
   *
   * ⚠️ Existe porque a régua GLOBAL (`NIVEIS`) descreve o **projeto inteiro** — 3★ é
   * "inteligência **+** recorrência **+** evidência **+** adoção", 5★ é "plataforma, várias áreas,
   * autonomia, ponteiro auditável". Um eixo ISOLADO nunca pode alegar isso sozinho, então toda
   * lente respondia 1–2 **corretamente dentro da pergunta que recebia**, e o painel nunca produzia
   * um ≥3★ (medido: 0% em 48 especiais, contra 41,7% da triagem humana — ver
   * `docs/plans/painel-agentes-especiais.md`, diagnóstico de 28/08/2026).
   *
   * A escala é a MESMA (a nota consolidada é comparável com a humana); o que muda é a leitura:
   * cada lente lê o número no seu eixo. ⚠️ **A régua global segue sendo fonte única do que uma
   * ESTRELA é** (`especiais-regua.ts`) — estas âncoras a traduzem por eixo, não a substituem, e
   * nenhuma delas afrouxa a `DERRUBA` (que continua entrando no prompt inteira).
   */
  ancoras: { nota: number; definicao: string }[];
  /** Ressalva do eixo, quando ele tem um caso que a âncora sozinha não cobre. */
  observacao?: string;
};

/** A lente estrutural: teto das outras (ver o cabeçalho e `consolidarLentes`). */
export const LENTE_GATE = "recorrencia_rastro";

export const LENTES: Lente[] = [
  {
    // A espinha da régua nova. Sem ela o painel media os APOIOS (recorrência, alcance,
    // autonomia, risco) e nunca a pergunta central: quanto da cadeia o projeto assume.
    chave: "funcao_cadeia",
    rotulo: "Função na cadeia",
    pergunta:
      "Quanto da cadeia informação → ação → consequência este projeto assume? Ele entrega o insumo, executa a ação, impede o erro, escolhe, ou responde pela entrega final?",
    criterios: ["Função na cadeia"],
    /**
     * ⚠️ O VERBO vem da régua (fonte única do nome de cada nível); a definição é LOCAL, e tem de
     * ser. A definição global de cada nível é CONJUNTIVA, ela descreve o projeto inteiro: o 3★
     * global exige "a consequência evitada recai sobre OUTRA área e tem impacto na operação",
     * que é alcance, não função. Foi exatamente isso que o T7 mediu — dar a definição global a um
     * eixo isolado faz toda lente responder 1 ou 2 corretamente, e o painel não passou de 2★ em
     * 48 especiais. Aqui fica só a parte que é FUNÇÃO; o resto pertence às outras lentes.
     */
    ancoras: [
      { nota: NIVEL_ZERO.nota, definicao: `${NIVEL_ZERO.verbo}. Não assume parte nenhuma da cadeia: existe para testar uma ideia ou resolver uma tarefa isolada.` },
      { nota: 1, definicao: `${CRITERIOS_ESTRELA[0].verbo}. Entrega o insumo, não a ação: produz dado, visibilidade, alerta ou registro, e quem age é gente.` },
      { nota: 2, definicao: `${CRITERIOS_ESTRELA[1].verbo}. Assume a ação em si e roda sem ninguém iniciar. Não escolhe o que fazer, faz.` },
      { nota: 3, definicao: `${CRITERIOS_ESTRELA[2].verbo}. Impede o erro de passar: valida, bloqueia ou exige registro antes de o processo seguir.` },
      { nota: 4, definicao: `${CRITERIOS_ESTRELA[3].verbo}. Escolhe, não só executa, e a escolha não sai de uma tabela fixa de "se isto, então aquilo".` },
      { nota: 5, definicao: `${CRITERIOS_ESTRELA[4].verbo}. Responde pela entrega final, sem ninguém entre a falha dele e o prejuízo.` },
    ],
  },
  {
    chave: LENTE_GATE,
    rotulo: "Recorrência, rastro e contrafactual",
    pergunta:
      "Isto roda de novo sozinho, existe um lugar NOMEADO onde conferir o ponteiro, e alguém nomeado sente falta se desligar?",
    criterios: ["Recorrência real", "Rastreabilidade", "Contrafactual"],
    /**
     * ⚠️ Medido em 03/09/2026, nos dois casos que o handoff apontava: no PIAPP esta lente
     * ESCREVEU "usado continuamente por mais de dez times e abastece a geração automática do
     * Prisma" e mesmo assim respondeu 1, com prova "vaga". Como ela é o teto das outras, o
     * projeto fechou em 2★ com alcance 5 provado por nome. O Prisma, idem.
     *
     * A âncora 3 desta lente já dizia "gente de FORA do autor depende da saída na rotina dela" —
     * o que faltava era dizer que, numa PLATAFORMA, o dependente NOMEADO É o lugar de conferir.
     * A régua já declara isso para o escape ("o caso da plataforma"); aqui o eixo não sabia.
     * ⚠️ Não vale para "poderá ser usado por" nem para dependente sem nome: aí não há atividade
     * em curso, e a prova continua vaga.
     */
    observacao:
      'PLATAFORMA: quando OUTRO projeto ou time NOMEADO roda em cima deste (consome API, MCP, integração), esse dependente é a prova, e a prova é "nomeada". Não exija um relatório ou painel além dele: para uma plataforma, quem usa É onde se confere. Vale só com nome próprio; "poderá ser usado por" e dependente sem nome continuam prova vaga.',
    ancoras: [
      { nota: 0, definicao: "Rodou uma vez, ou é teste/POC. Nada volta a rodar." },
      { nota: 1, definicao: "Roda de vez em quando, disparado à mão, sem lugar nomeado onde conferir. Se desligar, só o autor sente." },
      { nota: 2, definicao: "Roda sozinho (cron, gatilho) ou em uso contínuo, E existe UM lugar nomeado onde conferir o resultado. Um time sente falta." },
      { nota: 3, definicao: "Roda sozinho, o ponteiro tem nome próprio, e gente de FORA do autor depende da saída na rotina dela." },
      { nota: 4, definicao: "A rotina é obrigação recorrente de um processo com prazo (fiscal, financeiro, atendimento) e o rastro é conferível por quem não participou." },
      { nota: 5, definicao: "Outras áreas dependem, e o rastro é sistema/base própria consultada por terceiros — auditável sem pedir nada ao autor." },
    ],
  },
  {
    chave: "complexidade_autonomia",
    rotulo: "Complexidade e autonomia",
    pergunta:
      "O quanto o sistema DECIDE? Onde ele cai na escada automação < inteligência (IA no fluxo) < autonomia (decide e age sozinho)?",
    criterios: ["Complexidade técnica"],
    ancoras: [
      { nota: 0, definicao: "Não há sistema: o trabalho é manual, o entregável é o documento ou a planilha." },
      { nota: 1, definicao: "Automação de passos fixos — script, macro, mover ou formatar dados sempre do mesmo jeito." },
      { nota: 2, definicao: "Automação com regras condicionais ou integração entre sistemas: trata casos diferentes, mas não decide nada de novo." },
      { nota: 3, definicao: "Inteligência DENTRO do fluxo — IA, modelo ou heurística classifica, extrai ou redige, e esse resultado entra no processo." },
      { nota: 4, definicao: "Decide e age sozinho em parte do fluxo; o humano só revisa exceção." },
      { nota: 5, definicao: "Autonomia de ponta a ponta, com tratamento do próprio erro — é serviço/plataforma que outros chamam." },
    ],
  },
  {
    chave: "alcance_reuso",
    rotulo: "Alcance e reuso",
    pergunta:
      "Quantas pessoas de fora do autor usam isto de fato, e o quanto ele foi reusado em outro time, área, marca ou no grupo?",
    criterios: ["Alcance e reuso"],
    ancoras: [
      { nota: 0, definicao: "Ninguém usa além da execução que produziu o entregável." },
      { nota: 1, definicao: "Só o autor usa." },
      { nota: 2, definicao: "O time do autor usa — time nomeado, não \"a equipe\"." },
      { nota: 3, definicao: "Pessoas de fora do time do autor usam de fato, e dá para nomear quem." },
      { nota: 4, definicao: "Duas ou mais áreas usam, ou o mesmo projeto foi reusado em outra marca, unidade ou empresa do grupo." },
      { nota: 5, definicao: "A área inteira depende, ou virou serviço em que outros times se acoplam." },
    ],
  },
  {
    chave: "risco_evitado",
    rotulo: "Risco evitado",
    pergunta:
      "Que risco fiscal, jurídico, financeiro ou de segurança deixou de existir, e o quanto ele era material?",
    criterios: ["Risco evitado"],
    ancoras: [
      { nota: 0, definicao: "Não há risco a evitar. É resposta CORRETA e comum — a maioria dos projetos não evita risco nenhum." },
      { nota: 1, definicao: "Erro operacional pequeno, percebido e refeito sem custo." },
      { nota: 2, definicao: "Retrabalho recorrente ou erro que custa dinheiro pequeno, nomeado no material." },
      { nota: 3, definicao: "Risco material nomeado — multa, juros, quebra de prazo contratual, perda de dado — com valor ou ocorrência citada." },
      { nota: 4, definicao: "Risco fiscal, jurídico ou de segurança com exposição relevante E prova de que era real: autuação, incidente passado, apontamento de auditoria." },
      { nota: 5, definicao: "Exposição estrutural do grupo (compliance, LGPD, fraude) endereçada de forma contínua e auditável." },
    ],
  },
];

/**
 * Quais itens do piso CADA lente pode declarar.
 *
 * ⚠️ Medido no primeiro teste do painel repointado (03/09/2026): com a lista inteira em todas as
 * lentes, **`apenas_mensuravel` disparou em 4 das 5** num fluxo de relatório diário comum. É o
 * mesmo defeito que a régua já registra em outra forma (o texto antigo "o ganho é mensurável"
 * disparava em 484 de 484 não-especiais): todo projeto normal TEM número, e a lente de "risco
 * evitado" não tem como saber se o projeto **se resume** a ele. Ela vê um eixo; o piso é fato do
 * projeto inteiro.
 *
 * A régua não muda: os 7 itens continuam valendo e continuam zerando. O que muda é QUEM pode
 * afirmá-los, e o critério é o mesmo do painel inteiro: você não julga o eixo dos outros.
 * Item sem lente dona não seria declarável por ninguém, então cada um tem exatamente uma.
 */
export const PISO_POR_LENTE: Readonly<Record<string, readonly ChavePisoZero[]>> = {
  // O que o projeto ENTREGA além do número, e se o que ele faz é tarefa isolada.
  funcao_cadeia: ["apenas_mensuravel", "simples_local"],
  // Existência e continuidade: parado, POC, ou o mesmo escopo de novo.
  recorrencia_rastro: ["fora_de_uso", "experimentacao", "ressubmissao"],
  // Quem usa, e se isso é relevante para além de um punhado de gente.
  alcance_reuso: ["so_o_autor", "marginal"],
};

/** Os itens do piso que ESTA lente pode declarar (vazio = nenhum, e o campo vem sempre null). */
export function pisoDaLente(chave: string): readonly ChavePisoZero[] {
  return PISO_POR_LENTE[chave] ?? [];
}

/** O que uma lente NÃO julga — os eixos das OUTRAS lentes, derivados, nunca redigitados. */
export function outrosEixos(chave: string): string[] {
  return LENTES.filter((l) => l.chave !== chave).map((l) => l.rotulo);
}

export function lentePorChave(chave: string): Lente | null {
  return LENTES.find((l) => l.chave === chave) ?? null;
}

// ─── Saída de uma lente ────────────────────────────────────────────────────────

/**
 * O quanto o eixo está PROVADO no material — não é a confiança do modelo, é a qualidade da prova:
 * `nomeada` (dá para ir conferir, com nome próprio) · `vaga` (afirmado sem onde) · `ausente`.
 */
export type Evidencia = "nomeada" | "vaga" | "ausente";

export type AvaliacaoLente = {
  lente: string;
  /** A nota mais alta da régua que ESTE eixo sustenta (0..TETO_AGENTE). */
  nota: number;
  /**
   * Qual item do piso zerou o projeto, ou `null` se nenhum.
   *
   * ⚠️ **Campo OBRIGATÓRIO de propósito, e é a lição do run 1.** Lá o piso existia só como prosa
   * no prompt e o agente simplesmente não o usava: das 173 notas em que ele subiu acima de um
   * zero humano, **nenhuma** citou qualquer um dos desqualificadores, e 180 dos 194 zeros foram
   * justificados por "não comprova uso recorrente", que é outra regra, do bloco de disciplina.
   * O escape funciona justamente porque exige campo e é conferido em código; o piso não exigia
   * nada. Pedir a chave força o agente a percorrer a lista antes de posicionar a nota.
   */
  piso: ChavePisoZero | null;
  evidencia: Evidencia;
  confianca: Confianca;
  /** Por que este eixo para nesta nota — 1 a 3 frases. */
  justificativa: string;
  /** O trecho do material que sustenta a nota. Vazio = alegação sem prova (ver o guard). */
  sustentacao: string;
};

// ─── Prompt (montado da régua — fonte única) ───────────────────────────────────

function textoDosCriterios(titulos: readonly string[]): string {
  return EIXOS.filter((c) => titulos.includes(c.titulo))
    .map((c) => `- ${c.titulo}: ${c.texto}`)
    .join("\n");
}

/**
 * As âncoras DO EIXO da lente — o que substituiu a régua global no prompt (ver `Lente.ancoras`).
 */
function descreverAncoras(lente: Lente): string {
  return lente.ancoras
    .slice()
    .sort((a, b) => a.nota - b.nota)
    .map((a) => `${a.nota} — ${a.definicao}`)
    .join("\n");
}

/**
 * A escala global em UMA linha, só os TÍTULOS. Entra no prompt por um motivo estreito: as notas
 * dos projetos vizinhos (few-shot) são GLOBAIS, e sem nenhuma referência a lente não sabe ler
 * "este vizinho vale 4". ⚠️ Só os títulos, **nunca as definições**: são as definições globais de
 * 3★ para cima ("plataforma, várias áreas, autonomia, ponteiro auditável") que um eixo isolado
 * não consegue alegar sozinho e que travavam TODA lente em 1–2.
 */
function descreverEscalaGlobalCurta(): string {
  const base = [NIVEL_ZERO, ...CRITERIOS_ESTRELA].map((n) => `${n.nota} ${n.verbo}`).join(" · ");
  return `${base} · ${TETO_AGENTE + 1}-${NOTA_MAX} ${ESCAPE_MUDA_O_JOGO.verbo}`;
}

/**
 * ⚠️ A CURVA SAIU DO PROMPT DA LENTE, de propósito. Ela dizia "≥3★ é top 4% da base" e essa base
 * é a base INTEIRA (especiais mais normais), enquanto a lente julga um eixo isolado de UM
 * projeto. Está na lista do que já foi medido e não deve ser retentado
 * (`docs/plans/painel-agentes-especiais.md`): âncora de raridade dentro da lente empurra todo
 * mundo para baixo, e o painel não passava de 2★ em 48 especiais. Quem lê curva é o revisor, e a
 * dele é a dos ESPECIAIS auditados, não a da base.
 */

/**
 * O bloco do piso NA LENTE — só os itens do eixo dela (ver `PISO_POR_LENTE`). Lente sem itens
 * recebe a instrução explícita de não opinar: silêncio no prompt vira palpite na resposta.
 */
function textoDoPiso(lente: Lente): string {
  const meus = PISO_ZERO.filter((d) => pisoDaLente(lente.chave).includes(d.chave));
  if (meus.length === 0) {
    return 'O QUE ZERA: nada disso é do seu eixo. Responda "piso": null SEMPRE — outra lente do painel cuida dos desqualificadores, e opinar aqui zera o projeto por um motivo que você não tem como verificar.';
  }
  return [
    "O QUE ZERA o projeto inteiro, por melhor que o memorial esteja. Estes são os do SEU eixo:",
    ...meus.map((d) => `- [${d.chave}] ${d.texto}`),
    'Se nenhum for verdade, responda "piso": null. É a resposta mais comum, e é correta.',
    '⚠️ Zerar é a afirmação mais forte que você pode fazer, e ela derruba o projeto INTEIRO, por',
    'cima do que as outras quatro lentes acharam. Só declare o piso se puder COPIAR em',
    '"sustentacao" o trecho do material que mostra isso. Sem o trecho, o piso é ignorado e sobra',
    'apenas a sua nota — que já é a forma correta de dizer "neste eixo o projeto não sustenta".',
  ].join("\n");
}

export function buildSystemPromptLente(lente: Lente): string {
  return `Você é UM avaliador de um painel que julga projetos ESPECIAIS do GoDocs. Você olha UM eixo só — «${lente.rotulo}» — e mais nada.

SUA PERGUNTA ÚNICA:
${lente.pergunta}

SEUS CRITÉRIOS (só estes):
${textoDosCriterios(lente.criterios)}

COMO LER QUALQUER MEMORIAL (vale para todas as lentes):
${textoDosCriterios(CRITERIOS_GLOBAIS)}

VOCÊ NÃO JULGA (outra lente do painel cuida, e opinar aqui atrapalha a consolidação):
${outrosEixos(lente.chave)
  .map((r) => `- ${r}`)
  .join("\n")}

O QUE VOCÊ DEVOLVE:
A nota MAIS ALTA de 0 a ${TETO_AGENTE} que o SEU eixo sustenta: um TETO vindo do seu eixo, não um voto médio. Se o seu eixo sustenta 2, diga 2 mesmo que o projeto pareça impressionante por outro motivo, porque o outro motivo não é seu.

⚠️ ${TETO_AGENTE} é o SEU máximo. A faixa ${TETO_AGENTE + 1} a ${NOTA_MAX} ("${ESCAPE_MUDA_O_JOGO.verbo}") não é decidida por eixo isolado nem por você: ela exige duas citações da documentação e vai para o comitê humano, num passo separado. Nunca devolva nota acima de ${TETO_AGENTE}.

A RÉGUA DO SEU EIXO: a escala é a MESMA da base, mas aqui está o que cada nota significa NO SEU EIXO. É contra ESTAS frases que você responde, e não contra a descrição de um projeto inteiro:
${descreverAncoras(lente)}
Nota não listada fica entre a de baixo e a de cima.${lente.observacao ? `\n\n⚠️ ${lente.observacao}` : ""}

A ESCALA GLOBAL (só para LER a nota dos projetos vizinhos — não responda por ela):
${descreverEscalaGlobalCurta()}

${textoDoPiso(lente)}

DISCIPLINA:
- Notas INTEIRAS.
- "Vai reduzir", "uso esperado", "resultado projetado" NÃO é uso real — trate como POC.
- O próprio entregável (o dashboard, o CSV, o documento que o projeto gera) NÃO é ponteiro de uso recorrente nem prova de alcance.
- Admitir limite no memorial conta A FAVOR.
- Se o seu eixo simplesmente NÃO se aplica a este projeto (ex.: não há risco nenhum a evitar), devolva nota 0 com evidencia "ausente" e diga isso na justificativa. Isso é resposta CORRETA, não falha — outra lente sustenta o projeto.
- Os projetos vizinhos vêm com a nota GLOBAL deles (todos os eixos juntos). Use como âncora de MAGNITUDE — "um projeto assim vale 4 na base inteira" — nunca como a resposta do seu eixo.

COMO ESCREVER A JUSTIFICATIVA:
${REGRAS_DO_PORQUE}

FORMATO — responda APENAS com JSON válido, sem texto fora do JSON:
{
  "nota": <inteiro 0 a ${TETO_AGENTE}>,
  "piso": <a chave do item que ZERA, entre aspas, ou null se nenhum se aplica>,
  "evidencia": "nomeada" | "vaga" | "ausente",
  "confianca": "alta" | "media" | "baixa",
  "justificativa": "<1 a 3 frases: por que o seu eixo para nesta nota>",
  "sustentacao": "<o trecho do material que sustenta a nota, copiado. Vazio se não houver trecho nenhum.>"
}
⚠️ "piso" é OBRIGATÓRIO e vem ANTES de pensar na nota: percorra os itens que zeram, decida se algum é verdade, e só então posicione o eixo. Preencher com null é uma resposta legítima e comum; o que não vale é não olhar.
"evidencia": use "nomeada" SÓ quando houver nome próprio de relatório, painel, base, sistema, time ou pessoa em que se possa ir conferir — e copie esse trecho em "sustentacao". Sem trecho, é "vaga" ou "ausente".`;
}

export function buildUserMessageLente(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  funcaoChave?: string | null,
): string {
  const dados = {
    projeto: {
      nome: alvo.nome,
      area: alvo.area,
      ferramenta: alvo.ferramenta,
      tipos: alvo.tipos,
      por_que_e_especial: alvo.contexto_especial,
      descricao: alvo.descricao,
      submetido_em: alvo.submetido_em,
      memorial_ou_doc: alvo.memorial || alvo.doc || null,
    },
  };
  // A FUNÇÃO (T2) entra como "o que este grupo faz" — contexto, nunca mérito. ⚠️ Dentro de uma
  // mesma função as notas humanas vão de 0 a 10 (medido no T2): função NÃO prevê nota, e dizer
  // isso no prompt evita que a lente leia o grupo como pedigree.
  const funcao = funcaoChave
    ? `GRUPO DE FUNÇÃO DESTE PROJETO: ${rotuloFuncao(funcaoChave)} — ${definicaoFuncao(funcaoChave) ?? ""}
(⚠️ o grupo diz o que o projeto FAZ, não o quanto ele vale: dentro do mesmo grupo há projetos de 0 e de 10 estrelas.)

`
    : "";

  return `${funcao}PROJETOS ESPECIAIS PARECIDOS JÁ AVALIADOS (a nota deles é GLOBAL — âncora de magnitude):
${montarBlocoFewShot(vizinhos)}

PROJETO A AVALIAR:
${JSON.stringify(dados, null, 2)}

Responda pela SUA lente apenas.`;
}

// ─── Normalização + guards determinísticos ─────────────────────────────────────

const CONFIANCAS: Confianca[] = ["alta", "media", "baixa"];
const EVIDENCIAS: Evidencia[] = ["nomeada", "vaga", "ausente"];

/** Piso de tamanho para um trecho contar como trecho, e não como um "sim" solto. */
export const MIN_SUSTENTACAO = 12;

/**
 * Normaliza a saída crua de uma lente. Dois guards que não são cosméticos:
 * - **`nomeada` sem trecho copiado vira `vaga`**: alegar fonte é grátis, copiar o trecho não é —
 *   é a mesma régua do `[1.4]` (substantivo de fonte, não verbo de verificação);
 * - evidência/confiança inválidas caem no valor CONSERVADOR (`ausente`/`baixa`), nunca no otimista.
 *
 * `null` quando não há nota utilizável — o painel trata como lente FALTANDO, nunca como nota 0.
 */
export function normalizarAvaliacaoLente(bruto: unknown, lente: string): AvaliacaoLente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const notaCrua = Number(o.nota);
  if (!Number.isFinite(notaCrua)) return null;
  // ⚠️ Clampa no TETO DO AGENTE, não em NOTA_MAX: a faixa 6-10 não é decidida por eixo isolado.
  // Uma lente que devolve 7 está opinando sobre o escape, que exige duas citações e o comitê.
  const nota = Math.max(0, Math.min(TETO_AGENTE, Math.round(notaCrua)));

  const sustentacao = typeof o.sustentacao === "string" ? o.sustentacao.trim() : "";
  let evidencia: Evidencia = EVIDENCIAS.includes(o.evidencia as Evidencia)
    ? (o.evidencia as Evidencia)
    : "ausente";
  if (evidencia === "nomeada" && sustentacao.length < MIN_SUSTENTACAO) evidencia = "vaga";

  const confianca: Confianca = CONFIANCAS.includes(o.confianca as Confianca)
    ? (o.confianca as Confianca)
    : "baixa";

  const justCrua = typeof o.justificativa === "string" ? o.justificativa.trim() : "";

  // Piso declarado: só vale chave que EXISTE na régua. Chave inventada é ruído, e aceitá-la
  // deixaria o agente zerar por um motivo que ninguém consegue auditar depois.
  // Só vale chave que EXISTE na régua **e** pertence ao eixo DESTA lente. Chave inventada é
  // ruído; chave de outro eixo é a lente zerando o projeto por um fato que ela não tem como
  // verificar, que foi o que se mediu quando todas viam a lista inteira.
  const pisoCru = typeof o.piso === "string" ? o.piso.trim() : "";
  const permitidos = pisoDaLente(lente);
  const pisoDoEixo = (permitidos.find((c) => c === pisoCru) ?? null) as ChavePisoZero | null;
  // ⚠️ **ZERAR EXIGE CITAÇÃO**, pela mesma razão que o escape exige duas: é a afirmação mais
  // forte que uma lente pode fazer, e ela zera o projeto INTEIRO, por cima das outras quatro.
  //
  // Medido na run 4: o piso derrubou a 0 três projetos de nota alta — «Ferramenta de testes de
  // novos produtos» (planilha 7) por `ressubmissao`, «Benchmark de Estampas» (planilha 4) por
  // `so_o_autor` e o **GoPrice** (planilha 4) por `experimentacao`. O GoPrice é o exemplo de 4★
  // da PRÓPRIA régua. Nenhum dos três precisou apontar um trecho do dossiê para zerar.
  //
  // Com a citação exigida, a lente ainda pode zerar, mas tem de mostrar ONDE leu isso — e quem
  // revisa consegue conferir. Sem trecho, a alegação vira só a nota baixa daquele eixo.
  const piso = pisoDoEixo && sustentacao.length >= MIN_SUSTENTACAO ? pisoDoEixo : null;

  return {
    lente,
    // O piso é DESQUALIFICADOR: uma vez nomeado, a nota do eixo não sobrevive a ele.
    nota: piso ? 0 : nota,
    piso,
    evidencia,
    confianca,
    justificativa: justCrua || "Sem justificativa — a lente não explicou a nota.",
    sustentacao,
  };
}

/** Teto de uma lente que não achou prova nenhuma do próprio eixo. */
export const TETO_SEM_EVIDENCIA = 1;

/**
 * Eixo sem prova não sustenta nota: `evidencia: 'ausente'` limita a nota da própria lente a
 * `TETO_SEM_EVIDENCIA`. Sem isso, "provavelmente roda todo mês" compra 3★ — e foi assim que o
 * agente único promoveu 12 dos 17 zeros humanos (achado 3 do T1).
 */
export function aplicarTetoSemEvidencia(av: AvaliacaoLente): AvaliacaoLente {
  if (av.evidencia !== "ausente" || av.nota <= TETO_SEM_EVIDENCIA) return av;
  return { ...av, nota: TETO_SEM_EVIDENCIA, confianca: "baixa" };
}

// ─── Consolidação PURA (sem média, de propósito) ───────────────────────────────

/**
 * Quanto uma lente de VALOR pode passar do teto estrutural — e só quando o gate tem prova
 * NOMEADA. Gate sem prova nomeada não empresta margem nenhuma (a `DERRUBA` diz 0–1 nesse caso).
 */
export const MARGEM_ACIMA_DO_GATE = 1;

/**
 * Quanto um eixo de VALOR com prova **NOMEADA** empresta ao teto quando o gate tem prova só `vaga`.
 *
 * ⚠️ **Decisão do Kaique, 27/08/2026, com a medição do T7 na mesa** — afrouxa o gate conjuntivo da
 * decisão fechada nº 2 do plano ("nada sobe sem recorrência com ponteiro"), e afrouxa DE PROPÓSITO:
 * com margem 0 para prova `vaga`, **nenhum** dos 48 especiais passou de 2★ numa população onde a
 * triagem humana dá ≥3★ a 41,7%. Era o caso «Integrações multi-plataforma de CRM» (humana 3): gate
 * `1/vaga` + alcance `3/nomeada` → teto 1 → nota **1**, com o eixo forte jogado fora.
 *
 * ⚠️ **É 1, não a nota cheia do eixo de valor.** Prova nomeada em outro eixo compra ESPAÇO, não a
 * nota: com `teto = valor_nomeado_max` direto, «Acompanhamento de Mudanças de Preço» (humana 2, gate
 * `2/vaga`, alcance `4/nomeada`) saltaria para 4★ — trocar um erro de −1 por um de +2. Com 1, os
 * dois casos caem dentro de ±1, que é o critério que o T7 mede.
 * ⚠️ Gate com prova **`ausente`** não recebe empréstimo nenhum (segue `aplicarTetoSemEvidencia`):
 * o que se aceita é ponteiro vago, não ponteiro inexistente.
 */
export const MARGEM_VALOR_NOMEADO = 1;

/** Nota que um eixo de valor precisa sustentar para o empréstimo acima valer (fonte única: ≥3). */
export const NOTA_VALOR_EMPRESTA = LIMIARES_GENEROSIDADE[0];

export type Consolidado = {
  nota_preliminar: number;
  /** A nota da lente estrutural (`null` se ela falhou — aí não há teto). */
  gate: number | null;
  gate_evidencia: Evidencia | null;
  /** Teto imposto pelo gate (`null` quando o gate não respondeu). */
  teto: number | null;
  /** A maior nota entre as lentes de VALOR (não-gate). */
  valor_max: number;
  /** A maior nota entre as lentes de VALOR que trouxeram prova NOMEADA (0 se nenhuma). */
  valor_nomeado_max: number;
  /** Lentes declaradas que não responderam nesta rodada. */
  faltando: string[];
  /** Como a nota saiu, em uma linha — vai para a leitura e para o revisor do T5. */
  explicacao: string;
};

/**
 * Consolida as lentes de UM projeto **sem média**:
 * 1. cada lente já passou por `aplicarTetoSemEvidencia`;
 * 2. `teto` = nota do gate + (`MARGEM_ACIMA_DO_GATE`, só se o gate tem prova nomeada);
 * 3. `nota_preliminar` = min(teto, max(gate, maior nota das lentes de valor)).
 *
 * O passo 3 é DISJUNTIVO para cima (a régua diz que 4★ = "reuso multi-área **OU** risco material
 * **OU** ganho estrutural" — um eixo forte basta) e CONJUNTIVO no gate (nada sobe sem recorrência
 * com ponteiro). ⚠️ **Não trocar por média/mediana**: média de lente 0 com lente 4 devolve 2, que
 * é exatamente a compressão para o meio medida no T1 (viés −0,06 escondendo 0★→+1,94 e 7★→−7).
 *
 * Gate ausente (a lente falhou) → sem teto: usa o max das que responderam e diz isso na
 * `explicacao`. Nenhuma lente → nota 0, com a explicação de que ninguém julgou. Nunca lança.
 */
export function consolidarLentes(avaliacoes: AvaliacaoLente[]): Consolidado {
  const porChave = new Map(avaliacoes.map((a) => [a.lente, a]));
  const faltando = LENTES.filter((l) => !porChave.has(l.chave)).map((l) => l.chave);

  // ⚠️ O PISO É DO PROJETO, NÃO DO EIXO. "Ninguém além do autor usa" ou "está parado" não são
  // verdades sobre alcance ou sobre autonomia: são verdades sobre o projeto, e a régua diz que
  // basta UM ser verdade. Então uma lente que nomeia um item do piso zera o conjunto, não só a
  // si mesma. Sem isto, uma lente diria "0, está parado" e as outras quatro fariam média em cima
  // dela.
  //
  // ⚠️ Qual lente e qual item ficam NA EXPLICAÇÃO, e isso é a metade que importa: se o piso
  // passar a disparar demais, é aqui que se vê, com nome e chave, em vez de só aparecer como uma
  // base achatada em 0 (o risco declarado da D12). Nenhum item do piso disparou nas 173 notas do
  // run 1, então o número esperado é maior que zero e menor do que "quase tudo".
  const comPiso = avaliacoes.filter((a) => a.piso != null);
  if (comPiso.length > 0) {
    const chaves = [...new Set(comPiso.map((a) => `${a.lente}:${a.piso}`))].join(", ");
    return {
      nota_preliminar: 0,
      gate: porChave.get(LENTE_GATE)?.nota ?? null,
      gate_evidencia: porChave.get(LENTE_GATE)?.evidencia ?? null,
      teto: 0,
      valor_max: avaliacoes.length ? Math.max(...avaliacoes.map((a) => a.nota)) : 0,
      valor_nomeado_max: 0,
      faltando,
      explicacao: `zerado pelo piso (${chaves})`,
    };
  }

  const gateAv = porChave.get(LENTE_GATE) ?? null;
  const valor = avaliacoes.filter((a) => a.lente !== LENTE_GATE);
  const valor_max = valor.length ? Math.max(...valor.map((a) => a.nota)) : 0;
  const nomeadas = valor.filter((a) => a.evidencia === "nomeada");
  const valor_nomeado_max = nomeadas.length ? Math.max(...nomeadas.map((a) => a.nota)) : 0;

  if (!gateAv) {
    const nota = avaliacoes.length ? Math.max(...avaliacoes.map((a) => a.nota)) : 0;
    return {
      nota_preliminar: nota,
      gate: null,
      gate_evidencia: null,
      teto: null,
      valor_max,
      valor_nomeado_max,
      faltando,
      explicacao: avaliacoes.length
        ? `lente estrutural não respondeu — sem teto; nota = maior lente (${nota})`
        : "nenhuma lente respondeu — nota 0 por ausência de julgamento, não por demérito",
    };
  }

  // Margem: o gate com prova nomeada empresta 1 (como sempre); com prova só `vaga`, um eixo de
  // VALOR que sustenta ≥3 COM prova nomeada empresta 1 no lugar dele (ver `MARGEM_VALOR_NOMEADO`).
  const margem =
    gateAv.evidencia === "nomeada"
      ? MARGEM_ACIMA_DO_GATE
      : gateAv.evidencia === "vaga" && valor_nomeado_max >= NOTA_VALOR_EMPRESTA
        ? MARGEM_VALOR_NOMEADO
        : 0;
  const teto = Math.min(TETO_AGENTE, gateAv.nota + margem);
  const bruta = Math.max(gateAv.nota, valor_max);
  const nota_preliminar = Math.min(teto, bruta);

  const explicacao =
    nota_preliminar < bruta
      ? `eixo de valor sustentava ${bruta}, mas o estrutural para em ${gateAv.nota} (prova ${gateAv.evidencia}) → teto ${teto}`
      : `estrutural ${gateAv.nota} (prova ${gateAv.evidencia}) e maior eixo de valor ${valor_max} → ${nota_preliminar}`;

  return {
    nota_preliminar,
    gate: gateAv.nota,
    gate_evidencia: gateAv.evidencia,
    teto,
    valor_max,
    valor_nomeado_max,
    faltando,
    explicacao,
  };
}

// ─── Chamada de LLM (uma por lente) ────────────────────────────────────────────

export type OpcoesLente = {
  funcao?: string | null;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Roda UMA lente. Devolve `null` se o modelo não deu JSON utilizável — o painel trata como lente
 * faltando (`Consolidado.faltando`), nunca como nota 0.
 */
export async function avaliarPorLente(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  lente: Lente,
  opts: OpcoesLente = {},
): Promise<AvaliacaoLente | null> {
  const raw = await llmChat(
    [
      { role: "system", content: buildSystemPromptLente(lente) },
      { role: "user", content: buildUserMessageLente(alvo, vizinhos, opts.funcao) },
    ],
    { jsonMode: true, temperature: opts.temperature ?? 0.1, maxTokens: opts.maxTokens ?? 700 },
  );
  const av = normalizarAvaliacaoLente(extrairJson(raw), lente.chave);
  return av ? aplicarTetoSemEvidencia(av) : null;
}

export type ResultadoLentes = {
  avaliacoes: AvaliacaoLente[];
  falhas: { lente: string; motivo: string }[];
  consolidado: Consolidado;
};

/**
 * Roda as lentes escolhidas em PARALELO e consolida. ⚠️ Lente que falha (rede, JSON ilegível) não
 * derruba as outras e não vira nota 0 — vira `falhas` + `Consolidado.faltando`, para o T7 poder
 * distinguir "o painel julgou baixo" de "o painel não julgou".
 *
 * `opts.lentes` permite medir com 2, 3 ou 4 lentes sem tocar no código — é a decisão que o plano
 * deixou para a medição ("se 2 lentes já batem o baseline, 4 é dinheiro fora").
 */
export async function avaliarComLentes(
  alvo: AlvoClassificacao,
  vizinhos: Vizinho[],
  opts: OpcoesLente & { lentes?: string[] } = {},
): Promise<ResultadoLentes> {
  const escolhidas = opts.lentes?.length
    ? LENTES.filter((l) => opts.lentes!.includes(l.chave))
    : LENTES;

  const saidas = await Promise.all(
    escolhidas.map(async (l) => {
      try {
        const av = await avaliarPorLente(alvo, vizinhos, l, opts);
        return av
          ? { av, falha: null }
          : { av: null, falha: { lente: l.chave, motivo: "sem JSON utilizável" } };
      } catch (e) {
        return {
          av: null,
          falha: { lente: l.chave, motivo: e instanceof Error ? e.message : "erro" },
        };
      }
    }),
  );

  const avaliacoes = saidas.map((s) => s.av).filter((a): a is AvaliacaoLente => a != null);
  const falhas = saidas
    .map((s) => s.falha)
    .filter((f): f is { lente: string; motivo: string } => f != null);

  return { avaliacoes, falhas, consolidado: consolidarLentes(avaliacoes) };
}
