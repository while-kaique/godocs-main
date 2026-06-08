// Server functions para o chat interativo
// Conecta o frontend com o sistema de agentes

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
import type { ChatHistoryMessage, DocumentacaoColetada, ProjetoContexto } from '@/lib/agents/types';
import { documentacaoVazia } from '@/lib/agents/types';

// Busca contexto completo do projeto + documentação enviada pelo usuário
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

// Extrai o estado coletado mais recente a partir das mensagens do assistente
function extrairUltimoColetado(messages: { role: string; content: string }[]): DocumentacaoColetada {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msg.content) as { coletado?: DocumentacaoColetada };
      if (parsed.coletado) return parsed.coletado;
    } catch {
      // mensagem não é JSON, continua
    }
  }
  return documentacaoVazia();
}

// ─── Iniciar submissão: cria projeto + extrai doc + inicia agente ─────────────

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
    log('iniciarSubmissao', `Arquivo: ${data.doc_filename}, base64 length: ${data.doc_base64.length}`);

    // 1. Cria o projeto no banco
    log('iniciarSubmissao', 'Criando projeto no Supabase...');
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
    log('iniciarSubmissao', 'Extraindo texto do arquivo...');
    let docTexto = '';
    try {
      docTexto = await extractTextFromBase64(data.doc_base64, data.doc_filename);
      log('iniciarSubmissao', `Texto extraído: ${docTexto.length} chars`);
    } catch (extractErr) {
      err('iniciarSubmissao', 'Erro na extração de texto:', extractErr);
      // Não falha — continua sem texto
      docTexto = '';
    }

    // 3. Salva o texto da doc como mensagem especial (role='doc')
    log('iniciarSubmissao', 'Salvando mensagem de contexto (doc) no chat...');
    const { error: docMsgErr } = await supabaseAdmin.from('chat_messages').insert({
      projeto_id: projeto.id,
      role: 'doc',
      content: docTexto || '(documento sem texto legível)',
    });
    if (docMsgErr) {
      err('iniciarSubmissao', 'Falha ao salvar mensagem doc:', docMsgErr);
    }

    // 4. Monta contexto e coleta inicial (nome já preenchido)
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

    // 5. Roda orquestrador — primeira mensagem do agente
    log('iniciarSubmissao', 'Rodando orquestrador (primeira mensagem)...');
    let resultado;
    try {
      resultado = await runOrchestrator(ctx, [], coletadoInicial);
      log('iniciarSubmissao', `Orquestrador retornou: type="${resultado.type}"`);
    } catch (orchErr) {
      err('iniciarSubmissao', 'Falha no orquestrador:', orchErr);
      throw new Error(`Falha no agente de IA: ${orchErr instanceof Error ? orchErr.message : String(orchErr)}`);
    }

    // 6. Salva resposta do assistente
    log('iniciarSubmissao', 'Salvando primeira resposta do assistente...');
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: projeto.id,
      role: 'assistant',
      content: JSON.stringify(resultado),
      options: resultado.type === 'options' ? resultado.options : null,
    });

    log('iniciarSubmissao', 'Concluído com sucesso.');
    return {
      projeto_id: projeto.id,
      response: {
        type: resultado.type,
        content: resultado.type === 'options' ? resultado.question : resultado.content,
        options: resultado.type === 'options' ? resultado.options : null,
        isComplete: resultado.type === 'complete',
        coletado: resultado.coletado,
      },
    };
  });

// ─── Enviar mensagem no chat ───────────────────────────────────────────────────

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
    log('enviarMensagem', `projeto=${data.projeto_id}, mensagem="${data.content.slice(0, 80)}"`);

    // 1. Salva mensagem do usuário
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'user',
      content: data.content,
      selected_option: data.selected_option ?? null,
    });

    // 2. Busca histórico (exclui mensagens 'doc')
    const { data: msgs, error: msgsErr } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('projeto_id', data.projeto_id)
      .neq('role', 'doc')
      .order('created_at');

    if (msgsErr) err('enviarMensagem', 'Erro ao buscar histórico:', msgsErr);
    log('enviarMensagem', `Histórico: ${(msgs ?? []).length} mensagens`);

    const history: ChatHistoryMessage[] = (msgs ?? []).map((m) => {
      if (m.role === 'assistant') {
        try {
          const parsed = JSON.parse(m.content) as { content?: string; question?: string };
          return { role: 'assistant', content: parsed.content ?? parsed.question ?? m.content };
        } catch {
          return { role: 'assistant', content: m.content };
        }
      }
      return { role: 'user', content: m.content };
    });

    // 3. Estado coletado e contexto
    const coletado = extrairUltimoColetado(msgs ?? []);
    log('enviarMensagem', 'Campos já coletados:', Object.entries(coletado).filter(([, v]) => v !== null).map(([k]) => k));

    const ctx = await getProjetoContexto(data.projeto_id);
    log('enviarMensagem', `Contexto: projeto="${ctx.nome_projeto}", doc=${ctx.doc_texto ? ctx.doc_texto.length + ' chars' : 'nenhum'}`);

    // 4. Roda orquestrador
    log('enviarMensagem', 'Chamando orquestrador...');
    const resultado = await runOrchestrator(ctx, history, coletado);
    log('enviarMensagem', `Orquestrador retornou: type="${resultado.type}"`);

    // 5. Salva resposta do assistente
    const assistantContent = JSON.stringify(resultado);
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'assistant',
      content: assistantContent,
      options: resultado.type === 'options' ? resultado.options : null,
    });

    // 6. Se completo, compila documentação final
    if (resultado.type === 'complete') {
      log('enviarMensagem', 'Chat completo — compilando documentação...');
      try {
        const doc = await compilarDocumentacao(ctx, resultado.coletado);
        log('enviarMensagem', 'Documentação compilada, salvando...');

        await supabaseAdmin.from('documentacao').upsert({
          projeto_id: data.projeto_id,
          conteudo: doc as never,
        });

        await supabaseAdmin
          .from('projetos')
          .update({ chat_completo: true })
          .eq('id', data.projeto_id);

        log('enviarMensagem', 'Documentação salva com sucesso.');
      } catch (compErr) {
        err('enviarMensagem', 'Falha ao compilar/salvar documentação:', compErr);
      }
    }

    return {
      type: resultado.type,
      content: resultado.type === 'options' ? resultado.question : resultado.content,
      options: resultado.type === 'options' ? resultado.options : null,
      isComplete: resultado.type === 'complete',
      coletado: resultado.coletado,
    };
  });

// ─── Submeter projeto para validação ─────────────────────────────────────────

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

// ─── Validar projeto (chamado pelo admin) ─────────────────────────────────────

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
