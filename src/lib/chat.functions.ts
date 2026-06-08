// Server functions para o chat interativo
// Conecta o frontend com o sistema de agentes
// Fluxo: doc → doc_preview → saving → saving_preview → completo

const log = (fn: string, ...args: unknown[]) => console.log(`[chat.functions/${fn}]`, ...args);
const err = (fn: string, ...args: unknown[]) => console.error(`[chat.functions/${fn}]`, ...args);

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { compilarDocumentacao } from '@/lib/agents/doc-compiler';
import { validarDocumentacao } from '@/lib/agents/validator';
import { enviarEmailAprovacao, enviarEmailRejeicao } from '@/lib/agents/email-agent';
import { extractTextFromBase64 } from '@/lib/extract-text.server';
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  ProjetoContexto,
  SavingColetado,
} from '@/lib/agents/types';
import { documentacaoVazia, savingVazio } from '@/lib/agents/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getProjetoContexto(projeto_id: string): Promise<ProjetoContexto> {
  const [{ data, error }, { data: docMsg }] = await Promise.all([
    supabaseAdmin
      .from('projetos')
      .select('responsavel_nome, responsavel_email, ferramenta, membros, nome, areas(nome)')
      .eq('id', projeto_id)
      .single(),
    supabaseAdmin
      .from('chat_messages')
      .select('content')
      .eq('projeto_id', projeto_id)
      .eq('role', 'doc')
      .maybeSingle(),
  ]);

  if (error || !data) throw new Error('Projeto não encontrado.');

  return {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    area: (data.areas as { nome: string } | null)?.nome ?? null,
    membros: Array.isArray(data.membros) ? (data.membros as string[]) : [],
    nome_projeto: (data.nome as string | null) ?? '',
    data_criacao: null,
    doc_texto: docMsg?.content ?? null,
  };
}

type EstadoChat = {
  fase: ChatFase;
  coletado: DocumentacaoColetada;
  saving: SavingColetado;
};

/** Extrai fase + estado mais recente das mensagens do assistente */
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
      };
    } catch {
      continue;
    }
  }
  return { fase: 'doc', coletado: documentacaoVazia(), saving: savingVazio() };
}

/** Monta histórico limpo para o LLM (sem JSON interno) */
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

/** Extrai o resumo do projeto da mensagem de transição doc→saving */
function extrairResumoProjeto(msgs: { role: string; content: string }[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msg.content) as { type?: string; fase?: string; content?: string };
      if (parsed.type === 'complete' && parsed.fase === 'saving' && parsed.content) {
        return parsed.content;
      }
    } catch {
      continue;
    }
  }
  return '';
}

/** Filtra histórico para manter apenas mensagens da fase saving */
function buildSavingHistory(msgs: { role: string; content: string }[]): ChatHistoryMessage[] {
  let transitionIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msgs[i].content) as { type?: string; fase?: string };
      if (parsed.type === 'complete' && parsed.fase === 'saving') {
        transitionIdx = i;
        break;
      }
    } catch {
      continue;
    }
  }

  const savingMsgs = transitionIdx >= 0 ? msgs.slice(transitionIdx + 1) : msgs;
  return buildHistory(savingMsgs);
}

/** Formata a resposta do orquestrador para o frontend */
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
  };
}

// ─── Iniciar submissão: cria projeto + extrai doc + inicia agente ────────────

export const iniciarSubmissaoFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        responsavel_nome: z.string().min(1).max(120),
        responsavel_email: z.string().email().max(255),
        area_id: z.string().uuid().optional(),
        ferramenta: z.string().min(1).max(100),
        membros: z.array(z.string()).default([]),
        nome_projeto: z.string().min(1).max(200),
        data_criacao: z.string(),
        doc_base64: z.string().min(1),
        doc_filename: z.string().min(1),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    log('iniciarSubmissao', `Iniciando para "${data.nome_projeto}" (${data.responsavel_email})`);

    // 1. Cria o projeto no banco
    const { data: projeto, error: projErr } = await supabaseAdmin
      .from('projetos')
      .insert({
        responsavel_nome: data.responsavel_nome,
        responsavel_email: data.responsavel_email,
        area_id: data.area_id,
        ferramenta: data.ferramenta,
        membros: data.membros,
        nome: data.nome_projeto,
        status: 'rascunho',
      })
      .select()
      .single();

    if (projErr || !projeto) {
      err('iniciarSubmissao', 'Falha ao criar projeto:', projErr);
      throw new Error(`Falha ao criar projeto: ${projErr?.message ?? 'erro desconhecido'}`);
    }
    log('iniciarSubmissao', `Projeto criado: ${projeto.id}`);

    // 2. Extrai texto da documentação
    let docTexto = '';
    try {
      docTexto = await extractTextFromBase64(data.doc_base64, data.doc_filename);
      log('iniciarSubmissao', `Texto extraído: ${docTexto.length} chars`);
    } catch (extractErr) {
      err('iniciarSubmissao', 'Erro na extração de texto:', extractErr);
      docTexto = '';
    }

    // 3. Salva o texto da doc como mensagem especial (role='doc')
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: projeto.id,
      role: 'doc',
      content: docTexto || '(documento sem texto legível)',
    });

    // 4. Monta contexto
    const ctx: ProjetoContexto = {
      responsavel_nome: data.responsavel_nome,
      responsavel_email: data.responsavel_email,
      area: null,
      ferramenta: data.ferramenta,
      membros: data.membros,
      nome_projeto: data.nome_projeto,
      data_criacao: data.data_criacao,
      doc_texto: docTexto || null,
    };

    const coletadoInicial: DocumentacaoColetada = {
      ...documentacaoVazia(),
      nome_projeto: data.nome_projeto,
    };

    // 5. Roda orquestrador — primeira mensagem do agente (fase doc)
    log('iniciarSubmissao', 'Rodando orquestrador (fase doc)...');
    const resultado = await runOrchestrator(ctx, [], 'doc', coletadoInicial, savingVazio());

    // 6. Salva resposta do assistente
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: projeto.id,
      role: 'assistant',
      content: JSON.stringify(resultado),
      options: resultado.type === 'options' ? resultado.options : null,
    });

    // ── LOG DE CONVERSA ──
    const respContent = resultado.type === 'options'
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content;
    console.log('\n┌─────────────────────────────────────────────');
    console.log(`│ 🆕 NOVA SUBMISSÃO: "${data.nome_projeto}"`);
    console.log(`│ 📄 Doc: ${docTexto ? docTexto.length + ' chars extraídos' : 'sem texto'}`);
    console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
    console.log('│ 🤖 IA:');
    respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
    console.log('└─────────────────────────────────────────────\n');

    return {
      projeto_id: projeto.id,
      response: formatResponse(resultado),
    };
  });

// ─── Enviar mensagem no chat ────────────────────────────────────────────────

export const enviarMensagemFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        projeto_id: z.string().uuid(),
        content: z.string().min(1).max(4000),
        selected_option: z.number().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    log('enviarMensagem', `projeto=${data.projeto_id}`);

    // 1. Salva mensagem do usuário
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'user',
      content: data.content,
      selected_option: data.selected_option ?? null,
    });

    // 2. Busca histórico (exclui mensagens 'doc')
    const { data: msgs } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('projeto_id', data.projeto_id)
      .neq('role', 'doc')
      .order('created_at');

    const estado = extrairEstado(msgs ?? []);

    // Histórico filtrado: na fase saving, agente 2 começa limpo
    const isSavingFase = estado.fase === 'saving' || estado.fase === 'saving_preview';
    const history = isSavingFase
      ? buildSavingHistory(msgs ?? [])
      : buildHistory(msgs ?? []);

    const resumoProjeto = isSavingFase ? extrairResumoProjeto(msgs ?? []) : '';

    // 3. Contexto do projeto
    const ctx = await getProjetoContexto(data.projeto_id);
    log('enviarMensagem', `Fase: ${estado.fase}, histórico: ${history.length} msgs`);

    // 4. Roda o orquestrador na fase atual
    const resultado = await runOrchestrator(
      ctx,
      history,
      estado.fase,
      estado.coletado,
      estado.saving,
      resumoProjeto
    );

    // 5. Salva resposta do assistente
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'assistant',
      content: JSON.stringify(resultado),
      options: resultado.type === 'options' ? resultado.options : null,
    });

    // 6. Ações pós-transição

    // Doc aprovada → compila documentação
    if (resultado.fase === 'saving' && estado.fase === 'doc_preview') {
      log('enviarMensagem', 'Doc aprovada — compilando documentação...');
      try {
        const doc = await compilarDocumentacao(ctx, resultado.coletado);
        await supabaseAdmin.from('documentacao').upsert({
          projeto_id: data.projeto_id,
          conteudo: doc as never,
        });
        log('enviarMensagem', 'Documentação compilada e salva.');
      } catch (compErr) {
        err('enviarMensagem', 'Falha ao compilar:', compErr);
      }
    }

    // Fluxo completo → salva saving na doc e marca projeto
    if (resultado.fase === 'completo') {
      log('enviarMensagem', 'Fluxo completo — salvando saving...');
      const { data: docRow } = await supabaseAdmin
        .from('documentacao')
        .select('conteudo')
        .eq('projeto_id', data.projeto_id)
        .single();

      if (docRow) {
        const doc = docRow.conteudo as Record<string, unknown>;
        doc.saving = resultado.saving;
        await supabaseAdmin.from('documentacao').upsert({
          projeto_id: data.projeto_id,
          conteudo: doc as never,
        });
      }

      await supabaseAdmin
        .from('projetos')
        .update({ chat_completo: true })
        .eq('id', data.projeto_id);
    }

    // ── LOG DE CONVERSA ──
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
  });

// ─── Submeter projeto para validação ────────────────────────────────────────

export const submeterParaValidacaoFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ projeto_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { data: doc } = await supabaseAdmin
      .from('documentacao')
      .select('conteudo')
      .eq('projeto_id', data.projeto_id)
      .single();

    if (!doc) throw new Error('Documentação ainda não foi gerada. Conclua o chat primeiro.');

    await supabaseAdmin
      .from('projetos')
      .update({ status: 'em_validacao', submitted_at: new Date().toISOString() })
      .eq('id', data.projeto_id);

    return { ok: true };
  });

// ─── Validar projeto (chamado pelo admin) ───────────────────────────────────

export const validarProjetoFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ projeto_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    const { data: docRow } = await supabaseAdmin
      .from('documentacao')
      .select('conteudo')
      .eq('projeto_id', data.projeto_id)
      .single();

    if (!docRow) throw new Error('Documentação não encontrada.');

    const doc = docRow.conteudo as Parameters<typeof validarDocumentacao>[0];
    const resultado = await validarDocumentacao(doc);

    await supabaseAdmin.from('validacoes').insert({
      projeto_id: data.projeto_id,
      resultado: resultado.resultado,
      parecer: resultado.parecer,
      criterios: resultado.criterios as never,
    });

    const novoStatus = resultado.resultado === 'aprovado' ? 'validado' : 'rejeitado';
    await supabaseAdmin
      .from('projetos')
      .update({ status: novoStatus, validated_at: new Date().toISOString() })
      .eq('id', data.projeto_id);

    try {
      if (resultado.resultado === 'aprovado') {
        await enviarEmailAprovacao(doc, resultado);
      } else {
        await enviarEmailRejeicao(doc, resultado);
      }
      await supabaseAdmin
        .from('validacoes')
        .update({ email_enviado: true })
        .eq('projeto_id', data.projeto_id);
    } catch (emailErr) {
      console.error('[email-agent] Falha ao enviar email:', emailErr);
    }

    return { resultado: resultado.resultado, parecer: resultado.parecer };
  });
