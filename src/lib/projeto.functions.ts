import { z } from 'zod'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

const step1Schema = z.object({
  responsavel_nome: z.string().min(1).max(120),
  responsavel_email: z.string().email().max(255),
  area_id: z.string().uuid().optional(),
  ferramenta: z.string().min(1).max(100),
  membros: z.array(z.string()).default([]),
})

export async function criarProjeto(input: unknown) {
  const data = step1Schema.parse(input)
  const { data: projeto, error } = await supabaseAdmin
    .from('projetos')
    .insert({
      responsavel_nome: data.responsavel_nome,
      responsavel_email: data.responsavel_email,
      area_id: data.area_id,
      ferramenta: data.ferramenta,
      membros: data.membros,
      status: 'rascunho',
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return projeto
}

export async function salvarMensagem(input: unknown) {
  const data = z
    .object({
      projeto_id: z.string().uuid(),
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1),
      options: z.array(z.string()).optional(),
      selected_option: z.number().optional(),
    })
    .parse(input)
  const { data: msg, error } = await supabaseAdmin
    .from('chat_messages')
    .insert({
      projeto_id: data.projeto_id,
      role: data.role,
      content: data.content,
      options: data.options ?? null,
      selected_option: data.selected_option ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return msg
}

export async function getChatHistorico(projeto_id: string) {
  z.string().uuid().parse(projeto_id)
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('*')
    .eq('projeto_id', projeto_id)
    .order('created_at')
  if (error) throw new Error(error.message)
  return data
}

export async function salvarDocumentacao(input: unknown) {
  const data = z
    .object({
      projeto_id: z.string().uuid(),
      conteudo: z.record(z.unknown()),
    })
    .parse(input)
  const { error } = await supabaseAdmin.from('documentacao').upsert({
    projeto_id: data.projeto_id,
    conteudo: data.conteudo as never,
  })
  if (error) throw new Error(error.message)
  await supabaseAdmin
    .from('projetos')
    .update({ chat_completo: true })
    .eq('id', data.projeto_id)
  return { ok: true }
}

export async function submeterProjeto(projeto_id: string) {
  z.string().uuid().parse(projeto_id)
  const { error } = await supabaseAdmin
    .from('projetos')
    .update({ status: 'em_validacao', submitted_at: new Date().toISOString() })
    .eq('id', projeto_id)
  if (error) throw new Error(error.message)
  return { ok: true }
}
