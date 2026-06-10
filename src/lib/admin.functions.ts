import { z } from 'zod'
import { supabaseAdmin } from '@/integrations/supabase/client.server'

// ── Áreas ────────────────────────────────────────────────────────────────────

export async function getAreas() {
  const { data, error } = await supabaseAdmin.from('areas').select('*').order('nome')
  if (error) throw new Error(error.message)
  return data
}

export async function createArea(nome: string, _adminEmail: string) {
  const parsed = z.string().min(1).max(100).parse(nome)
  const { data, error } = await supabaseAdmin
    .from('areas')
    .insert({ nome: parsed })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteArea(id: string, _adminEmail: string) {
  z.string().uuid().parse(id)
  const { error } = await supabaseAdmin.from('areas').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { ok: true }
}

// ── Admins ────────────────────────────────────────────────────────────────────

export async function getAdmins() {
  const { data, error } = await supabaseAdmin.from('admins').select('*').order('email')
  if (error) throw new Error(error.message)
  return data
}

export async function addAdmin(input: { email: string; nome?: string }) {
  const parsed = z
    .object({ email: z.string().email(), nome: z.string().optional() })
    .parse(input)
  const { data, error } = await supabaseAdmin
    .from('admins')
    .insert({ email: parsed.email, nome: parsed.nome })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function removeAdmin(id: string, currentEmail: string) {
  z.string().uuid().parse(id)
  const { data: admin } = await supabaseAdmin
    .from('admins')
    .select('email')
    .eq('id', id)
    .single()
  if (admin?.email === currentEmail) {
    throw new Error('Você não pode remover a si mesmo.')
  }
  const { error } = await supabaseAdmin.from('admins').delete().eq('id', id)
  if (error) throw new Error(error.message)
  return { ok: true }
}

// ── Projetos ──────────────────────────────────────────────────────────────────

export async function getProjetos() {
  const { data, error } = await supabaseAdmin
    .from('projetos')
    .select('*, areas(nome)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function getProjetoDetalhes(id: string) {
  z.string().uuid().parse(id)
  const { data, error } = await supabaseAdmin
    .from('projetos')
    .select('*, areas(nome), chat_messages(*), documentacao(*), validacoes(*)')
    .eq('id', id)
    .single()
  if (error) throw new Error(error.message)
  return data
}

// ── Usuários ──────────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  nome: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin_master', 'leader']),
  areaIds: z.array(z.string().uuid()).default([]),
})

export async function createUser(input: unknown) {
  const data = createUserSchema.parse(input)
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: { nome: data.nome },
  })
  if (error) throw new Error(error.message)
  const userId = created.user.id
  await supabaseAdmin
    .from('profiles')
    .upsert({ id: userId, nome: data.nome, email: data.email }, { onConflict: 'id' })
  await supabaseAdmin.from('user_roles').delete().eq('user_id', userId)
  const { error: roleError } = await supabaseAdmin
    .from('user_roles')
    .insert({ user_id: userId, role: data.role })
  if (roleError) throw new Error(roleError.message)
  if (data.role === 'leader' && data.areaIds.length) {
    const { error: areasError } = await supabaseAdmin
      .from('leader_areas')
      .insert(data.areaIds.map((area_id) => ({ user_id: userId, area_id })))
    if (areasError) throw new Error(areasError.message)
  }
  return { id: userId }
}

export async function deleteUser(userId: string, currentEmail: string) {
  z.string().uuid().parse(userId)
  const { data: alvo } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle()
  if (alvo?.email && alvo.email === currentEmail) {
    throw new Error('Você não pode remover a si mesmo.')
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
  if (error) throw new Error(error.message)
  return { ok: true }
}

export async function updateUserAreas(input: unknown) {
  const data = z
    .object({
      userId: z.string().uuid(),
      areaIds: z.array(z.string().uuid()).default([]),
    })
    .parse(input)
  await supabaseAdmin.from('leader_areas').delete().eq('user_id', data.userId)
  if (data.areaIds.length) {
    const { error } = await supabaseAdmin
      .from('leader_areas')
      .insert(data.areaIds.map((area_id) => ({ user_id: data.userId, area_id })))
    if (error) throw new Error(error.message)
  }
  return { ok: true }
}

// ── Configurações ─────────────────────────────────────────────────────────────

export async function getConfiguracoes() {
  const { data, error } = await supabaseAdmin
    .from('configuracoes')
    .select('*')
    .order('chave')
  if (error) throw new Error(error.message)
  return data
}

export async function updateConfiguracao(chave: string, valor: unknown, adminEmail: string) {
  const { error } = await supabaseAdmin
    .from('configuracoes')
    .update({ valor: valor as never, updated_by: adminEmail })
    .eq('chave', chave)
  if (error) throw new Error(error.message)
  return { ok: true }
}
