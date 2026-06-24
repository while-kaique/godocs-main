// Funções de negócio do chat — sem dependência de TanStack Start.
// Chamadas diretamente pelo worker (src/worker.ts).
// Fluxo: doc → doc_preview → saving → saving_preview → completo

const log = (fn: string, ...args: unknown[]) => console.log(`[chat.functions/${fn}]`, ...args);
const err = (fn: string, ...args: unknown[]) => console.error(`[chat.functions/${fn}]`, ...args);

import { z } from 'zod';
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
  findDuplicateProjeto,
  updateProjeto,
  deleteChatMessagesByProjeto,
  deleteChatMessagesAfterFaseMarker,
  insertValidacao,
  updateValidacaoEmailEnviado,
  insertAnalise,
  gravarVersaoProjeto,
  parseJson,
} from '@/integrations/db/client.server';
import { runBackground } from '@/lib/background';
import { runOrchestrator, aplicaConfirmacaoBaseHoras } from '@/lib/agents/orchestrator';
import { compilarDocumentacao } from '@/lib/agents/doc-compiler';
import { validarDocumentacao } from '@/lib/agents/validator';
import { analisarProjeto as analisarProjetoAgent } from '@/lib/agents/analyzer';
import { enviarEmailAprovacao, enviarEmailRejeicao } from '@/lib/agents/email-agent';
import { extractTextFromMultipleFiles } from '@/lib/extract-text.server';
import { extrairCamposDocumentacao } from '@/lib/agents/extractor';
import { stripMarkdown } from '@/lib/strip-markdown';
import { deriveAreaFromEmail } from '@/lib/areas/teamguide.server';
import { isAdmin } from '@/lib/auth.functions';
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
} from '@/lib/agents/types';
import { documentacaoVazia, receitaVazia, savingVazio, CARGOS } from '@/lib/agents/types';
import { recomputarSavingFinanceiro, enriquecerMemorial, custoEvitadoMensalFromItens } from '@/lib/agents/saving-calc';
import { normalizarMarcadoresMemorial, extrairAlocacaoGanhos } from '@/lib/agents/memorial-format';
import { syncSubmitToGoogle, syncUpdateToGoogle } from '@/lib/google/sync';
import { readAllRows, updateRowByProjectId } from '@/lib/google/sheets';
import { upsertResumoDoc } from '@/lib/google/drive';
import { renderResumoDocumentacao } from '@/lib/agents/doc-render';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Registra um evento determinístico do formulário (valores marcados, "voltar
// etapa") para o timeline do Investigador. NÃO-bloqueante: é observabilidade e
// nunca deve quebrar a submissão — erros são apenas logados.
async function gravarEvento(
  projetoId: string,
  tipo: string,
  fase: string | null,
  dados?: unknown,
) {
  try {
    await recordFormEvent({ projeto_id: projetoId, tipo, fase, dados });
  } catch (e) {
    err('gravarEvento', `Falha ao gravar evento '${tipo}' (não bloqueante):`, e);
  }
}

// Nomes amigáveis dos campos de documentação (7 campos)
const DOC_FIELD_LABELS: Record<string, string> = {
  nome_projeto: 'nome do projeto',
  o_que_faz: 'o que faz',
  execucao: 'execução',
  dependencias: 'dependências',
  fluxo: 'fluxo',
  configurar_antes: 'configurar antes',
  atencao: 'atenção/riscos',
};

// Nomes amigáveis dos campos de saving
const SAVING_FIELD_LABELS: Record<string, string> = {
  linhas: 'pessoas/cargos',
  economia_horas_mes: 'economia de horas',
  tipo_saving: 'tipo de saving',
  memorial_calculo: 'memorial de cálculo',
};

// Nomes amigáveis dos campos de receita
const RECEITA_FIELD_LABELS: Record<string, string> = {
  tipo_saving: 'tipo de ganho',
  valor_ganho_mensal: 'valor de receita',
  memorial_calculo: 'memorial de cálculo',
};

function progressoDocumentacao(coletado: DocumentacaoColetada): string {
  const campos = Object.entries(coletado);
  const total = campos.length; // 7
  const preenchidos = campos.filter(([, v]) => v !== null).length;
  const faltando = campos.filter(([, v]) => v === null).map(([k]) => DOC_FIELD_LABELS[k] ?? k);
  if (faltando.length === 0) return `documentação ${preenchidos}/${total} ✓ completa`;
  return `documentação ${preenchidos}/${total} (falta: ${faltando.join(', ')})`;
}

function progressoSaving(saving: SavingColetado): string {
  const checks: [string, boolean][] = [
    ['pessoas/cargos', saving.linhas != null && saving.linhas.length > 0],
    ['economia de horas', saving.economia_horas_mes != null],
    ['tipo de saving', saving.tipo_saving != null],
    ['memorial de cálculo', saving.memorial_calculo != null],
  ];
  const total = checks.length;
  const preenchidos = checks.filter(([, ok]) => ok).length;
  const faltando = checks.filter(([, ok]) => !ok).map(([nome]) => nome);
  if (faltando.length === 0) return `memorial saving ${preenchidos}/${total} ✓ completo`;
  return `memorial saving ${preenchidos}/${total} (falta: ${faltando.join(', ')})`;
}

function progressoReceita(receita: ReceitaColetada): string {
  const checks: [string, boolean][] = [
    ['tipo de ganho', receita.tipo_saving != null],
    ['valor de receita', receita.valor_ganho_mensal != null],
    ['memorial de cálculo', receita.memorial_calculo != null],
  ];
  const total = checks.length;
  const preenchidos = checks.filter(([, ok]) => ok).length;
  const faltando = checks.filter(([, ok]) => !ok).map(([nome]) => nome);
  if (faltando.length === 0) return `memorial receita ${preenchidos}/${total} ✓ completo`;
  return `memorial receita ${preenchidos}/${total} (falta: ${faltando.join(', ')})`;
}

function progressoPorFase(fase: ChatFase, coletado: DocumentacaoColetada, saving: SavingColetado, receita: ReceitaColetada): string {
  switch (fase) {
    case 'doc':
    case 'doc_preview':
      return progressoDocumentacao(coletado);
    case 'saving':
    case 'saving_preview':
      return progressoSaving(saving);
    case 'receita':
    case 'receita_preview':
      return progressoReceita(receita);
    case 'completo':
      return 'fluxo completo ✓';
    default:
      return '';
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
  if (!data) throw new Error('Projeto não encontrado.');
  const docMsg = await getDocMessage(projeto_id);

  const tiposRaw = parseJson<string[]>(data.tipos_projeto);
  const tiposProjeto = Array.isArray(tiposRaw)
    ? (tiposRaw as ('saving' | 'receita_incremental')[])
    : null;

  const revisao = await buildRevisaoContexto(projeto_id, data);

  return {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    // area_nome vem do join por area_id; cai no texto p.area quando não há id mapeado.
    area: data.area_nome ?? data.area ?? null,
    membros: parseJson<string[]>(data.membros) ?? [],
    nome_projeto: data.nome ?? '',
    data_criacao: data.data_criacao_projeto ?? null,
    doc_texto: docMsg?.content ?? null,
    descricao_breve: data.descricao_breve ?? null,
    tipo_projeto: (data.tipo_projeto as 'saving' | 'receita_incremental' | null) ?? null,
    tipos_projeto: tiposProjeto,
    escopo: (data.escopo as 'interno' | 'externo' | null) ?? null,
    // 'sim'/'nao' — no 'nao' as horas_antes são o equivalente manual estimado, não
    // uma rotina real (o orquestrador valida de forma diferente — sem pedir o passo
    // a passo de uma rotina inexistente).
    alguem_fazia: (data.alguem_fazia as 'sim' | 'nao' | null) ?? null,
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

  const docGerada = docRow?.conteudo
    ? parseJson<DocumentacaoGerada>(docRow.conteudo)
    : null;

  const doc = docGerada
    ? {
        o_que_faz: docGerada.o_que_faz ?? null,
        execucao: docGerada.execucao ?? null,
        // fluxo/dependencias/atencao são estruturados; serializa em texto legível.
        fluxo: Array.isArray(docGerada.fluxo)
          ? docGerada.fluxo.map((f, i) => `${i + 1}. ${f.etapa}: ${f.descricao}`).join('\n')
          : null,
        dependencias: Array.isArray(docGerada.dependencias)
          ? docGerada.dependencias.map((d) => `${d.servico}: ${d.descricao}`).join('; ')
          : null,
        configurar_antes: Array.isArray(docGerada.configurar_antes)
          ? docGerada.configurar_antes.join('; ')
          : null,
        atencao: Array.isArray(docGerada.atencao)
          ? docGerada.atencao.map((a) => `${a.titulo}: ${a.descricao}`).join('; ')
          : null,
      }
    : null;

  const savingDoc = docGerada?.saving;
  const saving = (savingDoc || data.memorial_calculo || data.saving_horas != null)
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
  const receita = data.tipo_projeto === 'receita_incremental' && data.memorial_calculo
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
    if (msg.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msg.content) as Partial<EstadoChat>;
      return {
        fase: parsed.fase ?? 'doc',
        coletado: parsed.coletado ?? documentacaoVazia(),
        saving: parsed.saving ?? savingVazio(),
        receita: parsed.receita ?? receitaVazia(),
      };
    } catch {
      continue;
    }
  }
  return { fase: 'doc', coletado: documentacaoVazia(), saving: savingVazio(), receita: receitaVazia() };
}

function buildHistory(msgs: { role: string; content: string }[]): ChatHistoryMessage[] {
  return msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'assistant') {
        try {
          const parsed = JSON.parse(m.content) as { content?: string; question?: string };
          return { role: 'assistant' as const, content: parsed.content ?? parsed.question ?? m.content };
        } catch {
          return { role: 'assistant' as const, content: m.content };
        }
      }
      return { role: 'user' as const, content: m.content };
    });
}

function extrairResumoProjeto(msgs: { role: string; content: string }[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msg.content) as { type?: string; fase?: string; content?: string };
      if (parsed.type === 'complete' && (parsed.fase === 'saving' || parsed.fase === 'receita') && parsed.content) {
        return parsed.content;
      }
    } catch {
      continue;
    }
  }
  return '';
}

function buildPhaseHistory(
  msgs: { role: string; content: string }[],
  targetFase: 'saving' | 'receita',
): ChatHistoryMessage[] {
  // 1) Marcador de transição (type:complete + fase): a conversa da fase vem depois.
  let startIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msgs[i].content) as { type?: string; fase?: string };
      if (parsed.type === 'complete' && parsed.fase === targetFase) {
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
      if (msgs[i].role !== 'assistant') continue;
      try {
        const parsed = JSON.parse(msgs[i].content) as { fase?: string };
        if (parsed.fase === targetFase) { startIdx = i - 1; break; }
      } catch {
        continue;
      }
    }
  }
  const phaseMsgs = startIdx >= 0 ? msgs.slice(startIdx + 1) : msgs;
  return buildHistory(phaseMsgs);
}

function formatResponse(resultado: ReturnType<typeof runOrchestrator> extends Promise<infer R> ? R : never) {
  return {
    type: resultado.type,
    content: resultado.type === 'options'
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content,
    options: resultado.type === 'options' ? resultado.options : null,
    fase: resultado.fase,
    isPreview: resultado.type === 'preview',
    isComplete: resultado.fase === 'completo',
    coletado: resultado.coletado,
    saving: resultado.saving,
    receita: resultado.receita,
  };
}

function getTiposProjeto(ctx: ProjetoContexto): ('saving' | 'receita_incremental')[] {
  if (ctx.tipos_projeto && ctx.tipos_projeto.length > 0) return ctx.tipos_projeto;
  if (ctx.tipo_projeto) return [ctx.tipo_projeto];
  return ['saving'];
}

// ─── Schemas de validação de entrada ────────────────────────────────────────

const iniciarSubmissaoSchema = z.object({
  responsavel_nome: z.string().min(1).max(120),
  responsavel_email: z.string().email().max(255),
  area_id: z.string().min(1).optional(),
  // A área não é mais escolhida no formulário — é derivada do email (TeamGuide)
  // na submissão (submeterParaValidacao). Aqui o projeto nasce sem área.
  area: z.string().min(1).max(100).optional(),
  ferramenta: z.string().min(1).max(200),
  escopo: z.enum(['interno', 'externo']).optional(),
  servico_externo: z.string().max(200).optional(),
  membros: z.array(z.string()).default([]),
  nome_projeto: z.string().min(1).max(200),
  data_criacao: z.string(),
  tipo_projeto: z.enum(['saving', 'receita_incremental']).optional(),
  tipos_projeto: z.array(z.enum(['saving', 'receita_incremental'])).optional(),
  descricao_breve: z.string().max(1000).optional(),
  // Governança: o projeto usa o AI Proxy interno (gateway de IA da empresa)?
  usa_ai_proxy: z.enum(['sim', 'nao']).optional(),
  // Projeto especial: altíssimo impacto que não se encaixa em saving/receita.
  // Quando true, o fluxo pula a análise financeira e o analisador IA (validação humana).
  especial: z.boolean().optional(),
  contexto_especial: z.string().max(2000).optional(),
  docs: z.array(
    z.object({ base64: z.string().min(1), filename: z.string().min(1) })
  ).min(1).max(5000),
});

const enviarMensagemSchema = z.object({
  projeto_id: z.string().min(1),
  content: z.string().min(1).max(4000),
  selected_option: z.number().optional(),
});

const iniciarSavingSchema = z.object({
  projeto_id: z.string().min(1),
  tipo_saving: z.enum(['mensal', 'pontual']),
  // Havia alguém fazendo/mantendo o processo manualmente antes da automação?
  // 'sim' → horas reais; 'nao' → contrafactual (equivalente manual estimado);
  // 'externo' → ninguém fazia internamente e o ganho é 100% um custo externo
  // eliminado (SEM horas — só custo evitado). Árvore em step3-chat/constants.
  alguem_fazia: z.enum(['sim', 'nao', 'externo']).optional(),
  linhas: z.array(z.object({
    cargo: z.string(),
    horas_antes: z.number().min(0),
    horas_depois: z.number().min(0),
  })).optional(),
  custo_externo_mensal: z.number().min(0).optional(),
  // Custo evitado: a solução fez a empresa deixar de pagar ferramentas/serviços
  // externos? Lista incremental coletada no formulário (≠ custo_externo_mensal,
  // que é o custo INCORRIDO pela automação). Cada item: recorrência 'pontual' é
  // mensalizada ÷12; 'mensal' entra cheia. Soma ao saving (custo_evitado_reais).
  tem_custo_evitado: z.enum(['sim', 'nao']).optional(),
  custo_evitado_itens: z.array(z.object({
    nome: z.string(),
    valor: z.number().min(0),
    recorrencia: z.enum(['mensal', 'pontual']),
    justificativa: z.string(),
  })).optional(),
});

const iniciarReceitaSchema = z.object({
  projeto_id: z.string().min(1),
  tipo_saving: z.enum(['mensal', 'pontual']),
  // Valor de receita informado pela pessoa no formulário determinístico. O agente
  // recebe esse valor pré-preenchido e o DESAFIA (em vez de coletar do zero).
  valor_ganho_mensal: z.number().min(0).optional(),
  // Racional curto (de onde vem a receita) — ponto de partida para o agente aprofundar.
  racional: z.string().max(500).optional(),
});

const submeterValidacaoSchema = z.object({
  projeto_id: z.string().min(1),
  modo: z.enum(['novo', 'edicao']).optional(),
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
  const descricao = data.descricao_breve?.trim() ?? '';
  const contexto = data.contexto_especial?.trim() ?? '';
  const oQueFaz =
    [descricao, contexto].filter(Boolean).join('\n\n') ||
    'Projeto de alto impacto e difícil mensuração — submetido para validação humana.';

  return {
    titulo: data.nome_projeto,
    responsavel: { nome: data.responsavel_nome, email: data.responsavel_email, area: null },
    ferramenta: data.ferramenta,
    membros: data.membros,
    o_que_faz: oQueFaz,
    execucao: '—',
    dependencias: [],
    fluxo: [],
    configurar_antes: [],
    atencao: [],
    gerado_em: new Date().toISOString(),
  };
}

// ─── Iniciar submissão ───────────────────────────────────────────────────────

export async function iniciarSubmissao(rawData: unknown) {
  const data = iniciarSubmissaoSchema.parse(rawData);
  log('iniciarSubmissao', `Iniciando para "${data.nome_projeto}" (${data.responsavel_email})`);

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
      nome: data.nome_projeto,
      data_criacao_projeto: data.data_criacao,
      // Projeto especial: marca "Tipo de Projeto" como "especial" (banco + planilha)
      // e ignora os tipos financeiros — o fluxo não passa pelas fases de saving/receita.
      tipo_projeto: data.especial ? 'especial' : (data.tipo_projeto ?? null),
      tipos_projeto: data.especial ? ['especial'] : (data.tipos_projeto ?? null),
      descricao_breve: data.descricao_breve ?? null,
      usa_ai_proxy: data.usa_ai_proxy ?? null,
      especial: data.especial ?? false,
      contexto_especial: data.especial ? (data.contexto_especial ?? null) : null,
      status: 'rascunho',
    });
  } catch (projErr) {
    err('iniciarSubmissao', 'Falha ao criar projeto:', projErr);
    throw new Error(`Falha ao criar projeto: ${projErr instanceof Error ? projErr.message : 'erro desconhecido'}`);
  }
  log('iniciarSubmissao', `Projeto criado: ${projeto.id}`);

  // Evento de timeline: valores determinísticos das etapas 1 e 2 (não viram chat).
  await gravarEvento(projeto.id, 'submissao', 'doc', {
    nome_projeto: data.nome_projeto,
    escopo: data.escopo ?? null,
    ferramenta: data.ferramenta,
    servico_externo: data.servico_externo ?? null,
    membros: data.membros,
    data_criacao: data.data_criacao,
    tipos_projeto: data.especial ? ['especial'] : (data.tipos_projeto ?? (data.tipo_projeto ? [data.tipo_projeto] : [])),
    descricao_breve: data.descricao_breve ?? null,
    usa_ai_proxy: data.usa_ai_proxy ?? null,
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

  let docTexto = '';
  try {
    docTexto = await extractTextFromMultipleFiles(data.docs);
    log('iniciarSubmissao', `Texto extraído de ${data.docs.length} arquivo(s): ${docTexto.length} chars`);
  } catch (extractErr) {
    err('iniciarSubmissao', 'Erro na extração de texto:', extractErr);
    docTexto = '';
  }

  await insertChatMessage({
    projeto_id: projeto.id,
    role: 'doc',
    content: docTexto || '(documento sem texto legível)',
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
    log('iniciarSubmissao', `Projeto especial ${projeto.id}: doc montada sem IA, pronto para submissão.`);
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
      log('iniciarSubmissao', 'Rodando extrator automático...');
      coletadoInicial = await extrairCamposDocumentacao(ctx, docTexto || '');
      const preenchidos = Object.values(coletadoInicial).filter(v => v !== null).length;
      log('iniciarSubmissao', `Extrator: ${preenchidos}/7 campos preenchidos`);
    } catch (extractorErr) {
      err('iniciarSubmissao', 'Extrator falhou — continuando sem pré-preenchimento:', extractorErr);
      coletadoInicial = { ...documentacaoVazia(), nome_projeto: data.nome_projeto };
    }
  }

  log('iniciarSubmissao', 'Rodando orquestrador (fase doc)...');
  const resultado = await runOrchestrator(ctx, [], 'doc', coletadoInicial, savingVazio());

  await insertChatMessage({
    projeto_id: projeto.id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  const respContent = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 🆕 NOVA SUBMISSÃO: "${data.nome_projeto}"`);
  console.log(`│ 📄 Arquivos: ${data.docs.length} arquivo(s), ${docTexto ? docTexto.length + ' chars extraídos' : 'sem texto'}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoDocumentacao(resultado.coletado)}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

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
  const memorial = saving?.memorial_calculo ?? '';
  if (!memorial) return null;
  const totalGravado = saving?.economia_horas_mes ?? 0;
  // Captura todos os "Economia total ...: X h" declarados no texto.
  const declarados = [...memorial.matchAll(/economia\s+total[^\n:]*:\s*([\d.,]+)\s*h/gi)]
    .map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')))
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
  return 'Antes de eu fechar o memorial: a base padrão que eu uso é de **220h úteis por mês (22 dias úteis, seg–sex)**. Para fechar certo — alguém de fato **trabalha ou usa esse processo nos fins de semana** (uma pessoa, não apenas a automação rodando sozinha)?';
}

// Opções (botões) da pergunta de jornada. Índice 1 = só dias úteis, 2 = fim de semana.
const OPCOES_JORNADA = ['Não, só em dias úteis', 'Sim, há trabalho/uso humano no fim de semana'];

// Interpreta a resposta. O botão envia o índice (1=dias úteis, 2=fim de semana).
// Texto digitado cai no fallback por regex (negação vence — "não trabalho fim de
// semana" = dias_uteis). null = ambíguo (re-pergunta determinística).
function interpretarJornada(content: string, selectedOption: number | null): 'dias_uteis' | 'fim_de_semana' | null {
  if (selectedOption === 1) return 'dias_uteis';
  if (selectedOption === 2) return 'fim_de_semana';
  const t = (content ?? '').trim().toLowerCase();
  if (!t) return null;
  // Negação explícita vence (cobre "não, só dias úteis", "não trabalhamos fim de semana").
  if (/\bn[ãa]o\b/.test(t) || /\b(s[óo]|somente|apenas)\s+(dias?\s*[úu]teis|semana)/.test(t) || /dias?\s*[úu]teis/.test(t)) return 'dias_uteis';
  if (/\b(sim|s)\b/.test(t) || /(fim|final|fins)\s+de\s+semana|finais?\s+de\s+semana|s[áa]bado|domingo|\bfds\b|fim\s*de\s*sem/.test(t)) return 'fim_de_semana';
  return null;
}

const NUDGE_JORNADA_UTIL =
  '[SISTEMA] O usuário confirmou (botão) que o trabalho/uso do processo é SÓ em dias úteis. Mantenha o TETO de 220h/mês por PESSOA (22 dias úteis). Se alguma linha implicar mais de ~220h/mês para UM indivíduo (descontando multiplicadores de lojas/unidades), reconcilie para baixo até caber na semana útil ANTES de gerar o preview. Se tudo já estiver dentro do teto, siga para o preview. NÃO pergunte sobre isso de novo.';
const NUDGE_JORNADA_FIMSEMANA =
  '[SISTEMA] O usuário afirmou (botão) que há trabalho/uso HUMANO no fim de semana. VALIDE com cuidado antes de elevar a base: confirme que é mesmo uma PESSOA que trabalha/usa/se beneficia do processo no sábado/domingo (não basta a automação rodar) e quantos dias por semana de fato. Só então a base por pessoa pode subir proporcionalmente, até no MÁXIMO 30 dias úteis/mês (~300h; 6 dias ≈ 26 dias/264h, 7 dias ≈ 30 dias/300h). Ajuste as linhas (horas_antes/horas_depois) conforme a base validada. Se, ao questionar, ficar claro que só a automação roda no fim de semana (ninguém trabalha nem consome), NÃO eleve a base — mantenha 220h e reconcilie. NÃO repita a pergunta de fim de semana.';

// ─── Gate determinístico 2: TETO por pessoa (uma LINHA acima do teto) ────────
// Camada de segurança DURA sobre o teto de horas. O teto por pessoa (220h dias
// úteis / 300h com fim de semana humano) é, por prompt, só persuasão — o LLM pode
// ceder se o usuário insistir num número impossível para uma pessoa. Aqui o backend
// IMPEDE o preview enquanto uma linha passar do teto, A NÃO SER que o usuário
// confirme (com botões) que a linha soma VÁRIAS pessoas/unidades (caso multiplicador
// legítimo, ex.: várias lojas — que o sistema não consegue distinguir só pelas horas).
function tetoPorJornada(jornada: SavingColetado['jornada_base']): number {
  return jornada === 'fim_de_semana' ? 300 : 220;
}
function linhasAcimaDoTeto(linhas: SavingColetado['linhas'], cap: number) {
  return (linhas ?? []).filter((l) => (l.horas_antes ?? 0) > cap);
}
function perguntaTetoPessoa(excedentes: SavingColetado['linhas'], cap: number): string {
  const lista = (excedentes ?? []).map((l) => `${l.cargo} (${l.horas_antes}h/mês)`).join(', ');
  return `Preciso confirmar um ponto antes de fechar: ${lista} ${(excedentes ?? []).length > 1 ? 'aparecem' : 'aparece'} acima do teto de **${cap}h/mês por pessoa** (uma pessoa não trabalha mais que isso no mês). Esse total é de **uma pessoa só** ou **representa várias pessoas/unidades** (ex.: várias lojas, vários colaboradores)?`;
}
const OPCOES_TETO = ['É uma pessoa só (vou corrigir as horas)', 'Representa várias pessoas/unidades (lojas, colaboradores)'];
// Interpreta a resposta do teto. Texto primeiro (robusto p/ clique E digitação),
// índice 1-based como apoio (frontend: 1=pessoa, 2=múltiplo). null = ambíguo.
function interpretarTetoPessoa(content: string, selectedOption: number | null): 'pessoa' | 'multiplo' | null {
  const t = (content ?? '').trim().toLowerCase();
  if (/(v[áa]ri[ao]s?|m[úu]ltipl|lojas?|unidades?|colaboradores?|filia|por (loja|unidade)|cada (loja|unidade|colaborador)|equipe inteira)/.test(t)) return 'multiplo';
  if (/(uma pessoa|uma s[óo]|s[óo] (uma|um)\b|[ée] uma pessoa|corrig|reduz|ajust)/.test(t)) return 'pessoa';
  if (selectedOption === 2) return 'multiplo';
  if (selectedOption === 1) return 'pessoa';
  return null;
}
const NUDGE_TETO_MULTIPLO =
  '[SISTEMA] O usuário confirmou (botão) que a(s) linha(s) acima do teto somam VÁRIAS pessoas/unidades (não uma só) — então o total é legítimo (cada pessoa fica dentro do teto). Pode prosseguir e gerar o preview se o resto estiver completo. NÃO repita essa pergunta. No memorial, registre quantas pessoas/unidades compõem essas horas.';
function nudgeTetoPessoa(cap: number): string {
  return `[SISTEMA] O usuário confirmou que a(s) linha(s) acima do teto é(são) de UMA pessoa só — o que é IMPOSSÍVEL, pois uma pessoa não trabalha mais que ${cap}h/mês. RECONCILIE agora: reveja volume × tempo com o usuário e ajuste horas_antes dessa(s) linha(s) para no MÁXIMO ${cap}h/mês ANTES de gerar o preview. É PROIBIDO gerar preview com uma linha acima de ${cap}h/mês para uma única pessoa.`;
}

// ─── Enviar mensagem ─────────────────────────────────────────────────────────

export async function enviarMensagem(rawData: unknown) {
  const data = enviarMensagemSchema.parse(rawData);
  log('enviarMensagem', `projeto=${data.projeto_id}`);

  // Histórico montado a partir das mensagens JÁ persistidas + o novo turno do
  // usuário (ainda NÃO persistido). Só gravamos a conversa depois que o turno é
  // concluído com sucesso — assim, se a compilação da doc falhar (ver abaixo),
  // nada fica salvo pela metade e o usuário pode simplesmente tentar de novo.
  const msgs = await getChatMessagesExcludeRole(data.projeto_id, 'doc');

  const estado = extrairEstado(msgs ?? []);

  let history: ChatHistoryMessage[];
  let resumoProjeto = '';
  if (estado.fase === 'saving' || estado.fase === 'saving_preview') {
    history = buildPhaseHistory(msgs ?? [], 'saving');
    resumoProjeto = extrairResumoProjeto(msgs ?? []);
  } else if (estado.fase === 'receita' || estado.fase === 'receita_preview') {
    history = buildPhaseHistory(msgs ?? [], 'receita');
    resumoProjeto = extrairResumoProjeto(msgs ?? []);
  } else {
    history = buildHistory(msgs ?? []);
  }
  history.push({ role: 'user', content: data.content });

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);
  log('enviarMensagem', `Fase: ${estado.fase}, histórico: ${history.length} msgs, tipos: ${tiposProjeto.join(',')}`);

  // ── GATE JORNADA-BASE (220h/mês = TETO) — turno de RESPOSTA à pergunta ───────
  // Quando a jornada está 'pendente', este turno do usuário É a resposta (dias úteis
  // × fim de semana). Registramos no estado e injetamos um nudge [SISTEMA] (efêmero,
  // não persistido): dias úteis → manter teto de 220h/pessoa; fim de semana → validar
  // trabalho humano e elevar até no máx. 30 dias. Resposta ambígua → re-pergunta
  // determinística (sem chamar o orquestrador).
  const gateBaseHoras = estado.fase === 'saving' && aplicaConfirmacaoBaseHoras(ctx, estado.saving);
  let reask: OrchestratorResult | null = null;
  if (gateBaseHoras && estado.saving.jornada_base === 'pendente') {
    // (1) Turno de resposta à JORNADA (dias úteis × fim de semana).
    const resp = interpretarJornada(data.content, data.selected_option ?? null);
    if (resp === null) {
      log('enviarMensagem', 'Jornada-base: resposta ambígua — re-perguntando (dias úteis × fim de semana)');
      reask = {
        type: 'options', question: perguntaJornada(), options: OPCOES_JORNADA,
        fase: 'saving', coletado: estado.coletado,
        saving: { ...estado.saving, jornada_base: 'pendente' }, receita: estado.receita,
      };
    } else {
      log('enviarMensagem', `Jornada-base: usuário respondeu "${resp}"`);
      estado.saving = { ...estado.saving, jornada_base: resp };
      history.push({ role: 'user', content: resp === 'fim_de_semana' ? NUDGE_JORNADA_FIMSEMANA : NUDGE_JORNADA_UTIL });
    }
  } else if (gateBaseHoras && estado.saving.teto_pessoa === 'pendente') {
    // (2) Turno de resposta ao TETO por pessoa (uma pessoa só × várias unidades).
    const cap = tetoPorJornada(estado.saving.jornada_base);
    const resp = interpretarTetoPessoa(data.content, data.selected_option ?? null);
    if (resp === null) {
      log('enviarMensagem', 'Teto-pessoa: resposta ambígua — re-perguntando');
      reask = {
        type: 'options', question: perguntaTetoPessoa(linhasAcimaDoTeto(estado.saving.linhas, cap), cap), options: OPCOES_TETO,
        fase: 'saving', coletado: estado.coletado,
        saving: { ...estado.saving, teto_pessoa: 'pendente' }, receita: estado.receita,
      };
    } else if (resp === 'multiplo') {
      log('enviarMensagem', 'Teto-pessoa: usuário confirmou VÁRIAS unidades — liberado');
      estado.saving = { ...estado.saving, teto_pessoa: 'multiplo' };
      history.push({ role: 'user', content: NUDGE_TETO_MULTIPLO });
    } else {
      // 'pessoa' → uma pessoa só acima do teto é impossível: reset e exige reconciliação.
      log('enviarMensagem', 'Teto-pessoa: uma pessoa só acima do teto — exigindo reconciliação');
      estado.saving = { ...estado.saving, teto_pessoa: null };
      history.push({ role: 'user', content: nudgeTetoPessoa(cap) });
    }
  }

  const resultado = reask ?? await runOrchestrator(
    ctx,
    history,
    estado.fase,
    estado.coletado,
    estado.saving,
    resumoProjeto,
    tiposProjeto,
    estado.receita,
  );

  // O orquestrador adota o `saving` ecoado pelo LLM (que NÃO inclui os campos de gate).
  // Re-mescla os campos gerenciados pelo backend para que façam round-trip no estado.
  if (resultado.saving) {
    resultado.saving = {
      ...resultado.saving,
      jornada_base: estado.saving.jornada_base ?? null,
      teto_pessoa: estado.saving.teto_pessoa ?? null,
    };
  }

  // ── SAFETY NET: memorial_calculo no objeto saving/receita ──────────────────
  // O LLM às vezes coloca o memorial apenas no campo "content" e deixa
  // saving.memorial_calculo / receita.memorial_calculo como null no JSON.
  // Isso faz o memorial virar "-" na planilha. Extraímos do content como fallback.
  if ((resultado.type === 'preview' || resultado.type === 'complete') && resultado.type !== 'options') {
    const conteudoMsg = (resultado as { content?: string }).content ?? '';
    const memorialTexto = conteudoMsg.replace(/\n+Está correto\?[\s\S]*$/, '').trim();
    if (memorialTexto.length > 50) {
      if ((estado.fase === 'saving' || estado.fase === 'saving_preview') &&
          resultado.saving && !resultado.saving.memorial_calculo) {
        resultado.saving = { ...resultado.saving, memorial_calculo: memorialTexto };
        log('enviarMensagem', 'memorial_calculo (saving) extraído do content — LLM não populou o campo');
      }
      if ((estado.fase === 'receita' || estado.fase === 'receita_preview') &&
          resultado.receita && !resultado.receita.memorial_calculo) {
        resultado.receita = { ...resultado.receita, memorial_calculo: memorialTexto };
        log('enviarMensagem', 'memorial_calculo (receita) extraído do content — LLM não populou o campo');
      }
    }
  }

  // ── VALIDAÇÃO ANTI-ZERO: safety net hardcoded ──────────────────────────────
  // Mesmo com prompts instruindo a IA, o LLM pode gerar complete/preview com
  // economia ou receita zeradas. Interceptamos aqui e forçamos volta à coleta.
  // Mutamos o resultado direto — são objetos locais, sem risco de side-effect.
  if (resultado.type === 'complete') {
    // Saving: NÃO pode completar sem NENHUM ganho. O ganho válido vem de horas OU
    // de um custo evitado — então só bloqueamos quando 0h E sem custo evitado.
    // Exceção explícita: custo evitado PURO (alguem_fazia='externo') — o ganho é o
    // contrato cancelado (0h por design), validado no submit; não bloqueia por 0h.
    if (tiposProjeto.includes('saving') && (estado.fase === 'saving_preview' || estado.fase === 'saving')) {
      const savingRecomputado = recomputarSavingFinanceiro(resultado.saving, 0);
      const econHoras = savingRecomputado.economia_horas_mes ?? 0;
      const temCustoEvitado = (savingRecomputado.custo_evitado_reais ?? 0) > 0;
      const custoEvitadoPuro = ctx.alguem_fazia === 'externo';
      if (econHoras <= 0 && !temCustoEvitado && !custoEvitadoPuro) {
        log('enviarMensagem', `⛔ Saving sem ganho (0h e sem custo evitado) — bloqueando complete, forçando question`);
        Object.assign(resultado, {
          type: 'question',
          content: 'Não consigo finalizar o memorial sem nenhum ganho concreto — o projeto precisa economizar horas OU evitar um custo externo (contrato/serviço/licença). Vamos revisar: onde exatamente está o ganho?',
          fase: 'saving',
        });
      }
    }

    // Receita: valor_ganho_mensal NUNCA pode ser 0 ao completar
    if (tiposProjeto.includes('receita_incremental') && (estado.fase === 'receita_preview' || estado.fase === 'receita')) {
      const ganho = resultado.receita?.valor_ganho_mensal ?? 0;
      if (ganho <= 0) {
        log('enviarMensagem', `⛔ Receita com valor_ganho_mensal=${ganho} — bloqueando complete, forçando question`);
        Object.assign(resultado, {
          type: 'question',
          content: 'Não consigo finalizar o memorial com ganho de R$ 0 — se o projeto gera receita incremental, preciso de um valor concreto. Vamos revisar: qual é o ganho real de receita que o projeto gera?',
          fase: 'receita',
        });
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
    (resultado.type === 'preview' || resultado.type === 'complete')
  ) {
    log('enviarMensagem', '⛔ Preview/complete do saving sem a jornada-base definida — forçando pergunta (dias úteis × fim de semana)');
    const savingComFlag: SavingColetado = {
      ...((resultado.saving ?? estado.saving) as SavingColetado),
      jornada_base: 'pendente',
    };
    Object.assign(resultado, {
      type: 'options',
      question: perguntaJornada(),
      options: OPCOES_JORNADA,
      fase: 'saving',
      saving: savingComFlag,
    });
    delete (resultado as { content?: string }).content;
  }

  // ── GATE TETO POR PESSOA — bloqueia preview com linha acima do teto ─────────
  // Roda DEPOIS da jornada (que define o teto: 220h dias úteis / 300h fim de semana).
  // Se alguma LINHA tem horas_antes acima do teto e o usuário ainda NÃO confirmou que
  // ela soma várias pessoas/unidades, não deixa o preview/complete passar: força a
  // pergunta (uma pessoa × várias unidades). 'multiplo' libera; senão, exige reconciliar.
  const jornadaDefinida = estado.saving.jornada_base === 'dias_uteis' || estado.saving.jornada_base === 'fim_de_semana';
  if (
    gateBaseHoras &&
    jornadaDefinida &&
    estado.saving.teto_pessoa !== 'multiplo' &&
    (resultado.type === 'preview' || resultado.type === 'complete')
  ) {
    const cap = tetoPorJornada(estado.saving.jornada_base);
    const linhasAtuais = (resultado.saving?.linhas ?? estado.saving.linhas) as SavingColetado['linhas'];
    const excedentes = linhasAcimaDoTeto(linhasAtuais, cap);
    if (excedentes.length) {
      log('enviarMensagem', `⛔ Preview do saving com linha acima do teto de ${cap}h/pessoa (${excedentes.map((l) => `${l.cargo}:${l.horas_antes}h`).join(', ')}) — forçando pergunta (uma pessoa × várias unidades)`);
      const savingComFlag: SavingColetado = {
        ...((resultado.saving ?? estado.saving) as SavingColetado),
        teto_pessoa: 'pendente',
      };
      Object.assign(resultado, {
        type: 'options',
        question: perguntaTetoPessoa(excedentes, cap),
        options: OPCOES_TETO,
        fase: 'saving',
        saving: savingComFlag,
      });
      delete (resultado as { content?: string }).content;
    }
  }

  // Aprovação da documentação (doc_preview → impacto): a compilação da doc é o
  // CERNE do produto e é feita pelo agente — NÃO há fallback. Compilamos e
  // salvamos ANTES de confirmar a transição. Se a IA não devolver uma doc válida
  // (mesmo após os retries internos), compilarDocumentacao lança: abortamos o
  // turno SEM persistir nada, e o usuário continua no preview podendo aprovar de
  // novo (o frontend faz rollback da mensagem e exibe o erro).
  if ((resultado.fase === 'saving' || resultado.fase === 'receita') && estado.fase === 'doc_preview') {
    log('enviarMensagem', 'Doc aprovada — compilando documentação...');
    const doc = await compilarDocumentacao(ctx, resultado.coletado);
    await upsertDocumentacao(data.projeto_id, doc);
    log('enviarMensagem', 'Documentação compilada e salva.');
  }

  // Turno concluído com sucesso — agora sim persiste a mensagem do usuário e a resposta.
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'user',
    content: data.content,
    selected_option: data.selected_option ?? null,
  });

  // Se houve transição de fase (ex: doc_preview→saving), preserva a fase de
  // origem no JSON para que o Investigador agrupe a mensagem na fase correta.
  const persistido = resultado.fase !== estado.fase
    ? { ...resultado, fase_origem: estado.fase }
    : resultado;

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(persistido),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  if (resultado.fase === 'completo') {
    log('enviarMensagem', 'Fluxo completo — salvando dados financeiros...');
    const docRow = await getDocumentacao(data.projeto_id);

    if (docRow) {
      const doc = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;
      const tiposProjetoCtx = getTiposProjeto(ctx);
      if (tiposProjetoCtx.includes('saving')) {
        // R$ é sempre re-derivado das horas (o LLM pode ter reajustado horas sem
        // recalcular o valor) — ver recomputarSavingFinanceiro.
        const projetoCompleto = await getProjetoById(data.projeto_id);
        doc.saving = recomputarSavingFinanceiro(resultado.saving, projetoCompleto?.custo_externo_mensal ?? 0);
        avisarDivergenciaMemorialLinhas(doc.saving as SavingColetado, data.projeto_id);
      }
      if (tiposProjetoCtx.includes('receita_incremental')) doc.receita = resultado.receita;
      await upsertDocumentacao(data.projeto_id, doc);
    }

    await updateProjeto(data.projeto_id, { chat_completo: true });
  }

  const respContent2 = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 💬 TURNO DE CONVERSA`);
  console.log(`│ 🔄 Fase: ${estado.fase} → ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoPorFase(resultado.fase, resultado.coletado, resultado.saving, resultado.receita ?? receitaVazia())}`);
  console.log('│ 👤 Usuário:');
  data.content.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('│ 🤖 IA:');
  respContent2.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  if (resultado.type === 'options') {
    console.log(`│ 📋 Opções: ${(resultado as { options: string[] }).options.join(' | ')}`);
  }
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Iniciar fase saving ─────────────────────────────────────────────────────

export async function iniciarSaving(rawData: unknown) {
  const data = iniciarSavingSchema.parse(rawData);
  log('iniciarSaving', `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  // Reinício limpo: se a pessoa voltou ao formulário determinístico e reenviou,
  // descarta a conversa anterior da fase saving (ancorada nos números antigos).
  // No primeiro início é no-op (ainda não há mensagens após o marcador).
  await deleteChatMessagesAfterFaseMarker(data.projeto_id, 'saving');

  // Persiste no projeto se havia trabalho manual antes (coluna mapeada no n8n/SQL).
  if (data.alguem_fazia) {
    await updateProjeto(data.projeto_id, { alguem_fazia: data.alguem_fazia });
  }

  // Custo evitado: agrega a lista de ferramentas evitadas vinda do formulário.
  // Mensaliza cada item (pontual ÷12; mensal cheio) → valor único que soma ao
  // saving. Persiste sim/não, justificativa concatenada e o detalhe (JSON) no
  // projeto (colunas mapeadas no n8n/planilha).
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const itensEvitado = data.tem_custo_evitado === 'sim' ? (data.custo_evitado_itens ?? []) : [];
  const custoEvitadoMensal = round2(
    itensEvitado.reduce((s, it) => s + (it.recorrencia === 'pontual' ? it.valor / 12 : it.valor), 0),
  );
  // Justificativa do custo evitado = TODAS as informações que a pessoa preencheu
  // na etapa, uma ferramenta por linha: nome + custo (R$ + recorrência) + a
  // justificativa/explicação que ela deu. (O valor R$ TOTAL fica na coluna "Custo
  // Evitado"; aqui é o detalhamento por ferramenta.)
  const moedaBR = (n: number) => n.toFixed(2).replace('.', ',');
  const custoEvitadoDescricao = itensEvitado
    .map((it) => {
      const rec = it.recorrencia === 'pontual' ? 'pontual' : 'mensal';
      const just = it.justificativa?.trim() ? ` ${it.justificativa.trim()}` : '';
      return `• ${it.nome} — R$ ${moedaBR(it.valor)} (${rec}).${just}`;
    })
    .join('\n');
  await updateProjeto(data.projeto_id, {
    custo_evitado: data.tem_custo_evitado ?? null,
    custo_evitado_justificativa: custoEvitadoDescricao || null,
    custo_evitado_itens: JSON.stringify(itensEvitado),
    // Persiste o custo externo (custo INCORRIDO pela automação) no projeto. Sem
    // isto o valor só vivia em memória e se perdia: o submit relê
    // projeto.custo_externo_mensal (null → 0) e não abatia do Saving Reais.
    custo_externo_mensal: data.custo_externo_mensal ?? 0,
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
  saving.custo_evitado_tipo = custoEvitadoMensal > 0 ? 'mensal' : null;
  saving.custo_evitado_descricao = custoEvitadoDescricao || null;

  if (tiposProjeto.includes('saving') && data.linhas && data.linhas.length > 0) {
    const linhas: SavingLinha[] = data.linhas.map((l) => {
      const valorHora = CARGOS.find(c => c.label === l.cargo)?.valor_hora ?? 0;
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
      // Líquido: horas + custo evitado (mensalizado) − custo externo. Mesma
      // fórmula de recomputarSavingFinanceiro (que recalcula do zero no preview).
      economia_reais_mes: round2(totalReaisBruto + custoEvitadoMensal - custoExterno),
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

  const msgs = await getChatMessagesExcludeRole(data.projeto_id, 'doc');

  const resumoProjeto = extrairResumoProjeto(msgs ?? []);
  const estado = extrairEstado(msgs ?? []);

  const resultado = await runOrchestrator(
    ctx,
    [],
    'saving',
    estado.coletado,
    saving,
    resumoProjeto,
    tiposProjeto,
  );

  // Backstop determinístico — CUSTO EVITADO PURO (alguem_fazia='externo'): o ganho é
  // 100% o custo externo eliminado, então o agente NÃO pode carimbar o preview no 1º
  // turno sem argumentar. Se o LLM pulou a validação e já devolveu preview, trocamos
  // por UMA pergunta obrigatória (realidade + atribuição + escopo). O turno seguinte
  // (enviarMensagem) deixa o agente previewar já com a resposta registrada no memorial.
  // (Prompt-only não basta — o LLM tende a pular se o contexto parece claro.)
  if (ctx.alguem_fazia === 'externo' && resultado.type === 'preview') {
    log('iniciarSaving', '⛔ custo evitado puro previewou no 1º turno — forçando validação (realidade/atribuição/escopo)');
    Object.assign(resultado, {
      type: 'question',
      fase: 'saving',
      content:
        'Antes de fechar o memorial, preciso confirmar o ganho — ele vem 100% de um custo externo eliminado, então vale validar:\n' +
        '1) Esse contrato/serviço já foi DE FATO encerrado ou reduzido na prática (não algo que ainda vai acontecer)?\n' +
        '2) O encerramento foi por causa desta automação (ela assumiu o trabalho)?\n' +
        '3) O que esse contrato cobria? (ex.: quantos agentes/pessoas, qual volume de atendimentos por mês)',
    });
  }

  // Evento de timeline: valores do formulário de saving. `voltou` indica reentrada
  // (a pessoa voltou à etapa para reeditar) — já havia um evento 'saving' antes.
  const savingVoltou = await hasFormEventTipo(data.projeto_id, 'saving');
  await gravarEvento(data.projeto_id, 'saving', 'saving', {
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
    economia_horas_mes: saving.economia_horas_mes ?? null,
    economia_reais_mes: saving.economia_reais_mes ?? null,
    custo_evitado_mensal: custoEvitadoMensal > 0 ? custoEvitadoMensal : null,
  });

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  const respContent = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 💰 INÍCIO SAVING: tipos_projeto=${tiposProjeto.join(',')}, tipo_saving=${data.tipo_saving}`);
  if (data.linhas?.length) console.log(`│ 👤 Linhas: ${data.linhas.map(l => `${l.cargo} ${l.horas_antes}→${l.horas_depois}h`).join(' | ')}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoSaving(resultado.saving)}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Iniciar fase receita incremental ────────────────────────────────────────

export async function iniciarReceita(rawData: unknown) {
  const data = iniciarReceitaSchema.parse(rawData);
  log('iniciarReceita', `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  // Reinício limpo: se a pessoa voltou ao formulário determinístico e reenviou,
  // descarta a conversa anterior da fase receita. No primeiro início é no-op.
  await deleteChatMessagesAfterFaseMarker(data.projeto_id, 'receita');

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  const receita = receitaVazia();
  receita.tipo_saving = data.tipo_saving;
  receita.valor_ganho_mensal = data.valor_ganho_mensal ?? null;
  receita.racional = data.racional?.trim() || null;

  const msgs = await getChatMessagesExcludeRole(data.projeto_id, 'doc');

  const resumoProjeto = extrairResumoProjeto(msgs ?? []);
  const estado = extrairEstado(msgs ?? []);

  const resultado = await runOrchestrator(
    ctx,
    [],
    'receita',
    estado.coletado,
    estado.saving,
    resumoProjeto,
    tiposProjeto,
    receita,
  );

  // Evento de timeline: valores do formulário de receita. `voltou` = reentrada.
  const receitaVoltou = await hasFormEventTipo(data.projeto_id, 'receita');
  await gravarEvento(data.projeto_id, 'receita', 'receita', {
    voltou: receitaVoltou,
    tipo_saving: data.tipo_saving,
    valor_ganho_mensal: data.valor_ganho_mensal ?? null,
    racional: data.racional?.trim() || null,
  });

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  const respContent = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 📈 INÍCIO RECEITA: tipos_projeto=${tiposProjeto.join(',')}, tipo_saving=${data.tipo_saving}, valor=${data.valor_ganho_mensal ?? '—'}, racional=${receita.racional ?? '—'}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoReceita(resultado.receita ?? receitaVazia())}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Atualizar tipos do projeto ──────────────────────────────────────────────
// Permite trocar o tipo (saving / receita_incremental) durante o fluxo do agente.
// O orquestrador e a submissão final leem tipos_projeto do banco, então a troca
// no formulário precisa persistir aqui para a fase de impacto refletir a mudança.

const atualizarTiposSchema = z.object({
  projeto_id: z.string().min(1),
  tipos_projeto: z.array(z.enum(['saving', 'receita_incremental'])).min(1),
});

export async function atualizarTipos(rawData: unknown) {
  const data = atualizarTiposSchema.parse(rawData);
  log('atualizarTipos', `projeto=${data.projeto_id}, tipos=${data.tipos_projeto.join(',')}`);
  await updateProjeto(data.projeto_id, {
    tipos_projeto: data.tipos_projeto,
    tipo_projeto: data.tipos_projeto[0],
  });
  await gravarEvento(data.projeto_id, 'tipos', 'doc', {
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
  membros: z.array(z.string()).optional(),
  data_criacao: z.string().optional(),
  descricao_breve: z.string().max(1000).optional(),
  // Governança: o projeto usa o AI Proxy interno (gateway de IA da empresa)?
  usa_ai_proxy: z.enum(['sim', 'nao']).optional(),
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
  docs: z.array(
    z.object({ base64: z.string().min(1), filename: z.string().min(1) })
  ).max(5000).optional(),
});

export async function atualizarMetadados(rawData: unknown) {
  const data = atualizarMetadadosSchema.parse(rawData);
  const temDocs = !!data.docs && data.docs.length > 0;
  log('atualizarMetadados', `projeto=${data.projeto_id}, docs=${temDocs ? data.docs!.length : 0}`);

  // 1. Persiste os campos de texto fornecidos (o agente lê frescos no próximo turno).
  const campos: Record<string, unknown> = {};
  if (data.nome_projeto !== undefined) campos.nome = data.nome_projeto;
  if (data.area !== undefined) campos.area = data.area;
  if (data.ferramenta !== undefined) campos.ferramenta = data.ferramenta;
  if (data.membros !== undefined) campos.membros = data.membros;
  if (data.data_criacao !== undefined) campos.data_criacao_projeto = data.data_criacao;
  if (data.descricao_breve !== undefined) campos.descricao_breve = data.descricao_breve;
  if (data.usa_ai_proxy !== undefined) campos.usa_ai_proxy = data.usa_ai_proxy;
  if (data.contexto_especial !== undefined) campos.contexto_especial = data.contexto_especial;
  if (Object.keys(campos).length > 0) {
    await updateProjeto(data.projeto_id, campos);
  }

  // Evento de timeline: edição de metadados das etapas anteriores. `voltou` quando
  // a mudança reinicia a documentação (arquivos novos ou reset_doc). Só registra se
  // houve algo relevante (campos alterados, arquivos novos ou pedido de reset).
  const metadadosReset = temDocs || !!data.reset_doc;
  if (Object.keys(campos).length > 0 || metadadosReset) {
    await gravarEvento(data.projeto_id, 'metadados', 'doc', {
      voltou: metadadosReset,
      reset_doc: metadadosReset,
      campos: {
        nome: data.nome_projeto ?? null,
        area: data.area ?? null,
        ferramenta: data.ferramenta ?? null,
        membros: data.membros ?? null,
        data_criacao: data.data_criacao ?? null,
        descricao_breve: data.descricao_breve ?? null,
        usa_ai_proxy: data.usa_ai_proxy ?? null,
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
  const ehEspecial = data.especial === true || ctxData?.especial === 1;
  if (ehEspecial) {
    // Garante a marcação de especial no banco (cobre legado convertido em especial na
    // edição) — alinha tipo_projeto/tipos_projeto com o que iniciarSubmissao grava.
    await updateProjeto(data.projeto_id, {
      especial: true,
      tipo_projeto: 'especial',
      tipos_projeto: ['especial'],
    });
    const docEspecial = buildDocEspecial({
      nome_projeto: data.nome_projeto ?? ctxData?.nome ?? '',
      responsavel_nome: ctxData?.responsavel_nome ?? '',
      responsavel_email: ctxData?.responsavel_email ?? '',
      ferramenta: data.ferramenta ?? ctxData?.ferramenta ?? '',
      membros: data.membros ?? parseJson<string[]>(ctxData?.membros ?? null) ?? [],
      descricao_breve: data.descricao_breve ?? ctxData?.descricao_breve ?? undefined,
      contexto_especial: data.contexto_especial ?? ctxData?.contexto_especial ?? undefined,
    });
    await upsertDocumentacao(data.projeto_id, docEspecial);
    await updateProjeto(data.projeto_id, { chat_completo: true });
    log('atualizarMetadados', `Projeto especial ${data.projeto_id}: doc reconstruída sem IA, pronto para reenvio.`);
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
  let docTexto = '';
  if (temDocs) {
    try {
      docTexto = await extractTextFromMultipleFiles(data.docs!);
      log('atualizarMetadados', `Texto re-extraído de ${data.docs!.length} arquivo(s): ${docTexto.length} chars`);
    } catch (extractErr) {
      err('atualizarMetadados', 'Erro na re-extração de texto:', extractErr);
      docTexto = '';
    }
  } else {
    const docMsg = await getDocMessage(data.projeto_id);
    docTexto = docMsg?.content ?? '';
    log('atualizarMetadados', `reset_doc — reusando texto já extraído: ${docTexto.length} chars`);
  }

  const ctx = await getProjetoContexto(data.projeto_id);

  let coletadoInicial: DocumentacaoColetada = {
    ...documentacaoVazia(),
    nome_projeto: ctx.nome_projeto,
  };
  if (docTexto || ctx.descricao_breve) {
    try {
      coletadoInicial = await extrairCamposDocumentacao(ctx, docTexto || '');
    } catch (extractorErr) {
      err('atualizarMetadados', 'Extrator falhou — seguindo sem pré-preenchimento:', extractorErr);
      coletadoInicial = { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto };
    }
  }

  // Última operação que pode lançar. Se chegou aqui, a nova doc está pronta.
  const resultado = await runOrchestrator(ctx, [], 'doc', coletadoInicial, savingVazio());

  // ── TROCA (só agora) — apaga o antigo e grava o novo. Sequência curta de ops de
  // banco, sem trabalho de rede no meio que possa ser cancelado deixando estado parcial.
  await deleteChatMessagesByProjeto(data.projeto_id);
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'doc',
    content: docTexto || '(documento sem texto legível)',
  });
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });
  // Nomes dos arquivos atualizados só após o sucesso da regeneração (o link do Drive
  // é gerado depois, em submeterParaValidacao).
  if (temDocs) {
    await updateProjeto(data.projeto_id, {
      arquivos_nomes: data.docs!.map((d) => d.filename),
    });
  }

  log('atualizarMetadados', `Documentação reiniciada — fase: ${resultado.fase}`);
  return { ok: true, reset: true, response: formatResponse(resultado) };
}

// ─── Analisar projeto (pré-submissão) ───────────────────────────────────────

const analisarProjetoSchema = z.object({ projeto_id: z.string().min(1) });

export async function analisarProjetoFn(rawData: unknown) {
  const { projeto_id } = analisarProjetoSchema.parse(rawData);
  log('analisarProjeto', `projeto=${projeto_id}`);

  const resultado = await analisarProjetoAgent(projeto_id);

  // Projeto especial: a decisão de status é 100% humana — o analisador só agrega
  // complexidade + parecer (observações), incl. o veredito de "é mesmo especial?".
  const projetoAtual = await getProjetoById(projeto_id);
  const ehEspecial = projetoAtual?.especial === 1;

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
  const statusVeredito = resultado.resultado === 'aprovado' ? 'aprovado' : 'rejeitado';

  // Buscar documentação para calcular materialidade (teto de R$ 5k/mês)
  const docRow = await getDocumentacao(projeto_id);
  const conteudo = (parseJson<Record<string, unknown>>(docRow?.conteudo ?? '{}') ?? {}) as Record<string, unknown>;

  // Teto de materialidade: projetos acima de R$ 5k/mês exigem validação humana independente do veredito.
  const TETO_MATERIALIDADE_ANALISE = 5000;
  const materialidadeProjeto = calcularMaterialidade(
    conteudo.saving as Record<string, unknown> | undefined,
    conteudo.receita as Record<string, unknown> | undefined,
  );
  const statusFinal = ehEspecial
    ? 'em_validacao' // especial nunca auto-aprova/reprova — validação humana
    : materialidadeProjeto > TETO_MATERIALIDADE_ANALISE
      ? 'em_validacao'
      : statusVeredito;
  if (!ehEspecial && materialidadeProjeto > TETO_MATERIALIDADE_ANALISE) {
    log(`Materialidade R$ ${Math.round(materialidadeProjeto)}/mês > R$ ${TETO_MATERIALIDADE_ANALISE} → status forçado para em_validacao (analisador havia retornado '${statusVeredito}')`);
  }

  await updateProjeto(projeto_id, {
    complexidade: resultado.complexidade,
    observacoes,
    status: statusFinal,
    // Especial não é "validado" pelo analisador — quem valida é o humano; não carimba validated_at.
    ...(ehEspecial ? {} : { validated_at: new Date().toISOString() }),
  });

  log('analisarProjeto', `Resultado: ${resultado.resultado} → status=${statusFinal} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`);

  // ── Sync Google (planilha + chat) — fire-and-forget ──
  {
    const projeto = await getProjetoById(projeto_id);
    // TEMPORÁRIO: enquanto validamos a eficácia do formulário, projetos aprovados
    // pelo analisador também vão como "Pendente" na planilha — a aprovação
    // automática não é refletida no Sheets. O status interno (SQLite/dashboard)
    // continua correto. Reverter para 'Aprovado' quando a validação terminar.
    const statusLabel = ehEspecial
      ? 'Pendente' // especial → sempre validação humana
      : resultado.resultado === 'aprovado' ? 'Pendente' : (materialidadeProjeto > TETO_MATERIALIDADE_ANALISE ? 'Pendente' : 'Reenvio Pendente');

    // AGUARDADO (não fire-and-forget): assim o sync da Complexidade/Observações faz
    // parte da promise da análise. Evita o FAF aninhado que o runtime cancelava,
    // deixando a coluna "Complexidade" vazia de forma intermitente. O cron de
    // reconciliação (reconciliarComplexidade) é a rede de segurança para os casos em
    // que a própria análise é cancelada antes de concluir.
    await syncUpdateToGoogle({
      projetoId: projeto_id,
      projectName: projeto?.nome ?? '',
      complexidade: resultado.complexidade,
      observacoes: observacoes ?? '',
      status: statusLabel,
    });
  }

  return resultado;
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
export async function reconciliarComplexidade(maxReanalises = 15) {
  // Mapa id→Complexidade da planilha (1 leitura). Só os SUBMETIDOS no SQLite são
  // candidatos (evita varrer ~270 legados sem submissão).
  const rows = await readAllRows();
  const compNaPlanilha = new Map<string, string>();
  for (const r of rows) {
    const id = (r['ID Projeto'] ?? '').toString().trim().toLowerCase();
    if (id) compNaPlanilha.set(id, (r['Complexidade'] ?? '').toString().trim());
  }

  const submetidos = await getProjetosSubmetidos();
  let ressincronizados = 0;
  let reanalisados = 0;
  let faltando = 0;

  for (const p of submetidos) {
    const comp = compNaPlanilha.get(String(p.id).trim().toLowerCase());
    // Pula quem já tem complexidade não-vazia na planilha (ou nem está nela).
    if (comp === undefined || (comp !== '' && comp !== '—')) continue;
    faltando++;

    const compSqlite = (p.complexidade ?? '').toString().trim();
    try {
      if (compSqlite) {
        // Só faltou o sync para o Sheets: repõe direto (SEM notificar o Chat).
        await updateRowByProjectId(p.id, {
          'Complexidade': p.complexidade as string,
          'Observações': (p.observacoes as string | null)?.trim() ? (p.observacoes as string) : '—',
        });
        ressincronizados++;
      } else if (reanalisados < maxReanalises) {
        // Análise nunca concluiu: re-roda (analisa + sincroniza, aguardado).
        await analisarProjetoFn({ projeto_id: p.id });
        reanalisados++;
      }
    } catch (e) {
      err('reconciliarComplexidade', `Falha ao reconciliar ${p.id}:`, e);
    }
  }

  log('reconciliarComplexidade', `faltando=${faltando} ressincronizados=${ressincronizados} reanalisados=${reanalisados}`);
  return { submetidos: submetidos.length, faltando, ressincronizados, reanalisados };
}

// ─── Submeter para validação ─────────────────────────────────────────────────

export async function submeterParaValidacao(rawData: unknown, solicitanteEmail?: string | null) {
  const { projeto_id, modo } = submeterValidacaoSchema.parse(rawData);
  log('submeterParaValidacao', `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error('Documentação ainda não foi gerada. Conclua o chat primeiro.');

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;

  const projeto = await getProjetoById(projeto_id);

  if (!projeto) throw new Error('Projeto não encontrado.');

  // Rede de segurança: re-deriva R$ das horas antes de popular colunas/planilha.
  // Garante saving_reais correto mesmo que doc.saving tenha sido salvo com R$ zerado
  // por uma versão anterior ou por um turno que não passou pelo recálculo.
  if (conteudo.saving && typeof conteudo.saving === 'object') {
    // Re-deriva o custo evitado dos ITENS persistidos (fonte da verdade), em vez
    // de confiar no custo_evitado_reais que vinha do estado volátil do chat (o LLM
    // podia zerá-lo em fluxos longos — sumia o custo evitado pontual da planilha).
    const evitadoMensal = custoEvitadoMensalFromItens(projeto.custo_evitado_itens);
    (conteudo.saving as SavingColetado).custo_evitado_reais = evitadoMensal > 0 ? evitadoMensal : null;
    conteudo.saving = recomputarSavingFinanceiro(
      conteudo.saving as SavingColetado,
      projeto.custo_externo_mensal ?? 0,
    );
    // Divergência memorial×gravado na submissão → card de alerta no Investigador.
    const div = avisarDivergenciaMemorialLinhas(conteudo.saving as SavingColetado, projeto_id);
    if (div) {
      await gravarEvento(projeto_id, 'divergencia_memorial', 'saving', {
        total_texto: div.totalTexto,
        total_gravado: div.totalGravado,
      });
    }
  }
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  if (projeto.nome) {
    const duplicata = await findDuplicateProjeto(projeto.nome, projeto_id);
    if (duplicata) {
      throw new Error(`Já existe um projeto submetido com o nome "${projeto.nome}".`);
    }
  }

  // ── Derivar a ÁREA pelo email do responsável (TeamGuide) ───────────────────
  // A pessoa não escolhe mais a área no formulário — derivamos do cadastro dela
  // na TeamGuide pelo email. Se não for encontrada (raríssimo — todo mundo está
  // cadastrado lá), a área vira o aviso "ÁREA NÃO IDENTIFICADA". Em caso de falha
  // da API (indisponibilidade), preservamos a área já gravada para não perder o
  // dado durante uma queda transitória.
  const AREA_NAO_IDENTIFICADA = 'ÁREA NÃO IDENTIFICADA';
  let areaFinal: string;
  try {
    const areaDerivada = await deriveAreaFromEmail(projeto.responsavel_email ?? '');
    areaFinal = areaDerivada ?? AREA_NAO_IDENTIFICADA;
    if (areaDerivada) {
      log('submeterParaValidacao', `Área derivada da TeamGuide: "${areaDerivada}" (${projeto.responsavel_email})`);
    } else {
      log('submeterParaValidacao', `Email não encontrado na TeamGuide → "${AREA_NAO_IDENTIFICADA}" (${projeto.responsavel_email})`);
    }
  } catch (tgErr) {
    err('submeterParaValidacao', 'TeamGuide indisponível ao derivar área — preservando área existente:', tgErr);
    areaFinal = projeto.area ?? AREA_NAO_IDENTIFICADA;
  }
  projeto.area = areaFinal;

  // Projeto especial nunca auto-aprova (nem na área RPA): a validação é humana,
  // então fica sempre 'em_validacao' (→ "Pendente" na planilha) até o humano avaliar.
  const ehEspecial = projeto.especial === 1;

  // Reenvio: detectado quando o projeto já foi submetido antes (submitted_at preenchido)
  // ou quando o cliente passa modo:'edicao'. Reenvios nunca auto-aprovam — forçamos
  // sempre em_validacao para que a re-análise automática recomece do zero.
  const ehReenvio = modo === 'edicao' || !!projeto.submitted_at;

  // Gate de OWNERSHIP na edição: podem reenviar um projeto já existente o autor
  // (responsavel_email), um EDITOR DELEGADO (participante a quem o dono delegou o
  // poder) ou um admin RPA. Participante comum (membro sem delegação) só visualiza.
  // Vale só p/ reenvio; submissão nova não tem owner anterior a proteger. Se o email do
  // solicitante não veio (chamadas internas/cron), não bloqueia.
  if (ehReenvio && solicitanteEmail) {
    const alvo = solicitanteEmail.trim().toLowerCase();
    const ehOwner = (projeto.responsavel_email ?? '').trim().toLowerCase() === alvo;
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
        new Error('Apenas o autor ou um editor autorizado pode editar este projeto. Para transferir a autoria, acione a equipe RPA.'),
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
    if (tiposProjetoGate.includes('saving') &&
        (((saving?.economia_reais_mes as number) ?? 0) <= 0)) {
      throw new Error(
        'Não é possível submeter este projeto como saving sem ganho mensurável. ' +
        'O ganho precisa vir de uma redução concreta de horas OU de um custo externo evitado ' +
        '(contrato/serviço/licença que deixou de ser pago). Se nenhum dos dois se aplica, ' +
        'reclassifique como receita incremental ou projeto especial.'
      );
    }
    if (tiposProjetoGate.includes('receita_incremental') &&
        (((receita?.valor_ganho_mensal as number) ?? 0) <= 0)) {
      throw new Error(
        'Não é possível submeter receita incremental com ganho de R$ 0. ' +
        'Revise o memorial de receita antes de enviar.'
      );
    }
  }

  // Teto de materialidade: projetos acima de R$ 5.000/mês vão sempre para validação humana.
  const TETO_MATERIALIDADE = 5000;
  const materialidade = calcularMaterialidade(saving, receita);
  const status = ehEspecial || ehReenvio || materialidade > TETO_MATERIALIDADE
    ? 'em_validacao'
    : (projeto.area === 'RPA' ? 'aprovado' : 'em_validacao');
  if (materialidade > TETO_MATERIALIDADE) {
    log('submeterParaValidacao', `Materialidade R$ ${Math.round(materialidade)}/mês > R$ ${TETO_MATERIALIDADE} → em_validacao (validação humana obrigatória)`);
  }
  const now = new Date().toISOString();

  // ── Calcular ganho_total_mensal (saving + receita/10) ──
  // Saving entra cheio (economia_reais_mes já inclui custo evitado e abate custo
  // externo). Receita entra cheia e aplica ÷10 (fator de equivalência).
  // Pontual NÃO divide por 12 — valor cheio em ambos os casos.
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const savingMensal = savingReais;

  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  const receitaTipo = (receita?.tipo_saving as string) ?? 'mensal';
  const receitaEquivalente = receitaValor / 10;

  const ganhoTotalMensal = savingMensal + receitaEquivalente;

  // Memorial interno (planilha/SQLite): versão ENRIQUECIDA com valores financeiros (R$).
  // O LLM gera o memorial sem R$ (visível ao usuário); o backend injeta os valores
  // usando a tabela CARGOS + campos estruturados. O markdown cru fica em documentacao.conteudo.
  const tiposProjeto = (projeto.tipos_projeto
    ? JSON.parse(projeto.tipos_projeto as string)
    : [projeto.tipo_projeto].filter(Boolean)) as string[];
  const memorialInterno = stripMarkdown(
    enriquecerMemorial(saving as SavingColetado | undefined, receita as ReceitaColetada | undefined, tiposProjeto)
  );
  // Coluna "Memorial de Saving" (V) recebe SÓ o memorial de saving (com R$). O memorial de
  // receita vai SOMENTE para "Receita Memorial" (Z); em projeto só-receita, V fica "—".
  // (memorial_calculo no banco segue sendo o unificado — usado em "Memorial anterior"/auditoria.)
  const memorialSavingLimpo =
    tiposProjeto.includes('saving') && saving
      ? stripMarkdown(enriquecerMemorial(saving as SavingColetado | undefined, undefined, ['saving']))
      : null;
  const receitaMemorialLimpo = stripMarkdown(receita?.memorial_calculo as string | undefined);
  // "Alocação Ganhos" (coluna AK): justificativa [2.4] do gate ≥44h, fatiada do
  // memorial do LLM (sem R$). Null quando o gate não disparou → "—" no Sheets.
  const alocacaoGanhos = extrairAlocacaoGanhos(
    normalizarMarcadoresMemorial((saving as SavingColetado | undefined)?.memorial_calculo),
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
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    saving_reais: (saving?.economia_reais_mes as number) ?? null,
    tipo_saving: (saving?.tipo_saving as string) ?? null,
    memorial_calculo: memorialInterno,
    ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
    // Reenvio invalida a validação anterior (o humano precisa rever do zero).
    ...(ehReenvio ? { validated_at: null, validated_by: null } : {}),
  });

  log('submeterParaValidacao', `Status: ${status}`);

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
        ehReenvio ? 'reenvio' : 'submit_inicial',
        snapshotProjeto,
        conteudo,
        projetoAtualizado.responsavel_email,
        chatSnapshot,
      );
    }
  } catch (versionErr) {
    err('submeterParaValidacao', 'Falha ao gravar versão (não bloqueante):', versionErr);
  }

  // ── Resumo da documentação → UM doc no Drive (link único na coluna "URL") ──
  // Salva o RESUMO da documentação gerada pelo agente como UM documento no Drive
  // (NÃO os arquivos crus enviados). Em edição, atualiza o MESMO doc in-place — N
  // edições não geram N arquivos. Não bloqueia a submissão se o Drive falhar.
  try {
    const linkExistente = parseJson<string[]>(projeto.arquivos_links)?.[0] ?? null;
    // Doc completa de ponta a ponta: resumo do agente + texto dos arquivos do usuário.
    const msgsResumo = await getChatMessagesExcludeRole(projeto_id, 'doc');
    const docUsuarioMsg = await getDocMessage(projeto_id);
    const md = renderResumoDocumentacao(projeto, conteudo, {
      resumoProjeto: extrairResumoProjeto(msgsResumo),
      docUsuario: docUsuarioMsg?.content ?? null,
      arquivosNomes: parseJson<string[]>(projeto.arquivos_nomes) ?? [],
    });
    const sanit = (x: string) =>
      (x || '')
        .replace(/[|/\\]+/g, '-')
        .replace(/->|→|<>/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/[^\w\sÀ-ÿ.\-]/g, '')
        .trim()
        .replace(/\s/g, '_')
        .slice(0, 80);
    const filename = `${now.slice(0, 10)}_${now.slice(11, 19).replace(/:/g, '')}_${sanit(projeto.nome ?? 'projeto')}_${sanit(areaFinal ?? '')}.md`;
    const link = await upsertResumoDoc(filename, md, linkExistente);
    if (link) {
      await updateProjeto(projeto_id, { arquivos_links: [link] });
      (projeto as { arquivos_links?: string | null }).arquivos_links = JSON.stringify([link]);
      log('submeterParaValidacao', `Resumo da doc salvo no Drive: ${link}`);
    }
  } catch (driveErr) {
    err('submeterParaValidacao', 'Falha ao salvar resumo no Drive (não bloqueante):', driveErr);
  }

  // Evento de timeline: submissão/reenvio finalizado (fecha o histórico).
  await gravarEvento(projeto_id, 'submit', 'completo', {
    reenvio: ehReenvio,
    status,
    ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
  });

  // ── Sync Google (planilha + Drive + chat) — fire-and-forget ──
  {
    const membros = parseJson<string[]>(projeto.membros) ?? [];
    const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];

    runBackground(syncSubmitToGoogle({
      projetoId: projeto_id,
      modo: ehReenvio ? 'edicao' : 'novo',
      projeto,
      conteudo,
      saving,
      receita,
      membros,
      tiposProjeto,
      // TEMPORÁRIO: durante a validação da eficácia do formulário, gravamos sempre
      // "Pendente" na planilha — mesmo para projetos auto-aprovados (ex.: RPA). O
      // status interno (SQLite/dashboard) continua correto. Reverter para
      // `status === 'aprovado' ? 'Aprovado' : 'Pendente'` quando a validação terminar.
      status: 'Pendente',
      area: areaFinal ?? '—',
      memorialLimpo: memorialSavingLimpo ?? '—',
      receitaMemorialLimpo: receitaMemorialLimpo ?? '—',
      alocacaoGanhos,
      ganhoTotalMensal,
      // Edição: o memorial que estava gravado ANTES deste update (projeto foi lido
      // antes do updateProjeto) → vai para a coluna "Memorial anterior" no Sheets.
      memorialAnterior: ehReenvio ? (projeto.memorial_calculo ?? null) : null,
    }));
  }

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
  log('resyncGoogle', `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);
  if (!docRow) throw new Error('Documentação não encontrada.');
  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;

  const projeto = await getProjetoById(projeto_id);
  if (!projeto) throw new Error('Projeto não encontrado.');

  // Re-deriva R$ das horas (mesma rede de segurança do submit), incluindo o custo
  // evitado a partir dos itens persistidos.
  if (conteudo.saving && typeof conteudo.saving === 'object') {
    const evitadoMensal = custoEvitadoMensalFromItens(projeto.custo_evitado_itens);
    (conteudo.saving as SavingColetado).custo_evitado_reais = evitadoMensal > 0 ? evitadoMensal : null;
    conteudo.saving = recomputarSavingFinanceiro(
      conteudo.saving as SavingColetado,
      projeto.custo_externo_mensal ?? 0,
    );
    avisarDivergenciaMemorialLinhas(conteudo.saving as SavingColetado, projeto_id);
  }
  const saving = conteudo.saving as Record<string, unknown> | undefined;
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
    tiposProjeto.includes('saving') && saving
      ? stripMarkdown(enriquecerMemorial(saving as SavingColetado | undefined, undefined, ['saving']))
      : null;
  const receitaMemorialLimpo = stripMarkdown(receita?.memorial_calculo as string | undefined);
  const alocacaoGanhos = extrairAlocacaoGanhos(
    normalizarMarcadoresMemorial((saving as SavingColetado | undefined)?.memorial_calculo),
  );
  const membros = parseJson<string[]>(projeto.membros) ?? [];

  // 1. UPDATE da linha (por ID) + alerta no Chat — TEMPORÁRIO: status sempre "Pendente".
  await syncSubmitToGoogle({
    projetoId: projeto_id,
    modo: 'edicao',
    projeto,
    conteudo,
    saving,
    receita,
    membros,
    tiposProjeto,
    status: 'Pendente',
    area: projeto.area ?? '—',
    memorialLimpo: memorialSavingLimpo ?? '—',
    receitaMemorialLimpo: receitaMemorialLimpo ?? '—',
    alocacaoGanhos,
    ganhoTotalMensal,
  });

  // 2. Complexidade/Observações/Status (o que o analisador já havia gravado).
  await syncUpdateToGoogle({
    projetoId: projeto_id,
    projectName: projeto.nome ?? '',
    complexidade: projeto.complexidade ?? '',
    observacoes: projeto.observacoes ?? '',
    status: 'Pendente',
  });

  log('resyncGoogle', `OK — ${projeto.nome} (área=${projeto.area}, ganho=${Math.round(ganhoTotalMensal)})`);
  return {
    ok: true,
    projeto_id,
    nome: projeto.nome,
    area: projeto.area,
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    ganho_total_mensal: Math.round(ganhoTotalMensal * 100) / 100,
  };
}

// ─── Validar projeto ─────────────────────────────────────────────────────────

export async function validarProjeto(rawData: unknown) {
  const { projeto_id } = z.object({ projeto_id: z.string().min(1) }).parse(rawData);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error('Documentação não encontrada.');

  const doc = parseJson<Parameters<typeof validarDocumentacao>[0]>(docRow.conteudo) as Parameters<typeof validarDocumentacao>[0];
  const resultado = await validarDocumentacao(doc);

  await insertValidacao({
    projeto_id,
    resultado: resultado.resultado,
    parecer: resultado.parecer,
    criterios: resultado.criterios,
  });

  const novoStatus = resultado.resultado === 'aprovado' ? 'validado' : 'rejeitado';
  await updateProjeto(projeto_id, { status: novoStatus, validated_at: new Date().toISOString() });

  try {
    if (resultado.resultado === 'aprovado') {
      await enviarEmailAprovacao(doc, resultado);
    } else {
      await enviarEmailRejeicao(doc, resultado);
    }
    await updateValidacaoEmailEnviado(projeto_id);
  } catch (emailErr) {
    console.error('[email-agent] Falha ao enviar email:', emailErr);
  }

  return { resultado: resultado.resultado, parecer: resultado.parecer };
}
