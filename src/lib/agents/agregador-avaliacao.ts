/**
 * AGREGADOR / juiz do time autônomo de avaliação (fatia B) — PURO, irmão de
 * `decidirStatusSubmissao`. Concilia os votos dos especialistas:
 *   • Plausibilidade/FTE (`avaliarPlausibilidadeFTE`, já existente da fatia A),
 *   • Financeiro (`avaliarFinanceiro`),
 *   • sinal do RAG por corpus de aprovados (`avaliarSinalRag`, aqui).
 *
 * Regra de ouro (o pedido do dono): **confiança baixa OU divergência → `em_validacao`** (fila
 * humana). O agregador **NUNCA decide sozinho** um desfecho negativo — só há dois caminhos,
 * `aprovar` (todos os votos confiantes e concordes) ou `em_validacao` (qualquer dúvida) — e
 * **especial é ISENTO** (liderança NÃO isenta mais — 01/09/2026; ver o gate).
 *
 * ⚠️ MODO SOMBRA (fatia B): esta função só PRODUZ a recomendação. Nada aqui muda o status do
 * projeto — quem registra é `avaliacao-normais.functions.ts`, na tabela `projeto_avaliacao`.
 */
import type { ResultadoPlausibilidadeFTE } from './analyzer';
import type { ResultadoFinanceiro } from './avaliacao-financeira';
import type { JulgamentoEspecialista } from './especialista-avaliacao';
import { ROTULO_CURTO_DIMENSAO } from '@/lib/mesa-parecer';

// ─── Sinal do RAG (vizinhos aprovados) ──────────────────────────────────────

/** Similaridade mínima do vizinho mais próximo para o RAG "apoiar" a aprovação. */
export const PISO_APOIO_RAG = 0.5;
/** Quantos vizinhos aprovados próximos são precisos para o apoio contar. */
export const MIN_VIZINHOS_APOIO = 2;

export type SinalRag = {
  /** Há vizinhos aprovados próximos o suficiente para apoiar a aprovação. */
  apoio: boolean;
  /** 0..1 — confiança do sinal (apoio forte alto; sem/poucos vizinhos, baixo). */
  confianca: number;
  /** Quantos vizinhos entraram no cálculo. */
  vizinhos: number;
  /** Maior similaridade entre os vizinhos (0 quando não há nenhum). */
  topSimilaridade: number;
  /** Motivo legível — null quando há apoio. */
  motivo: string | null;
};

/**
 * Deriva o sinal do RAG a partir dos vizinhos APROVADOS recuperados (cada um com sua
 * similaridade). Muitos e próximos → apoio (projeto se parece com o que a triagem já aprovou);
 * poucos/nenhum → sem apoio, confiança baixa (empurra para a fila humana). PURA.
 */
export function avaliarSinalRag(
  vizinhos: { similaridade: number }[],
  opts: { pisoApoio?: number; minVizinhos?: number } = {},
): SinalRag {
  const piso =
    typeof opts.pisoApoio === 'number' && isFinite(opts.pisoApoio) ? opts.pisoApoio : PISO_APOIO_RAG;
  const minV =
    typeof opts.minVizinhos === 'number' && isFinite(opts.minVizinhos)
      ? opts.minVizinhos
      : MIN_VIZINHOS_APOIO;

  const n = vizinhos.length;
  const top = n > 0 ? Math.max(...vizinhos.map((v) => v.similaridade)) : 0;
  const apoio = n >= minV && top >= piso;
  const confianca = apoio ? 0.85 : n === 0 ? 0.4 : 0.55;
  const motivo = apoio
    ? null
    : n === 0
      ? 'Nenhum projeto aprovado semelhante no corpus — recomendo conferência humana.'
      : 'Poucos projetos aprovados semelhantes — sinal fraco, recomendo conferência humana.';

  return { apoio, confianca, vizinhos: n, topSimilaridade: top, motivo };
}

// ─── Agregação dos votos ─────────────────────────────────────────────────────

/** Limiar de confiança abaixo do qual a decisão vira humana (`em_validacao`). */
export const LIMIAR_CONFIANCA_AGREGADOR = 0.6;

/**
 * QUÓRUM de preocupação para BARRAR uma aprovação — **só na mesa LLM (`agregarJulgamentos`)**.
 *
 * ⚠️ Era `>= 1` (qualquer preocupação vetava) e isso tornava `aprovar` INALCANÇÁVEL: um dos quatro
 * especialistas é o CÉTICO ADVERSARIAL, cuja persona manda "TENTAR DERRUBAR uma aprovação", então
 * uma objeção sempre aparecia. Medido em PROD (01/09/2026, 20 normais re-avaliados): **20/20**
 * voltaram `em_validacao`, ZERO aprovações — a mesa mandava 100% ao humano, não reduzia trabalho
 * nenhum e marcava 0% de acerto (100% "conservador") contra 589 aprovados humanos. Um sinal que
 * está SEMPRE aceso não é sinal.
 *
 * Com quórum 2 a objeção solitária não barra, mas **continua registrada** nos `motivos` (a ficha
 * mostra a ressalva) e **continua derrubando a confiança** pela concordância direcional. Duas ou
 * mais preocupações barram como antes. Simétrico: nenhuma dimensão é privilegiada.
 *
 * ⚠️ `agregarVotos` (o agregador DETERMINÍSTICO) NÃO usa isto e segue byte-idêntico.
 */
export const QUORUM_PREOCUPACAO = 2;

/**
 * Piso de painel para poder recomendar `aprovar`. Com UM único parecer a concordância direcional é
 * 1.0 por construção (o lado majoritário é o único lado) e inflaria a confiança — nunca aprovar no
 * voto de um só. (Achado da revisão do T2, deixado em aberto para quando o painel virasse parcial.)
 */
export const MIN_JULGAMENTOS_PARA_APROVAR = 2;

export type VeredictoAgregado = 'aprovar' | 'em_validacao' | 'isento';

export type ResultadoAgregado = {
  /** 'aprovar' (todos confiantes/concordes), 'em_validacao' (dúvida) ou 'isento' (especial/liderança). */
  veredito: VeredictoAgregado;
  /** 0..1 — confiança agregada (o elo mais fraco entre os votos). */
  confianca: number;
  /** Recomenda enfileirar para a triagem humana. */
  aplicarEmValidacao: boolean;
  /** Os votos apontam para direções diferentes (uns ok, outros problema). */
  divergencia: boolean;
  /** Especial/liderança — a avaliação automática não se aplica. */
  isento: boolean;
  /** Razões legíveis do desfecho. */
  motivos: string[];
};

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Concilia os três votos + confiança. **Nunca** devolve um veredito negativo automático:
 * só `aprovar`, `em_validacao` ou `isento`. Baixa confiança OU divergência → `em_validacao`.
 */
export function agregarVotos(input: {
  fte: ResultadoPlausibilidadeFTE;
  financeiro: ResultadoFinanceiro;
  rag: SinalRag;
  especial?: boolean | null;
  fluxoDireto?: boolean | null;
  limiarConfianca?: number | null;
}): ResultadoAgregado {
  // ⚠️ LIDERANÇA NÃO ISENTA MAIS (decisão do Luis, 01/09/2026). Só o ESPECIAL isenta.
  // Antes, `fluxoDireto` (autor coordenador+) devolvia `isento` e isso silenciava **145 dos 649
  // normais (22% da base)** — "Fluxo de Caixa FIP Gobeauty", "Triagem Automática de Comunicação de
  // Fornecedores" e cia. saíam sem nenhuma recomendação, justamente a faixa que passa pelo fluxo
  // DIRETO (sem agente, sem gates) e por isso mais merece um olhar. Pior: os 4 especialistas LLM
  // JÁ rodavam nesses projetos e o resultado era DESCARTADO pelo curto-circuito.
  // ⚠️ Isto é só a MESA (sombra). A imunidade do ANALISADOR real (`normalizarClassificacao` e
  // `decidirStatusSubmissao`, em `analyzer.ts`) continua intacta — lá `fluxoDireto` mexe em STATUS
  // de produção, aqui não muda nada além da recomendação exibida. NÃO unificar as duas réguas.
  if (input.especial === true) {
    return {
      veredito: 'isento',
      confianca: 1,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: true,
      motivos: [
        'Projeto especial ou de liderança — avaliação automática não se aplica (validação humana).',
      ],
    };
  }

  const limiar =
    typeof input.limiarConfianca === 'number' &&
    isFinite(input.limiarConfianca) &&
    input.limiarConfianca > 0
      ? input.limiarConfianca
      : LIMIAR_CONFIANCA_AGREGADOR;

  // Confiança por voto: FTE implausível derruba forte; os outros trazem a própria confiança.
  const confFte = input.fte.implausivel ? 0.2 : 0.9;
  const confFin = clamp01(input.financeiro.confianca);
  const confRag = clamp01(input.rag.confianca);
  const confianca = Math.min(confFte, confFin, confRag);

  const fteOk = !input.fte.implausivel;
  const finOk = input.financeiro.veredito === 'ok';
  const ragOk = input.rag.apoio;
  const problemas = [!fteOk, !finOk, !ragOk].filter(Boolean).length;
  const oks = [fteOk, finOk, ragOk].filter(Boolean).length;
  const divergencia = problemas > 0 && oks > 0;

  const aplicarEmValidacao = confianca < limiar || divergencia;
  const veredito: VeredictoAgregado = aplicarEmValidacao ? 'em_validacao' : 'aprovar';

  const motivos: string[] = [];
  if (input.fte.implausivel && input.fte.motivo) motivos.push(input.fte.motivo);
  if (!finOk && input.financeiro.motivo) motivos.push(input.financeiro.motivo);
  if (!ragOk && input.rag.motivo) motivos.push(input.rag.motivo);
  if (divergencia) {
    motivos.push('Os especialistas divergiram — vai para a triagem.');
  }
  if (motivos.length === 0) {
    motivos.push('Saving plausível, financeiro coerente e semelhante a projetos já aprovados.');
  }

  return {
    veredito,
    confianca: clamp01(confianca),
    aplicarEmValidacao,
    divergencia,
    isento: false,
    motivos,
  };
}

// ─── Chair sobre os JULGAMENTOS LLM (T2) ─────────────────────────────────────

/**
 * Concilia os pareceres RACIOCINADOS dos especialistas LLM da mesa (`agregarVotos` acima faz o
 * mesmo com os votos DETERMINÍSTICOS crus; este é o irmão que julga a saída dos agentes).
 *
 * ## O que muda em relação a `agregarVotos`
 * A confiança **deixa de ser o degrau fixo** (0.85 do RAG / `Math.min` dos votos) e passa a medir
 * **concordância real** entre os agentes: quanto do painel está do mesmo lado (dispersão) × quão
 * seguros os agentes estão (confiança média). Assim:
 *   - painel unânime e seguro → confiança alta;
 *   - painel dividido (uns preocupam, outros não) → confiança baixa + `divergencia`;
 *   - painel que CONCORDA mas está inseguro (todos tranquilos, confiança baixa) → confiança baixa,
 *     e mesmo sem divergência a mesa manda para o humano (o limiar passa a ter efeito real).
 *
 * ## Invariantes (os mesmos de `agregarVotos`)
 * - **Nunca** um veredito negativo automático: só `aprovar`, `em_validacao` ou `isento`.
 * - **Preocupação com QUÓRUM** (>= `QUORUM_PREOCUPACAO`) → `em_validacao`. Uma objeção SOLITÁRIA
 *   não barra (o cético adversarial sempre acha uma), mas fica registrada nos `motivos` e derruba a
 *   confiança pela concordância direcional. ⚠️ SUBSTITUI o invariante antigo "qualquer especialista
 *   que preocupa → em_validacao", que tornava `aprovar` inalcançável — ver `QUORUM_PREOCUPACAO`.
 * - **Especial é ISENTO**; **liderança NÃO** (mudou em 01/09/2026 — a mesa julga quem entra
 *   pelo fluxo direto como julga todo mundo). Ver o comentário do gate.
 * - MODO SOMBRA: só PRODUZ a recomendação; nada aqui muda status.
 *
 * Os `motivos` vêm do ARGUMENTO raciocinado dos especialistas que preocuparam (não do cálculo cru)
 * — é o parecer que a ficha mostra. Sem preocupação e com consenso, um resumo tranquilizador.
 */
export function agregarJulgamentos(input: {
  julgamentos: JulgamentoEspecialista[];
  especial?: boolean | null;
  fluxoDireto?: boolean | null;
  limiarConfianca?: number | null;
}): ResultadoAgregado {
  // ⚠️ LIDERANÇA NÃO ISENTA MAIS (decisão do Luis, 01/09/2026). Só o ESPECIAL isenta.
  // Antes, `fluxoDireto` (autor coordenador+) devolvia `isento` e isso silenciava **145 dos 649
  // normais (22% da base)** — "Fluxo de Caixa FIP Gobeauty", "Triagem Automática de Comunicação de
  // Fornecedores" e cia. saíam sem nenhuma recomendação, justamente a faixa que passa pelo fluxo
  // DIRETO (sem agente, sem gates) e por isso mais merece um olhar. Pior: os 4 especialistas LLM
  // JÁ rodavam nesses projetos e o resultado era DESCARTADO pelo curto-circuito.
  // ⚠️ Isto é só a MESA (sombra). A imunidade do ANALISADOR real (`normalizarClassificacao` e
  // `decidirStatusSubmissao`, em `analyzer.ts`) continua intacta — lá `fluxoDireto` mexe em STATUS
  // de produção, aqui não muda nada além da recomendação exibida. NÃO unificar as duas réguas.
  if (input.especial === true) {
    return {
      veredito: 'isento',
      confianca: 1,
      aplicarEmValidacao: false,
      divergencia: false,
      isento: true,
      motivos: [
        'Projeto especial ou de liderança — avaliação automática não se aplica (validação humana).',
      ],
    };
  }

  const limiar =
    typeof input.limiarConfianca === 'number' &&
    isFinite(input.limiarConfianca) &&
    input.limiarConfianca > 0
      ? input.limiarConfianca
      : LIMIAR_CONFIANCA_AGREGADOR;

  const julgamentos = input.julgamentos ?? [];
  const n = julgamentos.length;

  // Sem pareceres: dúvida máxima → humano decide (fail-safe; nunca aprova no vazio).
  if (n === 0) {
    return {
      veredito: 'em_validacao',
      confianca: 0,
      aplicarEmValidacao: true,
      divergencia: false,
      isento: false,
      motivos: ['Sem pareceres dos especialistas — recomendo conferência humana.'],
    };
  }

  const preocupados = julgamentos.filter((j) => j.preocupa);
  const tranquilos = julgamentos.filter((j) => !j.preocupa);
  const divergencia = preocupados.length > 0 && tranquilos.length > 0;

  // Confiança = concordância DIRECIONAL (fração do painel no lado majoritário, ∈ [0.5, 1])
  // × confiança MÉDIA dos agentes (quão seguros estão). Consenso inseguro derruba a confiança;
  // divisão derruba a direcional. Substitui o degrau 0.85.
  const concordanciaDirecional = Math.max(preocupados.length, tranquilos.length) / n;
  const confiancaMedia = julgamentos.reduce((s, j) => s + clamp01(j.confianca), 0) / n;
  const confianca = clamp01(concordanciaDirecional * confiancaMedia);

  // Barra por QUÓRUM (>= 2 preocupados), não por qualquer objeção: ver `QUORUM_PREOCUPACAO`.
  const bloqueiaPorPreocupacao = preocupados.length >= QUORUM_PREOCUPACAO;
  // Painel de um só infla a concordância direcional (=1.0 por construção) — nunca aprovar assim.
  const painelSuficiente = n >= MIN_JULGAMENTOS_PARA_APROVAR;
  const aplicarEmValidacao = bloqueiaPorPreocupacao || confianca < limiar || !painelSuficiente;
  const veredito: VeredictoAgregado = aplicarEmValidacao ? 'em_validacao' : 'aprovar';

  const motivos: string[] = [];
  // O parecer que a ficha mostra é o ARGUMENTO raciocinado de quem preocupou.
  // Cada frase vai MARCADA com o especialista que a escreveu. Sem isso os argumentos viravam um
  // parágrafo corrido e, quando dois especialistas levantavam a MESMA dúvida, o texto parecia
  // repetido/embaralhado — era o defeito relatado pelo Luis em 01/09/2026. Marcado, o leitor vê
  // duas vozes concordando, que é o que de fato aconteceu.
  for (const j of preocupados) {
    const arg = j.argumento?.trim();
    if (arg) motivos.push(`${ROTULO_CURTO_DIMENSAO[j.dimensao]}: ${arg}`);
  }
  // Só promete triagem humana quando a mesa REALMENTE está mandando para lá.
  if (divergencia && aplicarEmValidacao) {
    motivos.push('Os especialistas divergiram — vai para a triagem.');
  }
  // Objeção SOLITÁRIA (sem quórum): a mesa recomenda aprovar, mas o argumento de quem objetou já
  // foi empilhado acima e NUNCA some — a ficha mostra a ressalva ao lado da recomendação.
  if (!aplicarEmValidacao && preocupados.length > 0) {
    motivos.push(
      'Só um especialista objetou — não é o bastante para barrar, mas a ressalva fica registrada.',
    );
  }
  if (motivos.length === 0) {
    motivos.push(
      confianca < limiar
        ? 'Os especialistas concordam que não há problema, mas sem segurança suficiente — recomendo conferência humana.'
        : 'Os especialistas concordam: sem sinal de preocupação nos eixos avaliados.',
    );
  }

  return {
    veredito,
    confianca,
    aplicarEmValidacao,
    divergencia,
    isento: false,
    motivos,
  };
}
