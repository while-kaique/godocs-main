// Funções de negócio do chat — sem dependência de TanStack Start.
// Chamadas diretamente pelo worker (src/worker.ts).
// Fluxo: doc → doc_preview → saving → saving_preview → completo

const log = (fn: string, ...args: unknown[]) => console.log(`[chat.functions/${fn}]`, ...args);
const err = (fn: string, ...args: unknown[]) => console.error(`[chat.functions/${fn}]`, ...args);

import { z } from "zod";
import {
  insertProjeto,
  insertChatMessage,
  getChatMessages,
  getChatMessagesExcludeRole,
  recordFormEvent,
  hasFormEventTipo,
  getProjetoContextoData,
  getDocumentacaoConteudo,
  getDocMessage,
  upsertDocumentacao,
  getDocumentacao,
  getProjetoById,
  getProjetosSubmetidos,
  getProjetosNaoRascunho,
  findDuplicateProjeto,
  updateProjeto,
  deleteChatMessagesByProjeto,
  deleteChatMessagesAfterFaseMarker,
  insertValidacao,
  updateValidacaoEmailEnviado,
  insertAnalise,
  gravarVersaoProjeto,
  getAprovacoesDoProjeto,
  vincularFilhoAoPai,
  parseJson,
} from "@/integrations/db/client.server";
import { runBackground } from "@/lib/background";
import { invalidarLinhasDoDono } from "@/lib/meus-projetos-cache";
import {
  runOrchestrator,
  aplicaConfirmacaoBaseHoras,
  aplicaGateAlocacaoGanhos,
  respostaAlocacaoVaga,
  TAXONOMIA_DESTINO_GANHO,
  secaoProcessoVaga,
  secaoPonteiroVaga,
  PISTA_ONDE_VERIFICAR,
  resolverSplitCargaEscala,
  totalEconomiaHoras,
  unidadeHorasDe,
  receitaMemorialEhSaving,
} from "@/lib/agents/orchestrator";
import {
  aplicaGateSobreposicao,
  detectarSobreposicaoReceita,
  deveBloquearPorSobreposicao,
  interpretarSobreposicao,
  perguntaSobreposicao,
  perguntaSobreposicaoFirme,
  OPCOES_SOBREPOSICAO,
  NUDGE_SOBREPOSICAO_CONFIRMADO,
  NUDGE_SOBREPOSICAO_AJUSTAR,
  NUDGE_SOBREPOSICAO_SEM_RESPOSTA,
} from "@/lib/agents/sobreposicao-receita";
import {
  bloqueioSavingSemGanho,
  bloqueioReceitaZerada,
  bloqueioReceitaIncompleta,
  bloqueioDocAusente,
  bloqueioDuplicata,
  bloqueioSubmissaoPausada,
  erroDeBloqueio,
} from "@/lib/mensagens-submissao";
import { deveRecusarSubmissao } from "@/lib/bloqueio-submissao";
import {
  aplicaGateCustoEvitadoChat,
  detectarCustoEvitadoNoChat,
  deveBloquearPorCustoEvitadoChat,
  interpretarCustoEvitadoChat,
  perguntaCustoEvitadoChat,
  perguntaCustoEvitadoChatFirme,
  mensagemCustoEvitadoPago,
  nudgeCustoEvitadoPago,
  OPCOES_CUSTO_EVITADO_CHAT,
  NUDGE_CUSTO_EVITADO_ESTIMADO,
  NUDGE_CUSTO_EVITADO_SEM_RESPOSTA,
  type EstadoCustoEvitadoChat,
} from "@/lib/agents/custo-evitado-chat";
import {
  aplicaGateGanhoProjetado,
  detectarGanhoProjetado,
  deveBloquearPorProjecao,
  interpretarGanhoReal,
  mensagemGanhoProjetado,
  mensagemGanhoProjetadoRepetida,
  devePreemptarPorProjecao,
  nudgeGanhoRealConfirmado,
  perguntaGanhoReal,
  perguntaGanhoRealFirme,
  textosParaDeteccaoReceita,
  textosParaDeteccaoSaving,
  OPCOES_GANHO_REAL,
  NUDGE_GANHO_REAL_SEM_RESPOSTA,
  type EstadoGanhoReal,
} from "@/lib/agents/ganho-projetado";
import { compilarDocumentacao } from "@/lib/agents/doc-compiler";
import { validarDocumentacao } from "@/lib/agents/validator";
import {
  analisarProjeto as analisarProjetoAgent,
  decidirStatusSubmissao,
} from "@/lib/agents/analyzer";
import { enviarEmailAprovacao, enviarEmailRejeicao } from "@/lib/agents/email-agent";
import { extractTextFromMultipleFiles } from "@/lib/extract-text.server";
import { extrairCamposDocumentacao } from "@/lib/agents/extractor";
import { stripMarkdown } from "@/lib/strip-markdown";
import { deriveAreaFromEmail, ehLideranca } from "@/lib/areas/teamguide.server";
import { memorialDiretoReceita, memorialDiretoSaving } from "@/lib/submeter-direto";
import {
  abrirPreAprovacao,
  abrirPreAprovacaoProjetoPai,
  dispensarPreAprovacao,
  justificativaAprovacaoSheet,
  rotuloAprovacaoSheet,
} from "@/lib/aprovacoes.functions";
import { notificarLideresDoProjeto } from "@/lib/gomoon-lideres.functions";
import { decidirMomentoNotificacao } from "@/lib/notificacao-chat";
import { isAdmin } from "@/lib/auth.functions";
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  DocumentacaoGerada,
  OrchestratorResult,
  ProjetoContexto,
  ReceitaColetada,
  RevisaoContexto,
  SavingColetado,
  SavingLinha,
} from "@/lib/agents/types";
import { documentacaoVazia, receitaVazia, savingVazio, CARGOS } from "@/lib/agents/types";
import {
  recomputarSavingFinanceiro,
  enriquecerMemorial,
  custoEvitadoMensalFromItens,
  custoProjetoMensalFromItens,
} from "@/lib/agents/saving-calc";
import {
  normalizarMarcadoresMemorial,
  extrairAlocacaoGanhos,
  extrairJustificativaCargaEscala,
  extrairProcessoAlterado,
  extrairPonteiroMovido,
} from "@/lib/agents/memorial-format";
import {
  syncSubmitToGoogle,
  syncUpdateToGoogle,
  nowFortaleza,
  derivarClassificacaoSheet,
} from "@/lib/google/sync";
import { readAllRows, updateRowByProjectId } from "@/lib/google/sheets";
import { upsertResumoDoc } from "@/lib/google/drive";
import { renderResumoDocumentacao } from "@/lib/agents/doc-render";
import { lerLinhaEspelho, espelharEscrita } from "@/lib/sheet-espelho";
import {
  prefixarNomeFeature,
  serializarIdsFeatureSheet,
} from "@/lib/projeto-vinculo";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Registra um evento determinístico do formulário (valores marcados, "voltar
// etapa") para o timeline do Investigador. NÃO-bloqueante: é observabilidade e
// nunca deve quebrar a submissão — erros são apenas logados.
async function gravarEvento(projetoId: string, tipo: string, fase: string | null, dados?: unknown) {
  try {
    await recordFormEvent({ projeto_id: projetoId, tipo, fase, dados });
  } catch (e) {
    err("gravarEvento", `Falha ao gravar evento '${tipo}' (não bloqueante):`, e);
  }
}

// Nomes amigáveis dos campos de documentação (7 campos)
const DOC_FIELD_LABELS: Record<string, string> = {
  nome_projeto: "nome do projeto",
  o_que_faz: "o que faz",
  execucao: "execução",
  dependencias: "dependências",
  fluxo: "fluxo",
  configurar_antes: "configurar antes",
  atencao: "atenção/riscos",
};

// Nomes amigáveis dos campos de saving
const SAVING_FIELD_LABELS: Record<string, string> = {
  linhas: "pessoas/cargos",
  economia_horas_mes: "economia de horas",
  tipo_saving: "tipo de saving",
  memorial_calculo: "memorial de cálculo",
};

// Nomes amigáveis dos campos de receita
const RECEITA_FIELD_LABELS: Record<string, string> = {
  tipo_saving: "tipo de ganho",
  valor_ganho_mensal: "valor de receita",
  memorial_calculo: "memorial de cálculo",
};

function progressoDocumentacao(coletado: DocumentacaoColetada): string {
  const campos = Object.entries(coletado);
  const total = campos.length; // 7
  const preenchidos = campos.filter(([, v]) => v !== null).length;
  const faltando = campos.filter(([, v]) => v === null).map(([k]) => DOC_FIELD_LABELS[k] ?? k);
  if (faltando.length === 0) return `documentação ${preenchidos}/${total} ✓ completa`;
  return `documentação ${preenchidos}/${total} (falta: ${faltando.join(", ")})`;
}

function progressoSaving(saving: SavingColetado): string {
  const checks: [string, boolean][] = [
    ["pessoas/cargos", saving.linhas != null && saving.linhas.length > 0],
    ["economia de horas", saving.economia_horas_mes != null],
    ["tipo de saving", saving.tipo_saving != null],
    ["memorial de cálculo", saving.memorial_calculo != null],
  ];
  const total = checks.length;
  const preenchidos = checks.filter(([, ok]) => ok).length;
  const faltando = checks.filter(([, ok]) => !ok).map(([nome]) => nome);
  if (faltando.length === 0) return `memorial saving ${preenchidos}/${total} ✓ completo`;
  return `memorial saving ${preenchidos}/${total} (falta: ${faltando.join(", ")})`;
}

function progressoReceita(receita: ReceitaColetada): string {
  const checks: [string, boolean][] = [
    ["tipo de ganho", receita.tipo_saving != null],
    ["valor de receita", receita.valor_ganho_mensal != null],
    ["memorial de cálculo", receita.memorial_calculo != null],
  ];
  const total = checks.length;
  const preenchidos = checks.filter(([, ok]) => ok).length;
  const faltando = checks.filter(([, ok]) => !ok).map(([nome]) => nome);
  if (faltando.length === 0) return `memorial receita ${preenchidos}/${total} ✓ completo`;
  return `memorial receita ${preenchidos}/${total} (falta: ${faltando.join(", ")})`;
}

function progressoPorFase(
  fase: ChatFase,
  coletado: DocumentacaoColetada,
  saving: SavingColetado,
  receita: ReceitaColetada,
): string {
  switch (fase) {
    case "doc":
    case "doc_preview":
      return progressoDocumentacao(coletado);
    case "saving":
    case "saving_preview":
      return progressoSaving(saving);
    case "receita":
    case "receita_preview":
      return progressoReceita(receita);
    case "completo":
      return "fluxo completo ✓";
    default:
      return "";
  }
}

// Materialidade real do projeto: saving + receita (valores cheios, pontual NÃO divide por 12).
// NÃO usa o ÷10 do ganho_total_mensal (métrica de gestão/ranking) — aqui queremos o valor real
// para o gate de R$ 5.000/mês de validação humana obrigatória.
function calcularMaterialidade(
  saving: Record<string, unknown> | undefined,
  receita: Record<string, unknown> | undefined,
): number {
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  return savingReais + receitaValor;
}

async function getProjetoContexto(projeto_id: string): Promise<ProjetoContexto> {
  const data = await getProjetoContextoData(projeto_id);
  if (!data) throw new Error("Projeto não encontrado.");
  const docMsg = await getDocMessage(projeto_id);

  const tiposRaw = parseJson<string[]>(data.tipos_projeto);
  const tiposProjeto = Array.isArray(tiposRaw)
    ? (tiposRaw as ("saving" | "receita_incremental")[])
    : null;

  const revisao = await buildRevisaoContexto(projeto_id, data);

  return {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    // area_nome vem do join por area_id; cai no texto p.area quando não há id mapeado.
    area: data.area_nome ?? data.area ?? null,
    membros: parseJson<string[]>(data.membros) ?? [],
    nome_projeto: data.nome ?? "",
    data_criacao: data.data_criacao_projeto ?? null,
    doc_texto: docMsg?.content ?? null,
    descricao_breve: data.descricao_breve ?? null,
    tipo_projeto: (data.tipo_projeto as "saving" | "receita_incremental" | null) ?? null,
    tipos_projeto: tiposProjeto,
    escopo: (data.escopo as "interno" | "externo" | null) ?? null,
    servico_externo: data.servico_externo ?? null,
    // ⚠️ Respostas do formulário que o agente PRECISA ver (renderizadas por
    // buildRespostasFormulario). O contrafactual é o insumo do ponto [1.4] do memorial:
    // sem ele o agente pergunta o ponteiro do zero, ignorando o que a pessoa já
    // respondeu na Etapa 2. Campo novo no formulário → nomeie AQUI também.
    contrafactual_afetados: data.contrafactual_afetados ?? null,
    // Insumo do gate de sobreposição receita × custo evitado. NÃO entra em prompt.
    custo_evitado_itens: data.custo_evitado_itens ?? null,
    usa_ai_proxy: data.usa_ai_proxy ?? null,
    // 'sim'/'nao' — no 'nao' as horas_antes são o equivalente manual estimado, não
    // uma rotina real (o orquestrador valida de forma diferente — sem pedir o passo
    // a passo de uma rotina inexistente).
    alguem_fazia: (data.alguem_fazia as "sim" | "nao" | null) ?? null,
    especial: data.especial === 1,
    contexto_especial: data.contexto_especial ?? null,
    revisao,
  };
}

// Monta o contexto de revisão (edição) a partir da submissão anterior. Só retorna
// dados quando o projeto JÁ FOI submetido (submitted_at presente ou documentação
// estruturada já existe) — caso contrário é uma primeira submissão e retorna null,
// deixando os prompts no comportamento padrão. Os valores em R$ aqui são staff-only.
async function buildRevisaoContexto(
  projeto_id: string,
  data: Awaited<ReturnType<typeof getProjetoContextoData>>,
): Promise<RevisaoContexto | null> {
  if (!data) return null;
  const docRow = await getDocumentacaoConteudo(projeto_id);
  const jaSubmetido = !!data.submitted_at || !!docRow?.conteudo;
  if (!jaSubmetido) return null;

  const docGerada = docRow?.conteudo ? parseJson<DocumentacaoGerada>(docRow.conteudo) : null;

  const doc = docGerada
    ? {
        o_que_faz: docGerada.o_que_faz ?? null,
        execucao: docGerada.execucao ?? null,
        // fluxo/dependencias/atencao são estruturados; serializa em texto legível.
        fluxo: Array.isArray(docGerada.fluxo)
          ? docGerada.fluxo.map((f, i) => `${i + 1}. ${f.etapa}: ${f.descricao}`).join("\n")
          : null,
        dependencias: Array.isArray(docGerada.dependencias)
          ? docGerada.dependencias.map((d) => `${d.servico}: ${d.descricao}`).join("; ")
          : null,
        configurar_antes: Array.isArray(docGerada.configurar_antes)
          ? docGerada.configurar_antes.join("; ")
          : null,
        atencao: Array.isArray(docGerada.atencao)
          ? docGerada.atencao.map((a) => `${a.titulo}: ${a.descricao}`).join("; ")
          : null,
      }
    : null;

  const savingDoc = docGerada?.saving;
  const saving =
    savingDoc || data.memorial_calculo || data.saving_horas != null
      ? {
          memorial_calculo: savingDoc?.memorial_calculo ?? data.memorial_calculo ?? null,
          linhas: (savingDoc?.linhas ?? []).map((l) => ({
            cargo: l.cargo,
            horas_antes: l.horas_antes,
            horas_depois: l.horas_depois,
          })),
          economia_horas_mes: savingDoc?.economia_horas_mes ?? data.saving_horas ?? null,
          economia_reais_mes: savingDoc?.economia_reais_mes ?? data.saving_reais ?? null,
          tipo_saving: savingDoc?.tipo_saving ?? data.tipo_saving ?? null,
          alguem_fazia: data.alguem_fazia ?? null,
          custo_externo_mensal: data.custo_externo_mensal ?? null,
        }
      : null;

  // O conteúdo de receita não vive em DocumentacaoGerada.saving; usa o memorial do
  // projeto como aproximação quando o tipo inclui receita.
  const receita =
    data.tipo_projeto === "receita_incremental" && data.memorial_calculo
      ? { memorial_calculo: data.memorial_calculo, valor_ganho_mensal: data.saving_reais ?? null }
      : null;

  if (!doc && !saving && !receita) return null;
  return { doc, saving, receita };
}

type EstadoChat = {
  fase: ChatFase;
  coletado: DocumentacaoColetada;
  saving: SavingColetado;
  receita: ReceitaColetada;
};

function extrairEstado(messages: { role: string; content: string }[]): EstadoChat {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    try {
      const parsed = JSON.parse(msg.content) as Partial<EstadoChat>;
      return {
        fase: parsed.fase ?? "doc",
        coletado: parsed.coletado ?? documentacaoVazia(),
        saving: parsed.saving ?? savingVazio(),
        receita: parsed.receita ?? receitaVazia(),
      };
    } catch {
      continue;
    }
  }
  return {
    fase: "doc",
    coletado: documentacaoVazia(),
    saving: savingVazio(),
    receita: receitaVazia(),
  };
}

function buildHistory(msgs: { role: string; content: string }[]): ChatHistoryMessage[] {
  return msgs
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      if (m.role === "assistant") {
        try {
          const parsed = JSON.parse(m.content) as { content?: string; question?: string };
          return {
            role: "assistant" as const,
            content: parsed.content ?? parsed.question ?? m.content,
          };
        } catch {
          return { role: "assistant" as const, content: m.content };
        }
      }
      return { role: "user" as const, content: m.content };
    });
}

function extrairResumoProjeto(msgs: { role: string; content: string }[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role !== "assistant") continue;
    try {
      const parsed = JSON.parse(msg.content) as { type?: string; fase?: string; content?: string };
      if (
        parsed.type === "complete" &&
        (parsed.fase === "saving" || parsed.fase === "receita") &&
        parsed.content
      ) {
        return parsed.content;
      }
    } catch {
      continue;
    }
  }
  return "";
}

function buildPhaseHistory(
  msgs: { role: string; content: string }[],
  targetFase: "saving" | "receita",
): ChatHistoryMessage[] {
  // 1) Marcador de transição (type:complete + fase): a conversa da fase vem depois.
  let startIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== "assistant") continue;
    try {
      const parsed = JSON.parse(msgs[i].content) as { type?: string; fase?: string };
      if (parsed.type === "complete" && parsed.fase === targetFase) {
        startIdx = i;
        break;
      }
    } catch {
      continue;
    }
  }
  // 2) Fallback: fase adicionada depois, sem transição (ex.: receita marcada após o
  //    saving já concluído). Ancora na PRIMEIRA mensagem da própria fase para isolar
  //    o histórico, sem arrastar a conversa do saving.
  if (startIdx < 0) {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== "assistant") continue;
      try {
        const parsed = JSON.parse(msgs[i].content) as { fase?: string };
        if (parsed.fase === targetFase) {
          startIdx = i - 1;
          break;
        }
      } catch {
        continue;
      }
    }
  }
  const phaseMsgs = startIdx >= 0 ? msgs.slice(startIdx + 1) : msgs;
  return buildHistory(phaseMsgs);
}

function formatResponse(
  resultado: ReturnType<typeof runOrchestrator> extends Promise<infer R> ? R : never,
) {
  return {
    type: resultado.type,
    content:
      resultado.type === "options"
        ? (resultado as { question: string }).question
        : (resultado as { content: string }).content,
    options: resultado.type === "options" ? resultado.options : null,
    fase: resultado.fase,
    isPreview: resultado.type === "preview",
    isComplete: resultado.fase === "completo",
    coletado: resultado.coletado,
    saving: resultado.saving,
    receita: resultado.receita,
  };
}

function getTiposProjeto(ctx: ProjetoContexto): ("saving" | "receita_incremental")[] {
  if (ctx.tipos_projeto && ctx.tipos_projeto.length > 0) return ctx.tipos_projeto;
  if (ctx.tipo_projeto) return [ctx.tipo_projeto];
  return ["saving"];
}

// ─── Schemas de validação de entrada ────────────────────────────────────────

// Mapa e-mail→papel dos participantes. Papéis atuais: coexecutor("Coautor") |
// planejador("Participante") | contribuidor("Contribuidor"). Os `value` internos
// coexecutor/planejador foram mantidos ao renomear os rótulos. O enum aceita também os
// LEGADOS idealizador/referencia_tecnica (feature anterior) p/ não rejeitar payload de
// cliente com cache antigo (version skew) — no sync eles caem em "Contribuidor".
// Opcional (projeto individual/legado → ausente). O e-mail é a chave, como em `membros`.
const membrosPapeisSchema = z
  .record(z.enum(["coexecutor", "planejador", "contribuidor", "idealizador", "referencia_tecnica"]))
  .optional();

const iniciarSubmissaoSchema = z.object({
  responsavel_nome: z.string().min(1).max(120),
  responsavel_email: z.string().email().max(255),
  area_id: z.string().min(1).optional(),
  // A área não é mais escolhida no formulário — é derivada do email (TeamGuide)
  // na submissão (submeterParaValidacao). Aqui o projeto nasce sem área.
  area: z.string().min(1).max(100).optional(),
  ferramenta: z.string().min(1).max(200),
  escopo: z.enum(["interno", "externo"]).optional(),
  servico_externo: z.string().max(200).optional(),
  membros: z.array(z.string()).default([]),
  membros_papeis: membrosPapeisSchema,
  nome_projeto: z.string().min(1).max(200),
  data_criacao: z.string(),
  tipo_projeto: z.enum(["saving", "receita_incremental"]).optional(),
  tipos_projeto: z.array(z.enum(["saving", "receita_incremental"])).optional(),
  descricao_breve: z.string().max(1000).optional(),
  // Governança: o projeto usa o AI Proxy interno (gateway de IA da empresa)?
  usa_ai_proxy: z.enum(["sim", "nao"]).optional(),
  // Contrafactual (Etapa 2): quem sentiria falta ("pessoa:a@x;b@y" | "time:Fiscal;CX")
  // (o "o que piora" saiu do form em 03/08/2026). Não barra a submissão — alimenta a
  // classificação de elegibilidade do analisador. O PONTEIRO movido também saiu do form
  // (o agente conduz no memorial). NÃO reintroduzir o "o que piora" aqui.
  contrafactual_afetados: z.string().max(1200).optional(),
  // Projeto especial: altíssimo impacto que não se encaixa em saving/receita.
  // Quando true, o fluxo pula a análise financeira e o analisador IA (validação humana).
  especial: z.boolean().optional(),
  contexto_especial: z.string().max(2000).optional(),
  // Fluxo DIRETO de liderança: quando true (e o SOLICITANTE é liderança/admin, conferido
  // no servidor), a doc é gerada por IA em UMA passada (extrator + compilador, sem
  // conversa) e o fluxo NÃO inicia o chat — o frontend segue direto ao formulário
  // determinístico de saving/receita. Ignorado para `especial` (que já pula tudo).
  fluxo_direto: z.boolean().optional(),
  // Projeto como FEATURE de outro (Etapa 1): id do projeto PAI. Vale só na submissão
  // NOVA (decisão do Luis). O nome do filho ganha o prefixo "[feature de <NOME do pai>]".
  projeto_pai_id: z.string().max(64).optional().nullable(),
  docs: z
    .array(z.object({ base64: z.string().min(1), filename: z.string().min(1) }))
    .min(1)
    .max(5000),
});

// Teto de caracteres de uma mensagem do chat. Generoso porque o usuário às vezes
// cola um memorial inteiro reescrito para pedir ajustes (~7-8 mil chars são comuns).
// O limite antigo (4000) rejeitava esses pastes com um ZodError cru → 500. Ver o
// guard amigável em `enviarMensagem` (devolve 400 com mensagem legível, não crash).
export const LIMITE_MENSAGEM_CHAT = 16000;

const enviarMensagemSchema = z.object({
  projeto_id: z.string().min(1),
  content: z.string().min(1).max(LIMITE_MENSAGEM_CHAT),
  selected_option: z.number().optional(),
});

const iniciarSavingSchema = z.object({
  projeto_id: z.string().min(1),
  // Fluxo DIRETO de liderança: pula o orquestrador e os gates — o memorial é montado
  // DETERMINISTICAMENTE do formulário (sem R$; o R$ entra por enriquecerMemorial). Só
  // vale se o solicitante for liderança/admin (conferido no servidor).
  modo_direto: z.boolean().optional(),
  // 'trimestral'/'semestral': rotina a cada 3/6 meses — grava o ACUMULADO do
  // período pelo valor cheio (não mensaliza). A cadência fica no tipo_saving.
  tipo_saving: z.enum(["mensal", "pontual", "trimestral", "semestral"]),
  // Havia alguém fazendo/mantendo o processo manualmente antes da automação?
  // 'sim' → horas reais; 'nao' → contrafactual (equivalente manual estimado);
  // 'externo' → ninguém fazia internamente e o ganho é 100% um custo externo
  // eliminado (SEM horas — só custo evitado). Árvore em step3-chat/constants.
  alguem_fazia: z.enum(["sim", "nao", "externo"]).optional(),
  linhas: z
    .array(
      z.object({
        cargo: z.string(),
        horas_antes: z.number().min(0),
        horas_depois: z.number().min(0),
      }),
    )
    .optional(),
  custo_externo_mensal: z.number().min(0).optional(),
  // Custo evitado: a solução fez a empresa deixar de pagar ferramentas/serviços
  // externos? Lista incremental coletada no formulário (≠ custo_externo_mensal,
  // que é o custo INCORRIDO pela automação). Cada item entra pelo valor CHEIO
  // ('pontual' e 'mensal', sem ÷12). Soma ao saving (custo_evitado_reais).
  tem_custo_evitado: z.enum(["sim", "nao"]).optional(),
  custo_evitado_itens: z
    .array(
      z.object({
        nome: z.string(),
        valor: z.number().min(0),
        recorrencia: z.enum(["mensal", "pontual"]),
        justificativa: z.string(),
      }),
    )
    .optional(),
  // Custos do projeto: serviços externos PAGOS que a solução INTERNA consome pra
  // rodar (chave de API, ElevenLabs…). Lista incremental do formulário. Cada item
  // entra pelo valor CHEIO (pontual e mensal, sem ÷12). SUBTRAI do saving
  // (custo_projeto_reais). Distinto do custo_externo_mensal (escopo externo) e do custo_evitado (que soma).
  tem_custo_projeto: z.enum(["sim", "nao"]).optional(),
  custo_projeto_itens: z
    .array(
      z.object({
        nome: z.string(),
        valor: z.number().min(0),
        recorrencia: z.enum(["mensal", "pontual"]),
        justificativa: z.string(),
      }),
    )
    .optional(),
});

const iniciarReceitaSchema = z.object({
  projeto_id: z.string().min(1),
  // Fluxo DIRETO de liderança (idem iniciarSaving): pula o orquestrador/gates e monta
  // o memorial de receita DETERMINISTICAMENTE. Conferido no servidor.
  modo_direto: z.boolean().optional(),
  tipo_saving: z.enum(["mensal", "pontual", "trimestral", "semestral"]),
  // Valor de receita informado pela pessoa no formulário determinístico. O agente
  // recebe esse valor pré-preenchido e o DESAFIA (em vez de coletar do zero).
  valor_ganho_mensal: z.number().min(0).optional(),
  // Racional curto (de onde vem a receita) — ponto de partida para o agente aprofundar.
  racional: z.string().max(500).optional(),
});

const submeterValidacaoSchema = z.object({
  projeto_id: z.string().min(1),
  modo: z.enum(["novo", "edicao"]).optional(),
});

// Monta a documentação de um projeto ESPECIAL sem nenhuma IA: usa a descrição
// breve (o que o projeto faz) e o contexto especial (por que é de alto impacto e
// difícil mensuração) que a pessoa escreveu. As demais seções (execução, fluxo,
// dependências…) não se aplicam a projetos fundacionais — ficam vazias/"—".
// O contexto especial também é enviado em campo próprio ao n8n (planilha).
function buildDocEspecial(data: {
  nome_projeto: string;
  responsavel_nome: string;
  responsavel_email: string;
  ferramenta: string;
  membros: string[];
  descricao_breve?: string;
  contexto_especial?: string;
}): DocumentacaoGerada {
  const descricao = data.descricao_breve?.trim() ?? "";
  const contexto = data.contexto_especial?.trim() ?? "";
  const oQueFaz =
    [descricao, contexto].filter(Boolean).join("\n\n") ||
    "Projeto de alto impacto e difícil mensuração — submetido para validação humana.";

  return {
    titulo: data.nome_projeto,
    responsavel: { nome: data.responsavel_nome, email: data.responsavel_email, area: null },
    ferramenta: data.ferramenta,
    membros: data.membros,
    o_que_faz: oQueFaz,
    execucao: "—",
    dependencias: [],
    fluxo: [],
    configurar_antes: [],
    atencao: [],
    gerado_em: new Date().toISOString(),
  };
}

// ─── Fluxo DIRETO de liderança ───────────────────────────────────────────────
// Cargo isento de pré-aprovação (coordenador+, a MESMA régua de `ehLideranca`) pula
// o agente conversacional e os gates: doc por IA numa passada + memorial
// determinístico. ⚠️ É uma PORTA que pula os freios de qualidade, então a permissão
// é conferida SEMPRE no SERVIDOR — o flag do cliente sozinho nunca libera (senão
// qualquer submissor burlaria os gates mandando `fluxo_direto:true`). Admin também
// entra (para poder testar o fluxo — ver override `?lideranca=1`). Fail-to-false: se
// a TeamGuide não responder, `ehLideranca` devolve false e cai no fluxo normal.
async function podeFluxoDireto(email: string | null | undefined): Promise<boolean> {
  const alvo = (email ?? "").trim();
  if (!alvo) return false;
  if (await isAdmin(alvo)) return true;
  return ehLideranca(alvo);
}

// ─── Iniciar submissão ───────────────────────────────────────────────────────

export async function iniciarSubmissao(
  rawData: unknown,
  solicitanteEmail?: string | null,
  opts: { onDelta?: (chunk: string) => void } = {},
) {
  const data = iniciarSubmissaoSchema.parse(rawData);
  log("iniciarSubmissao", `Iniciando para "${data.nome_projeto}" (${data.responsavel_email})`);

  // Vínculo de FEATURE: resolve o NOME do pai (server-side, não confia em texto do
  // cliente) para prefixar o nome do filho com "[feature de <NOME do pai>]". Preferimos
  // o nome do SQLite; caí para o espelho da planilha (legado que só existe na aba).
  const paiId = (data.projeto_pai_id ?? "").trim() || null;
  let nomeFinal = data.nome_projeto;
  if (paiId) {
    try {
      const pai = await getProjetoById(paiId);
      const nomePai = pai?.nome ?? (await lerLinhaEspelho(paiId))?.["Projeto"] ?? null;
      nomeFinal = prefixarNomeFeature(data.nome_projeto, nomePai);
    } catch (paiErr) {
      err("iniciarSubmissao", "Falha ao resolver nome do pai (segue sem prefixo):", paiErr);
    }
  }

  let projeto;
  try {
    projeto = await insertProjeto({
      responsavel_nome: data.responsavel_nome,
      responsavel_email: data.responsavel_email,
      area_id: data.area_id ?? null,
      area: data.area ?? null,
      ferramenta: data.ferramenta,
      escopo: data.escopo ?? null,
      servico_externo: data.servico_externo ?? null,
      membros: data.membros,
      membros_papeis: data.membros_papeis ?? null,
      nome: nomeFinal,
      projeto_pai_id: paiId,
      data_criacao_projeto: data.data_criacao,
      // Projeto especial: marca "Tipo de Projeto" como "especial" (banco + planilha)
      // e ignora os tipos financeiros — o fluxo não passa pelas fases de saving/receita.
      tipo_projeto: data.especial ? "especial" : (data.tipo_projeto ?? null),
      tipos_projeto: data.especial ? ["especial"] : (data.tipos_projeto ?? null),
      descricao_breve: data.descricao_breve ?? null,
      usa_ai_proxy: data.usa_ai_proxy ?? null,
      contrafactual_afetados: data.contrafactual_afetados ?? null,
      especial: data.especial ?? false,
      contexto_especial: data.especial ? (data.contexto_especial ?? null) : null,
      status: "rascunho",
    });
  } catch (projErr) {
    err("iniciarSubmissao", "Falha ao criar projeto:", projErr);
    throw new Error(
      `Falha ao criar projeto: ${projErr instanceof Error ? projErr.message : "erro desconhecido"}`,
    );
  }
  log("iniciarSubmissao", `Projeto criado: ${projeto.id}`);

  // Evento de timeline: valores determinísticos das etapas 1 e 2 (não viram chat).
  await gravarEvento(projeto.id, "submissao", "doc", {
    nome_projeto: data.nome_projeto,
    escopo: data.escopo ?? null,
    ferramenta: data.ferramenta,
    servico_externo: data.servico_externo ?? null,
    membros: data.membros,
    // Papéis dos participantes (mapa e-mail→papel) — observabilidade no timeline do
    // Investigador. Campo NOVO dentro do JSON `dados` (sem migração); eventos antigos
    // simplesmente não o têm e o Investigador cai na linha "Membros" simples.
    membros_papeis: data.membros_papeis ?? null,
    data_criacao: data.data_criacao,
    tipos_projeto: data.especial
      ? ["especial"]
      : (data.tipos_projeto ?? (data.tipo_projeto ? [data.tipo_projeto] : [])),
    descricao_breve: data.descricao_breve ?? null,
    usa_ai_proxy: data.usa_ai_proxy ?? null,
    contrafactual_afetados: data.contrafactual_afetados ?? null,
    especial: data.especial ?? false,
    contexto_especial: data.especial ? (data.contexto_especial ?? null) : null,
    arquivos: data.docs.map((d) => d.filename),
  });

  // Persiste só os NOMES dos arquivos enviados (referência). NÃO subimos os
  // arquivos crus ao Drive — o que vai para a coluna "URL" é UM link do RESUMO da
  // documentação gerada pelo agente, salvo no Drive em `submeterParaValidacao`.
  if (data.docs.length > 0) {
    await updateProjeto(projeto.id, {
      arquivos_nomes: data.docs.map((d) => d.filename),
    });
  }

  let docTexto = "";
  try {
    docTexto = await extractTextFromMultipleFiles(data.docs);
    log(
      "iniciarSubmissao",
      `Texto extraído de ${data.docs.length} arquivo(s): ${docTexto.length} chars`,
    );
  } catch (extractErr) {
    err("iniciarSubmissao", "Erro na extração de texto:", extractErr);
    docTexto = "";
  }

  await insertChatMessage({
    projeto_id: projeto.id,
    role: "doc",
    content: docTexto || "(documento sem texto legível)",
  });

  // ── Projeto especial: pula o agente por completo ────────────────────────────
  // Projeto de alto impacto e difícil mensuração → não passa pela conversa, pela
  // análise financeira nem pelo analisador IA (validação é humana). A documentação
  // é montada direto da descrição + contexto especial (sem nenhuma chamada de IA) e
  // persistida, para que submeterParaValidacao tenha a doc exigida e o n8n receba o
  // objeto `documentacao`. O frontend chama submeter-validacao logo em seguida.
  if (data.especial) {
    const docEspecial = buildDocEspecial(data);
    await upsertDocumentacao(projeto.id, docEspecial);
    await updateProjeto(projeto.id, { chat_completo: true });
    log(
      "iniciarSubmissao",
      `Projeto especial ${projeto.id}: doc montada sem IA, pronto para submissão.`,
    );
    return { projeto_id: projeto.id, especial: true };
  }

  const ctx: ProjetoContexto = {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    area: null,
    ferramenta: data.ferramenta,
    membros: data.membros,
    nome_projeto: data.nome_projeto,
    data_criacao: data.data_criacao,
    doc_texto: docTexto || null,
    descricao_breve: data.descricao_breve ?? null,
    tipo_projeto: data.tipo_projeto ?? null,
    escopo: data.escopo ?? null,
  };

  let coletadoInicial: DocumentacaoColetada = {
    ...documentacaoVazia(),
    nome_projeto: data.nome_projeto,
  };

  if (docTexto || data.descricao_breve) {
    try {
      log("iniciarSubmissao", "Rodando extrator automático...");
      coletadoInicial = await extrairCamposDocumentacao(ctx, docTexto || "");
      const preenchidos = Object.values(coletadoInicial).filter((v) => v !== null).length;
      log("iniciarSubmissao", `Extrator: ${preenchidos}/7 campos preenchidos`);
    } catch (extractorErr) {
      err("iniciarSubmissao", "Extrator falhou — continuando sem pré-preenchimento:", extractorErr);
      coletadoInicial = { ...documentacaoVazia(), nome_projeto: data.nome_projeto };
    }
  }

  // ── Fluxo DIRETO de liderança: compila a doc por IA numa ÚNICA passada (a partir
  // do que o extrator pegou dos arquivos/descrição) e NÃO inicia o chat. O frontend
  // segue direto ao formulário determinístico de saving/receita. A permissão é
  // conferida no SERVIDOR (o flag do cliente sozinho não libera). Ver `podeFluxoDireto`.
  if (data.fluxo_direto && !data.especial && (await podeFluxoDireto(solicitanteEmail))) {
    let doc: DocumentacaoGerada;
    try {
      doc = await compilarDocumentacao(ctx, coletadoInicial);
    } catch (compileErr) {
      // A liderança não tem chat para retentar — se a IA falhar, cai numa doc mínima
      // determinística (título + descrição) para a submissão não travar. A validação
      // de qualidade é humana (equipe RPA), igual ao caminho especial.
      err(
        "iniciarSubmissao",
        "Compilação da doc falhou no fluxo direto — usando doc mínima:",
        compileErr,
      );
      doc = buildDocEspecial({
        nome_projeto: data.nome_projeto,
        responsavel_nome: data.responsavel_nome,
        responsavel_email: data.responsavel_email,
        ferramenta: data.ferramenta,
        membros: data.membros,
        descricao_breve: data.descricao_breve,
      });
    }
    const docComSinais = {
      ...doc,
      tem_ia_como_funcionalidade: coletadoInicial.tem_ia_como_funcionalidade ?? null,
    };
    await upsertDocumentacao(projeto.id, docComSinais);
    log(
      "iniciarSubmissao",
      `Fluxo direto (liderança): doc compilada por IA — projeto ${projeto.id} pronto para o formulário.`,
    );
    return { projeto_id: projeto.id, fluxo_direto: true };
  }

  log("iniciarSubmissao", "Rodando orquestrador (fase doc)...");
  const resultado = await runOrchestrator(
    ctx,
    [],
    "doc",
    coletadoInicial,
    savingVazio(),
    "",
    ["saving"],
    receitaVazia(),
    { onDelta: opts.onDelta },
  );

  await insertChatMessage({
    projeto_id: projeto.id,
    role: "assistant",
    content: JSON.stringify(resultado),
    options: resultado.type === "options" ? resultado.options : null,
  });

  const respContent =
    resultado.type === "options"
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content;
  console.log("\n┌─────────────────────────────────────────────");
  console.log(`│ 🆕 NOVA SUBMISSÃO: "${data.nome_projeto}"`);
  console.log(
    `│ 📄 Arquivos: ${data.docs.length} arquivo(s), ${docTexto ? docTexto.length + " chars extraídos" : "sem texto"}`,
  );
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoDocumentacao(resultado.coletado)}`);
  console.log("│ 🤖 IA:");
  respContent.split("\n").forEach((line: string) => console.log(`│    ${line}`));
  console.log("└─────────────────────────────────────────────\n");

  return {
    projeto_id: projeto.id,
    response: formatResponse(resultado),
  };
}

// ─── Guarda de observabilidade: memorial (texto) × linhas (gravado) ──────────
// O backend GRAVA o saving a partir das `linhas` (recomputarSavingFinanceiro). Se
// o LLM ajustar o TEXTO do memorial mas esquecer de atualizar as linhas (ex: "é
// por loja × 3" só na prosa), o usuário vê um total e o sistema grava outro. Esta
// guarda NÃO bloqueia: loga e DEVOLVE a divergência (quando há) para o chamador
// decidir o que fazer com ela — na submissão vira um card de alerta no Investigador.
// Compara o gravado contra o MAIOR "Economia total: X h" declarado no texto (o
// headline), então pega o caso "270h no texto, 90h gravado". Devolve null se bate
// ou se não há número legível no texto.
function avisarDivergenciaMemorialLinhas(
  saving: SavingColetado | undefined,
  projetoId: string,
): { totalTexto: number; totalGravado: number } | null {
  const memorial = saving?.memorial_calculo ?? "";
  if (!memorial) return null;
  const totalGravado = saving?.economia_horas_mes ?? 0;
  // Captura todos os "Economia total ...: X h" declarados no texto.
  const declarados = [...memorial.matchAll(/economia\s+total[^\n:]*:\s*([\d.,]+)\s*h/gi)]
    .map((m) => Number(m[1].replace(/\./g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n));
  if (declarados.length === 0) return null; // sem número legível — não dá p/ conferir
  const totalTexto = Math.max(...declarados); // headline declarado no memorial
  const tolerancia = Math.max(0.5, totalTexto * 0.02);
  if (Math.abs(totalTexto - totalGravado) <= tolerancia) return null;
  console.warn(
    `[saving-guard] ⚠ Divergência memorial×linhas no projeto ${projetoId}: ` +
      `memorial declara ${totalTexto}h, mas o gravado (linhas) é ${totalGravado}h. ` +
      `Provável dessincronia do LLM (texto ≠ estruturado).`,
  );
  return { totalTexto, totalGravado };
}

// ─── Gate determinístico: JORNADA-BASE das horas (padrão CLT 220h/mês = TETO) ──
// Garante que, em rotina manual real e mensal (ver aplicaConfirmacaoBaseHoras), o
// chat SEMPRE indique a base de 220h úteis e pergunte (com botões), antes do 1º
// preview, se há trabalho HUMANO em fim de semana — pois essa é a ÚNICA forma de a
// base por pessoa passar de 220h (até no máx. 30 dias úteis/~300h). O LLM não faz
// essa pergunta: o backend força e interpreta a resposta (gate determinístico,
// à prova de o LLM esquecer ou previewar direto).

// Pergunta padronizada: indica a base de 220h E pergunta sobre trabalho de fim de semana.
function perguntaJornada(): string {
  return "Antes de eu fechar o memorial: a base padrão que eu uso é de **220h úteis por mês (22 dias úteis, seg–sex)**. Para fechar certo — alguém de fato **trabalha ou usa esse processo nos fins de semana** (uma pessoa, não apenas a automação rodando sozinha)?";
}

// Opções (botões) da pergunta de jornada. Índice 1 = só dias úteis, 2 = fim de semana.
const OPCOES_JORNADA = ["Não, só em dias úteis", "Sim, há trabalho/uso humano no fim de semana"];

// Interpreta a resposta. O botão envia o índice (1=dias úteis, 2=fim de semana).
// Texto digitado cai no fallback por regex (negação vence — "não trabalho fim de
// semana" = dias_uteis). null = ambíguo (re-pergunta determinística).
function interpretarJornada(
  content: string,
  selectedOption: number | null,
): "dias_uteis" | "fim_de_semana" | null {
  if (selectedOption === 1) return "dias_uteis";
  if (selectedOption === 2) return "fim_de_semana";
  const t = (content ?? "").trim().toLowerCase();
  if (!t) return null;
  // Negação explícita vence (cobre "não, só dias úteis", "não trabalhamos fim de semana").
  if (
    /\bn[ãa]o\b/.test(t) ||
    /\b(s[óo]|somente|apenas)\s+(dias?\s*[úu]teis|semana)/.test(t) ||
    /dias?\s*[úu]teis/.test(t)
  )
    return "dias_uteis";
  if (
    /\b(sim|s)\b/.test(t) ||
    /(fim|final|fins)\s+de\s+semana|finais?\s+de\s+semana|s[áa]bado|domingo|\bfds\b|fim\s*de\s*sem/.test(
      t,
    )
  )
    return "fim_de_semana";
  return null;
}

const NUDGE_JORNADA_UTIL =
  "[SISTEMA] O usuário confirmou (botão) que o trabalho/uso do processo é SÓ em dias úteis. Mantenha o TETO de 220h/mês por PESSOA (22 dias úteis). Se alguma linha implicar mais de ~220h/mês para UM indivíduo (descontando multiplicadores de lojas/unidades), reconcilie para baixo até caber na semana útil ANTES de gerar o preview. Se tudo já estiver dentro do teto, siga para o preview. NÃO pergunte sobre isso de novo.";
const NUDGE_JORNADA_FIMSEMANA =
  "[SISTEMA] O usuário afirmou (botão) que há trabalho/uso HUMANO no fim de semana. VALIDE com cuidado antes de elevar a base: confirme que é mesmo uma PESSOA que trabalha/usa/se beneficia do processo no sábado/domingo (não basta a automação rodar) e quantos dias por semana de fato. Só então a base por pessoa pode subir proporcionalmente, até no MÁXIMO 30 dias úteis/mês (~300h; 6 dias ≈ 26 dias/264h, 7 dias ≈ 30 dias/300h). Ajuste as linhas (horas_antes/horas_depois) conforme a base validada. Se, ao questionar, ficar claro que só a automação roda no fim de semana (ninguém trabalha nem consome), NÃO eleve a base — mantenha 220h e reconcilie. NÃO repita a pergunta de fim de semana.";

// ─── Gate determinístico 2: TETO por pessoa (uma LINHA acima do teto) ────────
// Camada de segurança DURA sobre o teto de horas. O teto por pessoa (220h dias
// úteis / 300h com fim de semana humano) é, por prompt, só persuasão — o LLM pode
// ceder se o usuário insistir num número impossível para uma pessoa. Aqui o backend
// IMPEDE o preview enquanto uma linha passar do teto, A NÃO SER que o usuário
// confirme (com botões) que a linha soma VÁRIAS pessoas/unidades (caso multiplicador
// legítimo, ex.: várias lojas — que o sistema não consegue distinguir só pelas horas).
function tetoPorJornada(jornada: SavingColetado["jornada_base"]): number {
  return jornada === "fim_de_semana" ? 300 : 220;
}
function linhasAcimaDoTeto(linhas: SavingColetado["linhas"], cap: number) {
  return (linhas ?? []).filter((l) => (l.horas_antes ?? 0) > cap);
}
function perguntaTetoPessoa(excedentes: SavingColetado["linhas"], cap: number): string {
  const lista = (excedentes ?? []).map((l) => `${l.cargo} (${l.horas_antes}h/mês)`).join(", ");
  return `Preciso confirmar um ponto antes de fechar: ${lista} ${(excedentes ?? []).length > 1 ? "aparecem" : "aparece"} acima do teto de **${cap}h/mês por pessoa** (uma pessoa não trabalha mais que isso no mês). Esse total é de **uma pessoa só** ou **representa várias pessoas/unidades** (ex.: várias lojas, vários colaboradores)?`;
}
const OPCOES_TETO = [
  "É uma pessoa só (vou corrigir as horas)",
  "Representa várias pessoas/unidades (lojas, colaboradores)",
];
// Interpreta a resposta do teto. Texto primeiro (robusto p/ clique E digitação),
// índice 1-based como apoio (frontend: 1=pessoa, 2=múltiplo). null = ambíguo.
function interpretarTetoPessoa(
  content: string,
  selectedOption: number | null,
): "pessoa" | "multiplo" | null {
  const t = (content ?? "").trim().toLowerCase();
  if (
    /(v[áa]ri[ao]s?|m[úu]ltipl|lojas?|unidades?|colaboradores?|filia|por (loja|unidade)|cada (loja|unidade|colaborador)|equipe inteira)/.test(
      t,
    )
  )
    return "multiplo";
  if (/(uma pessoa|uma s[óo]|s[óo] (uma|um)\b|[ée] uma pessoa|corrig|reduz|ajust)/.test(t))
    return "pessoa";
  if (selectedOption === 2) return "multiplo";
  if (selectedOption === 1) return "pessoa";
  return null;
}
const NUDGE_TETO_MULTIPLO =
  "[SISTEMA] O usuário confirmou (botão) que a(s) linha(s) acima do teto somam VÁRIAS pessoas/unidades (não uma só) — então o total é legítimo (cada pessoa fica dentro do teto). Pode prosseguir e gerar o preview se o resto estiver completo. NÃO repita essa pergunta. No memorial, registre quantas pessoas/unidades compõem essas horas.";
function nudgeTetoPessoa(cap: number): string {
  return `[SISTEMA] O usuário confirmou que a(s) linha(s) acima do teto é(são) de UMA pessoa só — o que é IMPOSSÍVEL, pois uma pessoa não trabalha mais que ${cap}h/mês. RECONCILIE agora: reveja volume × tempo com o usuário e ajuste horas_antes dessa(s) linha(s) para no MÁXIMO ${cap}h/mês ANTES de gerar o preview. É PROIBIDO gerar preview com uma linha acima de ${cap}h/mês para uma única pessoa.`;
}

// ─── Gate determinístico 3: SPLIT carga real × ganho por escala ──────────────
// Split CARGA REAL × GANHO POR ESCALA: a pergunta é CONDUZIDA PELO AGENTE (prompt em
// buildSavingPrompt, no padrão saudável da verificação de IA — opções, uma vez, aceita e
// segue). NÃO há mais gate determinístico bloqueando o preview: isso gerava o loop reportado
// na edição (o backend descartava o preview do LLM e re-perguntava o mesmo número à força).
// A rede de segurança agora é NÃO-bloqueante e vive na gravação: resolverSplitCargaEscala
// (orchestrator.ts) preenche horas_carga_real/horas_escala com o valor conservador (carga
// real = total, escala 0) quando o agente não capturou — mantém as colunas do Sheets sem
// travar o chat. Ver SPEC_CORRECOES (jul/2026, remoção do forçamento).

// ─── Gate determinístico 4: ALOCAÇÃO DE GANHOS (Seção 2.4 — "o que mudou") ────
// Quando o saving MENSAL é alto (≥44h) e ALGUÉM fazia à mão (aplicaGateAlocacaoGanhos),
// um ganho desse porte só é crível se o tempo liberado foi PRA algum lugar concreto. O
// prompt sozinho não garante: no projeto Gostream (150h/mês) o LLM NUNCA perguntou e
// gravou o boilerplate vago "realocado para outras atividades" — que a própria régua do
// prompt manda RECUSAR. Então o backend GARANTE a pergunta antes do preview (a menos que
// o LLM já tenha escrito uma Seção 2.4 concreta) e injeta a resposta do usuário como base
// da seção. Como no split, a INFORMAÇÃO é sempre coletada, independente do LLM.
// ⚠️ Os 3 textos abaixo consomem TAXONOMIA_DESTINO_GANHO (orchestrator.ts) — a régua NÃO
// se redigita aqui. Antes, cada um repetia o par "atividades NOMEADAS **E** o que o time
// entrega A MAIS", que recusava a resposta certa quando o ganho é MENOS CUSTO (equipe
// menor / vaga não reposta / contrato cancelado). Exportados para o teste da fonte única.
export function perguntaAlocacaoGanhos(total: number, unidade: string): string {
  return `Antes de eu fechar: **${total}${unidade}** é bastante tempo humano liberado — e um ganho desse tamanho só se sustenta se esse tempo virou outra coisa. **Pra onde foi esse tempo?** Me diga o destino CONCRETO, com nome. Qualquer um destes serve — inclusive equipe menor, que já é ganho por si só:

${TAXONOMIA_DESTINO_GANHO}`;
}
// Reperguntada FIRME quando a 1ª resposta veio vaga (respostaAlocacaoVaga). Roda 1x só
// (anti-loop): a próxima resposta é aceita como está, e a rede de segurança do preview
// (LLM-juiz) + a validação humana seguem como backstops.
export function perguntaAlocacaoGanhosFirme(total: number, unidade: string): string {
  return `Ainda preciso do destino CONCRETO dessas ${total}${unidade} — "outras atividades / mais produtividade / sobra tempo" não me diz nada, porque toda hora liberada vai para *alguma* coisa. Me diga em qual destes destinos o ganho se encaixa e qual foi ele, com nome:

${TAXONOMIA_DESTINO_GANHO}`;
}
// Nudge [SISTEMA] com a resposta do usuário: manda o LLM escrever a seção "### O que mudou
// após a automação" a partir do que a PESSOA disse (não boilerplate). Espelha nudgeCargaEscala.
export function nudgeAlocacaoGanhos(total: number, unidade: string, racional: string): string {
  const base = racional?.trim()
    ? `\nO usuário respondeu assim (use ISTO como base, sintetizando — não copie cru): «${racional.trim()}»`
    : "";
  return `[SISTEMA] O usuário informou PRA ONDE foi o tempo liberado dessas ${total}${unidade} economizadas.${base}
Registre isso no memorial na seção com o cabeçalho EXATO "### O que mudou após a automação" (logo após o total de horas da Seção 2), em texto qualitativo, SEM R$. Escreva o destino CONCRETO que o usuário deu (nunca "outras atividades"), deixando claro em qual dos destinos abaixo ele se encaixa, e conclua que o ganho é válido por causa dessa mudança. Se o usuário deu um número, inclua-o; se o destino é **menos custo** (equipe menor, vaga não reposta, contrato cancelado), registre assim mesmo — a entrega fica IGUAL e está correto. Depois siga para o preview. NÃO pergunte sobre isso de novo — a informação já foi coletada.

${TAXONOMIA_DESTINO_GANHO}`;
}

// ─── Gate determinístico 5: CRITÉRIO DE PROJETO (seções [1.3] e [1.4]) ───────
// "Processo alterado" e "Ponteiro movido e onde verificar" são OBRIGATÓRIAS nos 3 modos do
// MEMORIAL_ESQUELETO — são a RASTREABILIDADE da régua de critério (SPEC_CRITERIOS_PROJETO).
// O prompt sozinho não segurou (validação em staging 29/07/2026: o `receita-pura` fechou sem
// a [1.3] nas 2 rodadas; o `custo-evitado-puro` gravou só a metade da [1.4] nas 2), e a falha
// é SILENCIOSA — o analisador lê a ausência como rastreabilidade não comprovada e o autor cai
// em triagem manual injusta. Então o backend confere as seções antes do preview e, se faltar,
// pergunta UMA vez (anti-loop: a resposta seguinte é sempre aceita e vira nudge [SISTEMA]).
// Decisor PURO do gate: com este estado e este tipo de resultado, o preview deve ser
// bloqueado para perguntar as seções do critério?
//
// ⚠️ `resolvido` TEM de ser o estado lido NO MOMENTO do gate. Passar o snapshot do início
// do turno (`criterioAtual`) reintroduz o loop de 38 perguntas de 03/08/2026: o turno de
// resposta marca 'ok', o gate relê o valor velho ('pendente') e repergunta para sempre.
// A função existe justamente para tornar essa regra testável sem subir todo o
// `enviarMensagem` — o bug era invisível em teste de unidade porque vivia no ACOPLAMENTO
// entre duas leituras do mesmo campo, não dentro de nenhuma delas.
//
// 'ok' NUNCA volta a bloquear: é o "pergunta UMA vez só" da SPEC_CRITERIOS_PROJETO. O que
// segura a qualidade depois disso é o nudge [SISTEMA] (manda o LLM escrever a seção a
// partir do que a pessoa respondeu) e, no fim da fila, a triagem humana — nunca uma
// segunda trava, que é o que travava o usuário.
export function deveBloquearPorCriterio(
  resolvido: "pendente" | "ok" | null | undefined,
  tipoResultado: string,
): boolean {
  if (resolvido === "ok") return false;
  return tipoResultado === "preview" || tipoResultado === "complete";
}

// Frase de escape, repetida nos 3 formatos: "não sei onde conferir" É resposta legítima
// (vira zona cinzenta no analisador, nunca reprovação automática — decisão fechada da
// SPEC_CRITERIOS_PROJETO). Sem ela a pergunta lê como exigência e a pessoa inventa fonte.
const ESCAPE_SEM_FONTE =
  "Se não houver um lugar onde esse número é medido, me diga isso mesmo — eu registro a " +
  "ausência em vez de inventar uma fonte.";

// Opções (botões) de "qual ponteiro este projeto moveu". Espelham a régua do prompt
// ([1.4], BLOCO_SECOES_CRITERIO) em rótulos curtos o bastante para caber numa pílula.
// ⚠️ Só entram quando o ÚNICO buraco é o ponteiro: classificar é escolha de uma lista,
// mas "que processo mudou" precisa de prosa — botão ali fecharia o gate sem a resposta.
export const OPCOES_PONTEIRO = [
  "Custo (horas, headcount, contrato)",
  "Receita (vendas, ticket, pedidos)",
  "KPI da área (erro, retrabalho, prazo, risco)",
  "Ainda não sei dizer",
];

// Pergunta do gate. ⚠️ NUNCA numere os pedidos com letras: a versão anterior emitia
// "**(a) …**" / "**(b) …**" e, no caso mais comum (só o ponteiro falta), a mensagem
// começava num "(b)" órfão — o usuário via uma alínea de um roteiro que nunca lhe foi
// mostrado (bug reportado ago/2026). Bullets se explicam sozinhos em qualquer combinação.
export function perguntaCriterioSecoes(faltaProcesso: boolean, faltaPonteiro: boolean): string {
  // Só o ponteiro: pergunta curta + botões (ver OPCOES_PONTEIRO). O "onde conferir" vai
  // no mesmo turno como convite — quem souber já responde tudo digitando; quem clicar no
  // botão dá só o ponteiro, e o nudge manda o agente cobrar a fonte (uma vez).
  if (faltaPonteiro && !faltaProcesso) {
    return (
      "Antes de eu fechar o memorial, falta o ponto que sustenta o projeto na régua: " +
      "**qual ponteiro este projeto moveu?**\n\n" +
      "Escolha abaixo o que mais se aproxima. Se já souber, me diga junto **onde esse " +
      "número pode ser conferido** — o nome do relatório, painel, sistema ou base (por " +
      'exemplo, o painel "Conciliação diária" no Metabase, ou a base pedidos_cancelados).\n\n' +
      ESCAPE_SEM_FONTE
    );
  }
  // Só o processo: uma coisa só, sem lista.
  if (faltaProcesso && !faltaPonteiro) {
    return (
      "Antes de eu fechar o memorial, falta descrever **o processo que mudou e o tamanho " +
      "dele**: qual rotina era feita antes, como ela é hoje, e o volume, a frequência e o " +
      "tempo envolvidos."
    );
  }
  // Os dois: bullets, sem letras — cada um se lê sozinho.
  return (
    "Antes de eu fechar o memorial, faltam os dois pontos que sustentam o projeto na régua:\n\n" +
    "- **O processo que mudou e o tamanho dele** — qual rotina era feita antes, como ela é " +
    "hoje, e o volume, a frequência e o tempo envolvidos.\n" +
    "- **O ponteiro que isso moveu e onde conferir** — custo, receita ou um KPI da área " +
    "(erro, retrabalho, prazo, risco) — e em qual relatório, painel, sistema ou base, " +
    "**com nome**, alguém abriria pra ver esse número.\n\n" +
    ESCAPE_SEM_FONTE
  );
}

// A resposta ao gate trouxe a FONTE ("onde alguém confere") ou só classificou o ponteiro?
// Clique num botão = só o ponteiro: o rótulo não diz onde conferir — e "KPI da área…"
// casaria a PISTA_ONDE_VERIFICAR por acidente (a regex aceita "kpi"), o que faria o nudge
// dar a fonte por resolvida. Texto digitado passa pela MESMA régua do gate.
export function respostaTrouxeFonte(content: string, selecionouOpcao: boolean): boolean {
  if (selecionouOpcao) return false;
  return PISTA_ONDE_VERIFICAR.test(content ?? "");
}
// Nudge [SISTEMA] com a resposta do usuário: manda o LLM escrever as seções faltantes a
// partir do que a PESSOA disse (e do que a doc já traz), com os cabeçalhos EXATOS.
function nudgeCriterioSecoes(
  faltaProcesso: boolean,
  faltaPonteiro: boolean,
  racional: string,
  // true quando o usuário CLASSIFICOU o ponteiro (clique no botão) mas não disse onde o
  // número se confere. O gate não repergunta — ele fez sua pergunta e não vira loop —,
  // então o agente completa: propõe a fonte que a doc aprovada já nomeia e, se não houver,
  // pergunta UMA vez. Sem isso, o clique no botão fecharia o gate com meia seção [1.4] —
  // exatamente a falha do custo-evitado-puro que originou este gate.
  precisaFonte = false,
): string {
  const secoes = [
    faltaProcesso
      ? '"### Processo alterado" (qual rotina mudou, como era ANTES, como é AGORA e a MAGNITUDE — volume/frequência/tempo, sem R$)'
      : "",
    faltaPonteiro
      ? '"### Ponteiro movido e onde verificar" (QUAL ponteiro — custo · receita · KPI da área — e ONDE alguém confere esse número, com o relatório/painel/sistema/base NOMEADO; se o usuário não souber, registre a ausência explicitamente, sem inventar fonte)'
      : "",
  ].filter(Boolean);
  const base = racional.trim()
    ? `\nO usuário respondeu assim (use ISTO como base, sintetizando — não copie cru): «${racional.trim()}»`
    : "";
  const fonte = precisaFonte
    ? `
⚠️ O usuário CLASSIFICOU o ponteiro, mas NÃO disse onde esse número pode ser conferido. Antes de escrever a seção, resolva a fonte assim, nesta ordem: (1) se os DETALHES TÉCNICOS APROVADOS já nomeiam o relatório/painel/sistema/base onde o número vive, PROPONHA essa fonte para o usuário confirmar; (2) senão, pergunte UMA única vez onde alguém abriria para conferir esse número, pedindo o NOME ("no sistema" é vago); (3) se ele não souber, registre EXATAMENTE isso na seção e siga — nunca invente uma fonte nem trave a conversa.`
    : "";
  return `[SISTEMA] O usuário respondeu sobre o critério de projeto (processo alterado / ponteiro movido).${base}${fonte}
Escreva agora, no memorial, a(s) seção(ões) com o cabeçalho EXATO: ${secoes.join(" e ")}. Use também o que a documentação técnica já aprovada traz. Depois siga para o preview. NÃO pergunte sobre isso de novo — a informação já foi coletada.`;
}

// Mensagem do BACKSTOP de reclassificação (gate determinístico do item 3): quando a receita
// na verdade é saving, o backend bloqueia o preview/complete e devolve isto, mantendo a fase
// em 'receita'. Manda reclassificar o projeto como Saving no formulário — em vez de submeter
// um saving disfarçado de receita (caso legado-260).
const MSG_RECLASSIFICAR_RECEITA =
  "Pelo que conversamos, este caso **não é receita incremental** (receita nova que entra na " +
  "empresa) — é **economia operacional (saving)**. Para registrar corretamente, volte à Etapa 2/3 " +
  "e troque o tipo do projeto para **Saving**; aí refazemos o cálculo como saving (horas/custos), " +
  "não como receita. Se você acredita que há mesmo **receita nova, recorrente e já comprovada**, " +
  "me diga qual produto, canal ou funcionalidade gera essa receita a mais e a base de cálculo, que " +
  "eu monto o memorial de receita.";

// Justificativa do split carga real × escala → coluna "Justificativa Saving Escalado e
// Real" (TEXTO). Preferimos a SUBSEÇÃO "### Carga real e ganho por escala" que o agente
// escreve no memorial (a "análise do agente", rica — espelha a "Alocação Ganhos": sem
// coluna SQLite, re-extraída no resync). Se o split SE APLICA (alguém fazia à mão + os dois
// números) mas o agente não consolidou a subseção, montamos um fallback CONCRETO (não uma
// definição genérica): antes→depois por cargo + o split + a explicação que o usuário deu ao
// gate (carga_escala_racional). Só fica null → "—" quando o split não se aplica.
function derivarJustificativaCargaEscala(
  saving: Record<string, unknown> | null | undefined,
  alguemFazia: string | null | undefined,
): string | null {
  if (!saving) return null;
  const doMemorial = extrairJustificativaCargaEscala(
    normalizarMarcadoresMemorial(saving.memorial_calculo as string | null | undefined),
  );
  if (doMemorial) return doMemorial;
  const real = saving.horas_carga_real as number | null | undefined;
  const escala = saving.horas_escala as number | null | undefined;
  if (alguemFazia === "sim" && real != null && escala != null) {
    const total = Math.round((real + escala) * 100) / 100;
    const linhas = Array.isArray(saving.linhas)
      ? (saving.linhas as Array<Record<string, unknown>>)
      : [];
    const antesDepois = linhas
      .map((l) => {
        const cargo = String(l.cargo ?? "cargo").trim() || "cargo";
        const a = Number(l.horas_antes) || 0;
        const d = Number(l.horas_depois) || 0;
        return `${cargo} ${a}h→${d}h`;
      })
      .join("; ");
    const partes = [
      antesDepois
        ? `Antes × depois por cargo: ${antesDepois} (economia total ${total}h).`
        : `Economia total: ${total}h.`,
      `Carga real (o que a pessoa realmente fazia à mão): ${real}h; ganho por escala (volume que só a automação passou a cobrir): ${escala}h.`,
      escala === 0
        ? "A pessoa já executava o volume completo manualmente — a automação não ampliou o volume, só o executou."
        : "",
      (saving.carga_escala_racional as string | null | undefined)?.trim()
        ? `Base informada pelo usuário: ${(saving.carga_escala_racional as string).trim()}`
        : "",
    ].filter(Boolean);
    return partes.join(" ");
  }
  // 'nao' (contrafactual — ninguém fazia à mão): a carga humana real é 0 e 100% do
  // saving é ganho por escala. Espelha a coluna numérica (derivarSplitHorasSheet) com
  // uma justificativa concreta, em vez de deixar "—" ao lado de um Escalado preenchido.
  if (alguemFazia === "nao") {
    const total = Math.round((Number(saving.economia_horas_mes) || 0) * 100) / 100;
    if (total > 0) {
      return `Ninguém fazia esta tarefa manualmente (saving contrafactual): a carga humana real é 0h e as ${total}h economizadas são 100% ganho por escala — volume que só passou a ser tratado porque a automação assumiu um trabalho que nenhuma pessoa executava.`;
    }
  }
  return null;
}

// ─── Enviar mensagem ─────────────────────────────────────────────────────────

export async function enviarMensagem(
  rawData: unknown,
  opts: { onDelta?: (chunk: string) => void } = {},
) {
  // Mensagem longa demais → 400 com texto legível em vez do ZodError cru (que virava
  // 500 e travava o usuário no "tente novamente"). Trata antes do parse para a pessoa
  // saber exatamente o que fazer (resumir/dividir) em vez de ver um erro genérico.
  const conteudoBruto = (rawData as { content?: unknown })?.content;
  if (typeof conteudoBruto === "string" && conteudoBruto.length > LIMITE_MENSAGEM_CHAT) {
    throw Object.assign(
      new Error(
        `Sua mensagem é muito longa (${conteudoBruto.length.toLocaleString("pt-BR")} caracteres; ` +
          `o limite é ${LIMITE_MENSAGEM_CHAT.toLocaleString("pt-BR")}). ` +
          `Resuma ou divida em mais de uma mensagem.`,
      ),
      { status: 400 },
    );
  }

  const data = enviarMensagemSchema.parse(rawData);
  log("enviarMensagem", `projeto=${data.projeto_id}`);

  // Histórico montado a partir das mensagens JÁ persistidas + o novo turno do
  // usuário (ainda NÃO persistido). Só gravamos a conversa depois que o turno é
  // concluído com sucesso — assim, se a compilação da doc falhar (ver abaixo),
  // nada fica salvo pela metade e o usuário pode simplesmente tentar de novo.
  const msgs = await getChatMessagesExcludeRole(data.projeto_id, "doc");

  const estado = extrairEstado(msgs ?? []);

  let history: ChatHistoryMessage[];
  let resumoProjeto = "";
  if (estado.fase === "saving" || estado.fase === "saving_preview") {
    history = buildPhaseHistory(msgs ?? [], "saving");
    resumoProjeto = extrairResumoProjeto(msgs ?? []);
  } else if (estado.fase === "receita" || estado.fase === "receita_preview") {
    history = buildPhaseHistory(msgs ?? [], "receita");
    resumoProjeto = extrairResumoProjeto(msgs ?? []);
  } else {
    history = buildHistory(msgs ?? []);
  }
  history.push({ role: "user", content: data.content });

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);
  log(
    "enviarMensagem",
    `Fase: ${estado.fase}, histórico: ${history.length} msgs, tipos: ${tiposProjeto.join(",")}`,
  );

  // ── GATE JORNADA-BASE (220h/mês = TETO) — turno de RESPOSTA à pergunta ───────
  // Quando a jornada está 'pendente', este turno do usuário É a resposta (dias úteis
  // × fim de semana). Registramos no estado e injetamos um nudge [SISTEMA] (efêmero,
  // não persistido): dias úteis → manter teto de 220h/pessoa; fim de semana → validar
  // trabalho humano e elevar até no máx. 30 dias. Resposta ambígua → re-pergunta
  // determinística (sem chamar o orquestrador).
  const gateBaseHoras = estado.fase === "saving" && aplicaConfirmacaoBaseHoras(ctx, estado.saving);
  // Gate da alocação de ganhos (Seção 2.4): só saving mensal alto (≥44h) + alguém fazia à mão.
  const gateAlocacao = estado.fase === "saving" && aplicaGateAlocacaoGanhos(ctx, estado.saving);
  // Gate do CRITÉRIO DE PROJETO (seções [1.3]/[1.4]): vale nas DUAS famílias de fase
  // financeira (saving — incluindo custo evitado puro — e receita), porque as duas seções
  // são obrigatórias nos 3 modos do MEMORIAL_ESQUELETO.
  const faseCriterio: "saving" | "receita" | null =
    estado.fase === "saving" || estado.fase === "saving_preview"
      ? "saving"
      : estado.fase === "receita" || estado.fase === "receita_preview"
        ? "receita"
        : null;
  // ⚠️ SNAPSHOT DE PROPÓSITO, e com UM único uso legítimo: decidir, logo abaixo, se ESTE
  // turno é a resposta do usuário à pergunta do gate ('pendente' quando o turno começou).
  // NÃO reutilizar no gate lá embaixo — lá o estado já mudou dentro deste mesmo turno, e
  // ler o valor velho é literalmente o loop de 38 perguntas (ver deveBloquearPorCriterio).
  const criterioAtual =
    faseCriterio === "saving"
      ? (estado.saving.criterio_secoes ?? null)
      : faseCriterio === "receita"
        ? (estado.receita.criterio_secoes ?? null)
        : null;
  // Gate da SOBREPOSIÇÃO receita × custo evitado. A detecção é DETERMINÍSTICA (compara o
  // dinheiro da receita com os itens de custo evitado do formulário) — não depende do LLM
  // perceber, que foi exatamente o que falhou no Sucesso.AI: ele percebeu, avisou e passou.
  const gateSobreposicao = aplicaGateSobreposicao(estado.receita, estado.fase);
  const detSobreposicao = gateSobreposicao
    ? detectarSobreposicaoReceita(
        ctx.custo_evitado_itens,
        estado.receita.valor_ganho_mensal,
        estado.receita.racional,
      )
    : null;
  // ⚠️ MESMA semântica do `criterioAtual`: SNAPSHOT com um único uso legítimo — saber se
  // ESTE turno é a resposta à pergunta do gate. NÃO reutilizar no bloqueio lá embaixo.
  const sobreposicaoAtual = estado.receita.sobreposicao_custo_evitado ?? null;
  // Gate GANHO REAL × PROJETADO. Vale nas duas famílias financeiras (o caso de origem é de
  // receita, mas o portão de saving também era só prompt). A detecção é TEXTUAL sobre o
  // memorial + as falas do usuário NESTA fase — não depende do LLM perceber, que foi
  // exatamente o que falhou: ele perguntou duas vezes, ouviu "não é um número medido" e
  // gerou o preview com a ressalva escrita dentro do memorial.
  const faseGanhoReal = aplicaGateGanhoProjetado(estado.fase);
  const falasUsuarioFase = [...history.filter((m) => m.role === "user").map((m) => m.content)];
  const detProjecao =
    faseGanhoReal === "saving"
      ? detectarGanhoProjetado(textosParaDeteccaoSaving(estado.saving, falasUsuarioFase))
      : faseGanhoReal === "receita"
        ? detectarGanhoProjetado(textosParaDeteccaoReceita(estado.receita, falasUsuarioFase))
        : null;
  // Gate do CUSTO EVITADO DECLARADO NO CHAT. A detecção é TEXTUAL sobre as falas do usuário
  // NESTA fase (valor em R$ + vocabulário de gasto evitado) e ignora o que já está cadastrado
  // como item do formulário. Origem: SmartOnline/DIFAL — R$ 324.005,09 de multa e juros
  // citados no chat, aceitos sem UMA pergunta e depois descartados no submit (o R$ do custo
  // evitado vem dos itens do formulário). Ver `agents/custo-evitado-chat.ts`.
  const gateCustoEvitadoChat = aplicaGateCustoEvitadoChat(estado.fase, ctx.alguem_fazia);
  const detCustoEvitado = gateCustoEvitadoChat
    ? detectarCustoEvitadoNoChat(
        history.filter((m) => m.role === "user").map((m) => m.content),
        ctx.custo_evitado_itens,
      )
    : null;
  // ⚠️ SNAPSHOT — mesmo contrato dos demais: só para saber se ESTE turno é a resposta.
  const custoEvitadoChatAtual = estado.saving.custo_evitado_chat ?? null;
  // ⚠️ SNAPSHOT — mesmo contrato dos dois acima: só para saber se ESTE turno é a resposta.
  const ganhoRealAtual =
    faseGanhoReal === "saving"
      ? (estado.saving.ganho_real ?? null)
      : faseGanhoReal === "receita"
        ? (estado.receita.ganho_real ?? null)
        : null;
  let reask: OrchestratorResult | null = null;
  if (faseGanhoReal && ganhoRealAtual === "projetado") {
    // (0a) Estado TERMINAL de bloqueio. A única coisa que reabre é a pessoa AFIRMAR que o
    // ganho foi medido — aí o gate cede e a conversa segue. Qualquer outra mensagem recebe a
    // resposta curta de bloqueio, SEM chamar o LLM: era ele quem ficava negociando "escolha
    // um caminho" por 15 turnos (falha encontrada na staging, 04/08/2026).
    const racional = (data.content ?? "").trim();
    if (interpretarGanhoReal(racional, data.selected_option ?? null) === "real") {
      log(
        "enviarMensagem",
        `Ganho real × projetado (${faseGanhoReal}): usuário afirmou medição — reabrindo`,
      );
      if (faseGanhoReal === "saving") estado.saving = { ...estado.saving, ganho_real: "real" };
      else estado.receita = { ...estado.receita, ganho_real: "real" };
      history.push({ role: "user", content: nudgeGanhoRealConfirmado(racional) });
    } else {
      log(
        "enviarMensagem",
        `⛔ Ganho projetado confirmado (${faseGanhoReal}) — mantendo o bloqueio (sem LLM)`,
      );
      reask = {
        type: "question",
        content: mensagemGanhoProjetadoRepetida(faseGanhoReal),
        fase: faseGanhoReal,
        coletado: estado.coletado,
        saving: estado.saving,
        receita: estado.receita,
      };
    }
  } else if (
    faseGanhoReal &&
    (ganhoRealAtual === "pendente" || ganhoRealAtual === "reperguntado")
  ) {
    // (0) Turno de RESPOSTA ao gate GANHO REAL × PROJETADO. Vem PRIMEIRO na cadeia porque é
    // a premissa mais externa: não faz sentido validar horas ou base de cálculo de um ganho
    // que ainda não aconteceu. ANTI-LOOP por construção: 'pendente' → ambíguo → 'reperguntado'
    // → qualquer resposta cai em estado TERMINAL. Nunca uma terceira pergunta.
    const racional = (data.content ?? "").trim();
    const resp = interpretarGanhoReal(racional, data.selected_option ?? null);
    const primeiraVez = ganhoRealAtual === "pendente";
    // Ambíguo na 1ª → repergunta FIRME 1x. Ambíguo na 2ª → 'nao_respondido' (libera com marca).
    const novo: EstadoGanhoReal = resp ?? (primeiraVez ? "reperguntado" : "nao_respondido");
    if (faseGanhoReal === "saving") estado.saving = { ...estado.saving, ganho_real: novo };
    else estado.receita = { ...estado.receita, ganho_real: novo };
    log("enviarMensagem", `Ganho real × projetado (${faseGanhoReal}): resposta → "${novo}"`);
    if (novo === "reperguntado") {
      reask = {
        type: "options",
        question: perguntaGanhoRealFirme(faseGanhoReal),
        options: OPCOES_GANHO_REAL,
        fase: faseGanhoReal,
        coletado: estado.coletado,
        saving: estado.saving,
        receita: estado.receita,
      };
    } else if (novo === "projetado") {
      // Confirmou que é expectativa: BLOQUEIA aqui mesmo, sem gastar uma chamada de LLM.
      // A mensagem oferece as DUAS saídas reais (voltar quando medido / projeto especial) —
      // ver a nota do módulo sobre por que isto não é um beco sem saída.
      reask = {
        type: "question",
        content: mensagemGanhoProjetado(faseGanhoReal),
        fase: faseGanhoReal,
        coletado: estado.coletado,
        saving: estado.saving,
        receita: estado.receita,
      };
    } else if (novo === "real") {
      history.push({ role: "user", content: nudgeGanhoRealConfirmado(racional) });
    } else {
      history.push({ role: "user", content: NUDGE_GANHO_REAL_SEM_RESPOSTA });
    }
  } else if (gateBaseHoras && estado.saving.jornada_base === "pendente") {
    // (1) Turno de resposta à JORNADA (dias úteis × fim de semana).
    const resp = interpretarJornada(data.content, data.selected_option ?? null);
    if (resp === null) {
      log(
        "enviarMensagem",
        "Jornada-base: resposta ambígua — re-perguntando (dias úteis × fim de semana)",
      );
      reask = {
        type: "options",
        question: perguntaJornada(),
        options: OPCOES_JORNADA,
        fase: "saving",
        coletado: estado.coletado,
        saving: { ...estado.saving, jornada_base: "pendente" },
        receita: estado.receita,
      };
    } else {
      log("enviarMensagem", `Jornada-base: usuário respondeu "${resp}"`);
      estado.saving = { ...estado.saving, jornada_base: resp };
      history.push({
        role: "user",
        content: resp === "fim_de_semana" ? NUDGE_JORNADA_FIMSEMANA : NUDGE_JORNADA_UTIL,
      });
    }
  } else if (gateBaseHoras && estado.saving.teto_pessoa === "pendente") {
    // (2) Turno de resposta ao TETO por pessoa (uma pessoa só × várias unidades).
    const cap = tetoPorJornada(estado.saving.jornada_base);
    const resp = interpretarTetoPessoa(data.content, data.selected_option ?? null);
    if (resp === null) {
      log("enviarMensagem", "Teto-pessoa: resposta ambígua — re-perguntando");
      reask = {
        type: "options",
        question: perguntaTetoPessoa(linhasAcimaDoTeto(estado.saving.linhas, cap), cap),
        options: OPCOES_TETO,
        fase: "saving",
        coletado: estado.coletado,
        saving: { ...estado.saving, teto_pessoa: "pendente" },
        receita: estado.receita,
      };
    } else if (resp === "multiplo") {
      log("enviarMensagem", "Teto-pessoa: usuário confirmou VÁRIAS unidades — liberado");
      estado.saving = { ...estado.saving, teto_pessoa: "multiplo" };
      history.push({ role: "user", content: NUDGE_TETO_MULTIPLO });
    } else {
      // 'pessoa' → uma pessoa só acima do teto é impossível: reset e exige reconciliação.
      log("enviarMensagem", "Teto-pessoa: uma pessoa só acima do teto — exigindo reconciliação");
      estado.saving = { ...estado.saving, teto_pessoa: null };
      history.push({ role: "user", content: nudgeTetoPessoa(cap) });
    }
  } else if (gateAlocacao && estado.saving.alocacao_ganhos === "pendente") {
    // (4) Turno de resposta à ALOCAÇÃO DE GANHOS ("pra onde foi o tempo liberado"). Se a
    // resposta vier VAGA (respostaAlocacaoVaga — a família "outras atividades/sobra tempo"),
    // repergunta FIRME uma vez ('reperguntado'); senão captura o racional e injeta o nudge
    // para o LLM escrever a Seção 2.4 a partir do que o usuário disse.
    const total = totalEconomiaHoras(estado.saving);
    const unidade = unidadeHorasDe(estado.saving.tipo_saving);
    const racional = (data.content ?? "").trim();
    if (respostaAlocacaoVaga(racional)) {
      log("enviarMensagem", "Alocação de ganhos: resposta vaga — reperguntando (firme, 1x)");
      estado.saving = {
        ...estado.saving,
        alocacao_ganhos: "reperguntado",
        alocacao_ganhos_racional: racional || estado.saving.alocacao_ganhos_racional || null,
      };
      reask = {
        type: "question",
        content: perguntaAlocacaoGanhosFirme(total, unidade),
        fase: "saving",
        coletado: estado.coletado,
        saving: { ...estado.saving },
        receita: estado.receita,
      };
    } else {
      log("enviarMensagem", "Alocação de ganhos: destino informado — registrando no memorial");
      estado.saving = {
        ...estado.saving,
        alocacao_ganhos: "ok",
        alocacao_ganhos_racional: racional || null,
      };
      history.push({ role: "user", content: nudgeAlocacaoGanhos(total, unidade, racional) });
    }
  } else if (gateAlocacao && estado.saving.alocacao_ganhos === "reperguntado") {
    // (4b) Segunda resposta após a reperguntada firme. ANTI-LOOP: aceita o que vier (mesmo
    // ainda vago) — não repergunta uma 3ª vez. O nudge injeta o melhor racional disponível.
    // ⚠️ A partir daqui a rede restante é a VALIDAÇÃO HUMANA: o LLM-juiz do preview NÃO
    // interroga mais este ponto — `buildSavingPreviewPrompt` suprime o bloco de economia
    // alta quando `alocacao_ganhos` é 'ok'/'reperguntado' (anti-loop determinístico), porque
    // reinterrogar o que o gate já coletou era a origem das perguntas pós-preview.
    const total = totalEconomiaHoras(estado.saving);
    const unidade = unidadeHorasDe(estado.saving.tipo_saving);
    const racional = (data.content ?? "").trim();
    log("enviarMensagem", "Alocação de ganhos: 2ª resposta — aceitando (anti-loop) e registrando");
    estado.saving = {
      ...estado.saving,
      alocacao_ganhos: "ok",
      alocacao_ganhos_racional: racional || estado.saving.alocacao_ganhos_racional || null,
    };
    history.push({
      role: "user",
      content: nudgeAlocacaoGanhos(
        total,
        unidade,
        racional || (estado.saving.alocacao_ganhos_racional as string) || "",
      ),
    });
  } else if (faseCriterio && criterioAtual === "pendente") {
    // (5) Turno de RESPOSTA ao gate do critério de projeto ([1.3]/[1.4]). ANTI-LOOP: aceita
    // o que vier — inclusive "não sei onde conferir", que é resposta legítima (vira zona
    // cinzenta no analisador, nunca reprovação automática). Marca 'ok' e injeta o nudge
    // [SISTEMA] com o texto do usuário para o LLM escrever as seções faltantes.
    const memorialAtual =
      faseCriterio === "saving" ? estado.saving.memorial_calculo : estado.receita.memorial_calculo;
    const normalizado = normalizarMarcadoresMemorial(memorialAtual);
    const faltaProcesso = secaoProcessoVaga(extrairProcessoAlterado(normalizado));
    const faltaPonteiro = secaoPonteiroVaga(extrairPonteiroMovido(normalizado));
    const racional = (data.content ?? "").trim();
    log("enviarMensagem", `Critério de projeto (${faseCriterio}): resposta recebida — registrando`);
    if (faseCriterio === "saving") {
      estado.saving = { ...estado.saving, criterio_secoes: "ok" };
    } else {
      estado.receita = { ...estado.receita, criterio_secoes: "ok" };
    }
    // O gate perguntou o ponteiro com BOTÕES? Então a resposta pode ter vindo só como
    // classificação ("Custo (horas, headcount, contrato)"), sem dizer onde o número se
    // confere — e a seção [1.4] sairia pela metade, que é justamente a falha que originou
    // este gate. Nesse caso o nudge manda o agente completar a fonte (uma vez).
    const precisaFonte =
      (faltaPonteiro || !faltaProcesso) &&
      !respostaTrouxeFonte(racional, (data.selected_option ?? null) !== null);
    history.push({
      role: "user",
      // Se, por algum motivo, as duas seções já estiverem presentes, pedimos as duas mesmo
      // assim seria ruído — nesse caso o nudge cobre o [1.4], que é o ponto mais frágil.
      content: nudgeCriterioSecoes(
        faltaProcesso,
        faltaPonteiro || !faltaProcesso,
        racional,
        precisaFonte,
      ),
    });
  } else if (gateSobreposicao && sobreposicaoAtual === "pendente") {
    // (6) 1ª RESPOSTA ao gate de SOBREPOSIÇÃO receita × custo evitado.
    // Clique decide; texto livre cai no fallback por regex. Ambíguo → repergunta UMA vez.
    const resp = interpretarSobreposicao(data.content, data.selected_option ?? null);
    if (resp === null && detSobreposicao) {
      log(
        "enviarMensagem",
        "Sobreposição receita×custo evitado: resposta ambígua — 2ª e ÚLTIMA pergunta",
      );
      estado.receita = { ...estado.receita, sobreposicao_custo_evitado: "reperguntado" };
      reask = {
        type: "options",
        question: perguntaSobreposicaoFirme(detSobreposicao),
        options: OPCOES_SOBREPOSICAO,
        fase: "receita",
        coletado: estado.coletado,
        saving: estado.saving,
        receita: { ...estado.receita, sobreposicao_custo_evitado: "reperguntado" },
      };
    } else {
      const decisao = resp ?? "nao_respondido";
      log(
        "enviarMensagem",
        `Sobreposição receita×custo evitado: decisão "${decisao}" — encerrando o gate`,
      );
      estado.receita = { ...estado.receita, sobreposicao_custo_evitado: decisao };
      history.push({
        role: "user",
        content:
          decisao === "confirmado" ? NUDGE_SOBREPOSICAO_CONFIRMADO : NUDGE_SOBREPOSICAO_AJUSTAR,
      });
    }
  } else if (gateSobreposicao && sobreposicaoAtual === "reperguntado") {
    // (6b) 2ª resposta. ⚠️ ANTI-LOOP DURO: aceita o que vier. Ambíguo de novo →
    // 'nao_respondido' (libera + marca para a triagem). NUNCA uma terceira pergunta.
    const resp = interpretarSobreposicao(data.content, data.selected_option ?? null);
    const decisao = resp ?? "nao_respondido";
    log(
      "enviarMensagem",
      `Sobreposição receita×custo evitado: 2ª resposta "${decisao}" — encerrado (anti-loop)`,
    );
    estado.receita = { ...estado.receita, sobreposicao_custo_evitado: decisao };
    history.push({
      role: "user",
      content:
        decisao === "confirmado"
          ? NUDGE_SOBREPOSICAO_CONFIRMADO
          : decisao === "ajustar"
            ? NUDGE_SOBREPOSICAO_AJUSTAR
            : NUDGE_SOBREPOSICAO_SEM_RESPOSTA,
    });
  } else if (
    gateCustoEvitadoChat &&
    (custoEvitadoChatAtual === "pendente" || custoEvitadoChatAtual === "reperguntado")
  ) {
    // (7) Turno de RESPOSTA ao gate do CUSTO EVITADO declarado no chat. ANTI-LOOP por
    // construção: 'pendente' → ambíguo → 'reperguntado' → qualquer resposta cai em estado
    // TERMINAL. Nunca uma terceira pergunta.
    const racional = (data.content ?? "").trim();
    const resp = interpretarCustoEvitadoChat(racional, data.selected_option ?? null);
    const primeiraVez = custoEvitadoChatAtual === "pendente";
    const novo: EstadoCustoEvitadoChat = resp ?? (primeiraVez ? "reperguntado" : "nao_respondido");
    estado.saving = { ...estado.saving, custo_evitado_chat: novo };
    log("enviarMensagem", `Custo evitado no chat: resposta → "${novo}"`);
    if (novo === "reperguntado" && detCustoEvitado) {
      reask = {
        type: "options",
        question: perguntaCustoEvitadoChatFirme(detCustoEvitado),
        options: OPCOES_CUSTO_EVITADO_CHAT,
        fase: "saving",
        coletado: estado.coletado,
        saving: estado.saving,
        receita: estado.receita,
      };
    } else if (novo === "pago") {
      // ⚠️ O aviso NÃO vai por nudge: quem fala é o backend, sem gastar chamada de LLM. Na
      // validação no staging (11/08/2026) o agente recebeu o nudge com as duas instruções,
      // devolveu o preview no mesmo turno com "Contratos/Serviços Evitados: N/A" e NÃO avisou
      // que o valor precisa ir ao formulário — ignorou as duas. Prompt não segura (3ª vez
      // neste repo). O nudge do memorial entra no turno SEGUINTE, no ramo (7b).
      log(
        "enviarMensagem",
        "Custo evitado no chat: gasto REAL confirmado — avisando sobre o formulário (sem LLM)",
      );
      reask = {
        type: "question",
        content: mensagemCustoEvitadoPago(detCustoEvitado?.valor ?? 0),
        fase: "saving",
        coletado: estado.coletado,
        saving: estado.saving,
        receita: estado.receita,
      };
    } else if (novo === "estimado") {
      history.push({ role: "user", content: NUDGE_CUSTO_EVITADO_ESTIMADO });
    } else {
      history.push({ role: "user", content: NUDGE_CUSTO_EVITADO_SEM_RESPOSTA });
    }
  } else if (gateCustoEvitadoChat && custoEvitadoChatAtual === "pago") {
    // (7b) Turno seguinte ao aviso determinístico: a pessoa acabou de dizer ONDE o número se
    // confere. Injeta o nudge do memorial UMA vez e fecha o gate em 'pago_registrado'.
    // ⚠️ MONOTÔNICO e de passagem única: sem o estado próprio, o nudge seria reinjetado a
    // cada turno (o LLM reescreveria a seção e repetiria o aviso para sempre).
    const racional = (data.content ?? "").trim();
    log(
      "enviarMensagem",
      "Custo evitado no chat: registrando a seção do memorial (nudge 1x) — gate encerrado",
    );
    estado.saving = { ...estado.saving, custo_evitado_chat: "pago_registrado" };
    history.push({
      role: "user",
      content: nudgeCustoEvitadoPago(detCustoEvitado?.valor ?? 0, racional),
    });
  }
  // ── PRÉ-EMPÇÃO DO GATE GANHO REAL × PROJETADO (antes de gastar a chamada de LLM) ──
  // Roda DEPOIS da cadeia de respostas (não rouba o turno de resposta de outro gate) e só
  // quando nenhum outro gate já assumiu (`reask == null`).
  //
  // ⚠️ POR QUE existe: a 1ª versão do gate só agia sobre preview/complete, espelhando o gate
  // de sobreposição — mas ali o LLM QUER previewar. Aqui, com o portão reforçado no prompt,
  // ele passa a RECUSAR e nunca chega a preview: na staging (04/08/2026) o agente negociou
  // "escolha: encerrar a submissão ou reclassificar como especial" por ~15 turnos seguidos,
  // o histórico foi de 38 a 56 mensagens e a submissão morreu em 500 — com o gate INERTE.
  // Pré-emptando, o backend faz UMA pergunta de dois botões e chega a estado terminal.
  if (
    faseGanhoReal &&
    reask === null &&
    devePreemptarPorProjecao(ganhoRealAtual, detProjecao !== null)
  ) {
    log(
      "enviarMensagem",
      `⛔ Pré-empção do gate ganho real × projetado (${faseGanhoReal}, pistas: ${detProjecao!.marcas.join(",")}) — perguntando antes do LLM`,
    );
    if (faseGanhoReal === "saving") estado.saving = { ...estado.saving, ganho_real: "pendente" };
    else estado.receita = { ...estado.receita, ganho_real: "pendente" };
    reask = {
      type: "options",
      question: perguntaGanhoReal(detProjecao!, faseGanhoReal),
      options: OPCOES_GANHO_REAL,
      fase: faseGanhoReal,
      coletado: estado.coletado,
      saving: estado.saving,
      receita: estado.receita,
    };
  }

  // NOTA: o split CARGA REAL × ESCALA NÃO tem mais gate determinístico aqui. O agente
  // conduz a pergunta no chat (buildSavingPrompt) e a rede de segurança é aplicada na
  // gravação (resolverSplitCargaEscala em submeterParaValidacao) — ver SPEC_CORRECOES.

  // Streaming: só passamos `onDelta` quando é o LLM que redige a resposta (reask === null).
  // Quando um gate assume (reask !== null), runOrchestrator nem é chamado (short-circuit do
  // `??`) e a resposta sai imediata, sem stream — como manda o §6 do plano.
  const resultado =
    reask ??
    (await runOrchestrator(
      ctx,
      history,
      estado.fase,
      estado.coletado,
      estado.saving,
      resumoProjeto,
      tiposProjeto,
      estado.receita,
      { onDelta: opts.onDelta },
    ));

  // O orquestrador adota o `saving` ecoado pelo LLM (que NÃO inclui os campos de gate).
  // Re-mescla os campos gerenciados pelo backend para que façam round-trip no estado.
  if (resultado.saving) {
    resultado.saving = {
      ...resultado.saving,
      jornada_base: estado.saving.jornada_base ?? null,
      teto_pessoa: estado.saving.teto_pessoa ?? null,
      // Split carga real × escala: o LLM às vezes omite campos já coletados num turno
      // posterior (igual ao memorial). Mantém o valor anterior quando não reenviado, para
      // o split que o AGENTE capturou não sumir entre o preview e o complete. (A pergunta
      // é conduzida pelo agente; a rede conservadora é aplicada na gravação.)
      horas_carga_real: resultado.saving.horas_carga_real ?? estado.saving.horas_carga_real ?? null,
      horas_escala: resultado.saving.horas_escala ?? estado.saving.horas_escala ?? null,
      // Gate da alocação de ganhos (Seção 2.4): backend-only, nunca ecoado pelo LLM.
      alocacao_ganhos: estado.saving.alocacao_ganhos ?? null,
      alocacao_ganhos_racional:
        (resultado.saving.alocacao_ganhos_racional as string | null | undefined) ??
        estado.saving.alocacao_ganhos_racional ??
        null,
      // Gate do critério de projeto ([1.3]/[1.4]): backend-only, nunca ecoado pelo LLM.
      criterio_secoes: estado.saving.criterio_secoes ?? null,
      // Gate ganho real × projetado: backend-only. Perder isto no round-trip re-armaria o
      // gate a cada turno — o loop clássico.
      ganho_real: estado.saving.ganho_real ?? null,
      // Gate do custo evitado declarado no chat: backend-only, nunca ecoado pelo LLM (mesmo
      // motivo — perder no round-trip re-armaria o gate a cada turno).
      custo_evitado_chat: estado.saving.custo_evitado_chat ?? null,
    };
  }
  // Mesmo re-merge no lado da RECEITA — sem isto o 'ok' do gate do critério se perderia a
  // cada turno (o LLM não ecoa o campo) e a pergunta voltaria: o loop que a lição do split
  // carga×escala mandou nunca repetir.
  if (resultado.receita) {
    resultado.receita = {
      ...resultado.receita,
      criterio_secoes: estado.receita.criterio_secoes ?? null,
      // Gate da sobreposição receita × custo evitado: backend-only, nunca ecoado pelo LLM.
      // Perder isto no round-trip re-armaria o gate a cada turno — o loop clássico.
      sobreposicao_custo_evitado: estado.receita.sobreposicao_custo_evitado ?? null,
      // Gate ganho real × projetado: backend-only, nunca ecoado pelo LLM (mesmo motivo).
      ganho_real: estado.receita.ganho_real ?? null,
    };
  }

  // ── SAFETY NET: memorial_calculo no objeto saving/receita ──────────────────
  // O LLM às vezes coloca o memorial apenas no campo "content" e deixa
  // saving.memorial_calculo / receita.memorial_calculo como null no JSON.
  // Isso faz o memorial virar "-" na planilha. Extraímos do content como fallback.
  if (
    (resultado.type === "preview" || resultado.type === "complete") &&
    resultado.type !== "options"
  ) {
    const conteudoMsg = (resultado as { content?: string }).content ?? "";
    const memorialTexto = conteudoMsg.replace(/\n+Está correto\?[\s\S]*$/, "").trim();
    if (memorialTexto.length > 50) {
      if (
        (estado.fase === "saving" || estado.fase === "saving_preview") &&
        resultado.saving &&
        !resultado.saving.memorial_calculo
      ) {
        resultado.saving = { ...resultado.saving, memorial_calculo: memorialTexto };
        log(
          "enviarMensagem",
          "memorial_calculo (saving) extraído do content — LLM não populou o campo",
        );
      }
      if (
        (estado.fase === "receita" || estado.fase === "receita_preview") &&
        resultado.receita &&
        !resultado.receita.memorial_calculo
      ) {
        resultado.receita = { ...resultado.receita, memorial_calculo: memorialTexto };
        log(
          "enviarMensagem",
          "memorial_calculo (receita) extraído do content — LLM não populou o campo",
        );
      }
    }
  }

  // ── VALIDAÇÃO ANTI-ZERO: safety net hardcoded ──────────────────────────────
  // Mesmo com prompts instruindo a IA, o LLM pode gerar complete/preview com
  // economia ou receita zeradas. Interceptamos aqui e forçamos volta à coleta.
  // Mutamos o resultado direto — são objetos locais, sem risco de side-effect.
  if (resultado.type === "complete") {
    // Saving: NÃO pode completar sem NENHUM ganho. O ganho válido vem de horas OU
    // de um custo evitado — então só bloqueamos quando 0h E sem custo evitado.
    // Exceção explícita: custo evitado PURO (alguem_fazia='externo') — o ganho é o
    // contrato cancelado (0h por design), validado no submit; não bloqueia por 0h.
    if (
      tiposProjeto.includes("saving") &&
      (estado.fase === "saving_preview" || estado.fase === "saving")
    ) {
      const savingRecomputado = recomputarSavingFinanceiro(resultado.saving, 0);
      const econHoras = savingRecomputado.economia_horas_mes ?? 0;
      const temCustoEvitado = (savingRecomputado.custo_evitado_reais ?? 0) > 0;
      const custoEvitadoPuro = ctx.alguem_fazia === "externo";
      if (econHoras <= 0 && !temCustoEvitado && !custoEvitadoPuro) {
        log(
          "enviarMensagem",
          `⛔ Saving sem ganho (0h e sem custo evitado) — bloqueando complete, forçando question`,
        );
        Object.assign(resultado, {
          type: "question",
          content:
            "Não consigo finalizar o memorial sem nenhum ganho concreto — o projeto precisa economizar horas OU evitar um custo externo (contrato/serviço/licença). Vamos revisar: onde exatamente está o ganho?",
          fase: "saving",
        });
      }
    }

    // Receita: valor_ganho_mensal NUNCA pode ser 0 ao completar
    if (
      tiposProjeto.includes("receita_incremental") &&
      (estado.fase === "receita_preview" || estado.fase === "receita")
    ) {
      const ganho = resultado.receita?.valor_ganho_mensal ?? 0;
      if (ganho <= 0) {
        log(
          "enviarMensagem",
          `⛔ Receita com valor_ganho_mensal=${ganho} — bloqueando complete, forçando question`,
        );
        Object.assign(resultado, {
          type: "question",
          content:
            "Não consigo finalizar o memorial com ganho de R$ 0 — se o projeto gera receita incremental, preciso de um valor concreto. Vamos revisar: qual é o ganho real de receita que o projeto gera?",
          fase: "receita",
        });
      }
    }
  }

  // ── BACKSTOP RECLASSIFICAÇÃO: receita que na verdade é SAVING não vira preview/complete ──
  // Quando o agente conclui que "não é receita incremental" (o ganho é economia operacional,
  // não receita nova), o certo é PARAR e mandar reclassificar o projeto como saving — não
  // coletar saving no slot de receita e completar como se fosse receita (foi o que aconteceu no
  // legado-260). Prompt sozinho não segura (o LLM "ajuda" e completa mesmo assim), então o
  // backend bloqueia o preview/complete da receita quando o memorial está marcado como
  // não-receita ("não aplicável para receita" / "## Memorial de Saving" / "reclassificado como
  // saving") e devolve uma pergunta-guia, mantendo a fase em 'receita'. Roda também sobre o
  // type=question (não só preview/complete): se o agente escreveu o memorial saving-shaped no
  // objeto receita num turno qualquer, já redireciona. Ver SPEC_CORRECOES.md (legado-260).
  if (
    (estado.fase === "receita" || estado.fase === "receita_preview") &&
    resultado.type !== "options" &&
    receitaMemorialEhSaving(resultado.receita?.memorial_calculo as string | null | undefined)
  ) {
    log(
      "enviarMensagem",
      "⛔ Receita cujo memorial é saving/não-aplicável — bloqueando e pedindo reclassificação para saving",
    );
    Object.assign(resultado, {
      type: "question",
      content: MSG_RECLASSIFICAR_RECEITA,
      fase: "receita",
      // Zera o memorial saving-shaped para (a) não re-disparar o backstop no próximo turno e
      // (b) não persistir um memorial de saving dentro do objeto receita.
      receita: {
        ...((resultado.receita ?? estado.receita) as ReceitaColetada),
        memorial_calculo: null,
      },
    });
    delete (resultado as { options?: unknown }).options;
  }

  // ── GATE GANHO REAL × PROJETADO — força a pergunta antes de QUALQUER preview ──
  // Roda PRIMEIRO entre os gates de bloqueio: é a premissa mais externa (a Etapa 1 declarou
  // que o projeto já está em produção). Não faz sentido validar jornada, teto ou base de
  // cálculo de um ganho que ainda não aconteceu — e um gate por turno é a convenção daqui.
  //
  // ⚠️ ESTADO LIDO AGORA, NUNCA o `ganhoRealAtual` do topo do turno: o ramo de resposta
  // acima já mudou o estado DENTRO deste mesmo turno, e reler o snapshot é literalmente o
  // loop de 38 perguntas do gate [1.4] (03/08/2026).
  //
  // ⚠️ A detecção também roda sobre o memorial QUE O LLM ACABOU DE ESCREVER (não só sobre o
  // estado de entrada): o caso de origem confessou a projeção DENTRO do memorial no MESMO
  // turno em que gerou o preview — sem reler o resultado, o gate passaria ao largo.
  const ganhoRealResolvidoAgora = (
    faseGanhoReal === "saving"
      ? (resultado.saving ?? estado.saving)
      : (resultado.receita ?? estado.receita)
  )?.ganho_real;
  if (faseGanhoReal && deveBloquearPorProjecao(ganhoRealResolvidoAgora, resultado.type)) {
    const alvo =
      faseGanhoReal === "saving"
        ? (resultado.saving ?? estado.saving)
        : (resultado.receita ?? estado.receita);
    const det =
      faseGanhoReal === "saving"
        ? detectarGanhoProjetado(textosParaDeteccaoSaving(alvo as SavingColetado, falasUsuarioFase))
        : detectarGanhoProjetado(
            textosParaDeteccaoReceita(alvo as ReceitaColetada, falasUsuarioFase),
          );
    if (ganhoRealResolvidoAgora === "projetado") {
      // Já confirmado como expectativa: o preview segue bloqueado (a função do gate).
      log(
        "enviarMensagem",
        `⛔ Preview de ${faseGanhoReal} com ganho PROJETADO confirmado — bloqueando`,
      );
      Object.assign(resultado, {
        type: "question",
        content: mensagemGanhoProjetado(faseGanhoReal),
        fase: faseGanhoReal,
      });
      delete (resultado as { options?: unknown }).options;
    } else if (det ?? detProjecao) {
      // Há pista de projeção e o gate ainda não foi respondido → pergunta (1ª vez).
      const detalhe = (det ?? detProjecao)!;
      log(
        "enviarMensagem",
        `⛔ Preview de ${faseGanhoReal} com linguagem de ganho projetado (${detalhe.marcas.join(",")}) — forçando pergunta`,
      );
      const estadoGate =
        faseGanhoReal === "saving"
          ? { saving: { ...(alvo as SavingColetado), ganho_real: "pendente" as const } }
          : { receita: { ...(alvo as ReceitaColetada), ganho_real: "pendente" as const } };
      Object.assign(resultado, {
        type: "options",
        question: perguntaGanhoReal(detalhe, faseGanhoReal),
        options: OPCOES_GANHO_REAL,
        fase: faseGanhoReal,
        ...estadoGate,
      });
      delete (resultado as { content?: unknown }).content;
    } else {
      // Nenhuma pista: o gate NÃO se aplica a este projeto. Marca 'real' para não reavaliar a
      // cada turno (e para o `deveBloquearPorProjecao` liberar de imediato). ⚠️ Não confundir
      // com o 'real' CONFIRMADO pelo usuário — aqui é ausência de sinal, não afirmação dele.
      if (faseGanhoReal === "saving" && resultado.saving) {
        resultado.saving = { ...resultado.saving, ganho_real: "real" };
      } else if (faseGanhoReal === "receita" && resultado.receita) {
        resultado.receita = { ...resultado.receita, ganho_real: "real" };
      }
    }
  }

  // ── GATE JORNADA-BASE — força a pergunta antes do 1º preview ────────────────
  // Se o saving está em escopo e a jornada ainda NÃO foi definida, não deixamos o
  // preview/complete passar: trocamos por a pergunta (com botões) que indica a base
  // de 220h e pergunta sobre trabalho de fim de semana, mantendo a fase em 'saving'.
  // Preserva o `saving` recém-trabalhado pelo LLM (linhas/memorial), só marcando
  // jornada_base='pendente'. (gateBaseHoras só checa fase+escopo; "ainda não definida"
  // é o == null abaixo.)
  if (
    gateBaseHoras &&
    estado.saving.jornada_base == null &&
    (resultado.type === "preview" || resultado.type === "complete")
  ) {
    log(
      "enviarMensagem",
      "⛔ Preview/complete do saving sem a jornada-base definida — forçando pergunta (dias úteis × fim de semana)",
    );
    const savingComFlag: SavingColetado = {
      ...((resultado.saving ?? estado.saving) as SavingColetado),
      jornada_base: "pendente",
    };
    Object.assign(resultado, {
      type: "options",
      question: perguntaJornada(),
      options: OPCOES_JORNADA,
      fase: "saving",
      saving: savingComFlag,
    });
    delete (resultado as { content?: string }).content;
  }

  // ── GATE TETO POR PESSOA — bloqueia preview com linha acima do teto ─────────
  // Roda DEPOIS da jornada (que define o teto: 220h dias úteis / 300h fim de semana).
  // Se alguma LINHA tem horas_antes acima do teto e o usuário ainda NÃO confirmou que
  // ela soma várias pessoas/unidades, não deixa o preview/complete passar: força a
  // pergunta (uma pessoa × várias unidades). 'multiplo' libera; senão, exige reconciliar.
  const jornadaDefinida =
    estado.saving.jornada_base === "dias_uteis" || estado.saving.jornada_base === "fim_de_semana";
  if (
    gateBaseHoras &&
    jornadaDefinida &&
    estado.saving.teto_pessoa !== "multiplo" &&
    (resultado.type === "preview" || resultado.type === "complete")
  ) {
    const cap = tetoPorJornada(estado.saving.jornada_base);
    const linhasAtuais = (resultado.saving?.linhas ??
      estado.saving.linhas) as SavingColetado["linhas"];
    const excedentes = linhasAcimaDoTeto(linhasAtuais, cap);
    if (excedentes.length) {
      log(
        "enviarMensagem",
        `⛔ Preview do saving com linha acima do teto de ${cap}h/pessoa (${excedentes.map((l) => `${l.cargo}:${l.horas_antes}h`).join(", ")}) — forçando pergunta (uma pessoa × várias unidades)`,
      );
      const savingComFlag: SavingColetado = {
        ...((resultado.saving ?? estado.saving) as SavingColetado),
        teto_pessoa: "pendente",
      };
      Object.assign(resultado, {
        type: "options",
        question: perguntaTetoPessoa(excedentes, cap),
        options: OPCOES_TETO,
        fase: "saving",
        saving: savingComFlag,
      });
      delete (resultado as { content?: string }).content;
    }
  }

  // NOTA: aqui existia o GATE SPLIT CARGA REAL × ESCALA que BLOQUEAVA o preview e
  // re-perguntava o nº da carga real à força. Removido (jul/2026): descartar o preview
  // do agente e repetir a mesma pergunta gerava o loop reportado na edição. Agora o
  // agente conduz o split no chat (buildSavingPrompt) e a rede conservadora entra na
  // gravação (resolverSplitCargaEscala em submeterParaValidacao). Ver SPEC_CORRECOES.

  // ── GATE ALOCAÇÃO DE GANHOS (Seção 2.4) — força a pergunta antes do preview ──
  // Roda por ÚLTIMO (após jornada/teto/split) e só quando o resultado ainda é preview/
  // complete (um gate de cada vez). Se o LLM JÁ escreveu uma Seção 2.4 CONCRETA no
  // memorial (extrairAlocacaoGanhos + !respostaAlocacaoVaga), libera direto (marca 'ok');
  // senão BLOQUEIA e pergunta pra onde foi o tempo. Garante que a informação SEMPRE seja
  // coletada do USUÁRIO, em vez de o LLM inventar o boilerplate vago (bug do Gostream).
  if (
    gateAlocacao &&
    estado.saving.alocacao_ganhos !== "ok" &&
    (resultado.type === "preview" || resultado.type === "complete")
  ) {
    const savingAtual = (resultado.saving ?? estado.saving) as SavingColetado;
    const total = totalEconomiaHoras(savingAtual);
    const secao = extrairAlocacaoGanhos(normalizarMarcadoresMemorial(savingAtual.memorial_calculo));
    if (secao && !respostaAlocacaoVaga(secao)) {
      // O LLM já produziu uma justificativa concreta — não precisa perguntar de novo.
      log(
        "enviarMensagem",
        "Alocação de ganhos: Seção 2.4 concreta presente no memorial — liberado",
      );
      resultado.saving = { ...savingAtual, alocacao_ganhos: "ok" };
    } else {
      log(
        "enviarMensagem",
        `⛔ Preview do saving (${total}h/mês) sem a alocação de ganhos concreta — forçando pergunta (pra onde foi o tempo)`,
      );
      Object.assign(resultado, {
        type: "question",
        content: perguntaAlocacaoGanhos(total, unidadeHorasDe(savingAtual.tipo_saving)),
        fase: "saving",
        saving: { ...savingAtual, alocacao_ganhos: "pendente" },
      });
      delete (resultado as { options?: unknown }).options;
    }
  }

  // ── GATE CRITÉRIO DE PROJETO ([1.3]/[1.4]) — força a pergunta antes do preview ──
  // Roda por ÚLTIMO, depois de todos os gates de saving, e só quando o resultado AINDA é
  // preview/complete (um gate por turno). Vale para saving (inclusive custo evitado puro) e
  // para receita. Se as duas seções já estão escritas e com substância, libera direto
  // (marca 'ok'); senão bloqueia e pergunta UMA vez só (anti-loop) — na volta, o turno de
  // resposta acima marca 'ok' aconteça o que acontecer.
  //
  // ⚠️ ESTADO LIDO AGORA, NUNCA o `criterioAtual` do topo do turno. `criterioAtual` é um
  // snapshot tirado ANTES do turno de resposta rodar; usá-lo aqui foi o LOOP DE 38
  // PERGUNTAS reproduzido em prod (03/08/2026, projeto 471dd0c9…): no mesmo turno, o ramo
  // de resposta marcava 'ok' no estado e o gate logo abaixo relia o snapshot — ainda
  // 'pendente' — e RE-ARMAVA 'pendente', anulando o próprio anti-loop descrito acima.
  // Quem respondia honestamente "não há indicador" nunca saía: a submissão morria em 500
  // ("sem ganho mensurável"), porque a fase financeira jamais completava. Escapava só quem
  // tinha um painel para citar — texto longo o bastante para passar em `secaoPonteiroVaga`.
  const criterioResolvido =
    faseCriterio === "saving"
      ? ((resultado.saving ?? estado.saving).criterio_secoes ?? null)
      : ((resultado.receita ?? estado.receita).criterio_secoes ?? null);
  if (faseCriterio && deveBloquearPorCriterio(criterioResolvido, resultado.type)) {
    const alvo = (
      faseCriterio === "saving"
        ? (resultado.saving ?? estado.saving)
        : (resultado.receita ?? estado.receita)
    ) as { memorial_calculo?: string | null };
    const normalizado = normalizarMarcadoresMemorial(alvo.memorial_calculo);
    const faltaProcesso = secaoProcessoVaga(extrairProcessoAlterado(normalizado));
    const faltaPonteiro = secaoPonteiroVaga(extrairPonteiroMovido(normalizado));
    if (!faltaProcesso && !faltaPonteiro) {
      log(
        "enviarMensagem",
        `Critério de projeto (${faseCriterio}): seções [1.3]/[1.4] presentes — liberado`,
      );
      if (faseCriterio === "saving" && resultado.saving) {
        resultado.saving = { ...resultado.saving, criterio_secoes: "ok" };
      } else if (faseCriterio === "receita" && resultado.receita) {
        resultado.receita = { ...resultado.receita, criterio_secoes: "ok" };
      }
    } else {
      log(
        "enviarMensagem",
        `⛔ Preview de ${faseCriterio} sem as seções do critério (processo: ${faltaProcesso ? "faltando" : "ok"}, ponteiro: ${faltaPonteiro ? "faltando" : "ok"}) — forçando pergunta`,
      );
      // Botões só quando o ÚNICO buraco é o ponteiro (classificar = escolher de uma lista).
      // Com o processo faltando, a resposta precisa ser prosa — um clique fecharia o gate
      // sem a seção [1.3]. O frontend mantém o campo de texto ao lado dos botões
      // ("Selecione uma opção ou escreva sua resposta"), então quem quiser detalhar, detalha.
      // ⚠️ `formatResponse` só serializa `options` quando o type é "options" (e lê a
      // pergunta de `question`, não de `content`) — os dois ramos precisam ser coerentes,
      // senão os botões somem no caminho para a tela.
      const comBotoes = faltaPonteiro && !faltaProcesso;
      const pergunta = perguntaCriterioSecoes(faltaProcesso, faltaPonteiro);
      const estadoGate =
        faseCriterio === "saving"
          ? { saving: { ...(resultado.saving ?? estado.saving), criterio_secoes: "pendente" } }
          : { receita: { ...(resultado.receita ?? estado.receita), criterio_secoes: "pendente" } };
      if (comBotoes) {
        Object.assign(resultado, {
          type: "options",
          question: pergunta,
          options: OPCOES_PONTEIRO,
          fase: faseCriterio,
          ...estadoGate,
        });
        delete (resultado as { content?: unknown }).content;
      } else {
        Object.assign(resultado, {
          type: "question",
          content: pergunta,
          fase: faseCriterio,
          ...estadoGate,
        });
        delete (resultado as { options?: unknown }).options;
      }
    }
  }

  // ── GATE: SOBREPOSIÇÃO receita × custo evitado ─────────────────────────────
  // Roda DEPOIS do gate do critério, e só se aquele não tiver assumido o turno — um gate
  // por turno, senão o usuário leva duas perguntas de uma vez (a ordenação é a mesma do
  // saving: jornada → teto → alocação → critério).
  //
  // ⚠️ ESTADO LIDO AGORA, nunca o `sobreposicaoAtual` do topo do turno — mesma armadilha
  // que produziu o loop de 38 perguntas no gate do critério.
  //
  // ⚠️ ANTI-LOOP: o gate só pergunta quando o estado ainda NÃO é terminal. Como o ramo de
  // resposta lá em cima sempre termina em estado terminal ('confirmado'/'ajustar'/
  // 'nao_respondido') — inclusive quando a resposta é ininteligível —, o teto de DUAS
  // perguntas é estrutural, não depende de o texto do usuário ser bom o bastante.
  const sobreposicaoResolvidaAgora = (resultado.receita ?? estado.receita)
    .sobreposicao_custo_evitado;
  if (
    gateSobreposicao &&
    detSobreposicao &&
    !reask &&
    deveBloquearPorSobreposicao(sobreposicaoResolvidaAgora, resultado.type)
  ) {
    // ⚠️ MONOTÔNICO, sem exceção: null → 'pendente' → 'reperguntado' → 'nao_respondido'.
    // Nenhum ramo anda para trás. Chegar aqui já em 'reperguntado' significa que a resposta
    // do usuário foi consumida por OUTRO gate no mesmo turno (a cadeia de `else if` lá em
    // cima) — nesse caso NÃO se pergunta uma 3ª vez: encerra em 'nao_respondido', libera o
    // preview e deixa a marca para a triagem. Re-armar 'pendente' aqui era um loop de
    // verdade (o teste de simulação pegou), da mesma família do bug das 38 perguntas.
    if (sobreposicaoResolvidaAgora === "reperguntado") {
      log(
        "enviarMensagem",
        "Sobreposição receita×custo evitado: 2 perguntas já feitas e sem resposta — liberando com marca de triagem",
      );
      resultado.receita = {
        ...(resultado.receita ?? estado.receita),
        sobreposicao_custo_evitado: "nao_respondido",
      };
    } else {
      const jaPerguntou = sobreposicaoResolvidaAgora === "pendente";
      log(
        "enviarMensagem",
        `⛔ Preview de receita com sobreposição de custo evitado (via ${detSobreposicao.via}, R$ ${detSobreposicao.total}) — ${jaPerguntou ? "repergunta firme (2ª e última)" : "perguntando"}`,
      );
      Object.assign(resultado, {
        type: "options",
        question: jaPerguntou
          ? perguntaSobreposicaoFirme(detSobreposicao)
          : perguntaSobreposicao(detSobreposicao),
        options: OPCOES_SOBREPOSICAO,
        fase: "receita",
        receita: {
          ...(resultado.receita ?? estado.receita),
          sobreposicao_custo_evitado: jaPerguntou ? "reperguntado" : "pendente",
        },
      });
      delete (resultado as { content?: unknown }).content;
    }
  }

  // ── GATE: CUSTO EVITADO DECLARADO NO CHAT ──────────────────────────────────
  // Roda por ÚLTIMO na fase de saving e só se nenhum outro gate assumiu o turno (`!reask`) —
  // um gate por turno. Foi exatamente aqui que o caso de origem escapou: a autora declarou
  // R$ 324.005,09 de multa e juros e o LLM devolveu PREVIEW no turno seguinte, sem perguntar
  // nada (o turno foi então consumido pelo gate da jornada, e o valor nunca mais foi tocado).
  //
  // ⚠️ ESTADO LIDO AGORA, nunca o `custoEvitadoChatAtual` do topo do turno — mesma armadilha
  // que produziu o loop de 38 perguntas no gate do critério.
  //
  // ⚠️ MONOTÔNICO: null → 'pendente' → 'reperguntado' → terminal. Chegar aqui já em
  // 'reperguntado' significa que a resposta foi consumida por OUTRO gate no mesmo turno —
  // nesse caso NÃO se pergunta uma 3ª vez: encerra em 'nao_respondido' e libera com marca de
  // triagem. Re-armar 'pendente' aqui seria um loop de verdade.
  const custoEvitadoChatAgora = (resultado.saving ?? estado.saving).custo_evitado_chat;
  if (
    gateCustoEvitadoChat &&
    detCustoEvitado &&
    !reask &&
    deveBloquearPorCustoEvitadoChat(custoEvitadoChatAgora, resultado.type)
  ) {
    if (custoEvitadoChatAgora === "reperguntado") {
      log(
        "enviarMensagem",
        "Custo evitado no chat: 2 perguntas já feitas e sem resposta — liberando com marca de triagem",
      );
      resultado.saving = {
        ...(resultado.saving ?? estado.saving),
        custo_evitado_chat: "nao_respondido",
      };
    } else {
      const jaPerguntou = custoEvitadoChatAgora === "pendente";
      log(
        "enviarMensagem",
        `⛔ Preview do saving com gasto evitado de R$ ${detCustoEvitado.valor} citado só no chat (pistas: ${detCustoEvitado.marcas.join(",")}) — ${jaPerguntou ? "repergunta firme (2ª e última)" : "perguntando"}`,
      );
      Object.assign(resultado, {
        type: "options",
        question: jaPerguntou
          ? perguntaCustoEvitadoChatFirme(detCustoEvitado)
          : perguntaCustoEvitadoChat(detCustoEvitado),
        options: OPCOES_CUSTO_EVITADO_CHAT,
        fase: "saving",
        saving: {
          ...(resultado.saving ?? estado.saving),
          custo_evitado_chat: jaPerguntou ? "reperguntado" : "pendente",
        },
      });
      delete (resultado as { content?: unknown }).content;
    }
  }

  // Aprovação da documentação (doc_preview → impacto): a compilação da doc é o
  // CERNE do produto e é feita pelo agente — NÃO há fallback. Compilamos e
  // salvamos ANTES de confirmar a transição. Se a IA não devolver uma doc válida
  // (mesmo após os retries internos), compilarDocumentacao lança: abortamos o
  // turno SEM persistir nada, e o usuário continua no preview podendo aprovar de
  // novo (o frontend faz rollback da mensagem e exibe o erro).
  if (
    (resultado.fase === "saving" || resultado.fase === "receita") &&
    estado.fase === "doc_preview"
  ) {
    log("enviarMensagem", "Doc aprovada — compilando documentação...");
    const doc = await compilarDocumentacao(ctx, resultado.coletado);
    // O analisador lê documentacao.conteudo, mas a doc compilada (DocumentacaoGerada)
    // NÃO inclui o sinal tem_ia_como_funcionalidade coletado na fase doc. Sem carregá-lo
    // aqui, o gate determinístico de IA do analisador nunca o enxerga (ficava sempre null)
    // e a resposta explícita do usuário perdia a precedência. Ver SPEC_COMPLEXIDADE_NIVEIS (G0).
    const docComSinais = {
      ...doc,
      tem_ia_como_funcionalidade: resultado.coletado.tem_ia_como_funcionalidade ?? null,
    };
    await upsertDocumentacao(data.projeto_id, docComSinais);
    log("enviarMensagem", "Documentação compilada e salva.");
  }

  // Turno concluído com sucesso — agora sim persiste a mensagem do usuário e a resposta.
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: "user",
    content: data.content,
    selected_option: data.selected_option ?? null,
  });

  // Se houve transição de fase (ex: doc_preview→saving), preserva a fase de
  // origem no JSON para que o Investigador agrupe a mensagem na fase correta.
  const persistido =
    resultado.fase !== estado.fase ? { ...resultado, fase_origem: estado.fase } : resultado;

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: "assistant",
    content: JSON.stringify(persistido),
    options: resultado.type === "options" ? resultado.options : null,
  });

  if (resultado.fase === "completo") {
    log("enviarMensagem", "Fluxo completo — salvando dados financeiros...");
    const docRow = await getDocumentacao(data.projeto_id);

    if (docRow) {
      const doc = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<
        string,
        unknown
      >;
      const tiposProjetoCtx = getTiposProjeto(ctx);
      if (tiposProjetoCtx.includes("saving")) {
        // R$ é sempre re-derivado das horas (o LLM pode ter reajustado horas sem
        // recalcular o valor) — ver recomputarSavingFinanceiro.
        const projetoCompleto = await getProjetoById(data.projeto_id);
        // Custos do projeto: re-deriva dos itens persistidos (fonte da verdade) para
        // o líquido abater corretamente mesmo se o LLM não ecoou o campo no turno.
        const custoProjetoMensal = custoProjetoMensalFromItens(
          projetoCompleto?.custo_projeto_itens,
        );
        if (resultado.saving && typeof resultado.saving === "object") {
          (resultado.saving as SavingColetado).custo_projeto_reais =
            custoProjetoMensal > 0 ? custoProjetoMensal : null;
        }
        doc.saving = recomputarSavingFinanceiro(
          resultado.saving,
          projetoCompleto?.custo_externo_mensal ?? 0,
        );
        avisarDivergenciaMemorialLinhas(doc.saving as SavingColetado, data.projeto_id);
      }
      if (tiposProjetoCtx.includes("receita_incremental")) doc.receita = resultado.receita;
      await upsertDocumentacao(data.projeto_id, doc);
    }

    await updateProjeto(data.projeto_id, { chat_completo: true });
  }

  const respContent2 =
    resultado.type === "options"
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content;
  console.log("\n┌─────────────────────────────────────────────");
  console.log(`│ 💬 TURNO DE CONVERSA`);
  console.log(`│ 🔄 Fase: ${estado.fase} → ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(
    `│ 📊 Progresso: ${progressoPorFase(resultado.fase, resultado.coletado, resultado.saving, resultado.receita ?? receitaVazia())}`,
  );
  console.log("│ 👤 Usuário:");
  data.content.split("\n").forEach((line: string) => console.log(`│    ${line}`));
  console.log("│ 🤖 IA:");
  respContent2.split("\n").forEach((line: string) => console.log(`│    ${line}`));
  if (resultado.type === "options") {
    console.log(`│ 📋 Opções: ${(resultado as { options: string[] }).options.join(" | ")}`);
  }
  console.log("└─────────────────────────────────────────────\n");

  return formatResponse(resultado);
}

// ─── Iniciar fase saving ─────────────────────────────────────────────────────

export async function iniciarSaving(
  rawData: unknown,
  solicitanteEmail?: string | null,
  opts: { onDelta?: (chunk: string) => void } = {},
) {
  const data = iniciarSavingSchema.parse(rawData);
  log("iniciarSaving", `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  // Reinício limpo: se a pessoa voltou ao formulário determinístico e reenviou,
  // descarta a conversa anterior da fase saving (ancorada nos números antigos).
  // No primeiro início é no-op (ainda não há mensagens após o marcador).
  await deleteChatMessagesAfterFaseMarker(data.projeto_id, "saving");

  // Persiste no projeto se havia trabalho manual antes (coluna mapeada no n8n/SQL).
  if (data.alguem_fazia) {
    await updateProjeto(data.projeto_id, { alguem_fazia: data.alguem_fazia });
  }

  // Custo evitado: agrega a lista de ferramentas evitadas vinda do formulário.
  // Soma cada item pelo valor CHEIO (pontual e mensal, sem ÷12) → valor único que
  // soma ao saving. Persiste sim/não, justificativa concatenada e o detalhe (JSON)
  // no projeto (colunas mapeadas no n8n/planilha).
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const itensEvitado = data.tem_custo_evitado === "sim" ? (data.custo_evitado_itens ?? []) : [];
  const custoEvitadoMensal = round2(itensEvitado.reduce((s, it) => s + it.valor, 0));
  // Justificativa do custo evitado = TODAS as informações que a pessoa preencheu
  // na etapa, uma ferramenta por linha: nome + custo (R$ + recorrência) + a
  // justificativa/explicação que ela deu. (O valor R$ TOTAL fica na coluna "Custo
  // Evitado"; aqui é o detalhamento por ferramenta.)
  const moedaBR = (n: number) => n.toFixed(2).replace(".", ",");
  const custoEvitadoDescricao = itensEvitado
    .map((it) => {
      const rec = it.recorrencia === "pontual" ? "pontual" : "mensal";
      const just = it.justificativa?.trim() ? ` ${it.justificativa.trim()}` : "";
      return `• ${it.nome} — R$ ${moedaBR(it.valor)} (${rec}).${just}`;
    })
    .join("\n");

  // Custos do projeto: serviços externos PAGOS que a solução consome pra rodar.
  // Mesma soma do custo evitado (pontual e mensal pelo valor cheio, sem ÷12), mas
  // SUBTRAI do saving (custo incorrido pra operar). Persiste sim/não + justificativa + itens.
  const itensProjeto = data.tem_custo_projeto === "sim" ? (data.custo_projeto_itens ?? []) : [];
  const custoProjetoMensal = round2(itensProjeto.reduce((s, it) => s + it.valor, 0));
  const custoProjetoDescricao = itensProjeto
    .map((it) => {
      const rec = it.recorrencia === "pontual" ? "pontual" : "mensal";
      const just = it.justificativa?.trim() ? ` ${it.justificativa.trim()}` : "";
      return `• ${it.nome} — R$ ${moedaBR(it.valor)} (${rec}).${just}`;
    })
    .join("\n");

  await updateProjeto(data.projeto_id, {
    custo_evitado: data.tem_custo_evitado ?? null,
    custo_evitado_justificativa: custoEvitadoDescricao || null,
    custo_evitado_itens: JSON.stringify(itensEvitado),
    // Persiste o custo externo (custo INCORRIDO pela automação) no projeto. Sem
    // isto o valor só vivia em memória e se perdia: o submit relê
    // projeto.custo_externo_mensal (null → 0) e não abatia do Saving Reais.
    custo_externo_mensal: data.custo_externo_mensal ?? 0,
    custo_projeto: data.tem_custo_projeto ?? null,
    custo_projeto_justificativa: custoProjetoDescricao || null,
    custo_projeto_itens: JSON.stringify(itensProjeto),
  });

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  let saving = savingVazio();
  saving.tipo_saving = data.tipo_saving;
  // Custo externo (custo INCORRIDO pela automação) viaja no próprio objeto saving —
  // enriquecerMemorial lê daqui para mostrar o valor e abater na líquida do memorial.
  saving.custo_externo_mensal = data.custo_externo_mensal ?? 0;
  // Custo evitado já mensalizado entra cheio no recálculo (não divide de novo).
  saving.custo_evitado_reais = custoEvitadoMensal > 0 ? custoEvitadoMensal : null;
  saving.custo_evitado_tipo = custoEvitadoMensal > 0 ? "mensal" : null;
  saving.custo_evitado_descricao = custoEvitadoDescricao || null;
  // Custos do projeto já mensalizados — SUBTRAEM no recálculo do líquido.
  saving.custo_projeto_reais = custoProjetoMensal > 0 ? custoProjetoMensal : null;
  saving.custo_projeto_tipo = custoProjetoMensal > 0 ? "mensal" : null;
  saving.custo_projeto_descricao = custoProjetoDescricao || null;

  if (tiposProjeto.includes("saving") && data.linhas && data.linhas.length > 0) {
    const linhas: SavingLinha[] = data.linhas.map((l) => {
      const valorHora = CARGOS.find((c) => c.label === l.cargo)?.valor_hora ?? 0;
      const economiaHoras = Math.max(0, l.horas_antes - l.horas_depois);
      return {
        cargo: l.cargo,
        horas_antes: l.horas_antes,
        horas_depois: l.horas_depois,
        valor_hora: valorHora,
        economia_horas_mes: economiaHoras,
        economia_reais_mes: round2(economiaHoras * valorHora),
      };
    });
    const totalHoras = round2(linhas.reduce((s, l) => s + l.economia_horas_mes, 0));
    const totalReaisBruto = round2(linhas.reduce((s, l) => s + l.economia_reais_mes, 0));
    const custoExterno = data.custo_externo_mensal ?? 0;

    saving = {
      ...saving,
      linhas,
      economia_horas_mes: totalHoras,
      // Líquido: horas + custo evitado (mensalizado) − custo externo − custos do
      // projeto. Mesma fórmula de recomputarSavingFinanceiro (recalcula no preview).
      economia_reais_mes: round2(
        totalReaisBruto + custoEvitadoMensal - custoExterno - custoProjetoMensal,
      ),
    };
  } else if (custoEvitadoMensal > 0 || (data.custo_externo_mensal ?? 0) > 0) {
    // Custo evitado PURO (ramo "Não → elimina gasto externo? Sim", sem horas):
    // sem linhas, o líquido vem só do custo evitado − custo externo. O submit
    // recalcula isto de qualquer forma (recomputarSavingFinanceiro); aqui é só
    // para o estado do chat já refletir o ganho (economia_reais_mes não-nulo).
    saving = {
      ...saving,
      economia_horas_mes: 0,
      economia_reais_mes: round2(custoEvitadoMensal - (data.custo_externo_mensal ?? 0)),
    };
  }

  // ── Fluxo DIRETO de liderança: memorial DETERMINÍSTICO, sem orquestrador nem gates.
  // Conferido no servidor (`podeFluxoDireto`). O memorial visível ao usuário sai do
  // formulário (sem R$); o R$ é injetado por enriquecerMemorial na submissão.
  if (data.modo_direto && (await podeFluxoDireto(solicitanteEmail))) {
    log("iniciarSaving", "Fluxo direto (liderança): memorial determinístico, sem gates.");
    const memorial = memorialDiretoSaving(saving, ctx.descricao_breve);
    saving.memorial_calculo = memorial;

    const savingVoltouDireto = await hasFormEventTipo(data.projeto_id, "saving");
    await gravarEvento(data.projeto_id, "saving", "saving", {
      voltou: savingVoltouDireto,
      fluxo_direto: true,
      tipo_saving: data.tipo_saving,
      alguem_fazia: data.alguem_fazia ?? null,
      linhas: (data.linhas ?? []).map((l) => ({
        cargo: l.cargo,
        horas_antes: l.horas_antes,
        horas_depois: l.horas_depois,
      })),
      custo_externo_mensal: data.custo_externo_mensal ?? null,
      tem_custo_evitado: data.tem_custo_evitado ?? null,
      custo_evitado_itens: itensEvitado,
      tem_custo_projeto: data.tem_custo_projeto ?? null,
      custo_projeto_itens: itensProjeto,
      economia_horas_mes: saving.economia_horas_mes ?? null,
      economia_reais_mes: saving.economia_reais_mes ?? null,
      custo_evitado_mensal: custoEvitadoMensal > 0 ? custoEvitadoMensal : null,
      custo_projeto_mensal: custoProjetoMensal > 0 ? custoProjetoMensal : null,
    });

    // Persiste doc.saving (R$ SEMPRE re-derivado das horas — fonte de verdade), igual
    // ao ramo "completo" do fluxo normal, para a submissão ter o objeto financeiro.
    const docRowDireto = await getDocumentacao(data.projeto_id);
    if (docRowDireto) {
      const doc = (parseJson<Record<string, unknown>>(docRowDireto.conteudo) ?? {}) as Record<
        string,
        unknown
      >;
      const projetoCompleto = await getProjetoById(data.projeto_id);
      const custoProjetoM = custoProjetoMensalFromItens(projetoCompleto?.custo_projeto_itens);
      saving.custo_projeto_reais = custoProjetoM > 0 ? custoProjetoM : null;
      doc.saving = recomputarSavingFinanceiro(saving, projetoCompleto?.custo_externo_mensal ?? 0);
      avisarDivergenciaMemorialLinhas(doc.saving as SavingColetado, data.projeto_id);
      await upsertDocumentacao(data.projeto_id, doc);
    }

    // Só saving → encerra aqui (chat_completo). Com receita a seguir, o frontend abre
    // o formulário de receita, que marcará o chat_completo.
    const soSaving =
      tiposProjeto.includes("saving") && !tiposProjeto.includes("receita_incremental");
    if (soSaving) await updateProjeto(data.projeto_id, { chat_completo: true });

    return {
      type: "complete" as const,
      content: memorial,
      options: null,
      fase: soSaving ? "completo" : "saving",
      isPreview: true,
      isComplete: soSaving,
      coletado: null,
      saving,
      receita: null,
    };
  }

  const msgs = await getChatMessagesExcludeRole(data.projeto_id, "doc");

  const resumoProjeto = extrairResumoProjeto(msgs ?? []);
  const estado = extrairEstado(msgs ?? []);

  const resultado = await runOrchestrator(
    ctx,
    [],
    "saving",
    estado.coletado,
    saving,
    resumoProjeto,
    tiposProjeto,
    receitaVazia(),
    { onDelta: opts.onDelta },
  );

  // Backstop determinístico — CUSTO EVITADO PURO (alguem_fazia='externo'): o ganho é
  // 100% o custo externo eliminado, então o agente NÃO pode carimbar o preview no 1º
  // turno sem argumentar. Se o LLM pulou a validação e já devolveu preview, trocamos
  // por UMA pergunta obrigatória (realidade + atribuição + escopo). O turno seguinte
  // (enviarMensagem) deixa o agente previewar já com a resposta registrada no memorial.
  // (Prompt-only não basta — o LLM tende a pular se o contexto parece claro.)
  if (ctx.alguem_fazia === "externo" && resultado.type === "preview") {
    log(
      "iniciarSaving",
      "⛔ custo evitado puro previewou no 1º turno — forçando validação (realidade/atribuição/escopo)",
    );
    Object.assign(resultado, {
      type: "question",
      fase: "saving",
      content:
        "Antes de fechar o memorial, preciso confirmar o ganho — ele vem 100% de um custo externo eliminado, então vale validar:\n" +
        "1) Esse contrato/serviço já foi DE FATO encerrado ou reduzido na prática (não algo que ainda vai acontecer)?\n" +
        "2) O encerramento foi por causa desta automação (ela assumiu o trabalho)?\n" +
        "3) O que esse contrato cobria? (ex.: quantos agentes/pessoas, qual volume de atendimentos por mês)",
    });
  }

  // Evento de timeline: valores do formulário de saving. `voltou` indica reentrada
  // (a pessoa voltou à etapa para reeditar) — já havia um evento 'saving' antes.
  const savingVoltou = await hasFormEventTipo(data.projeto_id, "saving");
  await gravarEvento(data.projeto_id, "saving", "saving", {
    voltou: savingVoltou,
    tipo_saving: data.tipo_saving,
    alguem_fazia: data.alguem_fazia ?? null,
    linhas: (data.linhas ?? []).map((l) => ({
      cargo: l.cargo,
      horas_antes: l.horas_antes,
      horas_depois: l.horas_depois,
    })),
    custo_externo_mensal: data.custo_externo_mensal ?? null,
    tem_custo_evitado: data.tem_custo_evitado ?? null,
    custo_evitado_itens: itensEvitado,
    tem_custo_projeto: data.tem_custo_projeto ?? null,
    custo_projeto_itens: itensProjeto,
    economia_horas_mes: saving.economia_horas_mes ?? null,
    economia_reais_mes: saving.economia_reais_mes ?? null,
    custo_evitado_mensal: custoEvitadoMensal > 0 ? custoEvitadoMensal : null,
    custo_projeto_mensal: custoProjetoMensal > 0 ? custoProjetoMensal : null,
  });

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: "assistant",
    content: JSON.stringify(resultado),
    options: resultado.type === "options" ? resultado.options : null,
  });

  const respContent =
    resultado.type === "options"
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content;
  console.log("\n┌─────────────────────────────────────────────");
  console.log(
    `│ 💰 INÍCIO SAVING: tipos_projeto=${tiposProjeto.join(",")}, tipo_saving=${data.tipo_saving}`,
  );
  if (data.linhas?.length)
    console.log(
      `│ 👤 Linhas: ${data.linhas.map((l) => `${l.cargo} ${l.horas_antes}→${l.horas_depois}h`).join(" | ")}`,
    );
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoSaving(resultado.saving)}`);
  console.log("│ 🤖 IA:");
  respContent.split("\n").forEach((line: string) => console.log(`│    ${line}`));
  console.log("└─────────────────────────────────────────────\n");

  return formatResponse(resultado);
}

// ─── Iniciar fase receita incremental ────────────────────────────────────────

export async function iniciarReceita(
  rawData: unknown,
  solicitanteEmail?: string | null,
  opts: { onDelta?: (chunk: string) => void } = {},
) {
  const data = iniciarReceitaSchema.parse(rawData);
  log("iniciarReceita", `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  // Reinício limpo: se a pessoa voltou ao formulário determinístico e reenviou,
  // descarta a conversa anterior da fase receita. No primeiro início é no-op.
  await deleteChatMessagesAfterFaseMarker(data.projeto_id, "receita");

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  const receita = receitaVazia();
  receita.tipo_saving = data.tipo_saving;
  receita.valor_ganho_mensal = data.valor_ganho_mensal ?? null;
  receita.racional = data.racional?.trim() || null;

  // ── Fluxo DIRETO de liderança (idem iniciarSaving): memorial de receita
  // DETERMINÍSTICO, sem orquestrador nem gates. Receita é a última fase → chat_completo.
  if (data.modo_direto && (await podeFluxoDireto(solicitanteEmail))) {
    log("iniciarReceita", "Fluxo direto (liderança): memorial determinístico, sem gates.");
    const memorial = memorialDiretoReceita(receita, ctx.descricao_breve);
    receita.memorial_calculo = memorial;

    const receitaVoltouDireto = await hasFormEventTipo(data.projeto_id, "receita");
    await gravarEvento(data.projeto_id, "receita", "receita", {
      voltou: receitaVoltouDireto,
      fluxo_direto: true,
      tipo_saving: data.tipo_saving,
      valor_ganho_mensal: data.valor_ganho_mensal ?? null,
      racional: data.racional?.trim() || null,
    });

    const docRowDireto = await getDocumentacao(data.projeto_id);
    if (docRowDireto) {
      const doc = (parseJson<Record<string, unknown>>(docRowDireto.conteudo) ?? {}) as Record<
        string,
        unknown
      >;
      doc.receita = receita;
      await upsertDocumentacao(data.projeto_id, doc);
    }
    await updateProjeto(data.projeto_id, { chat_completo: true });

    return {
      type: "complete" as const,
      content: memorial,
      options: null,
      fase: "completo",
      isPreview: true,
      isComplete: true,
      coletado: null,
      saving: null,
      receita,
    };
  }

  const msgs = await getChatMessagesExcludeRole(data.projeto_id, "doc");

  const resumoProjeto = extrairResumoProjeto(msgs ?? []);
  const estado = extrairEstado(msgs ?? []);

  const resultado = await runOrchestrator(
    ctx,
    [],
    "receita",
    estado.coletado,
    estado.saving,
    resumoProjeto,
    tiposProjeto,
    receita,
    { onDelta: opts.onDelta },
  );

  // Evento de timeline: valores do formulário de receita. `voltou` = reentrada.
  const receitaVoltou = await hasFormEventTipo(data.projeto_id, "receita");
  await gravarEvento(data.projeto_id, "receita", "receita", {
    voltou: receitaVoltou,
    tipo_saving: data.tipo_saving,
    valor_ganho_mensal: data.valor_ganho_mensal ?? null,
    racional: data.racional?.trim() || null,
  });

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: "assistant",
    content: JSON.stringify(resultado),
    options: resultado.type === "options" ? resultado.options : null,
  });

  const respContent =
    resultado.type === "options"
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content;
  console.log("\n┌─────────────────────────────────────────────");
  console.log(
    `│ 📈 INÍCIO RECEITA: tipos_projeto=${tiposProjeto.join(",")}, tipo_saving=${data.tipo_saving}, valor=${data.valor_ganho_mensal ?? "—"}, racional=${receita.racional ?? "—"}`,
  );
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoReceita(resultado.receita ?? receitaVazia())}`);
  console.log("│ 🤖 IA:");
  respContent.split("\n").forEach((line: string) => console.log(`│    ${line}`));
  console.log("└─────────────────────────────────────────────\n");

  return formatResponse(resultado);
}

// ─── Atualizar tipos do projeto ──────────────────────────────────────────────
// Permite trocar o tipo (saving / receita_incremental) durante o fluxo do agente.
// O orquestrador e a submissão final leem tipos_projeto do banco, então a troca
// no formulário precisa persistir aqui para a fase de impacto refletir a mudança.

const atualizarTiposSchema = z.object({
  projeto_id: z.string().min(1),
  tipos_projeto: z.array(z.enum(["saving", "receita_incremental"])).min(1),
});

export async function atualizarTipos(rawData: unknown) {
  const data = atualizarTiposSchema.parse(rawData);
  log("atualizarTipos", `projeto=${data.projeto_id}, tipos=${data.tipos_projeto.join(",")}`);
  // Escolher um tipo financeiro (saving/receita) significa que o projeto deixou de ser
  // ESPECIAL — é aqui que o usuário declara a natureza do impacto. Zeramos a flag no
  // mesmo ponto. Sem isso, um projeto que era especial ficava preso em especial=1: o
  // atualizarMetadados seguinte re-forçava a flag pelo estado do banco (ctxData.especial
  // === 1), reconstruía a doc especial e dava return antecipado, ignorando a troca de
  // tipo — a edição "especial → saving" subia especial de novo (col. "Especial?"=Sim).
  await updateProjeto(data.projeto_id, {
    tipos_projeto: data.tipos_projeto,
    tipo_projeto: data.tipos_projeto[0],
    especial: false,
    // Deixou de ser especial → o contexto especial não descreve mais o projeto.
    // Limpa para a coluna "Contexto do Projeto Especial" virar "—" (edição fidedigna
    // ao novo tipo). ouTraco(null) → "—" no sync.
    contexto_especial: null,
  });
  await gravarEvento(data.projeto_id, "tipos", "doc", {
    tipos_projeto: data.tipos_projeto,
  });
  return { ok: true };
}

// ─── Atualizar metadados do projeto durante o fluxo do agente ────────────────
// Pessoas voltam às etapas anteriores para corrigir contexto/arquivos/área/datas
// depois que o agente já começou. Os campos de TEXTO (descrição, nome, área,
// ferramenta, data, membros) são lidos frescos do banco a cada turno do agente
// (getProjetoContexto), então basta persisti-los aqui. Quando os ARQUIVOS mudam,
// a base da documentação muda: re-extraímos o texto, re-rodamos o extrator e
// REINICIAMOS a fase de doc (limpa a conversa) com uma nova primeira mensagem.

const atualizarMetadadosSchema = z.object({
  projeto_id: z.string().min(1),
  nome_projeto: z.string().min(1).max(200).optional(),
  area: z.string().min(1).max(100).optional(),
  ferramenta: z.string().min(1).max(200).optional(),
  // Escopo EXTERNO: a mesma edição da "ferramenta" é o nome do serviço contratado, e ele
  // tem coluna própria (alimenta o prompt do orquestrador — "solução EXTERNA contratada
  // (X)"). Sem persistir aqui, editar o serviço atualizava só `ferramenta` e o agente
  // seguia lendo o nome antigo. O `escopo` em si NÃO é editável (regra financeira).
  servico_externo: z.string().max(200).optional(),
  membros: z.array(z.string()).optional(),
  membros_papeis: membrosPapeisSchema,
  data_criacao: z.string().optional(),
  descricao_breve: z.string().max(1000).optional(),
  // Governança: o projeto usa o AI Proxy interno (gateway de IA da empresa)?
  usa_ai_proxy: z.enum(["sim", "nao"]).optional(),
  // Contrafactual (Etapa 2): quem sentiria falta ("pessoa:a@x;b@y" | "time:Fiscal;CX")
  // (o "o que piora" saiu do form em 03/08/2026). Não barra a submissão — alimenta a
  // classificação de elegibilidade do analisador. O PONTEIRO movido também saiu do form
  // (o agente conduz no memorial). NÃO reintroduzir o "o que piora" aqui.
  contrafactual_afetados: z.string().max(1200).optional(),
  // Projeto especial: contexto especial (entrada determinística da fase de doc).
  contexto_especial: z.string().max(2000).optional(),
  // Edição de projeto especial: monta a doc sem IA (buildDocEspecial) e pula o
  // orquestrador, espelhando iniciarSubmissao. Sem isso, a edição de um legado/
  // projeto marcado como especial regenerava uma doc normal pelo agente — e, no
  // caminho de reenvio direto (handleEnviarEspecial), nunca persistia documentacao,
  // fazendo o submeter-validacao quebrar com "Documentação ainda não foi gerada".
  especial: z.boolean().optional(),
  // Força reiniciar a documentação reusando os arquivos já enviados (sem novo upload).
  // Usado quando muda a entrada determinística do projeto especial (descrição/contexto).
  reset_doc: z.boolean().optional(),
  // Se enviados, substituem os arquivos e reiniciam a documentação.
  docs: z
    .array(z.object({ base64: z.string().min(1), filename: z.string().min(1) }))
    .max(5000)
    .optional(),
});

export async function atualizarMetadados(rawData: unknown) {
  const data = atualizarMetadadosSchema.parse(rawData);
  const temDocs = !!data.docs && data.docs.length > 0;
  log("atualizarMetadados", `projeto=${data.projeto_id}, docs=${temDocs ? data.docs!.length : 0}`);

  // 1. Persiste os campos de texto fornecidos (o agente lê frescos no próximo turno).
  const campos: Record<string, unknown> = {};
  if (data.nome_projeto !== undefined) campos.nome = data.nome_projeto;
  if (data.area !== undefined) campos.area = data.area;
  if (data.ferramenta !== undefined) campos.ferramenta = data.ferramenta;
  if (data.servico_externo !== undefined) campos.servico_externo = data.servico_externo;
  if (data.membros !== undefined) campos.membros = data.membros;
  if (data.membros_papeis !== undefined) campos.membros_papeis = data.membros_papeis;
  if (data.data_criacao !== undefined) campos.data_criacao_projeto = data.data_criacao;
  if (data.descricao_breve !== undefined) campos.descricao_breve = data.descricao_breve;
  if (data.usa_ai_proxy !== undefined) campos.usa_ai_proxy = data.usa_ai_proxy;
  if (data.contrafactual_afetados !== undefined)
    campos.contrafactual_afetados = data.contrafactual_afetados;
  if (data.contexto_especial !== undefined) campos.contexto_especial = data.contexto_especial;
  if (Object.keys(campos).length > 0) {
    await updateProjeto(data.projeto_id, campos);
  }

  // Evento de timeline: edição de metadados das etapas anteriores. `voltou` quando
  // a mudança reinicia a documentação (arquivos novos ou reset_doc). Só registra se
  // houve algo relevante (campos alterados, arquivos novos ou pedido de reset).
  const metadadosReset = temDocs || !!data.reset_doc;
  if (Object.keys(campos).length > 0 || metadadosReset) {
    await gravarEvento(data.projeto_id, "metadados", "doc", {
      voltou: metadadosReset,
      reset_doc: metadadosReset,
      campos: {
        nome: data.nome_projeto ?? null,
        area: data.area ?? null,
        ferramenta: data.ferramenta ?? null,
        membros: data.membros ?? null,
        // Papéis dos participantes (mapa e-mail→papel) — ver nota no evento "submissao".
        membros_papeis: data.membros_papeis ?? null,
        data_criacao: data.data_criacao ?? null,
        descricao_breve: data.descricao_breve ?? null,
        usa_ai_proxy: data.usa_ai_proxy ?? null,
        contrafactual_afetados: data.contrafactual_afetados ?? null,
        contexto_especial: data.contexto_especial ?? null,
      },
      arquivos: temDocs ? data.docs!.map((d) => d.filename) : null,
    });
  }

  // 1.5. Projeto ESPECIAL (edição): espelha iniciarSubmissao — monta a doc sem
  // nenhuma IA (buildDocEspecial) a partir da descrição + contexto especial, persiste
  // em `documentacao`, marca chat_completo e PULA o orquestrador por completo. Cobre o
  // caso de um legado (sem linha em `documentacao`) reenviado como especial: antes o
  // orquestrador gerava uma doc normal e o submit seguinte quebrava com "Documentação
  // ainda não foi gerada". Detecta `especial` pelo flag do request OU pelo estado do
  // projeto (um projeto já marcado especial continua especial mesmo sem o flag).
  const ctxData = await getProjetoContextoData(data.projeto_id);
  // Conversão "especial → normal": quando o cliente manda `especial: false` EXPLÍCITO
  // num projeto hoje marcado especial, essa é a troca para saving/receita feita na
  // edição. Zera a flag aqui também (belt-and-suspenders com atualizarTipos, cobre a
  // ordem em que metadados chega antes da troca de tipos) e NÃO toma o ramo especial.
  // ⚠️ A condição NÃO pode ser só `ctxData?.especial === 1`: no fluxo real do formulário
  // o `atualizarTipos` roda ANTES desta chamada (submeter.tsx) e já zerou a flag, então
  // o guard não disparava — e o passo 1 acima acabava de REGRAVAR o `contexto_especial`
  // que o form ainda carregava. Resultado: flag zerada, texto órfão no SQLite e na coluna
  // "Contexto do Projeto Especial" (casos "Farol de Ciência do Código de Conduta" e
  // "GoStream - Checklist Proposta", ago/2026). Por isso olhamos TAMBÉM o contexto: com
  // `especial: false` explícito, contexto especial preenchido é sempre resíduo.
  const temContextoResidual = (ctxData?.contexto_especial ?? '').trim().length > 0;
  if (data.especial === false && (ctxData?.especial === 1 || temContextoResidual)) {
    // Zera a flag E limpa o contexto especial (não descreve mais o projeto) — a coluna
    // "Contexto do Projeto Especial" vira "—" no sync. Edição fidedigna ao novo tipo.
    await updateProjeto(data.projeto_id, { especial: false, contexto_especial: null });
    log(
      "atualizarMetadados",
      `Projeto ${data.projeto_id}: convertido de especial → normal (flag + contexto especial zerados).`,
    );
  }
  // Detecta especial pelo flag do request OU pelo estado do projeto (um projeto já
  // especial continua especial mesmo sem o flag — ex.: chamadas internas/cron). ⚠️ Um
  // `especial === false` explícito QUEBRA essa stickiness (é a conversão acima).
  const ehEspecial = data.especial === true || (data.especial !== false && ctxData?.especial === 1);
  if (ehEspecial) {
    // Garante a marcação de especial no banco (cobre legado convertido em especial na
    // edição) — alinha tipo_projeto/tipos_projeto com o que iniciarSubmissao grava.
    await updateProjeto(data.projeto_id, {
      especial: true,
      tipo_projeto: "especial",
      tipos_projeto: ["especial"],
    });
    const docEspecial = buildDocEspecial({
      nome_projeto: data.nome_projeto ?? ctxData?.nome ?? "",
      responsavel_nome: ctxData?.responsavel_nome ?? "",
      responsavel_email: ctxData?.responsavel_email ?? "",
      ferramenta: data.ferramenta ?? ctxData?.ferramenta ?? "",
      membros: data.membros ?? parseJson<string[]>(ctxData?.membros ?? null) ?? [],
      descricao_breve: data.descricao_breve ?? ctxData?.descricao_breve ?? undefined,
      contexto_especial: data.contexto_especial ?? ctxData?.contexto_especial ?? undefined,
    });
    await upsertDocumentacao(data.projeto_id, docEspecial);
    await updateProjeto(data.projeto_id, { chat_completo: true });
    log(
      "atualizarMetadados",
      `Projeto especial ${data.projeto_id}: doc reconstruída sem IA, pronto para reenvio.`,
    );
    return { ok: true, reset: true };
  }

  // 2. Sem arquivos novos e sem pedido de reset → nada a reiniciar; o agente já vê
  // os metadados frescos no próximo turno.
  if (!temDocs && !data.reset_doc) {
    return { ok: true, reset: false };
  }

  // 3. Arquivos mudaram (ou reset_doc) → REINICIA a doc. ⚠️ NÃO-DESTRUTIVO: fazemos
  // TODO o trabalho que pode falhar/demorar (extração + LLM) ANTES de tocar no chat/doc
  // existentes. Só no fim, com a nova doc pronta, fazemos a troca. Assim, se a requisição
  // for cancelada (cliente saiu/timeout) ou o LLM falhar, o chat/doc ANTIGOS ficam
  // intactos — antes apagávamos primeiro, então um cancelamento deixava o projeto SEM
  // documentação e o submit seguinte quebrava com "Documentação ainda não foi gerada".
  let docTexto = "";
  if (temDocs) {
    try {
      docTexto = await extractTextFromMultipleFiles(data.docs!);
      log(
        "atualizarMetadados",
        `Texto re-extraído de ${data.docs!.length} arquivo(s): ${docTexto.length} chars`,
      );
    } catch (extractErr) {
      err("atualizarMetadados", "Erro na re-extração de texto:", extractErr);
      docTexto = "";
    }
  } else {
    const docMsg = await getDocMessage(data.projeto_id);
    docTexto = docMsg?.content ?? "";
    log("atualizarMetadados", `reset_doc — reusando texto já extraído: ${docTexto.length} chars`);
  }

  const ctx = await getProjetoContexto(data.projeto_id);

  let coletadoInicial: DocumentacaoColetada = {
    ...documentacaoVazia(),
    nome_projeto: ctx.nome_projeto,
  };
  if (docTexto || ctx.descricao_breve) {
    try {
      coletadoInicial = await extrairCamposDocumentacao(ctx, docTexto || "");
    } catch (extractorErr) {
      err("atualizarMetadados", "Extrator falhou — seguindo sem pré-preenchimento:", extractorErr);
      coletadoInicial = { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto };
    }
  }

  // Última operação que pode lançar. Se chegou aqui, a nova doc está pronta.
  const resultado = await runOrchestrator(ctx, [], "doc", coletadoInicial, savingVazio());

  // ── TROCA (só agora) — apaga o antigo e grava o novo. Sequência curta de ops de
  // banco, sem trabalho de rede no meio que possa ser cancelado deixando estado parcial.
  await deleteChatMessagesByProjeto(data.projeto_id);
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: "doc",
    content: docTexto || "(documento sem texto legível)",
  });
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: "assistant",
    content: JSON.stringify(resultado),
    options: resultado.type === "options" ? resultado.options : null,
  });
  // Nomes dos arquivos atualizados só após o sucesso da regeneração (o link do Drive
  // é gerado depois, em submeterParaValidacao).
  if (temDocs) {
    await updateProjeto(data.projeto_id, {
      arquivos_nomes: data.docs!.map((d) => d.filename),
    });
  }

  log("atualizarMetadados", `Documentação reiniciada — fase: ${resultado.fase}`);
  return { ok: true, reset: true, response: formatResponse(resultado) };
}

// ─── Analisar projeto (pré-submissão) ───────────────────────────────────────

const analisarProjetoSchema = z.object({ projeto_id: z.string().min(1) });

export async function analisarProjetoFn(rawData: unknown) {
  const { projeto_id } = analisarProjetoSchema.parse(rawData);
  log("analisarProjeto", `projeto=${projeto_id}`);

  const resultado = await analisarProjetoAgent(projeto_id);

  // Projeto especial: a decisão de status é 100% humana — o analisador só agrega
  // complexidade + parecer (observações), incl. o veredito de "é mesmo especial?".
  const projetoAtual = await getProjetoById(projeto_id);
  const ehEspecial = projetoAtual?.especial === 1;
  // Fluxo DIRETO de liderança (cargo isento): como o especial, a decisão de status é
  // humana — o analisador não reprova nem "valida" automático. Fail-to-false.
  let ehLiderAnalise = false;
  try {
    ehLiderAnalise = await ehLideranca(projetoAtual?.responsavel_email ?? "");
  } catch (e) {
    console.error("[analisarProjeto] ehLideranca falhou (seguindo sem imunidade):", e);
  }

  await insertAnalise({
    projeto_id,
    resultado: resultado.resultado,
    pontuacao_total: resultado.pontuacao_total,
    pontuacao_maxima: resultado.pontuacao_maxima,
    justificativa: resultado.justificativa,
    resumo: resultado.resumo,
    criterios_hardcoded: resultado.criterios_hardcoded,
    criterios_dinamicos: resultado.criterios_dinamicos,
    complexidade_justificativa: resultado.complexidade_justificativa,
  });

  // Parecer da análise (campo `resumo`) → coluna "Observações". É uma mensagem de
  // STAFF (pontos de atenção), NÃO exibida ao usuário no front (gerava ansiedade).
  // Sem markdown na persistência (igual ao memorial).
  const observacoes = stripMarkdown(resultado.resumo || resultado.justificativa);

  // O veredito do analisador É a decisão de status (aprovado/rejeitado) — esta é a
  // função do analisador. Grava no projeto junto com complexidade e observações,
  // para o estado ficar correto de ponta a ponta (dashboard + planilha). Vale para
  // qualquer área, inclusive RPA (o veredito pode rebaixar uma auto-aprovação).
  const statusVeredito = resultado.resultado === "aprovado" ? "aprovado" : "rejeitado";

  // Buscar documentação para calcular materialidade (teto de R$ 5k/mês)
  const docRow = await getDocumentacao(projeto_id);
  const conteudo = (parseJson<Record<string, unknown>>(docRow?.conteudo ?? "{}") ?? {}) as Record<
    string,
    unknown
  >;

  // Teto de materialidade: projetos acima de R$ 5k/mês exigem validação humana independente do veredito.
  const TETO_MATERIALIDADE_ANALISE = 5000;
  const materialidadeProjeto = calcularMaterialidade(
    conteudo.saving as Record<string, unknown> | undefined,
    conteudo.receita as Record<string, unknown> | undefined,
  );
  // Régua de CRITÉRIO DE PROJETO ("isto é projeto?") — independente da pontuação.
  // `claro_nao` VENCE o veredito (reprova); `zona_cinzenta` manda para validação
  // humana; `claro_sim` deixa o fluxo atual decidir. As invariantes (nunca reprova sem
  // motivo, especial nunca reprova, materialidade alta → humana) já foram aplicadas por
  // normalizarClassificacao dentro do analisador.
  const classificacao = resultado.classificacao_avaliacao ?? null;
  const { status: statusFinal, statusSheet } = decidirStatusSubmissao({
    classificacao,
    ehEspecial,
    fluxoDireto: ehLiderAnalise,
    materialidade: materialidadeProjeto,
    vereditoAprovado: resultado.resultado === "aprovado",
    tetoMaterialidade: TETO_MATERIALIDADE_ANALISE,
  });
  const reprovadoPorCriterio = statusSheet === "Reprovado";
  if (reprovadoPorCriterio) {
    log(
      "analisarProjeto",
      `Classificação 'claro_nao' → status rejeitado/Reprovado (analisador havia retornado '${statusVeredito}')`,
    );
  }
  if (!ehEspecial && materialidadeProjeto > TETO_MATERIALIDADE_ANALISE) {
    log(
      `Materialidade R$ ${Math.round(materialidadeProjeto)}/mês > R$ ${TETO_MATERIALIDADE_ANALISE} → status forçado para em_validacao (analisador havia retornado '${statusVeredito}')`,
    );
  }

  await updateProjeto(projeto_id, {
    complexidade: resultado.complexidade,
    observacoes,
    status: statusFinal,
    // Espelho da classificação de elegibilidade (padrão complexidade/observacoes): serve
    // ao resync, à reconciliação e à ficha do /dashboard. `motivo_reprovacao` volta a
    // null quando o reenvio deixa de ser reprovado.
    classificacao_avaliacao: resultado.classificacao_avaliacao ?? null,
    classificacao_justificativa: resultado.classificacao_justificativa ?? null,
    motivo_reprovacao: resultado.motivo_reprovacao ?? null,
    // Especial e fluxo direto de liderança não são "validados" pelo analisador — quem
    // valida é o humano; não carimba validated_at.
    ...(ehEspecial || ehLiderAnalise ? {} : { validated_at: new Date().toISOString() }),
  });

  log(
    "analisarProjeto",
    `Resultado: ${resultado.resultado} → status=${statusFinal} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`,
  );

  // ── Dispensa da fila do líder (D29) ──
  // O líder é convocado no fim da submissão, ANTES de existir veredito do analisador
  // (que roda depois, em background). Quando o veredito é reprovar por critério, o
  // parecer dele deixou de fazer sentido: fecha a fila e reflete nas 2 colunas.
  // Nunca lança (D3) e o `undefined` de saída preserva a célula quando não dispensou —
  // inclusive no caso do líder que decidiu ANTES da análise chegar.
  let aprovacaoLiderSheet: string | undefined;
  let justificativaAprovacaoLiderSheet: string | undefined;
  if (reprovadoPorCriterio) {
    try {
      const dispensa = await dispensarPreAprovacao(projeto_id);
      if (dispensa.dispensou) {
        aprovacaoLiderSheet = dispensa.rotuloSheet;
        justificativaAprovacaoLiderSheet = dispensa.justificativaSheet;
      }
    } catch (e) {
      console.error("[analisarProjeto] falha ao dispensar a fila do líder (não-fatal):", e);
    }
  }

  // ── Sync Google (planilha + chat) — fire-and-forget ──
  {
    const projeto = await getProjetoById(projeto_id);
    // TEMPORÁRIO: enquanto validamos a eficácia do formulário, projetos aprovados
    // pelo analisador também vão como "Pendente" na planilha — a aprovação
    // automática não é refletida no Sheets. O status interno (SQLite/dashboard)
    // continua correto. Reverter para 'Aprovado' quando a validação terminar.
    // ⚠️ ÚNICA EXCEÇÃO à regra TEMPORÁRIA (decisão D1, 29/07/2026): classificação
    // 'claro_nao' grava "Reprovado" — reprovar por não ser projeto é informação que
    // precisa chegar ao autor. Todo o resto continua "Pendente".
    // O rótulo vem da MESMA função pura que decidiu o status interno (não duplicar a
    // precedência aqui — foi assim que os dois já divergiram no passado).
    const statusLabel = statusSheet;

    // AGUARDADO (não fire-and-forget): assim o sync da Complexidade/Observações faz
    // parte da promise da análise. Evita o FAF aninhado que o runtime cancelava,
    // deixando a coluna "Complexidade" vazia de forma intermitente. O cron de
    // reconciliação (reconciliarComplexidade) é a rede de segurança para os casos em
    // que a própria análise é cancelada antes de concluir.
    await syncUpdateToGoogle({
      projetoId: projeto_id,
      projectName: projeto?.nome ?? "",
      complexidade: resultado.complexidade,
      observacoes: observacoes ?? "",
      status: statusLabel,
      // Colunas "Classificação" (sempre com texto) e "Motivo Reprovado". A
      // "Motivo Reenvio" é MANUAL — o sistema nunca a escreve.
      classificacao: resultado.classificacao_avaliacao ?? null,
      classificacaoJustificativa: resultado.classificacao_justificativa ?? null,
      motivoReprovacao: resultado.motivo_reprovacao ?? null,
      // D29 — só definidas quando a fila foi realmente dispensada.
      aprovacaoLider: aprovacaoLiderSheet,
      justificativaAprovacaoLider: justificativaAprovacaoLiderSheet,
    });
  }

  return resultado;
}

/**
 * Decide o que a reconciliação deve fazer com UM projeto, a partir do que está na
 * planilha e do que o SQLite tem para oferecer. Pura de propósito: é o invariante de
 * CONVERGÊNCIA do cron e precisa ser testável sem banco nem Sheets.
 *
 * ⚠️ REGRESSÃO REAL (30/07/2026) que este desenho impede — não reintroduzir:
 * quando a coluna "Classificação" entrou, o critério de "já está pronto" passou a ser
 * `Complexidade preenchida E Classificação preenchida`. Só que um projeto ANTIGO tem
 * Complexidade na planilha, Classificação vazia (coluna nova) e NADA de classificação
 * no SQLite — logo o cron o reprocessava, escrevia só a Complexidade (que já estava
 * lá), a Classificação continuava vazia e ele voltava no minuto seguinte. Para sempre.
 * Medido na staging: 109 projetos × ~1 leitura de cabeçalho por minuto contra a cota de
 * 60 leituras/min do Sheets → cota permanentemente estourada, appends de submissões
 * novas falhando com 429 e projeto purgado do SQLite após a carência de 1h.
 *
 * A regra que corrige: só age quando existe algo REALMENTE gravável (coluna vazia na
 * planilha E dado correspondente no SQLite) ou quando cabe uma re-análise (o SQLite não
 * tem nem complexidade nem classificação). Nada a fazer → `'nada'`, e o projeto NÃO
 * conta como pendente.
 */
export function decidirReconciliacaoPlanilha(args: {
  /** Célula "Complexidade" da planilha (`undefined` = projeto não está na planilha). */
  comp: string | undefined;
  /** Célula "Classificação" da planilha. */
  classif: string | undefined;
  /** `projetos.complexidade` no SQLite. */
  compSqlite: string;
  /** `projetos.classificacao_avaliacao` no SQLite. */
  classifSqlite: string;
}): { acao: "nada" | "resync" | "reanalisar"; colunas: Array<"complexidade" | "classificacao"> } {
  const { comp, classif, compSqlite, classifSqlite } = args;
  const nada = { acao: "nada" as const, colunas: [] };
  // Fora da planilha: a reconciliação não inventa linha (quem faz append é a IDA).
  if (comp === undefined) return nada;
  const vazio = (v: string | undefined) => v === undefined || v === "" || v === "—";

  const colunas: Array<"complexidade" | "classificacao"> = [];
  if (vazio(comp) && compSqlite) colunas.push("complexidade");
  if (vazio(classif) && classifSqlite) colunas.push("classificacao");
  if (colunas.length) return { acao: "resync", colunas };

  // Sem nada para repor: só vale re-analisar se o SQLite está vazio nas DUAS pontas e
  // ao menos uma das colunas da planilha está esperando dado.
  const faltaNaPlanilha = vazio(comp) || vazio(classif);
  if (faltaNaPlanilha && !compSqlite && !classifSqlite) {
    return { acao: "reanalisar", colunas: [] };
  }
  return nada;
}

// ─── Reconciliação de Complexidade/Observações (rede de segurança) ───────────
//
// A análise roda em background (waitUntil) após o submit e ocasionalmente é
// CANCELADA pelo runtime antes de gravar a Complexidade na planilha — daí a coluna
// ficar vazia "às vezes". Esta função (chamada por um cron) varre a planilha,
// acha projetos SUBMETIDOS com "Complexidade" vazia e conserta:
//  - se o SQLite já tem complexidade (só faltou o sync) → repõe na planilha SEM
//    notificar o Google Chat (update direto, evita spam);
//  - se o SQLite também não tem → re-roda o analisador (que analisa + sincroniza).
// Idempotente: rodar repetidamente é seguro. Legados sem `submitted_at` são pulados.
//
// ⚠️ A decisão de O QUE fazer com cada projeto é a função PURA
// `decidirReconciliacaoPlanilha` — leia o comentário dela antes de mexer: é ali que
// mora a garantia de que o cron CONVERGE (não repete o mesmo projeto para sempre).
export async function reconciliarComplexidade(maxReanalises = 15) {
  // Mapa id→Complexidade da planilha (1 leitura). Só os SUBMETIDOS no SQLite são
  // candidatos (evita varrer ~270 legados sem submissão).
  const rows = await readAllRows();
  const compNaPlanilha = new Map<string, string>();
  // "Classificação" tem a MESMA fragilidade da Complexidade (a análise em background
  // pode ser cancelada antes do sync) — a mesma rede de segurança vale para ela.
  const classifNaPlanilha = new Map<string, string>();
  for (const r of rows) {
    const id = (r["ID Projeto"] ?? "").toString().trim().toLowerCase();
    if (id) {
      compNaPlanilha.set(id, (r["Complexidade"] ?? "").toString().trim());
      classifNaPlanilha.set(id, (r["Classificação"] ?? "").toString().trim());
    }
  }

  const submetidos = await getProjetosSubmetidos();
  let ressincronizados = 0;
  let reanalisados = 0;
  let faltando = 0;

  for (const p of submetidos) {
    const chave = String(p.id).trim().toLowerCase();
    const compSqlite = (p.complexidade ?? "").toString().trim();
    const classifSqlite = (p.classificacao_avaliacao ?? "").toString().trim();
    // A decisão (e a garantia de convergência) mora na função pura — ver o comentário
    // dela: reprocessar quem não tem nada a receber foi o loop que estourou a cota.
    const { acao, colunas } = decidirReconciliacaoPlanilha({
      comp: compNaPlanilha.get(chave),
      classif: classifNaPlanilha.get(chave),
      compSqlite,
      classifSqlite,
    });
    if (acao === "nada") continue;
    faltando++;

    try {
      if (acao === "resync") {
        // Só faltou o sync para o Sheets: repõe direto (SEM notificar o Chat). Escreve
        // APENAS as colunas que estão vazias na planilha e têm dado no SQLite.
        const celulas: Record<string, string> = {};
        if (colunas.includes("complexidade")) {
          celulas.Complexidade = compSqlite;
          celulas.Observações = (p.observacoes as string | null)?.trim()
            ? (p.observacoes as string)
            : "—";
        }
        if (colunas.includes("classificacao")) {
          celulas["Classificação"] = derivarClassificacaoSheet(
            classifSqlite,
            p.classificacao_justificativa as string | null,
          );
          celulas["Motivo Reprovado"] = (p.motivo_reprovacao as string | null)?.trim()
            ? (p.motivo_reprovacao as string)
            : "—";
        }
        await updateRowByProjectId(p.id, celulas);
        ressincronizados++;
      } else if (reanalisados < maxReanalises) {
        // Análise nunca concluiu: re-roda (analisa + sincroniza, aguardado).
        await analisarProjetoFn({ projeto_id: p.id });
        reanalisados++;
      }
    } catch (e) {
      err("reconciliarComplexidade", `Falha ao reconciliar ${p.id}:`, e);
    }
  }

  log(
    "reconciliarComplexidade",
    `faltando=${faltando} ressincronizados=${ressincronizados} reanalisados=${reanalisados}`,
  );
  return { submetidos: submetidos.length, faltando, ressincronizados, reanalisados };
}

// ─── Submeter para validação ─────────────────────────────────────────────────

/**
 * O `contexto_especial` guardado ainda descreve ESTE projeto?
 *
 * Decisor PURO (testável sem banco): só há contexto especial legítimo em projeto
 * marcado como especial. Se a flag caiu (conversão especial → saving/receita) e o
 * texto ficou, ele é resíduo — não pode ir para a coluna "Contexto do Projeto
 * Especial" nem aparecer na tela do projeto. Texto vazio/só espaço não é resíduo.
 */
export function deveLimparContextoEspecialOrfao(
  especial: number | null | undefined,
  contextoEspecial: string | null | undefined,
): boolean {
  return especial !== 1 && (contextoEspecial ?? '').trim().length > 0;
}

/**
 * Aplica a limpeza do contexto especial órfão: zera no banco E no objeto em memória
 * (é ele que o `syncSubmitToGoogle` serializa logo em seguida). Idempotente — só age
 * quando há resíduo — e NUNCA lança: nenhuma escrita no Google pode cair por causa
 * disto. Chamada no submit e no resync, os dois pontos que reescrevem a linha inteira.
 */
async function limparContextoEspecialOrfao(
  projetoId: string,
  projeto: { especial?: number | null; contexto_especial?: string | null },
  origem: string,
): Promise<void> {
  if (!deveLimparContextoEspecialOrfao(projeto.especial, projeto.contexto_especial)) return;
  try {
    await updateProjeto(projetoId, { contexto_especial: null });
    projeto.contexto_especial = null;
    log(origem, `Projeto ${projetoId}: contexto especial órfão limpo (projeto não é mais especial).`);
  } catch (limpezaErr) {
    err(origem, "Falha ao limpar contexto especial órfão (não bloqueante):", limpezaErr);
  }
}

export async function submeterParaValidacao(rawData: unknown, solicitanteEmail?: string | null) {
  const { projeto_id, modo } = submeterValidacaoSchema.parse(rawData);
  log("submeterParaValidacao", `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw erroDeBloqueio(bloqueioDocAusente());

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<
    string,
    unknown
  >;

  const projeto = await getProjetoById(projeto_id);

  if (!projeto) throw new Error("Projeto não encontrado.");

  // Rede de segurança: re-deriva R$ das horas antes de popular colunas/planilha.
  // Garante saving_reais correto mesmo que doc.saving tenha sido salvo com R$ zerado
  // por uma versão anterior ou por um turno que não passou pelo recálculo.
  if (conteudo.saving && typeof conteudo.saving === "object") {
    // Re-deriva o custo evitado dos ITENS persistidos (fonte da verdade), em vez
    // de confiar no custo_evitado_reais que vinha do estado volátil do chat (o LLM
    // podia zerá-lo em fluxos longos — sumia o custo evitado pontual da planilha).
    const evitadoMensal = custoEvitadoMensalFromItens(projeto.custo_evitado_itens);
    (conteudo.saving as SavingColetado).custo_evitado_reais =
      evitadoMensal > 0 ? evitadoMensal : null;
    // Custos do projeto: re-deriva dos itens persistidos (fonte da verdade) e ABATE.
    const custoProjetoMensal = custoProjetoMensalFromItens(projeto.custo_projeto_itens);
    (conteudo.saving as SavingColetado).custo_projeto_reais =
      custoProjetoMensal > 0 ? custoProjetoMensal : null;
    conteudo.saving = recomputarSavingFinanceiro(
      conteudo.saving as SavingColetado,
      projeto.custo_externo_mensal ?? 0,
    );
    // Divergência memorial×gravado na submissão → card de alerta no Investigador.
    const div = avisarDivergenciaMemorialLinhas(conteudo.saving as SavingColetado, projeto_id);
    if (div) {
      await gravarEvento(projeto_id, "divergencia_memorial", "saving", {
        total_texto: div.totalTexto,
        total_gravado: div.totalGravado,
      });
    }
  }
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  // Rede silenciosa do split carga real × escala: o agente conduz a pergunta no chat (não
  // há mais gate que force), mas pode não capturar. Se o split se aplica ('sim' recorrente
  // com horas) e não veio, assume o CONSERVADOR — carga real = total, escala 0 — para as
  // colunas de transparência não ficarem vazias. NÃO bloqueia nada. Idempotente (só entra
  // quando falta o split). O sync reverso horário não passa por aqui → legados ociosos ficam
  // como estão. Ver resolverSplitCargaEscala (orchestrator.ts) e SPEC_CORRECOES.
  if (saving) {
    const split = resolverSplitCargaEscala(projeto.alguem_fazia, saving as SavingColetado);
    if (split) {
      saving.horas_carga_real = split.horas_carga_real;
      saving.horas_escala = split.horas_escala;
    }
  }
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  if (projeto.nome) {
    const duplicata = await findDuplicateProjeto(projeto.nome, projeto_id);
    if (duplicata) {
      throw erroDeBloqueio(bloqueioDuplicata(projeto.nome));
    }
  }

  // ── Derivar a ÁREA pelo email do responsável (TeamGuide) ───────────────────
  // A pessoa não escolhe mais a área no formulário — derivamos do cadastro dela
  // na TeamGuide pelo email. Se não for encontrada (raríssimo — todo mundo está
  // cadastrado lá), a área vira o aviso "ÁREA NÃO IDENTIFICADA". Em caso de falha
  // da API (indisponibilidade), preservamos a área já gravada para não perder o
  // dado durante uma queda transitória.
  const AREA_NAO_IDENTIFICADA = "ÁREA NÃO IDENTIFICADA";
  let areaFinal: string;
  try {
    const areaDerivada = await deriveAreaFromEmail(projeto.responsavel_email ?? "");
    areaFinal = areaDerivada ?? AREA_NAO_IDENTIFICADA;
    if (areaDerivada) {
      log(
        "submeterParaValidacao",
        `Área derivada da TeamGuide: "${areaDerivada}" (${projeto.responsavel_email})`,
      );
    } else {
      log(
        "submeterParaValidacao",
        `Email não encontrado na TeamGuide → "${AREA_NAO_IDENTIFICADA}" (${projeto.responsavel_email})`,
      );
    }
  } catch (tgErr) {
    err(
      "submeterParaValidacao",
      "TeamGuide indisponível ao derivar área — preservando área existente:",
      tgErr,
    );
    areaFinal = projeto.area ?? AREA_NAO_IDENTIFICADA;
  }
  projeto.area = areaFinal;

  // Projeto especial nunca auto-aprova (nem na área RPA): a validação é humana,
  // então fica sempre 'em_validacao' (→ "Pendente" na planilha) até o humano avaliar.
  const ehEspecial = projeto.especial === 1;

  // Reenvio: detectado quando o projeto já foi submetido antes (submitted_at preenchido)
  // ou quando o cliente passa modo:'edicao'. Reenvios nunca auto-aprovam — forçamos
  // sempre em_validacao para que a re-análise automática recomece do zero.
  const ehReenvio = modo === "edicao" || !!projeto.submitted_at;

  // ── Bloqueio TEMPORÁRIO de novas submissões (janela determinística) ──────────
  // Reforço de SERVIDOR: recusa apenas SUBMISSÃO NOVA (não reenvio) enquanto a
  // janela está aberta. Reenvio/edição de projeto já submetido segue normal — a
  // triagem/aprovação do que já entrou não para. O cliente também desabilita o
  // botão; isto cobre cliente desatualizado / chamada direta à API. Janela e copy
  // vêm da fonte única `src/lib/bloqueio-submissao.ts`.
  if (deveRecusarSubmissao(ehReenvio)) {
    throw erroDeBloqueio(bloqueioSubmissaoPausada());
  }

  // Gate de OWNERSHIP na edição: podem reenviar um projeto já existente o autor
  // (responsavel_email), um EDITOR DELEGADO (participante a quem o dono delegou o
  // poder) ou um admin RPA. Participante comum (membro sem delegação) só visualiza.
  // Vale só p/ reenvio; submissão nova não tem owner anterior a proteger. Se o email do
  // solicitante não veio (chamadas internas/cron), não bloqueia.
  if (ehReenvio && solicitanteEmail) {
    const alvo = solicitanteEmail.trim().toLowerCase();
    const ehOwner = (projeto.responsavel_email ?? "").trim().toLowerCase() === alvo;
    const ehAdmin = await isAdmin(solicitanteEmail);
    const membros = parseJson<string[]>(projeto.membros) ?? [];
    const ehParticipante = !ehOwner && membros.some((m) => m.trim().toLowerCase() === alvo);
    // Editor delegado = participante presente em `editores_delegados` (interseção com
    // membros). Pode reenviar como se fosse o dono.
    const delegados = parseJson<string[]>(projeto.editores_delegados) ?? [];
    const ehEditorDelegado =
      ehParticipante && delegados.some((d) => d.trim().toLowerCase() === alvo);
    // Ser participante (não-delegado) vence o override de admin: quem só participa
    // visualiza, mesmo sendo admin. O override de admin vale só p/ projetos sem papel.
    if (!ehOwner && !ehEditorDelegado && (!ehAdmin || ehParticipante)) {
      throw Object.assign(
        new Error(
          "Apenas o autor ou um editor autorizado pode editar este projeto. Para transferir a autoria, acione a equipe RPA.",
        ),
        { status: 403 },
      );
    }
  }

  // Gate: bloqueia submissão com ganho zerado (skip projetos especiais)
  if (!ehEspecial) {
    const tiposProjetoGate = parseJson<string[]>(projeto.tipos_projeto) ?? [];
    // Ganho mensurável = economia_reais_mes > 0 (já é o LÍQUIDO: horas + custo
    // evitado − custo externo). Aceita saving SÓ de custo evitado (0h), desde que
    // o líquido seja positivo — é o caso "contrato externo cancelado, sem horas".
    // Bloqueia só quando NÃO há ganho algum (0h E sem custo evitado → líquido ≤ 0).
    if (tiposProjetoGate.includes("saving") && ((saving?.economia_reais_mes as number) ?? 0) <= 0) {
      // ⚠️ A mensagem é MONTADA com os números reais do projeto (mensagens-submissao.ts). O
      // texto fixo anterior dizia "sem redução concreta de horas" para uma submissão que
      // tinha 60h/mês validadas no memorial — o que barra é o LÍQUIDO, e o abatimento dos
      // custos declarados na Etapa 2 nunca era citado. Ver o caso SmartOnline/DIFAL.
      throw erroDeBloqueio(
        bloqueioSavingSemGanho({
          horas: (saving?.economia_horas_mes as number) ?? 0,
          unidade: unidadeHorasDe(
            (saving?.tipo_saving as SavingColetado["tipo_saving"]) ?? null,
          ).replace(/^h/, ""),
          custoEvitado: (saving?.custo_evitado_reais as number) ?? 0,
          custoExterno: projeto.custo_externo_mensal ?? 0,
          custoProjeto: (saving?.custo_projeto_reais as number) ?? 0,
          liquido: (saving?.economia_reais_mes as number) ?? 0,
        }),
      );
    }
    // Gate de COMPLETUDE da receita (último porto antes de gravar): um projeto declarado
    // receita_incremental precisa ter a receita REALMENTE preenchida — valor > 0,
    // periodicidade (tipo_saving) e um memorial de RECEITA (não vazio e não um memorial de
    // saving / "não aplicável"). Pega tanto dado pela metade (tipo_saving nulo — o sintoma do
    // legado-260) quanto receita que na verdade é saving e devia ter sido reclassificada (o
    // backstop de enviarMensagem já barra no chat; aqui é a rede determinística final).
    if (tiposProjetoGate.includes("receita_incremental")) {
      const memoReceita = ((receita?.memorial_calculo as string | null | undefined) ?? "").trim();
      if (((receita?.valor_ganho_mensal as number) ?? 0) <= 0) {
        throw erroDeBloqueio(bloqueioReceitaZerada());
      }
      if (
        !receita?.tipo_saving ||
        memoReceita.length < 30 ||
        receitaMemorialEhSaving(memoReceita)
      ) {
        throw erroDeBloqueio(bloqueioReceitaIncompleta());
      }
    }
  }

  // Teto de materialidade: projetos acima de R$ 5.000/mês vão sempre para validação humana.
  const TETO_MATERIALIDADE = 5000;
  const materialidade = calcularMaterialidade(saving, receita);
  const status =
    ehEspecial || ehReenvio || materialidade > TETO_MATERIALIDADE
      ? "em_validacao"
      : projeto.area === "RPA"
        ? "aprovado"
        : "em_validacao";
  if (materialidade > TETO_MATERIALIDADE) {
    log(
      "submeterParaValidacao",
      `Materialidade R$ ${Math.round(materialidade)}/mês > R$ ${TETO_MATERIALIDADE} → em_validacao (validação humana obrigatória)`,
    );
  }
  const now = new Date().toISOString();

  // ── Calcular ganho_total_mensal (saving + receita/10) ──
  // Saving entra cheio (economia_reais_mes já inclui custo evitado e abate custo
  // externo). Receita entra cheia e aplica ÷10 (fator de equivalência).
  // Pontual NÃO divide por 12 — valor cheio em ambos os casos.
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const savingMensal = savingReais;

  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  const receitaTipo = (receita?.tipo_saving as string) ?? "mensal";
  const receitaEquivalente = receitaValor / 10;

  const ganhoTotalMensal = savingMensal + receitaEquivalente;

  // Memorial interno (planilha/SQLite): versão ENRIQUECIDA com valores financeiros (R$).
  // O LLM gera o memorial sem R$ (visível ao usuário); o backend injeta os valores
  // usando a tabela CARGOS + campos estruturados. O markdown cru fica em documentacao.conteudo.
  const tiposProjeto = (
    projeto.tipos_projeto
      ? JSON.parse(projeto.tipos_projeto as string)
      : [projeto.tipo_projeto].filter(Boolean)
  ) as string[];
  const memorialInterno = stripMarkdown(
    enriquecerMemorial(
      saving as SavingColetado | undefined,
      receita as ReceitaColetada | undefined,
      tiposProjeto,
    ),
  );
  // Coluna "Memorial de Saving" (V) recebe SÓ o memorial de saving (com R$). O memorial de
  // receita vai SOMENTE para "Receita Memorial" (Z); em projeto só-receita, V fica "—".
  // (memorial_calculo no banco segue sendo o unificado — usado em "Memorial anterior"/auditoria.)
  const memorialSavingLimpo =
    tiposProjeto.includes("saving") && saving
      ? stripMarkdown(
          enriquecerMemorial(saving as SavingColetado | undefined, undefined, ["saving"]),
        )
      : null;
  const receitaMemorialLimpo = stripMarkdown(receita?.memorial_calculo as string | undefined);
  // "Alocação Ganhos" (coluna AK): justificativa [2.4] do gate ≥44h, fatiada do
  // memorial do LLM (sem R$). Null quando o gate não disparou → "—" no Sheets.
  const alocacaoGanhos = extrairAlocacaoGanhos(
    normalizarMarcadoresMemorial((saving as SavingColetado | undefined)?.memorial_calculo),
  );
  // "Justificativa Saving Escalado e Real": análise do agente para o split (fatiada do
  // memorial; fallback determinístico quando o split se aplica mas não foi consolidado).
  const justificativaCargaEscala = derivarJustificativaCargaEscala(
    saving as Record<string, unknown> | undefined,
    projeto.alguem_fazia,
  );

  await updateProjeto(projeto_id, {
    status,
    // Área derivada do email vira a fonte de verdade. Zera area_id para que o
    // area_nome (join por area_id, fallback p.area) reflita a área derivada.
    area: areaFinal,
    area_id: null,
    // submitted_at = data da PRIMEIRA submissão. No reenvio (edição) NÃO atualiza —
    // preserva "quando a pessoa submeteu" (só validated_*/Atualizado Em refletem a edição).
    ...(ehReenvio ? {} : { submitted_at: now }),
    // A submissão SEMPRE escreve "Atualizado Em" no Sheets (IDA) → marca no SQLite na
    // hora p/ o projeto deixar de contar como pendente (selo da home) sem esperar o
    // sync reverso. O reverse sync depois reconcilia com o carimbo formatado da planilha.
    atualizado_em: now,
    // Reenviar/submeter REATIVA o projeto: se estava descontinuado, volta a ser ativo
    // (e a IDA abaixo grava "Pendente" na coluna Status, saindo de "Descontinuado").
    descontinuado: 0,
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    saving_reais: (saving?.economia_reais_mes as number) ?? null,
    tipo_saving: (saving?.tipo_saving as string) ?? null,
    memorial_calculo: memorialInterno,
    // Split carga real × escala (transparência → Sheets). Null quando não se aplica.
    horas_carga_real: (saving?.horas_carga_real as number) ?? null,
    horas_escala: (saving?.horas_escala as number) ?? null,
    ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
    // Reenvio invalida a validação anterior (o humano precisa rever do zero).
    ...(ehReenvio ? { validated_at: null, validated_by: null } : {}),
  });

  log("submeterParaValidacao", `Status: ${status}`);

  // ── Snapshot imutável de auditoria ────────────────────────────────────────────
  // Grava uma cópia do estado do projeto no momento da submissão. Não propaga
  // erros — o snapshot é observabilidade, não deve bloquear a submissão.
  try {
    const projetoAtualizado = await getProjetoById(projeto_id);
    if (projetoAtualizado) {
      const snapshotProjeto: Record<string, unknown> = {
        nome: projetoAtualizado.nome,
        descricao_breve: projetoAtualizado.descricao_breve,
        ferramenta: projetoAtualizado.ferramenta,
        tipos_projeto: parseJson(projetoAtualizado.tipos_projeto) ?? [],
        especial: projetoAtualizado.especial,
        area: projetoAtualizado.area,
        saving_horas: projetoAtualizado.saving_horas,
        saving_reais: projetoAtualizado.saving_reais,
        horas_carga_real: projetoAtualizado.horas_carga_real,
        horas_escala: projetoAtualizado.horas_escala,
        tipo_saving: projetoAtualizado.tipo_saving,
        memorial_calculo: projetoAtualizado.memorial_calculo,
        ganho_total_mensal: projetoAtualizado.ganho_total_mensal,
        custo_externo_mensal: projetoAtualizado.custo_externo_mensal,
        alguem_fazia: projetoAtualizado.alguem_fazia,
        custo_evitado: projetoAtualizado.custo_evitado,
        custo_evitado_justificativa: projetoAtualizado.custo_evitado_justificativa,
        custo_evitado_itens: projetoAtualizado.custo_evitado_itens,
        status: projetoAtualizado.status,
      };
      // Snapshot da conversa ATUAL — congela os agentes originais desta versão para
      // o Investigador (os chat_messages são apagados ao voltar etapas/reeditar).
      const chatSnapshot = await getChatMessages(projeto_id);
      await gravarVersaoProjeto(
        projeto_id,
        ehReenvio ? "reenvio" : "submit_inicial",
        snapshotProjeto,
        conteudo,
        projetoAtualizado.responsavel_email,
        chatSnapshot,
      );
    }
  } catch (versionErr) {
    err("submeterParaValidacao", "Falha ao gravar versão (não bloqueante):", versionErr);
  }

  // ── Resumo da documentação → UM doc no Drive (link único na coluna "URL") ──
  // Salva o RESUMO da documentação gerada pelo agente como UM documento no Drive
  // (NÃO os arquivos crus enviados). Em edição, atualiza o MESMO doc in-place — N
  // edições não geram N arquivos. Não bloqueia a submissão se o Drive falhar.
  try {
    const linkExistente = parseJson<string[]>(projeto.arquivos_links)?.[0] ?? null;
    // Doc completa de ponta a ponta: resumo do agente + texto dos arquivos do usuário.
    const msgsResumo = await getChatMessagesExcludeRole(projeto_id, "doc");
    const docUsuarioMsg = await getDocMessage(projeto_id);
    const md = renderResumoDocumentacao(projeto, conteudo, {
      resumoProjeto: extrairResumoProjeto(msgsResumo),
      docUsuario: docUsuarioMsg?.content ?? null,
      arquivosNomes: parseJson<string[]>(projeto.arquivos_nomes) ?? [],
    });
    const sanit = (x: string) =>
      (x || "")
        .replace(/[|/\\]+/g, "-")
        .replace(/->|→|<>/g, "-")
        .replace(/\s+/g, " ")
        .replace(/[^\w\sÀ-ÿ.\-]/g, "")
        .trim()
        .replace(/\s/g, "_")
        .slice(0, 80);
    const filename = `${now.slice(0, 10)}_${now.slice(11, 19).replace(/:/g, "")}_${sanit(projeto.nome ?? "projeto")}_${sanit(areaFinal ?? "")}.md`;
    const link = await upsertResumoDoc(filename, md, linkExistente);
    if (link) {
      await updateProjeto(projeto_id, { arquivos_links: [link] });
      (projeto as { arquivos_links?: string | null }).arquivos_links = JSON.stringify([link]);
      log("submeterParaValidacao", `Resumo da doc salvo no Drive: ${link}`);
    }
  } catch (driveErr) {
    err("submeterParaValidacao", "Falha ao salvar resumo no Drive (não bloqueante):", driveErr);
  }

  // Evento de timeline: submissão/reenvio finalizado (fecha o histórico).
  await gravarEvento(projeto_id, "submit", "completo", {
    reenvio: ehReenvio,
    status,
    ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
  });

  // ── Pré-aprovação do líder (TeamGuide) ────────────────────────────────────
  // Abre (ou reabre, no reenvio — D10) a fila do líder direto do autor. NÃO bloqueia
  // nada (D3): a função nunca lança e, quando o autor É liderança (D20) ou não tem
  // líder (D6), devolve "—" e segue a vida.
  const preAprovacao = await abrirPreAprovacao(projeto_id, { nomeProjeto: projeto.nome });

  // Quando o grupo do Google Chat é avisado (11/08/2026). Fila REALMENTE aberta
  // (`isento: false`) → o alerta cala aqui e sai quando o líder pré-aprovar; qualquer
  // isenção → sai agora, com a nota dizendo por que não há parecer. A régua (e o
  // default seguro invertido) mora em `src/lib/notificacao-chat.ts`.
  const momentoNotificacao = decidirMomentoNotificacao(preAprovacao);

  // Aviso IMEDIATO ao líder (D26, 06/08/2026): o POST ao Gomoon sai agora, não na
  // manhã seguinte. Fire-and-forget via `runBackground` — o Godeploy cancelaria a
  // promise assim que a Response voltasse, e a submissão NÃO pode esperar uma DM.
  // `notificarLideresDoProjeto` nunca lança; o `catch` é cinto de segurança do
  // agendamento em si. Isento (sem líder / liderança) → `aprovadores` vazio → no-op.
  if (!preAprovacao.isento && preAprovacao.aprovadores.length) {
    runBackground(
      notificarLideresDoProjeto(projeto_id, preAprovacao.aprovadores, {
        nomeProjeto: projeto.nome,
      }).catch((e) => err("submeterParaValidacao", "Aviso ao líder falhou (não bloqueante):", e)),
    );
  }

  // ── Estágio 2 (feature de outro projeto): abre AGORA se o estágio 1 for ISENTO ──
  // Quando o autor é liderança / sem líder / especial / TeamGuide fora, o estágio 1 nunca
  // será aprovado por clique — ele já está "satisfeito". Então, se este projeto é uma
  // feature de outro, abrimos a fila do líder do dono do PAI já na submissão (Q2/Q7). Se
  // o estágio 1 abriu fila REAL, o estágio 2 é aberto no gatilho pós-aprovação
  // (`decidirAprovacao`). `abrirPreAprovacaoProjetoPai` é idempotente e NUNCA lança.
  if (
    preAprovacao.isento &&
    (projeto as { projeto_pai_id?: string | null }).projeto_pai_id
  ) {
    await abrirPreAprovacaoProjetoPai(projeto_id);
  }

  // ── Contexto especial órfão: rede final antes de qualquer escrita ────────────
  // O projeto deixou de ser especial em algum ponto do fluxo (Etapa 2.5 → saving/
  // receita), mas o texto do "porquê é especial" continuou no banco: ele não descreve
  // mais este projeto e não pode ir para a coluna "Contexto do Projeto Especial" nem
  // aparecer em /projeto/$id. As duas limpezas de origem (`atualizarTipos` e
  // `atualizarMetadados`) são condicionais e dependem de o formulário chamá-las na
  // ordem certa — aqui não depende de nada: se `especial` é 0 no momento do submit,
  // o contexto especial é resíduo, ponto. Zeramos no banco E no objeto em memória (é
  // ele que o `syncSubmitToGoogle` serializa logo abaixo). Idempotente e não bloqueia.
  await limparContextoEspecialOrfao(projeto_id, projeto, "submeterParaValidacao");

  // ── Sync Google (planilha + Drive + chat) — fire-and-forget ──
  {
    const membros = parseJson<string[]>(projeto.membros) ?? [];
    const membrosPapeis = parseJson<Record<string, string>>(projeto.membros_papeis) ?? {};
    const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];

    runBackground(
      syncSubmitToGoogle({
        projetoId: projeto_id,
        modo: ehReenvio ? "edicao" : "novo",
        projeto,
        conteudo,
        saving,
        receita,
        membros,
        membrosPapeis,
        tiposProjeto,
        // TEMPORÁRIO: durante a validação da eficácia do formulário, gravamos sempre
        // "Pendente" na planilha — mesmo para projetos auto-aprovados (ex.: RPA). O
        // status interno (SQLite/dashboard) continua correto. Reverter para
        // `status === 'aprovado' ? 'Aprovado' : 'Pendente'` quando a validação terminar.
        status: "Pendente",
        area: areaFinal ?? "—",
        memorialLimpo: memorialSavingLimpo ?? "—",
        receitaMemorialLimpo: receitaMemorialLimpo ?? "—",
        alocacaoGanhos,
        justificativaCargaEscala,
        ganhoTotalMensal,
        // Edição: o memorial que estava gravado ANTES deste update (projeto foi lido
        // antes do updateProjeto) → vai para a coluna "Memorial anterior" no Sheets.
        memorialAnterior: ehReenvio ? (projeto.memorial_calculo ?? null) : null,
        // Coluna "Aprovação do Líder" guarda só o ESTADO ("Pré-pendente", ou
        // "Pré-aprovado" quando o autor é liderança, ou "—"); quem é o líder e o
        // porquê da isenção vão na "Justificativa Aprovação do Líder" (D14).
        aprovacaoLider: preAprovacao.rotuloSheet,
        justificativaAprovacaoLider: preAprovacao.justificativaSheet,
        // Só notifica quem nunca terá parecer de líder (especial, autor liderança, sem
        // líder, TeamGuide fora). Quem entra em fila é anunciado na pré-aprovação.
        notificarChat: momentoNotificacao.quando === 'submissao',
        notaPreAprovacao: momentoNotificacao.nota,
        // Vínculo de FEATURE → coluna "ID Pai" na linha deste (filho). null → "—".
        idPai: (projeto as { projeto_pai_id?: string | null }).projeto_pai_id ?? null,
      }),
    );
  }

  // ── Vínculo de FEATURE: acumula o id deste FILHO na linha do PAI (cross-row) ──
  // Grava "ID Feature" (lista acumulada, sem duplicar) na linha do pai e reespelha,
  // além de somar o id em `projeto_filhos_ids` do pai no SQLite. Best-effort e
  // fire-and-forget: nunca derruba a submissão do filho (o vínculo primário é o
  // `projeto_pai_id` do filho, já persistido).
  {
    const paiId = (projeto as { projeto_pai_id?: string | null }).projeto_pai_id ?? null;
    if (paiId) {
      runBackground(
        (async () => {
          const lista = await vincularFilhoAoPai(paiId, projeto_id);
          if (!lista) return; // pai não existe no SQLite — nada a espelhar
          const celula = { "ID Feature": serializarIdsFeatureSheet(lista) } as const;
          await updateRowByProjectId(paiId, celula);
          await espelharEscrita(paiId, celula);
        })().catch((e) =>
          err("submeterParaValidacao", "Falha ao vincular feature ao pai (não bloqueante):", e),
        ),
      );
    }
  }

  // A linha deste projeto acabou de mudar na planilha (append/update via `runBackground`).
  // Sem invalidar, "Meus Projetos" serviria o cache de até 60 s de ANTES da submissão —
  // o projeto novo apareceria com Status "—", porque ele existe no SQLite na hora mas o
  // Status vem da linha do Sheets. Ver `meus-projetos-cache.ts`.
  if (projeto.responsavel_email) invalidarLinhasDoDono(projeto.responsavel_email);

  // Números finais recalculados — o cliente usa para o comparativo antes×depois
  // na tela pós-envio (edição). São os MESMOS valores gravados no projeto/snapshot.
  return {
    ok: true,
    status,
    // Projeto especial é validado por humano — o worker NÃO dispara a análise
    // automática em background para ele.
    especial: ehEspecial,
    ganho: {
      saving_horas: (saving?.economia_horas_mes as number) ?? null,
      saving_reais: (saving?.economia_reais_mes as number) ?? null,
      tipo_saving: (saving?.tipo_saving as string) ?? null,
      receita_valor: receitaValor > 0 ? receitaValor : null,
      receita_tipo: receitaTipo,
      custo_externo_mensal: projeto.custo_externo_mensal ?? null,
      ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
    },
  };
}

// ─── Re-sync Google (TEMPORÁRIO) ──────────────────────────────────────────────
// Re-dispara o sync para Google Sheets + Chat de um projeto JÁ submetido, SEM
// re-rodar o analisador de IA e SEM mutar o estado do projeto. Usa os valores já
// gravados no banco (saving/receita do doc, complexidade/observações da análise
// anterior). Útil para repor no Sheets/Chat o que se perdeu por uma submissão
// cujo sync foi cancelado (bug do waitUntil). Reproduz os dois eventos de sync da
// edição: UPDATE da linha (por ID) + atualização de complexidade/observações.
// REMOVER quando não for mais necessário.
export async function resyncGoogle(rawData: unknown) {
  const { projeto_id } = z.object({ projeto_id: z.string().min(1) }).parse(rawData);
  log("resyncGoogle", `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);
  if (!docRow) throw new Error("Documentação não encontrada.");
  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<
    string,
    unknown
  >;

  const projeto = await getProjetoById(projeto_id);
  if (!projeto) throw new Error("Projeto não encontrado.");

  // Contexto especial órfão: o resync reescreve a linha INTEIRA a partir do banco, então
  // sem esta limpeza ele REGRAVA o texto residual na coluna "Contexto do Projeto Especial"
  // — é justamente o resync a ferramenta usada para consertar linhas antigas (casos "Farol
  // de Ciência do Código de Conduta" e "GoStream - Checklist Proposta", 19/08/2026).
  await limparContextoEspecialOrfao(projeto_id, projeto, "resyncGoogle");

  // Re-deriva R$ das horas (mesma rede de segurança do submit), incluindo o custo
  // evitado a partir dos itens persistidos.
  if (conteudo.saving && typeof conteudo.saving === "object") {
    const evitadoMensal = custoEvitadoMensalFromItens(projeto.custo_evitado_itens);
    (conteudo.saving as SavingColetado).custo_evitado_reais =
      evitadoMensal > 0 ? evitadoMensal : null;
    const custoProjetoMensal = custoProjetoMensalFromItens(projeto.custo_projeto_itens);
    (conteudo.saving as SavingColetado).custo_projeto_reais =
      custoProjetoMensal > 0 ? custoProjetoMensal : null;
    conteudo.saving = recomputarSavingFinanceiro(
      conteudo.saving as SavingColetado,
      projeto.custo_externo_mensal ?? 0,
    );
    avisarDivergenciaMemorialLinhas(conteudo.saving as SavingColetado, projeto_id);
  }
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  // Rede silenciosa do split carga real × escala: o agente conduz a pergunta no chat (não
  // há mais gate que force), mas pode não capturar. Se o split se aplica ('sim' recorrente
  // com horas) e não veio, assume o CONSERVADOR — carga real = total, escala 0 — para as
  // colunas de transparência não ficarem vazias. NÃO bloqueia nada. Idempotente (só entra
  // quando falta o split). O sync reverso horário não passa por aqui → legados ociosos ficam
  // como estão. Ver resolverSplitCargaEscala (orchestrator.ts) e SPEC_CORRECOES.
  if (saving) {
    const split = resolverSplitCargaEscala(projeto.alguem_fazia, saving as SavingColetado);
    if (split) {
      saving.horas_carga_real = split.horas_carga_real;
      saving.horas_escala = split.horas_escala;
    }
  }
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  // ganho_total_mensal — mesma fórmula do submeterParaValidacao.
  // Saving entra cheio; receita aplica ÷10. Pontual NÃO divide por 12 (valor cheio).
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const savingMensal = savingReais;
  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  const ganhoTotalMensal = savingMensal + receitaValor / 10;

  const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];
  // V "Memorial de Saving" = só saving (receita vai só na coluna Z "Receita Memorial").
  const memorialSavingLimpo =
    tiposProjeto.includes("saving") && saving
      ? stripMarkdown(
          enriquecerMemorial(saving as SavingColetado | undefined, undefined, ["saving"]),
        )
      : null;
  const receitaMemorialLimpo = stripMarkdown(receita?.memorial_calculo as string | undefined);
  const alocacaoGanhos = extrairAlocacaoGanhos(
    normalizarMarcadoresMemorial((saving as SavingColetado | undefined)?.memorial_calculo),
  );
  const justificativaCargaEscala = derivarJustificativaCargaEscala(saving, projeto.alguem_fazia);
  const membros = parseJson<string[]>(projeto.membros) ?? [];
  const membrosPapeis = parseJson<Record<string, string>>(projeto.membros_papeis) ?? {};

  // Pré-aprovação do líder: o re-sync NÃO reabre fila (isso é `reabrirPreAprovacoes`),
  // então ele espelha o que a tabela INTERNA `projeto_aprovacoes` já diz — inclusive
  // um parecer JÁ DADO. Sem fila (isento/legado) manda `undefined`: a coluna fica como
  // está, em vez de virar "—" e apagar o estado que o submit gravou.
  const filaLider = await getAprovacoesDoProjeto(projeto_id);
  const aprovacaoLider = filaLider.length ? rotuloAprovacaoSheet(filaLider) : undefined;
  const justificativaAprovacaoLider = filaLider.length
    ? justificativaAprovacaoSheet(filaLider)
    : undefined;

  // 1. UPDATE da linha (por ID) + alerta no Chat — TEMPORÁRIO: status sempre "Pendente".
  await syncSubmitToGoogle({
    projetoId: projeto_id,
    modo: "edicao",
    projeto,
    conteudo,
    saving,
    receita,
    membros,
    membrosPapeis,
    tiposProjeto,
    status: "Pendente",
    area: projeto.area ?? "—",
    memorialLimpo: memorialSavingLimpo ?? "—",
    receitaMemorialLimpo: receitaMemorialLimpo ?? "—",
    alocacaoGanhos,
    justificativaCargaEscala,
    ganhoTotalMensal,
    aprovacaoLider,
    justificativaAprovacaoLider,
    // Re-sync é REPARO administrativo (regravar a linha da planilha) — não avisa
    // ninguém. Antes disparava uma mensagem no grupo por projeto reparado.
    notificarChat: false,
  });

  // 2. Complexidade/Observações/Status (o que o analisador já havia gravado).
  await syncUpdateToGoogle({
    projetoId: projeto_id,
    projectName: projeto.nome ?? "",
    complexidade: projeto.complexidade ?? "",
    observacoes: projeto.observacoes ?? "",
    status: "Pendente",
  });

  log(
    "resyncGoogle",
    `OK — ${projeto.nome} (área=${projeto.area}, ganho=${Math.round(ganhoTotalMensal)})`,
  );
  return {
    ok: true,
    projeto_id,
    nome: projeto.nome,
    area: projeto.area,
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    ganho_total_mensal: Math.round(ganhoTotalMensal * 100) / 100,
  };
}

// ─── Retroativo: custo evitado/projeto PONTUAL sem ÷12 ──────────────────────
// Corrige projetos preenchidos ANTES da remoção do ÷12 (decisão de produto de
// 01/07/2026, ver SPEC_CORRECOES.md). Reajusta saving_reais/ganho_total/memorial no
// SQLite e SÓ as colunas afetadas no Sheets. Dois caminhos:
//
//  • CASO A — submetido pelo APP (tem custo_evitado_itens/custo_projeto_itens): re-deriva
//    o valor dos ITENS persistidos (agora pelo valor CHEIO) via custoEvitadoMensalFromItens
//    e recompute o saving (fonte de verdade, exato).
//  • CASO B — LEGADO sem itens (só existe via sync do Sheet), custo evitado PONTUAL PURO
//    (0h, alguem_fazia='externo', sem custo externo/projeto — logo saving_reais == custo
//    evitado ÷12): recupera o valor ORIGINAL pela justificativa ("R$ X (pontual)"; método 1)
//    e, se não der pra parsear, cai no fallback ×12 (valor atual × 12). Legado pontual que
//    NÃO seja puro (tem horas/custo) vai para `flagged` (revisão manual) — não arrisca.
//
// ⚠️ NÃO reusa resyncGoogle/syncSubmitToGoogle de propósito: aquele caminho REGRAVA a
// linha inteira da planilha (incl. "Atualizado Em", que regulariza legado) por projeto.
// Aqui escrevemos direto via updateRowByProjectId (batch parcial, só as colunas afetadas).
// _(Até 11/08/2026 o motivo principal era outro — o caminho também disparava UMA
// notificação no Google Chat por projeto, o que em PROD seria spam de N mensagens. Isso
// deixou de valer: `resyncGoogle` passa `notificarChat: false` desde o D30.)_
//
// Idempotente: só toca quem de fato MUDA; pula os já corretos (re-run seguro). `dry`
// (default TRUE) só relata (projetos + flagged), sem escrever nada.
export async function retroativoCustosPontuais(rawData: unknown) {
  const { dry } = z.object({ dry: z.boolean().optional() }).parse(rawData ?? {});
  const modoDry = dry !== false; // default seguro: dry-run
  log("retroativoCustosPontuais", `dry=${modoDry}`);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const aprox = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const parseArr = (raw: unknown): Array<{ recorrencia?: string }> => {
    const v = parseJson<Array<{ recorrencia?: string }>>(
      typeof raw === "string" ? raw : JSON.stringify(raw ?? []),
    );
    return Array.isArray(v) ? v : [];
  };
  const temItens = (raw: unknown) => parseArr(raw).length > 0;
  const temPontualItens = (raw: unknown) =>
    parseArr(raw).some((it) => it?.recorrencia === "pontual");
  // pt-BR → número. "234,19"→234.19; "1.500,00"→1500; sem vírgula, pontos são milhar.
  const parseValorBR = (s: string): number => {
    const t = String(s).trim();
    return t.includes(",")
      ? parseFloat(t.replace(/\./g, "").replace(",", "."))
      : parseFloat(t.replace(/\./g, ""));
  };
  // Soma os itens "R$ <valor> (pontual|mensal)" da justificativa (formato gerado pelo app),
  // TODOS pelo valor CHEIO. Retorna também se há ao menos um item pontual.
  const somaJustificativa = (
    just: string,
  ): { total: number; temPontual: boolean; count: number } => {
    const re = /R\$\s*([\d.,]+)\s*\((pontual|mensal)\)/gi;
    let m: RegExpExecArray | null;
    let total = 0,
      temPontual = false,
      count = 0;
    while ((m = re.exec(just || "")) !== null) {
      const v = parseValorBR(m[1]);
      if (!isFinite(v) || v <= 0) continue;
      total += v;
      if (m[2].toLowerCase() === "pontual") temPontual = true;
      count++;
    }
    return { total: round2(total), temPontual, count };
  };

  const ids = (await getProjetosNaoRascunho()).map((r) => r.id);
  const projetosAfetados: Array<Record<string, unknown>> = [];
  const flagged: Array<Record<string, unknown>> = [];
  let scanned = 0;

  for (const id of ids) {
    scanned++;
    const projeto = await getProjetoById(id);
    if (!projeto) continue;

    // ── CASO A: submetido pelo APP (tem itens) — re-deriva dos itens (fonte exata) ──
    if (temItens(projeto.custo_evitado_itens) || temItens(projeto.custo_projeto_itens)) {
      // Só interessa item PONTUAL — mensal sempre entrou cheio (nada muda).
      if (
        !temPontualItens(projeto.custo_evitado_itens) &&
        !temPontualItens(projeto.custo_projeto_itens)
      )
        continue;

      const docRow = await getDocumentacao(id);
      if (!docRow) continue;
      const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<
        string,
        unknown
      >;
      const saving = conteudo.saving as SavingColetado | undefined;
      if (!saving || typeof saving !== "object") continue;

      const oldEvitado = Math.max(0, Number(saving.custo_evitado_reais) || 0);
      const oldProjeto = Math.max(0, Number(saving.custo_projeto_reais) || 0);
      const newEvitado = custoEvitadoMensalFromItens(projeto.custo_evitado_itens); // CHEIO
      const newProjeto = custoProjetoMensalFromItens(projeto.custo_projeto_itens); // CHEIO
      if (aprox(oldEvitado, newEvitado) && aprox(oldProjeto, newProjeto)) continue; // já correto

      const oldSavingReais = round2(Number(projeto.saving_reais) || 0);
      const oldGanho = round2(Number(projeto.ganho_total_mensal) || 0);
      const savingRecalc = recomputarSavingFinanceiro(
        {
          ...saving,
          custo_evitado_reais: newEvitado > 0 ? newEvitado : null,
          custo_projeto_reais: newProjeto > 0 ? newProjeto : null,
        },
        projeto.custo_externo_mensal ?? 0,
      );
      const receita = conteudo.receita as ReceitaColetada | undefined;
      const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];
      const savingReaisNew = round2(Number(savingRecalc.economia_reais_mes) || 0);
      const ganhoNew = savingReaisNew + (Number(receita?.valor_ganho_mensal) || 0) / 10;
      const ganhoNewRound = ganhoNew > 0 ? round2(ganhoNew) : 0;

      projetosAfetados.push({
        id,
        nome: projeto.nome,
        metodo: "itens",
        custo_evitado: { de: oldEvitado, para: newEvitado },
        custo_projeto: { de: oldProjeto, para: newProjeto },
        saving_reais: { de: oldSavingReais, para: savingReaisNew },
        ganho_total: { de: oldGanho, para: ganhoNewRound },
      });
      if (modoDry) continue;

      conteudo.saving = savingRecalc;
      await upsertDocumentacao(id, conteudo);
      const memorialInterno = enriquecerMemorial(savingRecalc, receita, tiposProjeto);
      await updateProjeto(id, {
        saving_reais: savingReaisNew,
        ganho_total_mensal: ganhoNewRound > 0 ? ganhoNewRound : null,
        memorial_calculo: memorialInterno,
      });
      const memorialSavingLimpo = tiposProjeto.includes("saving")
        ? stripMarkdown(enriquecerMemorial(savingRecalc, undefined, ["saving"]))
        : "—";
      await updateRowByProjectId(id, {
        "Custo Evitado": newEvitado,
        "Custo do Projeto": newProjeto,
        "Saving Reais": savingReaisNew,
        "Ganho Total": ganhoNewRound,
        "Memorial de Saving": memorialSavingLimpo,
        "Atualizado Em": nowFortaleza(),
      });
      log(
        "retroativoCustosPontuais",
        `[itens] aplicado ${id} (${projeto.nome}): evitado ${oldEvitado}→${newEvitado}, saving ${oldSavingReais}→${savingReaisNew}`,
      );
      continue;
    }

    // ── CASO B: LEGADO sem itens — custo evitado PONTUAL ──
    const just = projeto.custo_evitado_justificativa || "";
    // Só pontual (mensal nunca dividiu). Custo do projeto pontual em legado é raro e
    // subtrai — não dá pra tratar como "puro"; sinaliza.
    if (
      temItens(projeto.custo_projeto_itens) === false &&
      projeto.custo_projeto === "sim" &&
      /pontual/i.test(projeto.custo_projeto_justificativa || "")
    ) {
      flagged.push({
        id,
        nome: projeto.nome,
        motivo: "legado com custo do projeto pontual (subtrai) — revisar manual",
      });
    }
    if (projeto.custo_evitado !== "sim" || !/pontual/i.test(just)) continue;

    // "Puro": saving_reais == custo evitado ÷12 (sem horas, sem custo externo/projeto).
    const horas = Number(projeto.saving_horas) || 0;
    const custoExterno = Number(projeto.custo_externo_mensal) || 0;
    const ehPuro =
      projeto.alguem_fazia === "externo" &&
      horas === 0 &&
      custoExterno === 0 &&
      projeto.custo_projeto !== "sim";
    const oldSaving = round2(Number(projeto.saving_reais) || 0);
    const oldGanho = round2(Number(projeto.ganho_total_mensal) || 0);

    if (!ehPuro) {
      flagged.push({
        id,
        nome: projeto.nome,
        motivo: "legado pontual NÃO-puro (tem horas/custo externo/custo projeto) — revisar manual",
      });
      continue;
    }

    // novo valor CHEIO: método 1 (justificativa) → senão fallback ×12 (só puro).
    const parsed = somaJustificativa(just);
    let newEvitado: number | null = null;
    let metodo: string | null = null;
    if (parsed.total > 0 && parsed.temPontual) {
      newEvitado = parsed.total;
      metodo = "justificativa";
    } else {
      newEvitado = round2(oldSaving * 12);
      metodo = "x12";
    }

    if (aprox(newEvitado, oldSaving)) continue; // já corrigido / sem ÷12
    if (newEvitado < oldSaving) {
      flagged.push({
        id,
        nome: projeto.nome,
        motivo: `valor recuperado (${newEvitado}) < atual (${oldSaving}) — revisar manual`,
      });
      continue;
    }

    // Puro: saving = custo evitado; ganho mantém o delta (preserva eventual receita).
    const newSaving = newEvitado;
    const delta = round2(newSaving - oldSaving);
    const newGanho = round2(oldGanho + delta);

    projetosAfetados.push({
      id,
      nome: projeto.nome,
      metodo,
      custo_evitado: { de: oldSaving, para: newEvitado },
      custo_projeto: { de: 0, para: 0 },
      saving_reais: { de: oldSaving, para: newSaving },
      ganho_total: { de: oldGanho, para: newGanho },
    });
    if (modoDry) continue;

    await updateProjeto(id, {
      saving_reais: newSaving,
      ganho_total_mensal: newGanho > 0 ? newGanho : null,
    });
    await updateRowByProjectId(id, {
      "Custo Evitado": newEvitado,
      "Saving Reais": newSaving,
      "Ganho Total": newGanho,
      "Atualizado Em": nowFortaleza(),
    });
    log(
      "retroativoCustosPontuais",
      `[legado:${metodo}] aplicado ${id} (${projeto.nome}): ${oldSaving}→${newSaving}`,
    );
  }

  log(
    "retroativoCustosPontuais",
    `${modoDry ? "DRY" : "APLICADO"} — ${scanned} varridos, ${projetosAfetados.length} afetados, ${flagged.length} flagged`,
  );
  return {
    dry: modoDry,
    total_scanned: scanned,
    total_afetados: projetosAfetados.length,
    total_flagged: flagged.length,
    projetos: projetosAfetados,
    flagged,
  };
}

// ─── Validar projeto ─────────────────────────────────────────────────────────

export async function validarProjeto(rawData: unknown) {
  const { projeto_id } = z.object({ projeto_id: z.string().min(1) }).parse(rawData);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error("Documentação não encontrada.");

  const doc = parseJson<Parameters<typeof validarDocumentacao>[0]>(docRow.conteudo) as Parameters<
    typeof validarDocumentacao
  >[0];
  const resultado = await validarDocumentacao(doc);

  await insertValidacao({
    projeto_id,
    resultado: resultado.resultado,
    parecer: resultado.parecer,
    criterios: resultado.criterios,
  });

  const novoStatus = resultado.resultado === "aprovado" ? "validado" : "rejeitado";
  await updateProjeto(projeto_id, { status: novoStatus, validated_at: new Date().toISOString() });

  try {
    if (resultado.resultado === "aprovado") {
      await enviarEmailAprovacao(doc, resultado);
    } else {
      await enviarEmailRejeicao(doc, resultado);
    }
    await updateValidacaoEmailEnviado(projeto_id);
  } catch (emailErr) {
    console.error("[email-agent] Falha ao enviar email:", emailErr);
  }

  return { resultado: resultado.resultado, parecer: resultado.parecer };
}
