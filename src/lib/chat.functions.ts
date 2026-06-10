// Funções de negócio do chat — sem dependência de TanStack Start.
// Chamadas diretamente pelo worker (src/worker.ts).
// Fluxo: doc → doc_preview → saving → saving_preview → completo

const log = (fn: string, ...args: unknown[]) => console.log(`[chat.functions/${fn}]`, ...args);
const err = (fn: string, ...args: unknown[]) => console.error(`[chat.functions/${fn}]`, ...args);

import { z } from 'zod';
import {
  insertProjeto,
  insertChatMessage,
  getChatMessagesExcludeRole,
  getProjetoContextoData,
  getDocMessage,
  upsertDocumentacao,
  getDocumentacao,
  getProjetoById,
  findDuplicateProjeto,
  updateProjeto,
  insertValidacao,
  updateValidacaoEmailEnviado,
  parseJson,
} from '@/integrations/db/client.server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { compilarDocumentacao } from '@/lib/agents/doc-compiler';
import { validarDocumentacao } from '@/lib/agents/validator';
import { enviarEmailAprovacao, enviarEmailRejeicao } from '@/lib/agents/email-agent';
import { extractTextFromMultipleFiles } from '@/lib/extract-text.server';
import { extrairCamposDocumentacao } from '@/lib/agents/extractor';
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  ProjetoContexto,
  ReceitaColetada,
  SavingColetado,
  SavingLinha,
} from '@/lib/agents/types';
import { documentacaoVazia, receitaVazia, savingVazio, CARGOS } from '@/lib/agents/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getProjetoContexto(projeto_id: string): Promise<ProjetoContexto> {
  const data = await getProjetoContextoData(projeto_id);
  if (!data) throw new Error('Projeto não encontrado.');
  const docMsg = await getDocMessage(projeto_id);

  const tiposRaw = parseJson<string[]>(data.tipos_projeto);
  const tiposProjeto = Array.isArray(tiposRaw)
    ? (tiposRaw as ('saving' | 'receita_incremental')[])
    : null;

  return {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    area: data.area_nome ?? null,
    membros: parseJson<string[]>(data.membros) ?? [],
    nome_projeto: data.nome ?? '',
    data_criacao: null,
    doc_texto: docMsg?.content ?? null,
    tipo_projeto: (data.tipo_projeto as 'saving' | 'receita_incremental' | null) ?? null,
    tipos_projeto: tiposProjeto,
    escopo: (data.escopo as 'interno' | 'externo' | null) ?? null,
  };
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
  let transitionIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msgs[i].content) as { type?: string; fase?: string };
      if (parsed.type === 'complete' && parsed.fase === targetFase) {
        transitionIdx = i;
        break;
      }
    } catch {
      continue;
    }
  }
  const phaseMsgs = transitionIdx >= 0 ? msgs.slice(transitionIdx + 1) : msgs;
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
  area: z.string().min(1).max(100),
  ferramenta: z.string().min(1).max(200),
  escopo: z.enum(['interno', 'externo']).optional(),
  servico_externo: z.string().max(200).optional(),
  membros: z.array(z.string()).default([]),
  nome_projeto: z.string().min(1).max(200),
  data_criacao: z.string(),
  tipo_projeto: z.enum(['saving', 'receita_incremental']).optional(),
  tipos_projeto: z.array(z.enum(['saving', 'receita_incremental'])).optional(),
  descricao_breve: z.string().max(1000).optional(),
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
  linhas: z.array(z.object({
    cargo: z.string(),
    horas_antes: z.number().min(0),
    horas_depois: z.number().min(0),
  })).optional(),
  custo_externo_mensal: z.number().min(0).optional(),
});

const iniciarReceitaSchema = z.object({
  projeto_id: z.string().min(1),
  tipo_saving: z.enum(['mensal', 'pontual']),
});

const submeterValidacaoSchema = z.object({ projeto_id: z.string().min(1) });

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
      area: data.area,
      ferramenta: data.ferramenta,
      escopo: data.escopo ?? null,
      servico_externo: data.servico_externo ?? null,
      membros: data.membros,
      nome: data.nome_projeto,
      data_criacao_projeto: data.data_criacao,
      tipo_projeto: data.tipo_projeto ?? null,
      tipos_projeto: data.tipos_projeto ?? null,
      descricao_breve: data.descricao_breve ?? null,
      status: 'rascunho',
    });
  } catch (projErr) {
    err('iniciarSubmissao', 'Falha ao criar projeto:', projErr);
    throw new Error(`Falha ao criar projeto: ${projErr instanceof Error ? projErr.message : 'erro desconhecido'}`);
  }
  log('iniciarSubmissao', `Projeto criado: ${projeto.id}`);

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
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return {
    projeto_id: projeto.id,
    response: formatResponse(resultado),
  };
}

// ─── Enviar mensagem ─────────────────────────────────────────────────────────

export async function enviarMensagem(rawData: unknown) {
  const data = enviarMensagemSchema.parse(rawData);
  log('enviarMensagem', `projeto=${data.projeto_id}`);

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'user',
    content: data.content,
    selected_option: data.selected_option ?? null,
  });

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

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);
  log('enviarMensagem', `Fase: ${estado.fase}, histórico: ${history.length} msgs, tipos: ${tiposProjeto.join(',')}`);

  const resultado = await runOrchestrator(
    ctx,
    history,
    estado.fase,
    estado.coletado,
    estado.saving,
    resumoProjeto,
    tiposProjeto,
    estado.receita,
  );

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  if ((resultado.fase === 'saving' || resultado.fase === 'receita') && estado.fase === 'doc_preview') {
    log('enviarMensagem', 'Doc aprovada — compilando documentação...');
    try {
      const doc = await compilarDocumentacao(ctx, resultado.coletado);
      await upsertDocumentacao(data.projeto_id, doc);
      log('enviarMensagem', 'Documentação compilada e salva.');
    } catch (compErr) {
      err('enviarMensagem', 'Falha ao compilar:', compErr);
    }
  }

  if (resultado.fase === 'completo') {
    log('enviarMensagem', 'Fluxo completo — salvando dados financeiros...');
    const docRow = await getDocumentacao(data.projeto_id);

    if (docRow) {
      const doc = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;
      const tiposProjetoCtx = getTiposProjeto(ctx);
      if (tiposProjetoCtx.includes('saving')) doc.saving = resultado.saving;
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
  console.log('│ 👤 Usuário:');
  data.content.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('│ 🤖 IA:');
  respContent2.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  if (resultado.type === 'options') {
    console.log(`│ 📋 Opções: ${(resultado as { options: string[] }).options.join(' | ')}`);
  }
  const campos = resultado.coletado;
  const preenchidos = Object.entries(campos).filter(([, v]) => v !== null).map(([k]) => k);
  const vazios = Object.entries(campos).filter(([, v]) => v === null).map(([k]) => k);
  console.log(`│ ✅ Preenchidos: ${preenchidos.join(', ') || 'nenhum'}`);
  console.log(`│ ❌ Faltando: ${vazios.join(', ') || 'nenhum'}`);
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Iniciar fase saving ─────────────────────────────────────────────────────

export async function iniciarSaving(rawData: unknown) {
  const data = iniciarSavingSchema.parse(rawData);
  log('iniciarSaving', `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  let saving = savingVazio();
  saving.tipo_saving = data.tipo_saving;

  if (tiposProjeto.includes('saving') && data.linhas && data.linhas.length > 0) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
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
      economia_reais_mes: round2(totalReaisBruto - custoExterno),
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
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Iniciar fase receita incremental ────────────────────────────────────────

export async function iniciarReceita(rawData: unknown) {
  const data = iniciarReceitaSchema.parse(rawData);
  log('iniciarReceita', `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  const receita = receitaVazia();
  receita.tipo_saving = data.tipo_saving;

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
  console.log(`│ 📈 INÍCIO RECEITA: tipos_projeto=${tiposProjeto.join(',')}, tipo_saving=${data.tipo_saving}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Submeter para validação ─────────────────────────────────────────────────

export async function submeterParaValidacao(rawData: unknown) {
  const { projeto_id } = submeterValidacaoSchema.parse(rawData);
  log('submeterParaValidacao', `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error('Documentação ainda não foi gerada. Conclua o chat primeiro.');

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;
  const saving = conteudo.saving as Record<string, unknown> | undefined;

  const projeto = await getProjetoById(projeto_id);

  if (!projeto) throw new Error('Projeto não encontrado.');

  if (projeto.nome) {
    const duplicata = await findDuplicateProjeto(projeto.nome, projeto_id);
    if (duplicata) {
      throw new Error(`Já existe um projeto submetido com o nome "${projeto.nome}".`);
    }
  }

  const status = projeto.area === 'RPA' ? 'aprovado' : 'em_validacao';
  const now = new Date().toISOString();

  await updateProjeto(projeto_id, {
    status,
    submitted_at: now,
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    saving_reais: (saving?.economia_reais_mes as number) ?? null,
    tipo_saving: (saving?.tipo_saving as string) ?? null,
    memorial_calculo: (saving?.memorial_calculo as string) ?? null,
  });

  log('submeterParaValidacao', `Status: ${status}`);

  const chatWebhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (chatWebhookUrl) {
    try {
      const savingHoras = saving?.economia_horas_mes ?? 0;
      const savingReais = saving?.economia_reais_mes ?? 0;
      const fmtReais = Number(savingReais).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const tipoSaving = saving?.tipo_saving ?? 'mensal';
      const membros = (parseJson<string[]>(projeto.membros) ?? []).join(', ');

      const text = [
        '──────────────────────',
        '',
        '🚨 *Novo fluxo de automação cadastrado – aprovação pendente*',
        '',
        `📌 *Projeto:* ${projeto.nome}`,
        `🏷️ *Área:* ${projeto.area ?? '—'}`,
        `🛠️ *Ferramenta:* ${projeto.ferramenta}`,
        '',
        `👤 *Solicitante:* ${projeto.responsavel_nome}`,
        `📧 *E-mail:* ${projeto.responsavel_email}`,
        membros ? `👥 *Participantes:* ${membros}` : '',
        '',
        `⏱️ *Saving estimado (horas/mês):* ${savingHoras} horas`,
        `💰 *Saving estimado (R$/mês):* R$ ${fmtReais}`,
        `📊 *Tipo de saving:* ${tipoSaving}`,
        '',
        `📅 *Data da submissão:* ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Fortaleza' })}`,
        `📊 *Status:* ${status === 'aprovado' ? 'Aprovado (auto)' : 'Pendente'}`,
        '',
        '👉 *Aguardando avaliação e aprovação dos responsáveis.*',
        '',
        '──────────────────────',
      ].filter(Boolean).join('\n');

      await fetch(chatWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      log('submeterParaValidacao', 'Notificação Google Chat enviada.');
    } catch (chatErr) {
      err('submeterParaValidacao', 'Falha ao enviar notificação Google Chat:', chatErr);
    }
  }

  return { ok: true, status };
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
