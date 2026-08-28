/**
 * `TAXONOMIA_FUNCAO` + roteador por FUNÇÃO — módulo PURO (T2 do painel de agentes).
 *
 * ## Por que FUNÇÃO e nunca ÁREA
 * Área aproxima por setor/marca e **separa irmãos de função**: o «GoPrice» (Gocase) tirou 0–1★ e o
 * «Agente precificador» (Gobeaute) tirou 4★ fazendo quase a mesma coisa. Foi por isso que o texto
 * do embedding cortou área/ferramenta/tipo (`textoParaEmbedding`), e é a mesma razão aqui. Medido
 * na base real (50 especiais, 13 áreas, 26/08/2026): **precificação aparece em Growth e em
 * Gobeaute · painel aparece em 6 áreas diferentes** — agrupar por área daria vizinho errado.
 *
 * ## Por que a taxonomia é DECLARADA e o roteador é DETERMINÍSTICO
 * Se o LLM inventasse as funções a cada corrida, "Precificação" viraria "Pricing" na semana
 * seguinte e **a comparação entre corridas morria** — sem comparabilidade não existe o T7. Então:
 * lista fechada aqui, e a classificação é **casamento de vocabulário**, não julgamento. Isso dá de
 * graça a propriedade que o plano pede: **mesmo texto → mesma função, sempre**, sem custo de LLM e
 * sem variação de temperatura.
 *
 * ## Onde os vizinhos do Pinecone entram
 * Como **EVIDÊNCIA, não como decisor**: eles só falam quando o vocabulário do próprio texto não
 * decide (empate ou nenhum termo). Deixá-los decidir sempre seria trocar uma régua declarada por
 * "o que os vizinhos parecem ser" — e vizinho errado propagaria função errada em cadeia.
 *
 * ⚠️ Módulo PURO: sem banco, sem rede, sem LLM. ⚠️ Ele **não dá nota nenhuma** — função é rota,
 * não juízo de valor.
 */

/** Uma função declarada. `termos` são RADICAIS já sem acento (o texto é normalizado antes). */
export type Funcao = {
  chave: string;
  rotulo: string;
  /** Vai no prompt dos avaliadores para dizer o que este grupo faz. */
  definicao: string;
  termos: string[];
};

/** Devolvido quando nada casa. É resposta honesta, não lixo — e o painel trata como grupo próprio. */
export const FUNCAO_INDEFINIDA = 'indefinida';

/**
 * As funções, **da mais específica para a mais genérica** — a ordem É o critério de desempate
 * (ver `classificarFuncao`). ⚠️ `painel_indicador` e `plataforma_ia` ficam no FIM de propósito:
 * são as duas que qualquer projeto encosta ("tem um dashboard", "usa IA"), e no topo da lista
 * engoliriam os grupos que realmente distinguem o trabalho.
 */
export const TAXONOMIA_FUNCAO: Funcao[] = [
  {
    chave: 'preco_margem',
    rotulo: 'Preço, margem e orçamento',
    definicao: 'Define, monitora ou recalcula preço, custo, margem, orçamento ou cotação.',
    termos: [
      'precific', 'preco', 'precos', 'margem', 'markup', 'cmv', 'orcamento', 'cotacao',
      'tabela de preco', 'remarcacao', 'desconto', 'cupom', 'cupons', 'faixa de preco',
    ],
  },
  {
    chave: 'qualidade_inspecao',
    rotulo: 'Qualidade e inspeção',
    definicao: 'Confere amostra, peça ou lote contra um padrão e aponta defeito ou desvio.',
    termos: [
      'controle de qualidade', 'inspec', 'defeito', 'refugo', 'conformidade da peca',
      'analise de impressao', 'aprovacao de amostra', 'laudo', ' qc ',
    ],
  },
  {
    chave: 'documento_fiscal',
    rotulo: 'Documento, fiscal e faturamento',
    definicao: 'Emite, confere ou arquiva documento fiscal, contrato, romaneio ou fatura.',
    termos: [
      'nota fiscal', 'nfe', 'faturamento', 'fatura', 'romaneio', 'assinatura digital',
      'imposto', 'difal', 'tributar', 'boleto', 'conciliacao fiscal', 'industrializacao',
    ],
  },
  {
    chave: 'logistica_prazo',
    rotulo: 'Logística, prazo e estoque',
    definicao: 'Cuida de frete, prazo de entrega, transportadora, estoque ou planejamento de supply.',
    termos: [
      'frete', 'transportadora', 'prazo de entrega', 'sla de entrega', 'rastreio', 'shipping',
      'estoque', 'supply', 's&oe', 'reposicao', 'expedicao', 'coleta da transportadora',
    ],
  },
  {
    chave: 'conteudo_criativo',
    rotulo: 'Conteúdo e criativo',
    definicao: 'Gera, testa ou publica peça criativa: estampa, arte, anúncio, vídeo, copy.',
    termos: [
      'estampa', 'criativo', 'anuncio', 'ads', 'ctr', 'copy', 'arte final', 'banner',
      'video', 'videos', 'reels', 'live', 'lives', 'briefing criativo', 'admaker', 'imagem gerada',
    ],
  },
  {
    chave: 'atendimento_mensagem',
    rotulo: 'Atendimento e mensagens',
    definicao: 'Fala com cliente, creator ou time: ticket, chamado, mensagem, comentário, resposta.',
    termos: [
      'ticket', 'chamado', 'atendimento', ' cx ', 'sac', 'whatsapp', 'coment',
      'mensagem', 'mensagens', 'resposta ao cliente', 'nps', 'review', 'reclamacao', 'creator',
    ],
  },
  {
    chave: 'coleta_externa',
    rotulo: 'Coleta de dado externo',
    definicao: 'Busca fora de casa: concorrente, marketplace, site público, benchmark.',
    termos: [
      'scraper', 'scraping', 'raspagem', 'benchmark', 'concorrent', 'marketplace',
      'coleta de dados externos', 'monitorar sites', 'tendencia de mercado', 'busca publica',
    ],
  },
  {
    chave: 'alerta_monitoramento',
    rotulo: 'Alerta e monitoramento',
    definicao: 'Vigia um número e AVISA quando sai do esperado — o valor está no aviso, não na tela.',
    termos: [
      'alerta', 'alertas', 'farol', 'notifica quando', 'avisa quando', 'monitora',
      'monitoramento', 'fora do padrao', 'desvio', 'gatilho', 'acompanhamento de mudanca',
    ],
  },
  {
    chave: 'pessoas_processo',
    rotulo: 'Gente e processo interno',
    definicao: 'Organiza pessoas e ritos internos: checklist, treinamento, cultura, conformidade.',
    termos: [
      'onboarding', 'checklist', 'treinamento', 'matriz de habilidades', 'cultura',
      'codigo de conduta', 'indicacao', 'recrutamento', 'avaliacao de desempenho',
      'registro de ponto', 'processo interno do time',
    ],
  },
  {
    chave: 'integracao_sistemas',
    rotulo: 'Integração entre sistemas',
    definicao: 'Liga dois sistemas e mantém o dado igual nos dois — sincronização, importação, hub.',
    termos: [
      'integracao', 'integrar', 'sincroniz', ' erp ', ' crm ', 'webhook', 'importar do sistema',
      'exportar para o sistema', 'api de terceiro', 'hub de integracao', 'yampi', 'shopify',
    ],
  },
  {
    chave: 'painel_indicador',
    rotulo: 'Painel e indicador',
    definicao: 'Consolida número em painel, relatório ou visão recorrente para alguém olhar.',
    termos: [
      'dashboard', 'painel', 'relatorio', 'indicador', 'kpi', 'visao consolidada',
      'grafico', 'metabase', 'looker', 'planilha consolidada',
    ],
  },
  {
    chave: 'plataforma_ia',
    rotulo: 'Plataforma ou agente de IA',
    definicao: 'Produto interno com IA no fluxo, que decide ou executa sozinho — não só consulta.',
    termos: [
      'agente autonomo', 'agente de ia', 'copiloto', 'prompt studio', 'plataforma interna',
      'decide sozinho', 'executa sozinho', 'assistente de ia', 'llm', 'modelo de linguagem',
      'rag', 'embedding',
    ],
  },
];

const POR_CHAVE = new Map(TAXONOMIA_FUNCAO.map((f) => [f.chave, f]));

/** Rótulo legível de uma chave (inclusive `indefinida`) — para relatório e prompt. */
export function rotuloFuncao(chave: string): string {
  return POR_CHAVE.get(chave)?.rotulo ?? 'Função indefinida';
}

export function definicaoFuncao(chave: string): string | null {
  return POR_CHAVE.get(chave)?.definicao ?? null;
}

/**
 * Normaliza para o casamento: minúsculas, sem acento, pontuação virando espaço e espaço colapsado.
 * As bordas ganham espaço para um termo como `' qc '` poder exigir palavra isolada sem `\b`
 * (⚠️ `\b` em JS é ASCII-only e o repo já se queimou com isso — aqui o texto chega sem acento,
 * mas o guard explícito é mais barato de ler do que a regra do `\b`).
 */
export function normalizarTexto(t: string): string {
  const semAcento = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return ' ' + semAcento.replace(/[^a-z0-9&]+/g, ' ').trim().replace(/\s+/g, ' ') + ' ';
}

/**
 * Um termo casa quando aparece **começando em fronteira de palavra** — `precific` pega
 * "precificador" e "precificação" (radical de propósito), mas `preco` NÃO pega "impreco…" nem
 * vira falso positivo dentro de outra palavra.
 */
function casaTermo(textoNorm: string, termo: string): boolean {
  const t = normalizarTexto(termo).trim();
  if (!t) return false;
  const idx = textoNorm.indexOf(t);
  if (idx < 0) return false;
  // O termo já normalizado começa em fronteira se o char anterior não é alfanumérico.
  const antes = textoNorm[idx - 1];
  return antes === undefined || !/[a-z0-9]/.test(antes);
}

/**
 * O projeto para o roteador, em duas partes. `titulo` = nome + "o que faz" (a frase que a pessoa
 * escreveu para dizer o que é); `corpo` = o resto (memorial, doc).
 */
export type EntradaFuncao = { titulo?: string | null; corpo?: string | null };

/**
 * Quanto vale um termo que aparece no TÍTULO em relação a um que aparece só no corpo.
 *
 * ⚠️ Medido na base real (51 especiais, 26/08/2026): sem esse peso, **14 de 51 (27%) empatavam em
 * 1 termo × 1 termo** e o desempate ficava arbitrário — e errava. Quatro casos concretos: «Gobeaute
 * Prompt Studio» virava *integração* por um "integrar" perdido na doc, em vez de *plataforma de IA*
 * pelo "prompt studio" que está no NOME; «[VERSTA] Robo orçamento» virava *criativo* por um "ads" do
 * corpo, em vez de *orçamento*; «Hub Criativo» virava *gente e processo* por um "checklist"; e
 * «Ferramenta de comentar nos posts» virava *criativo* por "vídeo". Um termo no nome é o autor
 * dizendo o que o projeto É; um termo no meio de 4 mil caracteres de doc é menção de passagem.
 */
export const PESO_TITULO = 3;

export type PontoPlacar = { funcao: string; rotulo: string; pontos: number; termos: string[] };

export type FuncaoDetectada = {
  /** A chave escolhida, ou `indefinida`. */
  funcao: string;
  rotulo: string;
  /** `texto` = o vocabulário do projeto decidiu · `vizinhos` = evidência do índice · `nenhuma`. */
  origem: 'texto' | 'vizinhos' | 'nenhuma';
  /** Os termos que sustentaram a escolha — é o que torna a rota conferível à mão. */
  termos: string[];
  /** Todas as funções com ponto, da maior para a menor. Vazio quando nada casou. */
  placar: PontoPlacar[];
  /** Houve empate no topo, resolvido pela ORDEM declarada da taxonomia. */
  empate: boolean;
};

/** Evidência de um vizinho do índice: o texto que se sabe dele + o quanto ele se parece. */
export type EvidenciaVizinho = {
  texto: string;
  similaridade: number;
};

/**
 * Conta os termos DISTINTOS de cada função no texto. Distintos, e não ocorrências: um memorial que
 * repete "dashboard" 12 vezes não vale mais que um que nomeia preço, margem e markup — repetição é
 * estilo de escrita, variedade de vocabulário é sinal de assunto.
 */
export function placarFuncao(entrada: string | EntradaFuncao): PontoPlacar[] {
  const e: EntradaFuncao = typeof entrada === 'string' ? { corpo: entrada } : entrada;
  const titulo = normalizarTexto(e.titulo ?? '');
  const corpo = normalizarTexto(e.corpo ?? '');
  const placar: PontoPlacar[] = [];
  for (const f of TAXONOMIA_FUNCAO) {
    const casados: string[] = [];
    let pontos = 0;
    for (const t of f.termos) {
      const noTitulo = casaTermo(titulo, t);
      const noCorpo = casaTermo(corpo, t);
      if (!noTitulo && !noCorpo) continue;
      casados.push(t);
      pontos += noTitulo ? PESO_TITULO : 1;
    }
    if (casados.length > 0) {
      placar.push({ funcao: f.chave, rotulo: f.rotulo, pontos, termos: casados });
    }
  }
  // Empate mantém a ORDEM DECLARADA (índice na taxonomia) — determinismo antes de elegância.
  const ordem = new Map(TAXONOMIA_FUNCAO.map((f, i) => [f.chave, i]));
  return placar.sort(
    (a, b) => b.pontos - a.pontos || (ordem.get(a.funcao) ?? 0) - (ordem.get(b.funcao) ?? 0),
  );
}

/**
 * A função do projeto. Vocabulário do próprio texto manda; os vizinhos entram só quando ele
 * **não decide** (nada casou, ou empate no topo). Puro e estável: mesmo texto → mesma resposta.
 */
export function classificarFuncao(
  entrada: string | EntradaFuncao,
  vizinhos: EvidenciaVizinho[] = [],
): FuncaoDetectada {
  const placar = placarFuncao(entrada);
  const empate = placar.length > 1 && placar[0].pontos === placar[1].pontos;

  // O vocabulário do PRÓPRIO projeto sempre manda — inclusive no empate, resolvido pela ordem
  // declarada (a função mais específica ganha).
  //
  // ⚠️ Os vizinhos NÃO desempatam mais (medido em 26/08/2026): a única coisa que se sabe deles é
  // `nome + leitura`, um texto curtíssimo, e com ele eles decidiram 13 de 51 casos e **erraram ao
  // menos 3** — «Hub Criativo» foi para *gente e processo*, «[VERSTA] Robo orçamento» para
  // *criativo*. Evidência fina não pode vencer uma régua declarada; o peso do título (acima) é o
  // desempate honesto, porque vem do texto do projeto.
  if (placar.length > 0) {
    const topo = placar[0];
    return {
      funcao: topo.funcao,
      rotulo: topo.rotulo,
      origem: 'texto',
      termos: topo.termos,
      placar,
      empate,
    };
  }

  // Nada casou: aí sim os vizinhos são o ÚNICO sinal que existe (é o caso do «Prisma», cujo nome e
  // descrição não dizem o que ele faz). Voto ponderado pela similaridade — vizinho de fronteira não
  // vale o mesmo que o quase-idêntico.
  const votos = new Map<string, number>();
  for (const v of vizinhos) {
    const p = placarFuncao(v.texto);
    if (p.length === 0) continue;
    const peso = Number.isFinite(v.similaridade) && v.similaridade > 0 ? v.similaridade : 0;
    if (peso <= 0) continue;
    votos.set(p[0].funcao, (votos.get(p[0].funcao) ?? 0) + peso);
  }
  let melhor: { funcao: string; peso: number } | null = null;
  for (const [funcao, peso] of votos) {
    if (!melhor || peso > melhor.peso) melhor = { funcao, peso };
  }

  if (melhor) {
    return {
      funcao: melhor.funcao,
      rotulo: rotuloFuncao(melhor.funcao),
      origem: 'vizinhos',
      termos: [],
      placar,
      empate,
    };
  }

  return {
    funcao: FUNCAO_INDEFINIDA,
    rotulo: rotuloFuncao(FUNCAO_INDEFINIDA),
    origem: 'nenhuma',
    termos: [],
    placar: [],
    empate: false,
  };
}

// ─── Cobertura da taxonomia (o relatório do T2) ────────────────────────────────

export type CoberturaFuncao = {
  total: number;
  /** Quantos caíram em cada função, da maior para a menor. */
  por_funcao: { funcao: string; rotulo: string; n: number; pct: number }[];
  indefinidas: number;
  indefinidas_pct: number;
  /** Quantos precisaram dos vizinhos para decidir. */
  por_vizinhos: number;
  /** Funções DECLARADAS que ninguém ocupou — candidatas a sair da lista. */
  vazias: string[];
};

/**
 * Mede a taxonomia contra a base. Duas leituras que importam: **`indefinidas` alto** = o
 * vocabulário não cobre a base (falta termo, não falta função), e **`vazias`** = função declarada
 * que ninguém ocupa, que só dilui o roteamento. Sem isso a taxonomia seria opinião.
 */
export function medirCobertura(detectadas: FuncaoDetectada[]): CoberturaFuncao {
  const total = detectadas.length;
  const contagem = new Map<string, number>();
  let indefinidas = 0;
  let porVizinhos = 0;
  for (const d of detectadas) {
    if (d.funcao === FUNCAO_INDEFINIDA) indefinidas++;
    else contagem.set(d.funcao, (contagem.get(d.funcao) ?? 0) + 1);
    if (d.origem === 'vizinhos') porVizinhos++;
  }
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  const ordem = new Map(TAXONOMIA_FUNCAO.map((f, i) => [f.chave, i]));
  return {
    total,
    por_funcao: [...contagem.entries()]
      .map(([funcao, n]) => ({ funcao, rotulo: rotuloFuncao(funcao), n, pct: pct(n) }))
      .sort((a, b) => b.n - a.n || (ordem.get(a.funcao) ?? 0) - (ordem.get(b.funcao) ?? 0)),
    indefinidas,
    indefinidas_pct: pct(indefinidas),
    por_vizinhos: porVizinhos,
    vazias: TAXONOMIA_FUNCAO.filter((f) => !contagem.has(f.chave)).map((f) => f.chave),
  };
}
