/**
 * CATEGORIZAÇÃO DE PROJETO (item 5.4 do plano) — módulo PURO, FONTE ÚNICA dos dois eixos.
 *
 * São dois eixos independentes, e a confusão entre eles é o erro a evitar:
 *
 *   · **TIPO** — *o que o projeto É* (o artefato entregue): Dashboard · App · Automação ·
 *     Agente · Sistema. Eixo NOVO, coluna nova `Tipo de Projeto`.
 *   · **NÍVEL** — *como o trabalho acontece*: Determinístico · Inteligente · Autônomo ·
 *     Agêntico. ⚠️ Este eixo **NÃO é novo**: é a coluna `Complexidade`, que já existe desde
 *     06/2026 com os 3 primeiros valores (`automacao`/`inteligencia`/`autonomia`), tem árvore
 *     de decisão no `analyzer.ts`, 578 linhas de dado na planilha e multiplicador de score no
 *     Gomoon. Aqui só entra o 4º degrau (`agentico`) e os RÓTULOS de exibição.
 *
 * ⚠️ Os VALORES gravados continuam sendo os slugs legados (`automacao`…) — renomear valor
 * invalidaria a base inteira e o `parseCategoria` do Gomoon. O que muda é o rótulo na tela.
 *
 * ⚠️ "Automação" aparece nos DOIS eixos e significa coisas diferentes: no TIPO é o artefato
 * headless (rotina que roda sem tela); no NÍVEL é "percorre caminho determinístico". Um
 * Dashboard (tipo) é quase sempre nível `automacao` — não é redundância, é o cruzamento.
 */

// ─── Eixo TIPO — o que o projeto É ───────────────────────────────────────────

/**
 * Os 5 tipos, **em ordem de PRECEDÊNCIA** (o primeiro que casar vence).
 *
 * Por que precedência e não multi-seleção: a categorização existe para AGREGAR ("quantos
 * agentes temos?"), e um projeto que conta em 2 baldes conta 2× — é a mesma dupla contagem
 * que a régua "área = a do dono, uma só" resolveu do lado do Gomoon. A ordem descreve a
 * camada mais ALTA presente no artefato: quem tem um agente é um Agente, mesmo que também
 * tenha painel; quem tem vários módulos é um Sistema, mesmo que um deles seja tela.
 */
export const TIPOS_PROJETO = ['agente', 'sistema', 'app', 'dashboard', 'automacao'] as const;
export type TipoProjeto = (typeof TIPOS_PROJETO)[number];

export const ROTULO_TIPO: Record<TipoProjeto, string> = {
  agente: 'Agente',
  sistema: 'Sistema',
  app: 'App',
  dashboard: 'Dashboard',
  automacao: 'Automação',
};

/**
 * As definições que vão ao PROMPT do analisador. FONTE ÚNICA: não redigitar no
 * `analyzer.ts` — mexer aqui é mexer no que o LLM lê.
 */
export const DEFINICAO_TIPO: Record<TipoProjeto, string> = {
  agente:
    'conversa ou recebe uma tarefa em linguagem natural e a resolve usando IA em runtime — chatbot, assistente, copiloto, agente que lê um caso e responde. O artefato é o INTERLOCUTOR.',
  sistema:
    'plataforma com VÁRIOS módulos/fluxos que sustenta um processo inteiro de ponta a ponta, com banco próprio e mais de um tipo de usuário. O artefato é a PLATAFORMA (ex.: o próprio GoDocs).',
  app: 'aplicação de tela ÚNICA em propósito, onde a pessoa ENTRA E OPERA — cadastra, preenche, aprova, edita. Tem interface e escrita pelo usuário. O artefato é a FERRAMENTA DE TRABALHO.',
  dashboard:
    'painel de LEITURA — consolida dados e mostra números/gráficos/listas para alguém decidir. Pode filtrar e exportar, mas não é onde o trabalho é feito. O artefato é a VISÃO.',
  automacao:
    'rotina HEADLESS: dispara por trigger/agenda e executa sem que ninguém abra tela — RPA, robô, fluxo n8n, script, integração, disparo de mensagem. O artefato é o PROCESSO QUE RODA SOZINHO.',
};

/** Aceita o que veio do LLM/planilha e devolve um tipo válido, ou `null`. */
export function normalizarTipo(input: unknown): TipoProjeto | null {
  const bruto = String(input ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!bruto) return null;
  const direto = TIPOS_PROJETO.find((t) => t === bruto);
  if (direto) return direto;
  // Rótulo de exibição (o que a planilha guarda) e sinônimos de uma palavra.
  const porRotulo: Record<string, TipoProjeto> = {
    agente: 'agente',
    agent: 'agente',
    chatbot: 'agente',
    bot: 'agente',
    assistente: 'agente',
    sistema: 'sistema',
    plataforma: 'sistema',
    app: 'app',
    aplicativo: 'app',
    aplicacao: 'app',
    portal: 'app',
    dashboard: 'dashboard',
    painel: 'dashboard',
    relatorio: 'dashboard',
    automacao: 'automacao',
    automatizacao: 'automacao',
    rpa: 'automacao',
    robo: 'automacao',
    integracao: 'automacao',
  };
  return porRotulo[bruto] ?? null;
}

/**
 * Pistas DECLARADAS por tipo — a camada determinística. Não decidem sozinhas (o LLM lê a
 * documentação inteira e vê o que uma regex não vê); servem para (a) dar o palpite quando o
 * LLM cala ou devolve lixo e (b) alimentar a evidência que vai ao painel de validação.
 *
 * ⚠️ **`\b` em JS é ASCII-only**: `rob[ôo]\b` NUNCA casa "robô" seguido de espaço (o `ô` já é
 * não-palavra para o motor, então não há fronteira ali). Onde a pista termina em letra
 * acentuada, o fim é `(?![\wÀ-ÿ])`. Mesmo gotcha das `PISTAS_PROJECAO` e do `[1.4]`.
 *
 * ⚠️ Varridas na ORDEM de `TIPOS_PROJETO` (precedência), não por contagem de casamentos:
 * contar ocorrências faria "painel" citado 3× na descrição vencer o "agente" que o projeto é.
 */
const PISTAS_TIPO: Record<TipoProjeto, RegExp[]> = {
  agente: [/\bagentes?\b/i, /\bagentic/i, /chat\s?bot/i, /\bbot\b/i, /assistente/i, /copilot/i, /\bllm\b/i],
  sistema: [/\bplataforma\b/i, /\bsistema\b/i, /\bhub\b/i, /\bm[óo]dulos?\b/i, /\berp\b/i],
  app: [/\baplicativ/i, /\bapp\b/i, /\bportal\b/i, /\bformul[áa]rio\b/i, /\bcadastr/i, /\btela de\b/i, /\binterface\b/i],
  dashboard: [/\bdashboards?\b/i, /\bpain[ée]l\b/i, /\bpain[ée]is\b/i, /\bvis[ãa]o gerencial\b/i, /\bindicadores\b/i, /\bgr[áa]ficos?\b/i, /\brelat[óo]rio\b/i],
  automacao: [/\bautoma[çc]/i, /\brpa\b/i, /\brob[ôo](?![\wÀ-ÿ])/i, /\bn8n\b/i, /\bscript\b/i, /\bcron\b/i, /\bintegra[çc]/i, /\brotina\b/i, /\bdisparo\b/i],
};

export type PalpiteTipo = { tipo: TipoProjeto; evidencia: string } | null;

/**
 * Palpite determinístico a partir do texto livre do projeto (nome + descrição + doc).
 * Devolve o primeiro tipo, na ordem de precedência, cuja pista casar — e a pista que casou,
 * para o painel de validação poder mostrar POR QUE o palpite foi esse.
 */
export function palpitarTipo(texto: string): PalpiteTipo {
  const alvo = String(texto ?? '');
  if (!alvo.trim()) return null;
  for (const tipo of TIPOS_PROJETO) {
    for (const pista of PISTAS_TIPO[tipo]) {
      const m = alvo.match(pista);
      if (m) return { tipo, evidencia: m[0] };
    }
  }
  return null;
}

// ─── Eixo NÍVEL — reaproveita a coluna `Complexidade` ────────────────────────

/**
 * Os 4 níveis. Os 3 primeiros são os valores JÁ GRAVADOS na coluna `Complexidade`; só
 * `agentico` é novo. Ordem = do mais simples ao mais alto (usada para comparar/rebaixar).
 */
export const NIVEIS_PROJETO = ['automacao', 'inteligencia', 'autonomia', 'agentico'] as const;
export type NivelProjeto = (typeof NIVEIS_PROJETO)[number];

/**
 * Rótulos de EXIBIÇÃO do nível — o vocabulário do plano (5.4). O valor gravado continua
 * sendo o slug: renomear valor invalidaria as 578 linhas e o `parseCategoria` do Gomoon.
 */
export const ROTULO_NIVEL: Record<NivelProjeto, string> = {
  automacao: 'Determinístico',
  inteligencia: 'Inteligente',
  autonomia: 'Autônomo',
  agentico: 'Agêntico',
};

/** Posição na escala (0 = mais simples). Serve para "só rebaixa, nunca promove". */
export function grauDoNivel(nivel: NivelProjeto): number {
  return NIVEIS_PROJETO.indexOf(nivel);
}

/**
 * Texto do 4º degrau para o prompt. FONTE ÚNICA — o `analyzer.ts` interpola daqui.
 *
 * A fronteira `autonomia` × `agentico` é **quem escreve o roteiro**: autônomo executa
 * sozinho um caminho que o construtor definiu; agêntico DECIDE o caminho — escolhe quais
 * ferramentas usar, em que ordem, e itera até concluir o objetivo.
 */
export const DEFINICAO_AGENTICO =
  '"agentico" — além de agir sozinho (autonomia), o sistema DECIDE O PRÓPRIO CAMINHO: recebe um objetivo, escolhe quais ferramentas/passos usar e em que ordem, e ITERA até concluir, em vez de percorrer um roteiro fixo escrito por quem o construiu. Exige IA em runtime E ação consequente na ponta. (Ex.: agente que recebe "resolva este chamado", decide sozinho consultar o pedido, depois o estoque, depois responder e fechar.) ⚠️ Fluxo de N passos encadeados que SEMPRE roda na mesma ordem NÃO é agêntico — é autonomia, por mais passos que tenha.';

/**
 * Invariante determinística do 4º degrau: `agentico` **exige os dois eixos ligados**
 * (ação consequente + IA em runtime). Só REBAIXA — nunca promove ninguém a agêntico por
 * sinal automático, pela mesma razão que a autonomia nunca é promovida por regra: o
 * falso-positivo é caro e a promoção indevida infla o score de todo mundo no Gomoon.
 *
 * `null`/`undefined` nos sinais = "não inferido" → não rebaixa (confia no LLM), igual ao
 * freio anti-falso-autonomia que já existe.
 */
export function rebaixarAgenticoSemSinal(
  nivel: NivelProjeto,
  sinais: { acao_autonoma?: boolean | null; ia_efetiva?: boolean | null },
): { nivel: NivelProjeto; ajuste: string | null } {
  if (nivel !== 'agentico') return { nivel, ajuste: null };
  if (sinais.acao_autonoma === false) {
    const destino: NivelProjeto = sinais.ia_efetiva === true ? 'inteligencia' : 'automacao';
    return { nivel: destino, ajuste: `agentico rebaixado para '${destino}' (acao_autonoma=false)` };
  }
  if (sinais.ia_efetiva === false) {
    return { nivel: 'autonomia', ajuste: `agentico rebaixado para 'autonomia' (sem IA em runtime)` };
  }
  return { nivel, ajuste: null };
}

// ─── Cruzamento dos dois eixos ───────────────────────────────────────────────

/**
 * Invariante de COERÊNCIA entre os eixos: um artefato classificado como **Agente** que não
 * usa IA em runtime não é um agente — é uma automação com cara de conversa (o menu de
 * respostas fixas do "bot" do WhatsApp). Como todo guard deste repo, só CORRIGE para baixo.
 *
 * Só age com sinal EXPLÍCITO `false`; `null` (submissão antiga, sem o campo) não mexe.
 */
export function coerirTipoComNivel(
  tipo: TipoProjeto | null,
  sinais: { ia_efetiva?: boolean | null },
): { tipo: TipoProjeto | null; ajuste: string | null } {
  if (tipo === 'agente' && sinais.ia_efetiva === false) {
    return { tipo: 'automacao', ajuste: `tipo 'agente' rebaixado para 'automacao' (sem IA em runtime)` };
  }
  return { tipo, ajuste: null };
}

/**
 * A decisão final do eixo TIPO: LLM primeiro, palpite determinístico como rede, guard de
 * coerência por cima. Devolve também de ONDE veio, porque o painel de validação precisa
 * distinguir "o agente decidiu" de "ninguém decidiu e caiu no fallback".
 */
export type OrigemTipo = 'llm' | 'deterministico' | 'indefinido';

export function resolverTipoProjeto(input: {
  sugestaoLLM?: unknown;
  texto?: string;
  ia_efetiva?: boolean | null;
}): { tipo: TipoProjeto | null; origem: OrigemTipo; evidencia: string | null; ajuste: string | null } {
  const doLLM = normalizarTipo(input.sugestaoLLM);
  const palpite = doLLM ? null : palpitarTipo(input.texto ?? '');
  const escolhido = doLLM ?? palpite?.tipo ?? null;
  const { tipo, ajuste } = coerirTipoComNivel(escolhido, { ia_efetiva: input.ia_efetiva });
  return {
    tipo,
    origem: doLLM ? 'llm' : palpite ? 'deterministico' : 'indefinido',
    evidencia: palpite?.evidencia ?? null,
    ajuste,
  };
}

/** Célula da planilha: rótulo legível, "—" quando não há tipo (padrão do repo). */
export function tipoParaSheet(tipo: TipoProjeto | null | undefined): string {
  return tipo ? ROTULO_TIPO[tipo] : '—';
}
