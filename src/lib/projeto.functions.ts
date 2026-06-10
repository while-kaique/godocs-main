import { z } from 'zod'
import {
  insertProjeto,
  insertChatMessage,
  getChatMessages,
  upsertDocumentacao,
  updateProjeto,
  parseJson,
} from '@/integrations/db/client.server'

// ID de área/projeto é hex de 32 chars (não é UUID) — validamos como string.
const idSchema = z.string().min(1).max(64)

const step1Schema = z.object({
  responsavel_nome: z.string().min(1).max(120),
  responsavel_email: z.string().email().max(255),
  area_id: idSchema.optional(),
  ferramenta: z.string().min(1).max(100),
  membros: z.array(z.string()).default([]),
})

export async function criarProjeto(input: unknown) {
  const data = step1Schema.parse(input)
  return insertProjeto({
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    area_id: data.area_id ?? null,
    ferramenta: data.ferramenta,
    membros: data.membros,
    status: 'rascunho',
  })
}

export async function salvarMensagem(input: unknown) {
  const data = z
    .object({
      projeto_id: idSchema,
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1),
      options: z.array(z.string()).optional(),
      selected_option: z.number().optional(),
    })
    .parse(input)
  return insertChatMessage({
    projeto_id: data.projeto_id,
    role: data.role,
    content: data.content,
    options: data.options ?? null,
    selected_option: data.selected_option ?? null,
  })
}

export async function getChatHistorico(projeto_id: string) {
  idSchema.parse(projeto_id)
  return getChatMessages(projeto_id).map((m) => ({
    ...m,
    options: parseJson(m.options),
  }))
}

export async function salvarDocumentacao(input: unknown) {
  const data = z
    .object({
      projeto_id: idSchema,
      conteudo: z.record(z.unknown()),
    })
    .parse(input)
  upsertDocumentacao(data.projeto_id, data.conteudo)
  updateProjeto(data.projeto_id, { chat_completo: true })
  return { ok: true }
}

export async function submeterProjeto(projeto_id: string) {
  idSchema.parse(projeto_id)
  updateProjeto(projeto_id, {
    status: 'em_validacao',
    submitted_at: new Date().toISOString(),
  })
  return { ok: true }
}
