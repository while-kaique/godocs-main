// Server functions para o chat interativo
// Conecta o frontend com o sistema de agentes

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { compilarDocumentacao } from '@/lib/agents/doc-compiler';
import { validarDocumentacao } from '@/lib/agents/validator';
import { enviarEmailAprovacao, enviarEmailRejeicao } from '@/lib/agents/email-agent';
import type { ChatHistoryMessage, DocumentacaoColetada, ProjetoContexto } from '@/lib/agents/types';
import { documentacaoVazia } from '@/lib/agents/types';

// Busca contexto completo do projeto para passar ao orquestrador
async function getProjetoContexto(projeto_id: string): Promise<ProjetoContexto> {
  const { data, error } = await supabaseAdmin
    .from('projetos')
    .select('responsavel_nome, responsavel_email, ferramenta, membros, areas(nome)')
    .eq('id', projeto_id)
    .single();

  if (error || !data) throw new Error('Projeto não encontrado.');

  return {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    area: (data.areas as { nome: string } | null)?.nome ?? null,
    membros: Array.isArray(data.membros) ? (data.membros as string[]) : [],
  };
}

// Extrai o estado coletado mais recente a partir das mensagens do assistente
function extrairUltimoColetado(messages: { role: string; content: string }[]): DocumentacaoColetada {
  // O orquestrador embute o campo "coletado" em mensagens assistente como JSON
  // Busca da mais recente para a mais antiga
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

// ─── Enviar mensagem no chat ───────────────────────────────────────────────────

export const enviarMensagemFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z
      .object({
        projeto_id: z.string().uuid(),
        content: z.string().min(1).max(4000),
        selected_option: z.number().optional(), // 1-3 se clicou em opção
      })
      .parse(d)
  )
  .handler(async ({ data }) => {
    // 1. Salva a mensagem do usuário
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'user',
      content: data.content,
      selected_option: data.selected_option ?? null,
    });

    // 2. Busca histórico completo
    const { data: msgs } = await supabaseAdmin
      .from('chat_messages')
      .select('role, content')
      .eq('projeto_id', data.projeto_id)
      .order('created_at');

    const history: ChatHistoryMessage[] = (msgs ?? []).map((m) => {
      // Mensagens do assistente armazenam JSON internamente;
      // expõe só o campo "content" ou "question" para o histórico do LLM
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

    // 3. Extrai o estado coletado até agora
    const coletado = extrairUltimoColetado(msgs ?? []);

    // 4. Contexto do projeto (Step 1)
    const ctx = await getProjetoContexto(data.projeto_id);

    // 5. Roda o orquestrador
    const resultado = await runOrchestrator(ctx, history, coletado);

    // 6. Salva resposta do assistente (armazena JSON completo para manter estado)
    const assistantContent = JSON.stringify(resultado);
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'assistant',
      content: assistantContent,
      options: resultado.type === 'options' ? resultado.options : null,
    });

    // 7. Se completo, dispara o compilador de documentação
    if (resultado.type === 'complete') {
      const doc = await compilarDocumentacao(ctx, resultado.coletado);

      await supabaseAdmin.from('documentacao').upsert({
        projeto_id: data.projeto_id,
        conteudo: doc as never,
      });

      await supabaseAdmin
        .from('projetos')
        .update({ chat_completo: true })
        .eq('id', data.projeto_id);
    }

    // Retorna resposta formatada para o frontend
    return {
      type: resultado.type,
      content: resultado.type === 'options' ? resultado.question : resultado.content,
      options: resultado.type === 'options' ? resultado.options : null,
      isComplete: resultado.type === 'complete',
      coletado: resultado.coletado,
    };
  });

// ─── Iniciar chat (primeira mensagem do assistente) ───────────────────────────

export const iniciarChatFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ projeto_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    // Verifica se já tem mensagens
    const { data: existing } = await supabaseAdmin
      .from('chat_messages')
      .select('id')
      .eq('projeto_id', data.projeto_id)
      .limit(1);

    if (existing && existing.length > 0) {
      // Chat já iniciado, retorna histórico existente
      const { data: msgs } = await supabaseAdmin
        .from('chat_messages')
        .select('*')
        .eq('projeto_id', data.projeto_id)
        .order('created_at');
      return { isNew: false, messages: msgs ?? [] };
    }

    // Chat novo — roda orquestrador para gerar mensagem inicial
    const ctx = await getProjetoContexto(data.projeto_id);
    const resultado = await runOrchestrator(ctx, [], documentacaoVazia());

    const assistantContent = JSON.stringify(resultado);
    await supabaseAdmin.from('chat_messages').insert({
      projeto_id: data.projeto_id,
      role: 'assistant',
      content: assistantContent,
      options: resultado.type === 'options' ? resultado.options : null,
    });

    return {
      isNew: true,
      messages: [
        {
          role: 'assistant',
          content: resultado.type === 'options' ? resultado.question : resultado.content,
          options: resultado.type === 'options' ? resultado.options : null,
        },
      ],
    };
  });

// ─── Submeter projeto para validação (após chat completo) ─────────────────────

export const submeterParaValidacaoFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ projeto_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    // Verifica se documentação foi gerada
    const { data: doc } = await supabaseAdmin
      .from('documentacao')
      .select('conteudo')
      .eq('projeto_id', data.projeto_id)
      .single();

    if (!doc) throw new Error('Documentação ainda não foi gerada. Conclua o chat primeiro.');

    // Atualiza status
    await supabaseAdmin
      .from('projetos')
      .update({ status: 'em_validacao', submitted_at: new Date().toISOString() })
      .eq('id', data.projeto_id);

    return { ok: true };
  });

// ─── Validar projeto (chamado pelo admin ou processo automático) ──────────────

export const validarProjetoFn = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) =>
    z.object({ projeto_id: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data }) => {
    // Busca documentação
    const { data: docRow } = await supabaseAdmin
      .from('documentacao')
      .select('conteudo')
      .eq('projeto_id', data.projeto_id)
      .single();

    if (!docRow) throw new Error('Documentação não encontrada.');

    const doc = docRow.conteudo as Parameters<typeof validarDocumentacao>[0];

    // Roda agente validador
    const resultado = await validarDocumentacao(doc);

    // Salva validação
    await supabaseAdmin.from('validacoes').insert({
      projeto_id: data.projeto_id,
      resultado: resultado.resultado,
      parecer: resultado.parecer,
      criterios: resultado.criterios as never,
    });

    // Atualiza status do projeto
    const novoStatus = resultado.resultado === 'aprovado' ? 'validado' : 'rejeitado';
    await supabaseAdmin
      .from('projetos')
      .update({
        status: novoStatus,
        validated_at: new Date().toISOString(),
      })
      .eq('id', data.projeto_id);

    // Dispara email
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
