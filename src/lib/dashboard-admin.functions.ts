/**
 * Dashboard do admin — a planilha como fonte de verdade, lida do ESPELHO.
 *
 * A tela original lia `getProjetosWithArea()` (SQLite) e por isso mostrava rascunho e
 * status interno desatualizado: o "Status" que vale é o da coluna do Sheets, mantido
 * à mão pela triagem (o sync reverso inclusive EXCLUI `status` dos campos que voltam
 * para o SQLite). A correção foi passar a listar **a planilha** — e isso continua valendo:
 * o que a tela mostra é a LINHA DA PLANILHA, nunca o estado interno de `projetos`.
 *
 * O que mudou (11/08/2026): a linha não vem mais de um `readAllRows()` no meio do request,
 * e sim do **espelho** da planilha no SQLite (`sheet-espelho.ts`), atualizado pelo cron de
 * 5 min e remendado na hora por toda escrita nossa. Com isso caiu o cache de 60 s com SWR
 * e a máquina de patches em memória, que existiam só para esconder uma leitura de ~2 s —
 * o remendo agora mora no banco (coluna `patch`), então vale para qualquer isolate.
 *
 * Consequências (as mesmas de antes, pelo mesmo motivo):
 * - **Rascunho não aparece** (nunca vai à planilha) — é o comportamento desejado.
 * - Colunas manuais (Diff Horas / Diff Saving, Observações da revisão) chegam junto: o
 *   espelho guarda a linha CRUA, inteira.
 * - Toda coluna é chaveada pelo NOME REAL do cabeçalho, então reordenar/inserir coluna
 *   na planilha não quebra a tela (mesma garantia de `google/sheets.ts`).
 * - `?refresh=1` deixou de "furar cache" e passou a **sincronizar de verdade** (lê a
 *   planilha agora e regrava o espelho) — é o botão "Atualizar" da triagem.
 */
import { z } from "zod";
import { updateRowByProjectId, type SheetRow } from "@/lib/google/sheets";
import { registrarAtividade } from "@/lib/atividades.functions";
// A discordância da ficha vira LIÇÃO pelo módulo puro das correções: o eixo, o piso e o teto do
// motivo saem de lá para a tela e o servidor cobrarem exatamente o que o prompt vai aceitar.
import {
  correcoesDoLog,
  EIXOS_CORRECAO,
  ensinaAlgo,
  MOTIVO_MAX,
  MOTIVO_MIN,
  type EixoCorrecao,
} from "@/lib/correcoes";
import {
  insertAdminStatusLog,
  getAdminStatusLogs,
  getAdminStatusLogsPorIds,
  getContrafactualAfetados,
  getContrafactualAfetadosPorIds,
  getContribuicoesDeParticipantesPorIds,
  getReenviosDoProjeto,
  getReenviosPorIds,
  getAprovacoesDoProjeto,
  getAprovacoesDeProjetos,
  type ReenvioResumo,
  getAvaliacoesNormaisPorIds,
  getAvaliacaoNormal,
  getDeliberacao,
  getDeliberacoesPorIds,
  getAvaliacaoRetroativa,
  getAvaliacoesRetroativasPorIds,
  getFeedbacksPorIds,
  getAvaliacaoFeedback,
  upsertAvaliacaoFeedback,
  deleteAvaliacaoFeedback,
  type ProjetoAvaliacaoRow,
  type DeliberacaoResumoRow,
  type AvaliacaoRetroativaRow,
  type EspecialAvaliacaoRow,
  type AvaliacaoFeedbackRow,
  type AprovacaoRow,
} from "@/integrations/db/client.server";
import {
  desserializarAfetados,
  type AfetadoTipo,
} from "@/lib/submeter/constants";
import { parecerEstagio2ParaFicha, type ParecerEstagio2 } from "@/lib/aprovacoes.functions";
// A frase do parecer que o eixo da discordância contesta — a MESMA função que a tela usa.
import { linhaDoEixo, partirParecerMesa } from "@/lib/mesa-parecer";
import {
  lerResumosEspelho,
  lerLinhaEspelho,
  lerLinhasEspelho,
  espelharEscrita,
  statusEspelho,
} from "@/lib/sheet-espelho";
import { syncSheetsToSqlite } from "@/lib/google/sync-reverse";
import {
  getUltimoConsensoDoTime,
  getUltimosConsensosDoTimePorIds,
  getAvaliacaoEspecialPorId,
  getAvaliacoesEspeciaisPorIds,
} from "@/integrations/db/client.server";
import {
  montarContribuicoesPorProjeto,
  type ContribuicaoParticipante,
} from "@/lib/participantes-contribuicoes";
import {
  texto,
  ouTraco,
  numero,
  chaveStatus,
  chaveBusca,
  mapResumo,
  ordenarPorDataDesc,
  contarPorStatus,
  type ProjetoDashboardResumo,
} from "@/lib/dashboard-resumo";

// Os mappers moram no módulo PURO `dashboard-resumo.ts` (o espelho recorta as MESMAS
// colunas, e um módulo de servidor importando esta tela criaria ciclo). Re-exportados aqui
// porque os call sites e os testes de sempre os esperam neste módulo — fonte única, sem
// nada redigitado.
export {
  texto,
  ouTraco,
  numero,
  chaveStatus,
  chaveBusca,
  mapResumo,
  ordenarPorDataDesc,
  contarPorStatus,
  COLUNAS_RESUMO,
  recortarResumo,
} from "@/lib/dashboard-resumo";
export type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * Status que a tela pode GRAVAR na planilha, na ordem em que aparecem na triagem.
 * ⚠️ Estes textos precisam existir na validação de dados (dropdown) da coluna
 * "Status" — escrever um valor fora do dropdown não falha, mas deixa a célula
 * marcada como inválida para quem abre a planilha.
 */
export const STATUS_GRAVAVEIS = [
  "Pendente",
  "Em validação",
  "Aprovado",
  "Reenvio Pendente",
  "Reprovado",
  "Descontinuado",
] as const;
export type StatusGravavel = (typeof STATUS_GRAVAVEIS)[number];

/**
 * O que a coluna "Sombra" da tabela mostra por projeto — o veredito do AGREGADOR do time de
 * avaliação (fatia B) e sua confiança. Enxuto de propósito: a tabela só destaca veredito +
 * confiança; o detalhe (deliberação, retroativo, motivos) vive na ficha. NADA aqui muda status.
 */
export type AvaliacaoSombraResumo = {
  veredito: string;
  confianca: number | null;
  divergencia: boolean;
  aplicar: boolean;
};

export type ListagemDashboard = {
  projetos: ProjetoDashboardResumo[];
  contagem: Record<string, number>; // statusChave → total ('sem_status' quando vazio)
  total: number;
  /**
   * Recomendação em SOMBRA do agregador por projeto (coluna "Sombra"), chaveada por id. Vem
   * de tabelas INTERNAS (não do espelho da planilha), por isso num mapa lateral — mesmo padrão
   * das `avaliacoes` da `/especiais`. Falha de leitura → mapa vazio (a coluna mostra "—").
   */
  avaliacoes: Record<string, AvaliacaoSombraResumo>;
  /** Voto 👍/👎 já dado pelo admin, por id (indicador na coluna; o voto acontece na ficha). */
  feedbacks: Record<string, "like" | "dislike">;
  /** ISO — quando a planilha foi lida pela última vez (a idade do ESPELHO, não do request). */
  lidoEm: string;
  /** O espelho passou de `ESPELHO_VELHO_MS` sem sincronizar → a tela avisa. */
  espelhoVelho: boolean;
  /** A última corrida do sync falhou (a anterior pode ter dado certo). */
  syncFalhou: boolean;
  /** Nunca sincronizou (banco novo / primeiro deploy) — a tela pede "Atualizar". */
  semEspelho: boolean;
};

export type DetalheDashboard = {
  id: string;
  /** Todas as células não-vazias da linha, chaveadas pelo nome real da coluna. */
  campos: Record<string, string>;
  /**
   * Contrafactual da Etapa 2 ("quem sentiria falta se a automação parasse"). Vem do
   * SQLite (`projetos.contrafactual_afetados`), NÃO da planilha — esse campo nunca virou
   * coluna do Sheets. `null` quando o autor não respondeu ou o projeto só existe na
   * planilha (legado sem linha no SQLite).
   */
  contrafactual: { tipo: AfetadoTipo; lista: string[] } | null;
  /**
   * "O que cada participante fez" (`projetos.membros_contribuicoes`). Mesma natureza do
   * contrafactual acima: mora SÓ no SQLite, nunca virou coluna do Sheets — por isso vem
   * numa leitura à parte e não sai da linha do espelho. Lista VAZIA quando o projeto é
   * anterior à feature, é legado sem linha no SQLite, ou a leitura falhou (a ficha abre
   * do mesmo jeito; a seção só não aparece).
   */
  pessoas: ContribuicaoParticipante[];
  /**
   * Parecer do ESTÁGIO 2 da pré-aprovação (líder do dono do projeto PAI) — só quando o
   * projeto é uma FEATURE de outro (projeto vinculado). Vem do SQLite (`projeto_aprovacoes`,
   * estágio 2), NÃO da planilha (o estágio 2 não tem coluna). A triagem vê os DOIS pareceres:
   * o estágio 1 (líder do autor) na seção que lê a linha da planilha, e este ao lado.
   * `null` = projeto não é feature, ou o estágio 2 ainda não abriu.
   */
  preAprovacaoPai: ParecerEstagio2 | null;
  /**
   * Linha do tempo da triagem, mais recente primeiro. Duas naturezas de evento convivem:
   * - `status`: mudança de status feita nesta tela (a planilha não guarda autoria) — de
   *   `admin_status_log`.
   * - `reenvio`: o dono/editor reenviou o projeto — de `projeto_versions` (`acao = 'reenvio'`).
   * Sem essa segunda natureza, o reenvio só dava para inferir pelo status mudando.
   */
  historico: HistoricoEntrada[];
  /**
   * A avaliação em SOMBRA do time de agentes (fatia B/C) — o que o agente recomendaria, ao
   * lado da decisão humana, para o TESTE SOMBRA. Vem de tabelas INTERNAS (não da planilha,
   * não do espelho). ⚠️ NADA disto muda o status do projeto. `null` quando o agente ainda não
   * avaliou este projeto (ou a leitura falhou — a seção só não aparece).
   */
  avaliacaoSombra: {
    /** Recomendação do agregador (fatia B). */
    mesa: {
      veredito: string;
      confianca: number | null;
      divergencia: boolean;
      aplicar: boolean;
      motivo: string | null;
    } | null;
    /**
     * O parecer dos **QUATRO** agentes, com o argumento de cada um — inclusive de quem NÃO
     * preocupou. Vem do `votos` da linha do projeto (`montarPareceresDaMesa`).
     *
     * ⚠️ É o que substitui a leitura do `motivo` para exibir o painel: o `motivo` só carrega a
     * objeção de quem preocupou NA ÚLTIMA rodada, então o painel mostrava 4 porquês numa abertura
     * e 2 na seguinte (queixa do Luis, 08/09/2026). Vazio em avaliação ANTIGA, gravada antes de o
     * argumento passar a ser persistido — aí a tela cai no `motivo` de sempre.
     */
    especialistas: {
      dimensao: string;
      preocupa: boolean;
      argumento: string;
      confianca: number | null;
    }[];
    /**
     * A **estrela sugerida** pelo classificador de 1 agente (`especial_avaliacao`).
     *
     * ⚠️ É esta que o botão da ficha roda, e é UMA chamada de LLM. O time completo (30 chamadas)
     * **não cabe num clique**: em prod, 08/09/2026, o `waitUntil` do Godeploy foi cancelado no
     * meio dele ("tasks did not complete within the allowed time"), com 2 de 4 chamadas
     * respondidas — o botão dizia "rodando" e nunca chegava estrela nenhuma.
     */
    estrela: {
      estrelas: number;
      confianca: string | null;
      leitura: string | null;
      contestada: boolean;
      quando: string | null;
    } | null;
    /**
     * O último veredito do TIME de agentes (30 chamadas, ferramenta de auditoria em LOTE).
     * `null` quando o time nunca rodou neste projeto — o normal.
     */
    time: {
      estrela: number | null;
      /**
       * O time indicou a faixa 6-10 ("muda o jogo")?
       *
       * ⚠️ **Sem este campo a tela MENTE, e mentiu** (10/09/2026). Quando o escape é indicado, a
       * régua trava a nota em `TETO_AGENTE` (5) — porque 5 é o teto do que o agente pode conceder
       * sozinho — e a informação real fica NESTE sinal. O interpretador descartava o `escape` do
       * JSON do consenso, então o «AVD Central v2» aparecia como **"5 · Assume"** quando o time
       * havia dito, com os dois gatilhos citados, que ele é da faixa 6-10 e que o número é do
       * comitê. Dono do produto, olhando a ficha: *"pq q ele fala q é escape, saida humano pois é
       * um 6-10 e tem estrelas 5?"* — a pergunta certa.
       */
      escape: boolean;
      saida: string | null;
      confianca: string | null;
      quando: string | null;
      motivos: string[];
      divergencias: string[];
    } | null;
    /** Estado da deliberação multi-turno (fatia C). */
    deliberacao: {
      estado: string;
      grau: string | null;
      rodada: number;
      motivo: string | null;
      /**
       * Histórico das rodadas (o parecer + confiança de cada uma) — a "conversa" da mesa. Só é
       * preenchido na FICHA individual (`getProjetoDashboard`), que lê a linha inteira; no lote da
       * listagem fica `[]` de propósito (o `historico` NÃO é selecionado em lote — teto de 32 MiB
       * de RPC). Vazio quando não há deliberação ou quando veio pelo lote.
       */
      historico: { rodada: number; estado: string | null; confianca: number | null; motivo: string | null }[];
    } | null;
    /** Medição retroativa contra o humano (fatia C). */
    retroativo: {
      resultado: string;
      veredito_agregado: string | null;
      veredito_humano: string | null;
      grau: string | null;
      motivo: string | null;
    } | null;
  } | null;
  /** Voto do admin sobre a recomendação em sombra (👍/👎), ou `null` se ainda não votou. */
  feedback: "like" | "dislike" | null;
};

export type HistoricoEntrada =
  | {
      tipo: "status";
      status_anterior: string | null;
      status_novo: string;
      observacoes: string | null;
      admin_email: string;
      created_at: string | null;
    }
  | {
      tipo: "reenvio";
      /** Nº da edição (1ª edição = 1). `versao_num = 1` é o submit inicial, não conta. */
      edicao: number;
      submetido_por: string | null;
      created_at: string | null;
    };

/**
 * Funde o log de status (admin) com os reenvios (dono/editor) numa linha do tempo única,
 * mais recente primeiro — a MESMA ordem `created_at DESC` que o log de status já usava, para
 * não reordenar silenciosamente a ficha dos outros projetos. Ambos os carimbos vêm do SQLite
 * no formato `YYYY-MM-DD HH:MM:SS`, então a comparação por string ordena certo; carimbo
 * ausente vai para o fim. PURA (testável sem banco).
 */
export function montarHistoricoTriagem(
  statusLogs: {
    status_anterior: string | null;
    status_novo: string;
    observacoes: string | null;
    admin_email: string;
    created_at: string | null;
  }[],
  reenvios: ReenvioResumo[],
): HistoricoEntrada[] {
  const entradas: HistoricoEntrada[] = [
    ...statusLogs.map((l): HistoricoEntrada => ({ tipo: "status", ...l })),
    ...reenvios.map(
      (r): HistoricoEntrada => ({
        tipo: "reenvio",
        edicao: Math.max(1, r.versao_num - 1),
        submetido_por: r.submetido_por,
        created_at: r.created_at,
      }),
    ),
  ];
  return entradas.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
}

// ─── Leitura do espelho ──────────────────────────────────────────────────────

/**
 * Idade a partir da qual a tela avisa que o espelho está velho. O cron roda a cada 5 min,
 * então 20 min sem sincronizar significa que **4 corridas** falharam ou pararam — é sinal
 * de problema, não de cadência. É o antídoto para o único jeito de esta arquitetura mentir:
 * o sync morrer em silêncio e a tela seguir mostrando dado velho com cara de novo.
 */
export const ESPELHO_VELHO_MS = 20 * 60 * 1000;

// ─── Superfície SOMBRA (teste sombra do time de avaliação) ───────────────────

/** Normaliza o voto cru da tabela para o par exibível (ignora valor desconhecido). */
function normalizarVoto(v: string | null | undefined): "like" | "dislike" | null {
  return v === "like" || v === "dislike" ? v : null;
}

/**
 * Recomendação do agregador + voto do admin da PÁGINA inteira, em duas consultas por `IN`.
 * ⚠️ NUNCA lança — o teste sombra é acessório e não pode derrubar a triagem. Falha → mapas
 * vazios (a coluna "Sombra" mostra "—").
 */
async function carregarSombraDaListagem(ids: string[]): Promise<{
  avaliacoes: Record<string, AvaliacaoSombraResumo>;
  feedbacks: Record<string, "like" | "dislike">;
}> {
  const avaliacoes: Record<string, AvaliacaoSombraResumo> = {};
  const feedbacks: Record<string, "like" | "dislike"> = {};
  if (ids.length === 0) return { avaliacoes, feedbacks };
  try {
    const [mesas, votos] = await Promise.all([
      getAvaliacoesNormaisPorIds(ids),
      getFeedbacksPorIds(ids),
    ]);
    for (const id of ids) {
      const chave = id.trim().toLowerCase();
      const m = mesas.get(chave);
      if (m) {
        avaliacoes[id] = {
          veredito: m.veredito,
          confianca: m.confianca,
          divergencia: m.divergencia === 1,
          aplicar: m.aplicar === 1,
        };
      }
      const voto = normalizarVoto(votos.get(chave)?.voto);
      if (voto) feedbacks[id] = voto;
    }
  } catch (e) {
    console.error("[dashboard-admin] falha ao ler avaliação em sombra da listagem:", e);
  }
  return { avaliacoes, feedbacks };
}

/**
 * Interpreta o `historico` da deliberação (JSON gravado por `upsertDeliberacao`) num array tipado
 * de rodadas. FAIL-SOFT: entrada ausente/ilegível → `[]` (a seção só não mostra as rodadas).
 * Só campos escalares conhecidos entram (nada de blob).
 */
export function parseHistoricoDeliberacao(
  raw: string | null | undefined,
): { rodada: number; estado: string | null; confianca: number | null; motivo: string | null }[] {
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      rodada: typeof e.rodada === "number" ? e.rodada : 0,
      estado: typeof e.estado === "string" ? e.estado : null,
      confianca: typeof e.confianca === "number" ? e.confianca : null,
      motivo: typeof e.motivo === "string" ? e.motivo : null,
    }));
}

/**
 * Extrai os 4 pareceres do `votos` gravado. PURA e TOLERANTE: JSON inválido, ausente ou de uma
 * gravação ANTIGA (antes de o argumento passar a ser persistido) devolve `[]`, e a tela cai no
 * `motivo` de sempre — nenhum backfill é necessário para o painel não quebrar.
 */
export function pareceresDosVotos(
  votosJson: string | null | undefined,
): NonNullable<DetalheDashboard["avaliacaoSombra"]>["especialistas"] {
  if (!votosJson) return [];
  let bruto: unknown;
  try {
    bruto = JSON.parse(votosJson);
  } catch {
    return [];
  }
  const lista = (bruto as { pareceres?: unknown })?.pareceres;
  if (!Array.isArray(lista)) return [];
  const out: NonNullable<DetalheDashboard["avaliacaoSombra"]>["especialistas"] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const dimensao = typeof p.dimensao === "string" ? p.dimensao : null;
    if (!dimensao) continue;
    out.push({
      dimensao,
      preocupa: p.preocupa === true,
      argumento: typeof p.argumento === "string" ? p.argumento : "",
      confianca: typeof p.confianca === "number" && Number.isFinite(p.confianca) ? p.confianca : null,
    });
  }
  return out;
}

/**
 * Interpreta o nó de consenso do TIME. PURA e TOLERANTE (o `saida` é JSON gravado pelo log; se ele
 * mudar de forma, a seção some em vez de a ficha cair).
 */
export function interpretarConsensoDoTime(
  no: { saida: string | null; confianca: string | null; veredito: string | null; created_at: string | null } | null | undefined,
): NonNullable<DetalheDashboard["avaliacaoSombra"]>["time"] {
  if (!no) return null;
  let c: Record<string, unknown> = {};
  try {
    const parsed = no.saida ? JSON.parse(no.saida) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) c = parsed as Record<string, unknown>;
  } catch {
    c = {};
  }
  const textos = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  return {
    estrela: typeof c.estrela === "number" && Number.isFinite(c.estrela) ? c.estrela : null,
    // ⚠️ O `escape` vem do MESMO JSON e estava sendo descartado aqui — ver o campo no tipo.
    escape: c.escape === true,
    saida: typeof c.saida === "string" ? c.saida : no.veredito,
    confianca: typeof c.confianca === "string" ? c.confianca : no.confianca,
    quando: no.created_at,
    motivos: textos(c.motivos),
    divergencias: textos(c.divergencias),
  };
}

/**
 * Monta o bloco `avaliacaoSombra` da ficha a partir das três linhas (agregador, deliberação,
 * retroativo). PURA. `null` quando nenhuma das três existe (o agente ainda não avaliou).
 *
 * ⚠️ O `historico` da deliberação só chega quando o chamador leu a linha INTEIRA (ficha individual);
 * o lote não o seleciona (32 MiB de RPC) e passa `undefined` → `[]`.
 */
export function montarAvaliacaoSombra(
  mesa: {
    veredito: string;
    confianca: number | null;
    divergencia: number;
    aplicar: number;
    motivo: string | null;
    /** JSON gravado por `serializarVotos` — é de onde saem os 4 pareceres. */
    votos?: string | null;
  } | null,
  delib: {
    estado: string;
    rodada: number;
    grau: string | null;
    motivo: string | null;
    historico?: string | null;
  } | null,
  retro: {
    resultado: string;
    veredito_agregado: string | null;
    veredito_humano: string | null;
    grau: string | null;
    motivo: string | null;
  } | null,
  /** O último consenso do TIME (nó `tipo='consenso'` do log em árvore), quando houver. */
  time?: { saida: string | null; confianca: string | null; veredito: string | null; created_at: string | null } | null,
  /** A recomendação de estrela do classificador de 1 agente (`especial_avaliacao`). */
  estrela?: {
    estrelas_recomendada: number;
    confianca: string | null;
    leitura: string | null;
    contestada: number;
    criado_em: string | null;
  } | null,
): DetalheDashboard["avaliacaoSombra"] {
  if (!mesa && !delib && !retro && !time && !estrela) return null;
  return {
    mesa: mesa
      ? {
          veredito: mesa.veredito,
          confianca: mesa.confianca,
          divergencia: mesa.divergencia === 1,
          aplicar: mesa.aplicar === 1,
          motivo: mesa.motivo,
        }
      : null,
    especialistas: pareceresDosVotos(mesa?.votos),
    // ⚠️ **A NOTA DO CLASSIFICADOR DE 1 AGENTE SAIU DA FICHA (10/09/2026).** A tela mostrava DUAS
    // notas com DUAS réguas: a do time (os seis verbos de `estrelas-regua.ts`, que é a régua que o
    // dono do produto escreveu) e a deste classificador, que consolida as 4 LENTES por eixos e
    // escreve coisas como *"faltaria mostrar essa adoção obrigatória pela área"* — critério de
    // completude de DOCUMENTAÇÃO, não do que o projeto faz. Palavras dele, olhando o «SendApp»:
    // *"Isso de faltar documentação disso e aquilo nao faz o menor sentido"* e *"Nao quero ter duas
    // abordagens ali nao pois ta confundindo no frontend"*.
    // ⚠️ Só a EXIBIÇÃO saiu: `especial_avaliacao` continua guardando as duas origens
    // (`agente-classificador` e `time-completo`), então nada de histórico se perde e o painel de
    // auditoria em lote segue podendo lê-las.
    estrela: null,
    time: interpretarConsensoDoTime(time),
    deliberacao: delib
      ? {
          estado: delib.estado,
          grau: delib.grau,
          rodada: delib.rodada,
          motivo: delib.motivo,
          historico: parseHistoricoDeliberacao(delib.historico),
        }
      : null,
    retroativo: retro
      ? {
          resultado: retro.resultado,
          veredito_agregado: retro.veredito_agregado,
          veredito_humano: retro.veredito_humano,
          grau: retro.grau,
          motivo: retro.motivo,
        }
      : null,
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Listagem da triagem — lê o ESPELHO da planilha (SQLite), nunca o Sheets em request e
 * nunca o estado interno de `projetos`.
 *
 * @param refresh `?refresh=1` — o botão "Atualizar" da tela. Não é mais "furar cache": roda
 *                um **sync de verdade** (lê a planilha, regrava o espelho) e só então lê.
 *                Falha do Sheets aqui **não** derruba a tela: o espelho anterior segue
 *                servindo e a resposta avisa por `syncFalhou`.
 */
export async function listarProjetosDashboard(refresh = false): Promise<ListagemDashboard> {
  if (refresh) {
    try {
      await syncSheetsToSqlite("manual");
    } catch (e) {
      // `syncSheetsToSqlite` já não propaga por si; este catch é o cinto do cinto.
      console.error("[dashboard-admin] sync manual falhou (servindo o espelho atual):", e);
    }
  }

  const [{ linhas, lidoEmMs }, saude] = await Promise.all([lerResumosEspelho(), statusEspelho()]);
  const projetos = linhas
    .map(mapResumo)
    .filter((p): p is ProjetoDashboardResumo => p != null)
    .sort(ordenarPorDataDesc);

  // Superfície SOMBRA: a recomendação do agregador e o voto do admin vêm de tabelas INTERNAS
  // (não do espelho), num mapa lateral chaveado por id — mesmo padrão da `/especiais`. Falha
  // aqui NÃO derruba a listagem (o teste sombra é acessório): a coluna só mostra "—".
  const { avaliacoes, feedbacks } = await carregarSombraDaListagem(projetos.map((p) => p.id));

  // A idade é do dado: preferimos o carimbo da última corrida OK e caímos no `lido_em` das
  // linhas (o espelho pode ter linhas de antes de `sync_runs` existir).
  const idadeRef = saude.ultimoSyncOkMs ?? lidoEmMs;
  return {
    projetos,
    contagem: contarPorStatus(projetos),
    total: projetos.length,
    avaliacoes,
    feedbacks,
    lidoEm: new Date(idadeRef ?? Date.now()).toISOString(),
    espelhoVelho: idadeRef != null && Date.now() - idadeRef > ESPELHO_VELHO_MS,
    syncFalhou: saude.ultimaFalhou,
    semEspelho: idadeRef == null || projetos.length === 0,
  };
}

/**
 * Detalhe de um projeto: a linha INTEIRA da planilha (todas as células preenchidas), vinda
 * do espelho — inclusive as colunas MANUAIS (Diff Horas/Saving) e a justificativa do
 * parecer do líder, que a listagem não carrega. O frontend agrupa os campos; colunas que
 * não conhecemos aparecem numa seção "Outras colunas" em vez de desaparecerem.
 */
export async function getProjetoDashboard(id: string): Promise<DetalheDashboard> {
  z.string().min(1).max(120).parse(id);

  // As três leituras são INDEPENDENTES e cada round-trip ao SQLite do Godeploy entra no tempo
  // de abrir a ficha — em série, o histórico só começava depois de a linha chegar.
  //
  // ⚠️ Os `catch` acessórios (histórico e contrafactual) ficam DENTRO do `Promise.all`, e
  // não num `try` em volta: eles não podem impedir a triagem de abrir a ficha e, no caminho
  // do 404, quem lança é a checagem da linha — uma rejeição solta viraria "unhandled
  // rejection" no worker, porque ninguém mais estaria esperando por ela.
  //
  // O contrafactual ("quem sentiria falta") mora SÓ no SQLite (`projetos.contrafactual_afetados`),
  // nunca na planilha — por isso a leitura à parte, por PK. Falha dele → seção só não aparece.
  const [alvo, historicoStatus, reenvios, contrafactual, pessoas, sombra, feedback, preAprovacaoPai] =
    await Promise.all([
    lerLinhaEspelho(id),
    getAdminStatusLogs(id)
      .then((logs) =>
        logs.map((l) => ({
          status_anterior: l.status_anterior,
          status_novo: l.status_novo,
          observacoes: l.observacoes,
          admin_email: l.admin_email,
          created_at: l.created_at,
        })),
      )
      .catch((e) => {
        console.error("[dashboard-admin] falha ao ler histórico de status:", e);
        return [];
      }),
    // Reenvios (edições) do dono/editor — acessório: falha aqui só omite as linhas de reenvio,
    // a ficha ainda abre com o log de status.
    getReenviosDoProjeto(id).catch((e): ReenvioResumo[] => {
      console.error("[dashboard-admin] falha ao ler reenvios:", e);
      return [];
    }),
    getContrafactualAfetados(id)
      .then((row): DetalheDashboard["contrafactual"] => {
        const { tipo, lista } = desserializarAfetados(row?.contrafactual_afetados);
        return lista.length > 0 ? { tipo, lista } : null;
      })
      .catch((e): DetalheDashboard["contrafactual"] => {
        console.error("[dashboard-admin] falha ao ler contrafactual:", e);
        return null;
      }),
    // "O que cada participante fez": mesma natureza do contrafactual (só SQLite), então
    // mesma disciplina — leitura à parte, acessória, e falha aqui só omite a seção.
    getContribuicoesDeParticipantesPorIds([id])
      .then((mapa): ContribuicaoParticipante[] => {
        const linha = mapa.get(id.trim().toLowerCase());
        return linha ? (montarContribuicoesPorProjeto([linha])[linha.id] ?? []) : [];
      })
      .catch((e): ContribuicaoParticipante[] => {
        console.error("[dashboard-admin] falha ao ler o que cada participante fez:", e);
        return [];
      }),
    // Avaliação em SOMBRA (teste sombra) — tabelas INTERNAS, acessório: falha só omite a seção.
    Promise.all([
      getAvaliacaoNormal(id),
      getDeliberacao(id),
      getAvaliacaoRetroativa(id),
      // A estrela do time vive no log em árvore, não na mesa. Falha aqui só omite a seção.
      // ⚠️ `Promise.resolve().then(...)` converte um throw SÍNCRONO em rejeição — o `.catch` solto
      // não pegaria (é o padrão do repo, do gatilho da notificação de pré-aprovação).
      Promise.resolve()
        .then(() => getUltimoConsensoDoTime(id))
        .catch(() => null),
      Promise.resolve()
        .then(() => getAvaliacaoEspecialPorId(id))
        .catch(() => null),
    ])
      .then(([mesa, delib, retro, time, estrela]) =>
        montarAvaliacaoSombra(mesa, delib, retro, time, estrela),
      )
      .catch((e): DetalheDashboard["avaliacaoSombra"] => {
        console.error("[dashboard-admin] falha ao ler avaliação em sombra:", e);
        return null;
      }),
    getAvaliacaoFeedback(id)
      .then((row): DetalheDashboard["feedback"] => normalizarVoto(row?.voto))
      .catch((e): DetalheDashboard["feedback"] => {
        console.error("[dashboard-admin] falha ao ler feedback da sombra:", e);
        return null;
      }),
    // Parecer do estágio 2 (líder do dono do pai) — só SQLite; acessório, falha → null.
    getAprovacoesDoProjeto(id)
      .then((linhas) => parecerEstagio2ParaFicha(linhas))
      .catch((e) => {
        console.error("[dashboard-admin] falha ao ler pré-aprovação do pai:", e);
        return null;
      }),
  ]);

  if (!alvo) {
    throw Object.assign(new Error("Projeto não encontrado na planilha."), { status: 404 });
  }
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(alvo)) {
    const val = texto(v as string | undefined);
    if (val) campos[k] = val;
  }

  return {
    id,
    campos,
    historico: montarHistoricoTriagem(historicoStatus, reenvios),
    contrafactual,
    pessoas,
    avaliacaoSombra: sombra,
    feedback,
    preAprovacaoPai,
  };
}

/**
 * Teto de fichas por lote. Uma ficha pesa **5,5 KB em média** (medido em prod, 17/08/2026,
 * 641 linhas; p90 = 9,4 KB), então 25 ≈ 137 KB — o tamanho de uma página da tabela, que é
 * exatamente o alvo. Com `porPagina = 100` o lote para nos 30 primeiros e o resto continua
 * caindo no prefetch por hover: melhor semear a maior parte do que baixar meio megabyte.
 */
export const LOTE_MAX_FICHAS = 30;

/**
 * As fichas de VÁRIOS projetos numa requisição só — o que faz abrir uma linha da tabela não
 * custar requisição nenhuma.
 *
 * Por que em lote: neste ambiente **cada requisição carrega ~750 ms de overhead fixo do
 * edge** (ver o bullet de performance de navegação no `CLAUDE.md`), e abrir 25 fichas de uma
 * página eram 25 requisições — o prefetch por hover só escondia isso para quem passa o mouse
 * e espera 150 ms. Uma requisição de ~137 KB paga as 25.
 *
 * ⚠️ Só o ESPELHO (SQLite), nunca o Sheets: são 2 consultas por `IN` (linhas + histórico),
 * não uma por projeto. Round-trip por item dentro de um laço é o erro que já derrubou o
 * Investigador.
 */
export async function getProjetosDashboardLote(
  raw: unknown,
): Promise<Record<string, DetalheDashboard>> {
  const { ids } = z.object({ ids: z.array(z.string().min(1).max(120)).max(200) }).parse(raw);
  const alvos = [...new Set(ids.map((i) => i.trim()).filter(Boolean))].slice(0, LOTE_MAX_FICHAS);
  if (alvos.length === 0) return {};

  const [
    linhas,
    historicos,
    reenvios,
    contrafactuais,
    contribuicoes,
    mesas,
    delibs,
    retros,
    consensosTime,
    estrelasAgente,
    votos,
    aprovacoesPai,
  ] = await Promise.all([
    lerLinhasEspelho(alvos),
    // Histórico é acessório: sem ele a ficha ainda abre. Uma falha aqui não pode custar o
    // lote inteiro e devolver a tela ao caminho de 25 requisições.
    getAdminStatusLogsPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler histórico em lote:", e);
      return new Map<string, Awaited<ReturnType<typeof getAdminStatusLogs>>>();
    }),
    // Reenvios em lote (mesma consulta por `IN`, sem os blobs de snapshot). Falha aqui → as
    // fichas do lote só ficam sem as linhas de reenvio.
    getReenviosPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler reenvios em lote:", e);
      return new Map<string, ReenvioResumo[]>();
    }),
    // Contrafactual ("quem sentiria falta") mora só no SQLite, então entra numa consulta por
    // `IN` à parte (nunca uma por projeto). Falha aqui → seção só não aparece nas fichas do lote.
    getContrafactualAfetadosPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler contrafactual em lote:", e);
      return new Map<string, string | null>();
    }),
    // "O que cada participante fez" — também só SQLite, também uma consulta por `IN`.
    getContribuicoesDeParticipantesPorIds(alvos)
      .then((mapa) => montarContribuicoesPorProjeto([...mapa.values()]))
      .catch((e) => {
        console.error("[dashboard-admin] falha ao ler contribuições em lote:", e);
        return {} as Record<string, ContribuicaoParticipante[]>;
      }),
    // Avaliação em SOMBRA em lote — 3 consultas por `IN` (agregador, deliberação, retroativo)
    // + os votos. Cada uma acessória: falha só omite a seção sombra das fichas do lote.
    getAvaliacoesNormaisPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler avaliação (sombra) em lote:", e);
      return new Map<string, ProjetoAvaliacaoRow>();
    }),
    getDeliberacoesPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler deliberação (sombra) em lote:", e);
      return new Map<string, DeliberacaoResumoRow>();
    }),
    getAvaliacoesRetroativasPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler retroativo (sombra) em lote:", e);
      return new Map<string, AvaliacaoRetroativaRow>();
    }),
    // O último consenso do TIME (a estrela) — uma consulta por `IN`, com a linha mais recente de
    // cada projeto escolhida no próprio SQL. Acessório: falha → nenhuma ficha mostra a estrela.
    Promise.resolve()
      .then(() => getUltimosConsensosDoTimePorIds(alvos))
      .catch((e) => {
        console.error("[dashboard-admin] falha ao ler consenso do time em lote:", e);
        return new Map<string, { saida: string | null; confianca: string | null; veredito: string | null; created_at: string | null }>();
      }),
    // A estrela sugerida (classificador de 1 agente) — uma consulta por `IN`. Acessório.
    Promise.resolve()
      .then(() => getAvaliacoesEspeciaisPorIds(alvos))
      .catch((e) => {
        console.error("[dashboard-admin] falha ao ler estrela sugerida em lote:", e);
        return new Map<string, EspecialAvaliacaoRow>();
      }),
    getFeedbacksPorIds(alvos).catch((e) => {
      console.error("[dashboard-admin] falha ao ler feedback (sombra) em lote:", e);
      return new Map<string, AvaliacaoFeedbackRow>();
    }),
    // Pré-aprovação do estágio 2 (líder do dono do pai) em lote — uma consulta por `IN`,
    // agrupada por projeto_id. Acessório: falha → nenhuma ficha mostra o parecer do pai.
    getAprovacoesDeProjetos(alvos)
      .then((rows) => {
        const porId = new Map<string, typeof rows>();
        for (const r of rows) {
          const k = r.projeto_id.trim().toLowerCase();
          const lista = porId.get(k) ?? [];
          lista.push(r);
          porId.set(k, lista);
        }
        return porId;
      })
      .catch((e) => {
        console.error("[dashboard-admin] falha ao ler pré-aprovação do pai em lote:", e);
        return new Map<string, AprovacaoRow[]>();
      }),
  ]);

  const out: Record<string, DetalheDashboard> = {};
  for (const id of alvos) {
    const chave = id.trim().toLowerCase();
    const linha = linhas.get(chave);
    // Projeto que não está no espelho fica FORA do lote (em vez de entrar como ficha
    // vazia): a abertura cai no caminho normal e mostra o 404 de verdade.
    if (!linha) continue;
    const campos: Record<string, string> = {};
    for (const [k, v] of Object.entries(linha)) {
      const val = texto(v as string | undefined);
      if (val) campos[k] = val;
    }
    const afet = desserializarAfetados(contrafactuais.get(chave));
    out[id] = {
      id,
      campos,
      historico: montarHistoricoTriagem(historicos.get(chave) ?? [], reenvios.get(chave) ?? []),
      contrafactual: afet.lista.length > 0 ? afet : null,
      // O mapper chaveia pelo id COMO ESTÁ no banco; o lote trabalha em minúsculas, então
      // tenta os dois antes de desistir (id de legado vem em caixa alta na planilha).
      pessoas: contribuicoes[id] ?? contribuicoes[chave] ?? [],
      avaliacaoSombra: montarAvaliacaoSombra(
        mesas.get(chave) ?? null,
        delibs.get(chave) ?? null,
        retros.get(chave) ?? null,
        // ⚠️ Precisa vir no LOTE: sem isto a estrela do time apareceria só nas fichas abertas fora
        // do lote (o clique numa linha semeada mostraria "o time não rodou" mentindo).
        consensosTime.get(chave) ?? null,
        estrelasAgente.get(chave) ?? null,
      ),
      feedback: normalizarVoto(votos.get(chave)?.voto),
      preAprovacaoPai: parecerEstagio2ParaFicha(aprovacoesPai.get(chave) ?? []),
    };
  }
  return out;
}

/**
 * Sanidade da célula "Estrelas" — NÃO é a escala da nota (a escala é aberta, ver o schema).
 * Existe só para um clique repetido/`+` desgovernado não gravar um número absurdo numa
 * coluna que gente usa para somar e ordenar na planilha.
 */
export const MAX_ESTRELAS_GRAVAVEL = 100;

const statusSchema = z.object({
  projeto_id: z.string().min(1).max(120),
  status: z.enum(STATUS_GRAVAVEIS),
  // Motivo da revisão: vai para a coluna "Observações", que é o texto que o disparo de
  // e-mails de reenvio manda para o dono. `undefined` = não mexer na célula.
  observacoes: z.string().max(4000).optional(),
  // Motivos em COLUNA PRÓPRIA (não sequestram "Observações", que é o parecer usado pelo
  // disparo de e-mails): `motivo_reenvio` acompanha "Reenvio Pendente" e `motivo_reprovado`
  // acompanha "Reprovado", sobrepondo o motivo escrito pelo analisador.
  // `undefined` = não mexer na célula.
  motivo_reenvio: z.string().max(4000).optional(),
  motivo_reprovado: z.string().max(4000).optional(),
  // Nota da triagem (coluna manual "Estrelas"). `undefined` = não mexer na célula — é o
  // que impede um "salvar status" de zerar a nota de outra pessoa.
  // ⚠️ **Sem teto de 5** (pedido do Luis, 17/08/2026): a triagem dá N estrelas, e o teto
  // antigo tratava as notas altas que JÁ existem na planilha (7, 8, 10) como legado a
  // "substituir". O `MAX_ESTRELAS_GRAVAVEL` é só sanidade de célula (nota não é contador),
  // não escala: quem define a escala é quem tria.
  estrelas: z.number().int().min(0).max(MAX_ESTRELAS_GRAVAVEL).optional(),
});

/** Colunas que este módulo escreve — o teste garante que a lista não cresce por descuido. */
export const COLUNAS_ESCRITAS = [
  "Status",
  "Observações",
  // Motivos da triagem humana. "Motivo Reenvio" é escrita SÓ aqui (o sistema nunca a
  // toca); "Motivo Reprovado" também é escrita pelo analisador e a triagem sobrepõe.
  "Motivo Reenvio",
  "Motivo Reprovado",
  // Nota de 0 a 5 da triagem. Coluna MANUAL da planilha: esta tela é o único lugar do
  // sistema que a escreve (ver `SHEET_COLUMNS`).
  "Estrelas",
] as const;

/**
 * Grava o status na planilha (a fonte de verdade da triagem) e registra quem mudou.
 *
 * ⚠️ NÃO escreve "Atualizado Em": aquela coluna é o carimbo da última escrita do
 * SISTEMA e é o que decide se um legado está regularizado (`pendente` em Meus
 * Projetos). Preenchê-la aqui marcaria como regularizado um legado que ninguém editou.
 *
 * ⚠️ Não mexe no `status` do SQLite: o sync reverso exclui `status` de propósito
 * (planilha manda) e o status interno pertence ao fluxo de submissão/análise. A
 * exceção conhecida é "Descontinuado", que o sync reverso reconhece e reflete na flag
 * `descontinuado` do projeto.
 */
export async function definirStatusProjeto(raw: unknown, adminEmail: string) {
  const { projeto_id, status, observacoes, motivo_reenvio, motivo_reprovado, estrelas } =
    statusSchema.parse(raw);

  const linha = await lerLinhaEspelho(projeto_id);
  if (!linha) {
    throw Object.assign(new Error("Projeto não encontrado na planilha."), { status: 404 });
  }

  const statusAnterior = texto(linha["Status"]);
  const updates: Partial<Record<(typeof COLUNAS_ESCRITAS)[number], string>> = { Status: status };
  if (observacoes !== undefined) updates["Observações"] = ouTraco(observacoes);
  if (motivo_reenvio !== undefined) updates["Motivo Reenvio"] = ouTraco(motivo_reenvio);
  if (motivo_reprovado !== undefined) updates["Motivo Reprovado"] = ouTraco(motivo_reprovado);
  // ⚠️ NÃO passa por `ouTraco`: a coluna é NUMÉRICA e "sem estrela" é **0**, o valor que 426
  // das 639 linhas de prod já têm. Gravar "—" aqui transformaria a coluna em texto e
  // quebraria a soma/ordenação de quem usa a planilha.
  if (estrelas !== undefined) updates["Estrelas"] = String(estrelas);

  await updateRowByProjectId(projeto_id, updates);

  // Remenda o espelho com o que acabou de ser gravado: a tela reflete a mudança na hora,
  // sem esperar o cron. ⚠️ O remendo fica marcado com `escrito_em`, então um sync que
  // COMEÇOU antes desta escrita (e portanto leu a célula antiga) não a desfaz — era o
  // "status voltava atrás" que os patches em memória resolviam só dentro de um isolate.
  await espelharEscrita(projeto_id, updates);

  try {
    await insertAdminStatusLog({
      projeto_id,
      projeto_nome: texto(linha["Projeto"]),
      status_anterior: statusAnterior,
      status_novo: status,
      // A auditoria guarda o texto que justificou a mudança: o parecer, se houver, ou
      // o motivo digitado no modal (reprovação/reenvio) — para o log não ficar mudo
      // quando o admin usa só a coluna de motivo.
      observacoes:
        observacoes?.trim() || motivo_reprovado?.trim() || motivo_reenvio?.trim() || null,
      admin_email: adminEmail,
    });
  } catch (e) {
    // Auditoria é registro paralelo — não pode desfazer uma escrita que já aconteceu.
    console.error("[dashboard-admin] falha ao registrar auditoria de status:", e);
  }

  // Espelha no feed unificado do painel (drawer "Histórico"). registrarAtividade não lança.
  await registrarAtividade({
    ator_email: adminEmail,
    acao: "status",
    projeto_id,
    projeto_nome: texto(linha["Projeto"]),
    detalhe: status,
    meta: {
      status_anterior: statusAnterior,
      status_novo: status,
      motivo: observacoes?.trim() || motivo_reprovado?.trim() || motivo_reenvio?.trim() || null,
    },
  });

  return { ok: true, projeto_id, status, statusAnterior };
}

// ─── Feedback do admin sobre a recomendação em SOMBRA (teste sombra) ──────────

const feedbackSchema = z.object({
  projetoId: z.string().min(1).max(120),
  // `null` = limpar o voto (o admin clicou de novo no botão que já estava marcado).
  // ⚠️ `"like"` continua no schema mesmo tendo SAÍDO da tela: uma aba com JS em cache
  // (version skew, que este repo já viu) postaria o voto antigo, e um 400 ali seria erro sem
  // saída para quem só clicou num botão que existia até o deploy. Ele grava o estado e não
  // ensina nada — que é exatamente o que ele já fazia.
  voto: z.enum(["like", "dislike"]).nullable(),
  /** Nome do projeto, só para o feed de auditoria ficar legível (o id sempre basta). */
  projetoNome: z.string().max(300).nullish(),
  /** Qual lente do agente errou. Fora da lista → recusado pelo enum. */
  eixo: z.enum(EIXOS_CORRECAO as unknown as [EixoCorrecao, ...EixoCorrecao[]]).nullish(),
  /**
   * A razão escrita por quem discordou — o que transforma gabarito em critério.
   *
   * ⚠️ O piso é o MESMO `MOTIVO_MIN` que `ensinaAlgo` cobra, e é cobrado AQUI também: aceitar
   * um motivo de 3 caracteres gravaria uma linha que o prompt descarta em silêncio, e a pessoa
   * sairia da tela achando que ensinou algo.
   */
  motivo: z.string().trim().max(MOTIVO_MAX).nullish(),
  /**
   * O desfecho que a triagem diz ser o certo (discordância do VEREDITO).
   *
   * ⚠️ Esta rota NÃO aceita "nota certa", e é deliberado: a ficha do `/dashboard` não exibe nota
   * do agente (a única nota ali é a coluna MANUAL "Estrelas"), então não haveria com o que
   * comparar — e `ensinaAlgo` reprovaria a lição por não ter referência que mudou. Quem corrige
   * NOTA faz isso pelo canal da estrela (`definirEstrelasEspecial`), que já grava motivo e
   * leitura do agente. O parser (`correcoesDoLog`) entende `nota_certa` para quando aquele canal
   * passar a declarar o eixo.
   */
  vereditoCerto: z.string().trim().max(80).nullish(),
});

/**
 * Registra o voto 👍/👎 do admin sobre a recomendação em SOMBRA — SINAL DE TREINAMENTO.
 * ⚠️ NÃO muda o status do projeto (segue humano): só grava/apaga a linha em `avaliacao_feedback`.
 * Guarda junto o veredito do agente a que o voto se refere (contexto para análise depois).
 */
export async function registrarFeedbackSombra(raw: unknown, adminEmail: string) {
  const dados = feedbackSchema.parse(raw);
  const { projetoId, voto } = dados;
  const motivo = dados.motivo?.trim() || null;

  // ⚠️ Motivo CURTO é recusado; motivo AUSENTE não. São coisas diferentes: um texto de 3
  // caracteres é lixo que o prompt descartaria calado (`ensinaAlgo`), enquanto a ausência é o
  // 👎 simples de sempre — que segue valendo como estado do botão e não vira lição.
  if (motivo && motivo.length < MOTIVO_MIN) {
    throw new Error(
      `O porquê precisa de pelo menos ${MOTIVO_MIN} caracteres. É ele que transforma a discordância em lição para o agente: sem a razão, o que o agente aprende é "concorde com o humano".`,
    );
  }

  if (voto === null) {
    await deleteAvaliacaoFeedback(projetoId);
    return { ok: true as const, voto: null };
  }

  // O veredito a que o voto se refere — best-effort (o agente pode não ter avaliado ainda).
  let veredito: string | null = null;
  let parecerCompleto: string | null = null;
  try {
    const avaliacao = await getAvaliacaoNormal(projetoId);
    veredito = avaliacao?.veredito ?? null;
    parecerCompleto = avaliacao?.motivo ?? null;
  } catch (e) {
    console.error("[dashboard-admin] falha ao ler veredito da sombra para o feedback:", e);
  }

  // ⚠️ A `leitura_do_agente` da lição é a frase do especialista DO EIXO escolhido, não o parecer
  // inteiro: o `recortar` de 220 chars do `descreverCorrecao` cortaria justamente as primeiras
  // linhas, quase nunca a que a pessoa respondeu — e aí o par argumento/réplica fica trocado.
  // Sem linha daquele eixo (parecer legado num parágrafo só, ou eixo "outro"), cai no parecer
  // completo: metade do par é melhor que a metade errada.
  const linhaCitada = linhaDoEixo(partirParecerMesa(parecerCompleto), dados.eixo ?? null);
  const parecerDoAgente = linhaCitada?.texto ?? parecerCompleto;

  await upsertAvaliacaoFeedback({
    projeto_id: projetoId,
    voto,
    veredito_referente: veredito,
    admin_email: adminEmail,
  });

  // A DISCORDÂNCIA COM MOTIVO é o que vira lição, e ela mora no `admin_activity_log` —
  // append-only, com `meta_json` livre, o mesmo caminho que a correção de estrela já usa.
  // ⚠️ `avaliacao_feedback` NÃO serve para isso: é upsert de 1 linha por projeto (guarda o
  // estado do botão, perde o histórico) e não tem coluna para eixo/motivo/parecer.
  // ⚠️ `registrarAtividade` nunca lança: auditoria não desfaz o clique que já aconteceu.
  if (voto !== "dislike" || !motivo) return { ok: true as const, voto, virouLicao: false };

  const meta = {
    eixo: dados.eixo ?? null,
    motivo,
    leitura_do_agente: parecerDoAgente,
    veredito_do_agente: veredito,
    veredito_certo: dados.vereditoCerto ?? null,
  };

  // ⚠️ O retorno importa AQUI e só aqui: `registrarAtividade` engole a falha (D3), e afirmar
  // "virou lição" sobre uma escrita engolida é prometer o que não existe.
  const gravou = await registrarAtividade({
    ator_email: adminEmail,
    acao: "avaliacao_discordancia",
    projeto_id: projetoId,
    projeto_nome: dados.projetoNome ?? null,
    detalhe: dados.vereditoCerto
      ? `discordou do veredito: deveria ser ${dados.vereditoCerto}`
      : "discordou da recomendação do time de avaliação",
    meta,
  });

  // ⚠️ Pergunta ao LEITOR REAL se aquilo virou lição, em vez de afirmar que virou. `correcoesDoLog`
  // + `ensinaAlgo` são os mesmos que o prompt usa, então o que a tela promete e o que o agente vai
  // ler não podem divergir — e havia dois jeitos concretos de divergirem em silêncio: a mesa ainda
  // não ter avaliado o projeto (sem `veredito_do_agente` não há "de → para" a ensinar) e a pessoa
  // escolher o MESMO desfecho que o agente deu.
  const [correcao] = correcoesDoLog([
    {
      acao: "avaliacao_discordancia",
      projeto_id: projetoId,
      projeto_nome: dados.projetoNome ?? null,
      meta_json: JSON.stringify(meta),
      created_at: null,
    },
  ]);
  const virouLicao = gravou && !!correcao && ensinaAlgo(correcao);

  return {
    ok: true as const,
    voto,
    virouLicao,
    // O motivo de NÃO ter virado lição, para a tela dizer a verdade em vez de prometer.
    porque: virouLicao
      ? null
      : !gravou
        ? "o registro da discordância não pôde ser gravado agora, então ela não vai chegar ao agente"
        : // ⚠️ Este ramo vem ANTES dos outros dois: sem desfecho declarado não há "de → para", e
          // reaproveitar o texto do empate afirmaria que a pessoa apontou algo que ela não apontou.
          // O formulário nunca manda esse payload (ele exige o desfecho), mas a resposta não pode
          // mentir para um cliente fora da tela.
          !dados.vereditoCerto
          ? "a discordância não disse qual era o desfecho certo, e é isso que o agente precisa para aprender"
          : veredito
            ? "o desfecho que você apontou é o mesmo que o agente deu, então não há correção de raciocínio a ensinar"
            : "o time de avaliação ainda não avaliou este projeto, então não há recomendação a corrigir",
  };
}
