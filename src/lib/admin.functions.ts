import { z } from 'zod'
import {
  getAreas as dbGetAreas,
  insertArea,
  deleteArea as dbDeleteArea,
  getAdmins as dbGetAdmins,
  insertAdmin,
  deleteAdmin,
  getProjetosWithArea,
  getProjetoWithRelations,
  upsertProfile,
  deleteProfile,
  getProfileById,
  insertUserRole,
  deleteUserRoles,
  deleteLeaderAreas,
  insertLeaderAreas,
  getProfiles,
  getUserRoles,
  getLeaderAreas,
  getConfiguracoes as dbGetConfiguracoes,
  updateConfiguracao as dbUpdateConfiguracao,
  parseJson,
  type ProjetoRow,
} from '@/integrations/db/client.server'

// ID de área/admin/projeto é hex de 32 chars (não é UUID), então validamos
// apenas como string não-vazia.
const idSchema = z.string().min(1).max(64)

// ── Mapeadores (linha SQLite → formato consumido pelo frontend) ────────────────

function mapProjeto(row: ProjetoRow & { area_nome?: string | null }) {
  const { area_nome, membros, tipos_projeto, chat_completo, ...rest } = row
  return {
    ...rest,
    membros: parseJson<string[]>(membros) ?? [],
    tipos_projeto: parseJson<string[]>(tipos_projeto),
    chat_completo: !!chat_completo,
    areas: area_nome ? { nome: area_nome } : null,
  }
}

// ── Áreas ────────────────────────────────────────────────────────────────────

export async function getAreas() {
  return dbGetAreas()
}

export async function createArea(nome: string, _adminEmail: string) {
  const parsed = z.string().min(1).max(100).parse(nome)
  return insertArea(parsed)
}

export async function deleteArea(id: string, _adminEmail: string) {
  idSchema.parse(id)
  dbDeleteArea(id)
  return { ok: true }
}

// ── Admins ────────────────────────────────────────────────────────────────────

export async function getAdmins() {
  return dbGetAdmins()
}

export async function addAdmin(input: { email: string; nome?: string }) {
  const parsed = z
    .object({ email: z.string().email(), nome: z.string().optional() })
    .parse(input)
  return insertAdmin(parsed.email, parsed.nome ?? null)
}

export async function removeAdmin(id: string, currentEmail: string) {
  idSchema.parse(id)
  const admin = dbGetAdmins().find((a) => a.id === id)
  if (admin?.email === currentEmail) {
    throw new Error('Você não pode remover a si mesmo.')
  }
  deleteAdmin(id)
  return { ok: true }
}

// ── Projetos ──────────────────────────────────────────────────────────────────

export async function getProjetos() {
  return getProjetosWithArea().map(mapProjeto)
}

export async function getProjetoDetalhes(id: string) {
  idSchema.parse(id)
  const projeto = getProjetoWithRelations(id)
  if (!projeto) throw new Error('Projeto não encontrado.')

  const { chat_messages, documentacao, validacoes, ...projetoRow } = projeto
  return {
    ...mapProjeto(projetoRow),
    chat_messages: chat_messages.map((m) => ({
      ...m,
      options: parseJson(m.options),
    })),
    documentacao: documentacao.map((d) => ({
      ...d,
      conteudo: parseJson(d.conteudo),
    })),
    validacoes: validacoes.map((v) => ({
      ...v,
      criterios: parseJson(v.criterios),
      email_enviado: !!v.email_enviado,
    })),
  }
}

// ── Usuários ──────────────────────────────────────────────────────────────────

type Role = 'admin_master' | 'leader'

// Lista usuários (profiles) com seu papel e áreas vinculadas, junto das áreas
// disponíveis — em uma única chamada para a página de gestão.
export async function getUsuarios() {
  const profiles = getProfiles()
  const roles = getUserRoles()
  const leaderAreas = getLeaderAreas()
  const areas = dbGetAreas()

  const roleMap = new Map<string, Role>()
  for (const r of roles) roleMap.set(r.user_id, r.role as Role)

  const areaMap = new Map<string, string[]>()
  for (const la of leaderAreas) {
    const arr = areaMap.get(la.user_id) ?? []
    arr.push(la.area_id)
    areaMap.set(la.user_id, arr)
  }

  const usuarios = profiles.map((p) => ({
    id: p.id,
    nome: p.nome,
    email: p.email,
    role: roleMap.get(p.id) ?? null,
    areaIds: areaMap.get(p.id) ?? [],
  }))

  return { usuarios, areas }
}

const createUserSchema = z.object({
  nome: z.string().min(1).max(120),
  email: z.string().email(),
  // Senha é exigida pelo formulário, mas não é mais usada: a autenticação é
  // feita pelo Godeploy edge (Google OAuth), não há credenciais locais.
  password: z.string().min(6).optional(),
  role: z.enum(['admin_master', 'leader']),
  areaIds: z.array(idSchema).default([]),
})

export async function createUser(input: unknown) {
  const data = createUserSchema.parse(input)
  const userId = crypto.randomUUID()
  upsertProfile(userId, data.nome, data.email)
  deleteUserRoles(userId)
  insertUserRole(userId, data.role)
  if (data.role === 'leader' && data.areaIds.length) {
    insertLeaderAreas(userId, data.areaIds)
  }
  return { id: userId }
}

export async function deleteUser(userId: string, currentEmail: string) {
  idSchema.parse(userId)
  const alvo = getProfileById(userId)
  if (alvo?.email && alvo.email === currentEmail) {
    throw new Error('Você não pode remover a si mesmo.')
  }
  // user_roles e leader_areas têm ON DELETE CASCADE.
  deleteProfile(userId)
  return { ok: true }
}

export async function updateUserAreas(input: unknown) {
  const data = z
    .object({
      userId: idSchema,
      areaIds: z.array(idSchema).default([]),
    })
    .parse(input)
  deleteLeaderAreas(data.userId)
  if (data.areaIds.length) {
    insertLeaderAreas(data.userId, data.areaIds)
  }
  return { ok: true }
}

// ── Configurações ─────────────────────────────────────────────────────────────

export async function getConfiguracoes() {
  return dbGetConfiguracoes().map((c) => ({
    ...c,
    valor: parseJson(c.valor),
  }))
}

export async function updateConfiguracao(chave: string, valor: unknown, adminEmail: string) {
  dbUpdateConfiguracao(chave, valor, adminEmail)
  return { ok: true }
}
