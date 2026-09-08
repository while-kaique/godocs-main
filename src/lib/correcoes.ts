/**
 * CORREÇÕES humanas — o que a triagem mudou, e **por quê** — módulo PURO.
 *
 * ## Por que existe
 * O sistema já sabia o "antes → depois" de cada nota (o `definirEstrelasEspecial` lê a estrela
 * anterior antes de escrever) e o RAG já prefere a nota HUMANA à recomendada como âncora. Então
 * corrigir o PIAPP de 5 para 8 já fazia o próximo projeto parecido receber "PIAPP = 8" como
 * vizinho.
 *
 * O que faltava era o PORQUÊ, e a diferença entre ter e não ter é a diferença entre duas coisas
 * muito distintas:
 *
 * - **sem o motivo**, o agente aprende "concorde com o humano". Ele decora que projeto parecido
 *   com o PIAPP vale 8. Isso é gabarito, não critério, e é o viés que o dono do produto vetou
 *   explicitamente;
 * - **com o motivo**, ele aprende "subi porque OUTROS PROJETOS RODAM EM CIMA DELE, e você tinha
 *   lido isso como alcance em vez de plataforma". Isso generaliza para um projeto que não se
 *   parece nada com o PIAPP e tem a mesma propriedade.
 *
 * ⚠️ **A correção entra como EXEMPLO COMPARÁVEL, nunca como alvo.** Nada aqui ajusta nota
 * automaticamente. O agente vê o que a gente mudou e por quê, do mesmo jeito que vê um vizinho.
 *
 * ## Por que serve para o financeiro também
 * A forma é a mesma: um número, o número novo, e a razão. Muda só de onde a correção vem — a
 * estrela é um clique no app, o valor é corrigido na planilha pela triagem. Por isso `tipo` é
 * campo, e não dois módulos.
 */

/**
 * O que a mão humana corrigiu: a NOTA de um especial, o VALOR financeiro na planilha, ou o
 * DESFECHO que o time de avaliação propôs (o 👎 da ficha de triagem).
 *
 * ⚠️ O `veredito` não é numérico, e é por isso que ele tem par de campos próprio
 * (`veredito_de`/`veredito_para`): "reprovar → aprovar" não cabe em `de`/`para`, e forçá-lo num
 * número inventaria uma escala que ninguém definiu.
 */
export type TipoCorrecao = 'estrela' | 'valor' | 'veredito';

/**
 * QUAL lente do agente errou — o eixo da discordância.
 *
 * ⚠️ Existe porque o `tipo` diz o que foi corrigido, não QUEM errou. Sem o eixo, a lição
 * ensina "esta nota estava errada"; com ele, ensina "foi o seu raciocínio de HORAS que estava
 * errado", que é o que o especialista daquele eixo precisa ler.
 */
export type EixoCorrecao = 'horas' | 'financeiro' | 'precedente' | 'impacto_irrelevante' | 'outro';

/** Os eixos aceitos. Eixo fora desta lista vira `null` — nunca um eixo inventado. */
export const EIXOS_CORRECAO: readonly EixoCorrecao[] = [
  'horas',
  'financeiro',
  'precedente',
  'impacto_irrelevante',
  'outro',
];

/**
 * Como o eixo é NOMEADO na lição e na tela — FONTE ÚNICA.
 *
 * ⚠️ Não redigite estes textos no formulário da ficha: o rótulo que a pessoa escolhe tem de ser
 * o mesmo que o agente lê, senão a lição fala de um eixo com um nome que o prompt não usa.
 */
export const ROTULO_EIXO: Record<EixoCorrecao, string> = {
  horas: 'horas',
  financeiro: 'financeiro',
  precedente: 'precedente',
  impacto_irrelevante: 'impacto irrelevante',
  outro: 'outro',
};

/**
 * Uma linha explicando cada eixo — para a TELA escolher com sentido, não por adivinhação.
 *
 * ⚠️ Vive ao lado do `ROTULO_EIXO` de propósito: rótulo e sentido têm de andar juntos, senão a
 * tela ensina um significado e o prompt lê outro.
 */
export const AJUDA_EIXO: Record<EixoCorrecao, string> = {
  horas: 'as horas declaradas não são plausíveis para quem fazia o trabalho',
  financeiro: 'o valor não fecha, ou o mesmo dinheiro foi contado duas vezes',
  precedente: 'comparou com os projetos errados, ou ignorou um parecido já decidido',
  impacto_irrelevante: 'o ganho existe mas é pequeno demais para o que o projeto afirma',
  outro: 'o erro não é de nenhum eixo acima',
};

/**
 * Os desfechos que a triagem pode apontar como o certo — FONTE ÚNICA da tela, do servidor e da
 * lição. O `valor` é o que vai gravado; o `rotulo` é o que a pessoa lê.
 *
 * ⚠️ São 3 e não 2: "precisa de olho humano" não é meio-aprovar, é o desfecho legítimo de quem
 * viu sinal e não quer decidir sozinho. Sem ele, quem discorda é empurrado a escolher um extremo
 * que não pensou.
 */
export const VEREDITOS_CERTOS = [
  { valor: 'aprovar', rotulo: 'Deveria aprovar' },
  { valor: 'em_validacao', rotulo: 'Precisa de olho humano' },
  { valor: 'reprovar', rotulo: 'Deveria reprovar' },
] as const;

/** Interpreta o eixo cru (de `meta_json` ou do formulário). Desconhecido/ausente → `null`. */
export function eixoValido(bruto: unknown): EixoCorrecao | null {
  return typeof bruto === 'string' && (EIXOS_CORRECAO as readonly string[]).includes(bruto)
    ? (bruto as EixoCorrecao)
    : null;
}

export type Correcao = {
  tipo: TipoCorrecao;
  projeto_id: string;
  projeto_nome: string | null;
  /** O que estava lá antes da mão humana. `null` quando não havia nada. */
  de: number | null;
  /** O que a pessoa cravou. `null` no `veredito`, que não é número. */
  para: number | null;
  /** Qual lente do agente errou. `null` quando a correção não declarou eixo (legado). */
  eixo: EixoCorrecao | null;
  /** Só no `tipo: 'veredito'`: o desfecho que o agente propôs. */
  veredito_de: string | null;
  /** Só no `tipo: 'veredito'`: o desfecho que a triagem diz ser o certo. */
  veredito_para: string | null;
  /** O que o AGENTE tinha recomendado, quando havia recomendação. */
  recomendado: number | null;
  /**
   * O PORQUÊ que o agente escreveu — o texto que a pessoa estava lendo quando discordou.
   *
   * ⚠️ Sem ele a lição fica pela metade. O motivo humano é quase sempre uma RÉPLICA a uma frase
   * específica ("você disse que caiu para 0 porque antes ninguém fazia, mas dá para escalar e
   * ter saving escalado"). Guardar só a réplica é guardar metade de uma conversa: o agente lê
   * "dá para escalar" sem saber a qual raciocínio dele aquilo responde, e não tem como corrigir
   * o passo que errou.
   */
  leitura_agente: string | null;
  /** A razão escrita por quem corrigiu. É o que transforma gabarito em critério. */
  motivo: string | null;
  quando: string | null;
};

/** Teto do motivo. Duas frases: é uma anotação de triagem, não um parecer. */
export const MOTIVO_MAX = 400;

/**
 * Piso do motivo — o mesmo que `ensinaAlgo` cobra, para a tela não aceitar o que o prompt vai
 * descartar em silêncio. É baixo de propósito: "roda em 3 marcas" ensina, e cobrar redação
 * faria a pessoa desistir de escrever.
 */
export const MOTIVO_MIN = 10;

/**
 * A correção vale como lição quando MUDA alguma coisa e diz por quê.
 *
 * ⚠️ Correção sem motivo NÃO vira exemplar de primeira classe: ela continua valendo como âncora
 * de magnitude (o RAG já faz isso), mas não entra no prompt como lição. Sem a razão, tudo que
 * ela ensina é "a nota é essa porque sim", que é exatamente o decorar-gabarito.
 */
export function ensinaAlgo(c: Correcao): boolean {
  if (!c.motivo || c.motivo.trim().length < MOTIVO_MIN) return false;
  // ⚠️ O veredito tem a MESMA régua ("mudou alguma coisa?"), só não é numérica: sem os dois
  // desfechos, ou com os dois iguais, não há correção nenhuma a ensinar.
  if (c.tipo === 'veredito') {
    const de = c.veredito_de?.trim();
    const para = c.veredito_para?.trim();
    return !!de && !!para && de !== para;
  }
  const referencia = c.recomendado ?? c.de;
  return referencia != null && referencia !== c.para;
}

/** Uma linha por correção, para o bloco de exemplos do prompt. */
export function descreverCorrecao(c: Correcao): string {
  // O PAR é a lição: o que o agente argumentou, e o que a réplica humana disse sobre AQUILO.
  const oQueOAgenteDisse = c.leitura_agente
    ? `\n    o agente argumentou: "${recortar(c.leitura_agente)}"`
    : '';
  const alvo = `«${c.projeto_nome ?? c.projeto_id}»`;
  // O eixo entra NOMEADO, logo depois do projeto: é a primeira coisa que o especialista daquele
  // eixo precisa reconhecer como sendo sobre ele.
  const eixo = c.eixo ? ` (eixo: ${ROTULO_EIXO[c.eixo]})` : '';
  const replica = `\n    a triagem respondeu: "${c.motivo}"`;

  if (c.tipo === 'veredito') {
    return `• ${alvo}${eixo}: o agente concluiu "${c.veredito_de}", a triagem corrigiu para "${c.veredito_para}".${oQueOAgenteDisse}${replica}`;
  }

  const dir = c.recomendado != null && (c.para ?? 0) > c.recomendado ? 'SUBIU' : 'BAIXOU';
  const origem = c.recomendado != null ? `o agente recomendou ${c.recomendado}` : `estava ${c.de}`;
  const unidade = c.tipo === 'estrela' ? '★' : '';
  return `• ${alvo}${eixo}: ${origem}, a triagem ${dir} para ${c.para}${unidade}.${oQueOAgenteDisse}${replica}`;
}

/** O argumento do agente entra recortado: o que ensina é a tese dele, não o texto inteiro. */
function recortar(t: string, teto = 220): string {
  const limpo = t.replace(/\s+/g, ' ').trim();
  return limpo.length <= teto ? limpo : `${limpo.slice(0, teto).replace(/\s+\S*$/, '')}…`;
}

/**
 * O bloco de lições para o prompt.
 *
 * ⚠️ O texto diz ao agente o que fazer com isso, e o que NÃO fazer: são correções de OUTROS
 * projetos, e servem para reconhecer o critério que ele deixou passar, não para copiar a nota.
 */
export function blocoCorrecoes(correcoes: Correcao[], teto = 6): string {
  const uteis = correcoes.filter(ensinaAlgo).slice(0, teto);
  if (uteis.length === 0) return '';
  return [
    'CORREÇÕES QUE A TRIAGEM JÁ FEZ (o que a gente mudou na sua recomendação, e por quê):',
    ...uteis.map(descreverCorrecao),
    '⚠️ Estas são correções em OUTROS projetos. Cada uma é um raciocínio SEU que a triagem',
    'respondeu. Leia o par: onde o argumento falhou, e o que faltava enxergar. Use isso para',
    'reconhecer o CRITÉRIO que passou batido, nunca para copiar a nota — um projeto que não se',
    'parece com nenhum deles pode ter a mesma propriedade, e um que se parece pode não ter.',
  ].join('\n');
}

// ─── Leitura do que já foi corrigido ──────────────────────────────────────────

/** Linha crua de `admin_activity_log`, só o que a correção precisa. */
export type LinhaAtividade = {
  acao: string;
  projeto_id: string | null;
  projeto_nome: string | null;
  meta_json: string | null;
  created_at: string | null;
};

/**
 * Extrai as correções das linhas do log de atividade.
 *
 * ⚠️ PURO de propósito: o log é a fonte, e ela é append-only, então a correção fica registrada
 * com a data em que foi feita e ninguém a reescreve. Aqui só se traduz.
 *
 * ⚠️ Uma correção por PROJETO, a mais recente. Se a triagem mexeu três vezes no mesmo cartão, o
 * que ensina é onde ela parou, não o caminho — e repetir o mesmo projeto no bloco de exemplos
 * gastaria as poucas linhas que ele tem.
 */
/**
 * As ações do `admin_activity_log` que carregam correção — e são só estas DUAS.
 *
 * ⚠️ Ação desconhecida continua sendo IGNORADA. Ampliar o union do `AcaoAdmin` não pode virar
 * porta aberta: uma ação sem o `meta_json` no formato certo entraria como lição vazia, e lição
 * vazia é pior que lição nenhuma (ocupa uma das 6 linhas do bloco e não ensina nada).
 */
export const ACOES_COM_CORRECAO = ['estrelas', 'avaliacao_discordancia'] as const;

/** Texto não-vazio do `meta`, ou `null`. */
function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Número finito do `meta`, ou `null`.
 *
 * ⚠️ ESTRITO de propósito. Com `Number(v)` solto, `''`, `' '`, `false` e `[]` viram **0** — e um
 * `nota_certa` em branco entraria no prompt como "a triagem corrigiu para 0★", que é uma lição
 * inventada. Aceita número finito, ou string que É um número.
 */
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+(?:[.,]\d+)?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function correcoesDoLog(linhas: LinhaAtividade[]): Correcao[] {
  const porProjeto = new Map<string, Correcao>();
  for (const l of linhas) {
    if (!l.projeto_id) continue;
    if (!(ACOES_COM_CORRECAO as readonly string[]).includes(l.acao)) continue;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(l.meta_json ?? '{}') as Record<string, unknown>;
    } catch {
      continue;
    }

    const comum = {
      projeto_id: l.projeto_id,
      projeto_nome: l.projeto_nome,
      eixo: eixoValido(meta.eixo),
      motivo: texto(meta.motivo),
      leitura_agente: texto(meta.leitura_do_agente),
      quando: l.created_at,
    };

    let c: Correcao | null = null;

    if (l.acao === 'estrelas') {
      const para = numero(meta.estrelas);
      if (para == null) continue;
      c = {
        ...comum,
        tipo: 'estrela',
        de: numero(meta.estrelas_anterior),
        para,
        recomendado: numero(meta.recomendado_pelo_agente),
        veredito_de: null,
        veredito_para: null,
      };
    } else {
      // A discordância da ficha de triagem (o 👎). Ela chega de dois jeitos, e o campo
      // preenchido é que decide o `tipo`: quem corrige a NOTA manda `nota_certa`, quem
      // corrige o DESFECHO manda `veredito_certo`. Sem nenhum dos dois não há correção.
      const notaCerta = numero(meta.nota_certa);
      const vereditoCerto = texto(meta.veredito_certo);
      if (notaCerta != null) {
        c = {
          ...comum,
          tipo: 'estrela',
          de: null,
          para: notaCerta,
          recomendado: numero(meta.recomendado_pelo_agente),
          veredito_de: null,
          veredito_para: null,
        };
      } else if (vereditoCerto) {
        c = {
          ...comum,
          tipo: 'veredito',
          de: null,
          para: null,
          recomendado: null,
          veredito_de: texto(meta.veredito_do_agente),
          veredito_para: vereditoCerto,
        };
      }
    }

    if (!c) continue;
    // O log vem do mais novo para o mais antigo: o primeiro que aparece é o que vale.
    if (!porProjeto.has(l.projeto_id)) porProjeto.set(l.projeto_id, c);
  }
  return [...porProjeto.values()];
}

/**
 * As correções que valem a pena mostrar — **as dos VIZINHOS primeiro**, recentes depois.
 *
 * ⚠️ Exclui a do PRÓPRIO projeto que está sendo julgado: mostrar ao agente a nota que a triagem
 * já cravou naquele cartão não é ensinar critério, é entregar a resposta.
 *
 * ⚠️ **A ordem é o desenho, e ela vem de uma pergunta do dono do produto (05/09/2026):** "não
 * seria melhor uma base de consulta em vez de tudo no prompt?". A intuição está certa — o que
 * ensina é a correção de um projeto PARECIDO, não a mais recente —, mas a base de consulta já
 * existe: é o RAG, que a esta altura já recuperou os `K_VIZINHOS` mais similares. Então a
 * correção viaja JUNTO do vizinho a que pertence, em vez de virar lista à parte.
 *
 * ⚠️ **Uma tool foi considerada e descartada, com motivo:** o `llm.ts` não expõe `tools` e o
 * proxy não faz tool-calling nativo (ver `avaliacao/ferramentas.ts`), então cada consulta seria
 * mais um round-trip de JSON parseado à mão — e falha de parse é o defeito que já custou 65% de
 * uma rodada inteira. Some-se que o bloco é capado em 6 lições: não há prompt crescendo sem
 * limite para justificar o custo.
 */
export function licoesPara(
  correcoes: Correcao[],
  projetoId: string,
  /** Ids dos vizinhos que o RAG recuperou para ESTE projeto. Vazio = só a ordem cronológica. */
  idsVizinhos: readonly string[] = [],
): Correcao[] {
  // ⚠️ As DUAS pontas da comparação são canonizadas. O `!==` cru era sensível a caixa enquanto
  // os vizinhos já vinham em minúscula: para LEGADO (a planilha guarda `LEGADO-049`, o sync cria
  // `legado-049`), a correção do PRÓPRIO projeto em julgamento entrava no prompt como lição — que
  // é exatamente o vazamento que esta função existe para evitar.
  const chave = (id: string) => String(id ?? '').trim().toLowerCase();
  const alvo = chave(projetoId);
  const vizinho = new Set(idsVizinhos.map(chave));
  const recente = (c: Correcao) => String(c.quando ?? '');
  return correcoes
    .filter((c) => chave(c.projeto_id) !== alvo && ensinaAlgo(c))
    .sort((a, b) => {
      const va = vizinho.has(chave(a.projeto_id)) ? 1 : 0;
      const vb = vizinho.has(chave(b.projeto_id)) ? 1 : 0;
      if (va !== vb) return vb - va;
      return recente(b).localeCompare(recente(a));
    });
}
