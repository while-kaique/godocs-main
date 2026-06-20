// Funções de negócio para "Meus Projetos" — lista e detalhe de projetos do usuário.
// O email do solicitante vem SEMPRE do header Godeploy (nunca do body/query).

import {
  getProjetosByOwnerEmail,
  getProjetoWithRelations,
  getProjetoById,
  getLatestVersionByProjeto,
  getAdminByEmail,
  getChatMessages,
  excluirProjetoCascade,
  parseJson,
} from '@/integrations/db/client.server';
import type { ProjetoRow } from '@/integrations/db/client.server';
import { syncOwnerRowsFromSheet } from '@/lib/google/sync-reverse';

export type MeuProjetoItem = {
  id: string;
  nome: string | null;
  status: string | null;
  tipos_projeto: string[];
  especial: boolean;
  area_nome: string | null;
  ganho_total_mensal: number | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
  arquivos_nomes: string[];
  // "Atualizado Em" do Sheets (carimbo da última escrita do sistema). Vazio = o app
  // nunca escreveu na planilha p/ este projeto = legado pendente de edição.
  atualizado_em: string | null;
  // Legado pendente: submetido (não-rascunho) mas sem "Atualizado Em" no Sheets →
  // precisa ser editado/reenviado até o prazo para regularizar.
  pendente: boolean;
};

// Prazo para regularizar legados (editar/reenviar até deixar de ter "Atualizado Em" vazio).
export const PRAZO_LEGADO = '30/06/2026';

export type VersaoSnapshot = {
  versao_num: number;
  acao: string;
  snapshot_projeto: {
    nome: string | null;
    descricao_breve: string | null;
    ferramenta: string | null;
    tipos_projeto: string[];
    area: string | null;
    saving_horas: number | null;
    saving_reais: number | null;
    tipo_saving: string | null;
    memorial_calculo: string | null;
    ganho_total_mensal: number | null;
    custo_externo_mensal: number | null;
    alguem_fazia: string | null;
  };
  snapshot_doc: {
    saving?: { memorial_calculo?: string | null };
    receita?: { memorial_calculo?: string | null };
  } | null;
  created_at: string | null;
};

export type MeuProjetoDetalhes = MeuProjetoItem & {
  responsavel_nome: string;
  responsavel_email: string;
  ferramenta: string;
  escopo: string | null;
  servico_externo: string | null;
  membros: string[];
  nome_projeto: string | null;
  data_criacao_projeto: string | null;
  descricao_breve: string | null;
  contexto_especial: string | null;
  tipo_saving: string | null;
  saving_horas: number | null;
  saving_reais: number | null;
  custo_externo_mensal: number | null;
  alguem_fazia: string | null;
  memorial_calculo: string | null;
  documentacao: unknown | null;
  ultima_versao: VersaoSnapshot | null;
};

function ehDono(projeto: ProjetoRow, email: string): boolean {
  const alvo = email.trim().toLowerCase();
  if ((projeto.responsavel_email ?? '').trim().toLowerCase() === alvo) return true;
  const membros = parseJson<string[]>(projeto.membros) ?? [];
  return membros.some((m) => m.trim().toLowerCase() === alvo);
}

// "Atualizado Em" preenchido? Trata vazio/"—"/"-" como ausente (= legado pendente).
function temAtualizadoEm(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = String(v).trim();
  return s !== '' && s !== '—' && s !== '-';
}

// Projeto LEGADO? Só os ids no padrão "LEGADO-233" (importados antes do formulário)
// contam como pendentes. Projetos submetidos pelo app têm id aleatório (hex) e NUNCA
// são pendentes, mesmo sem "Atualizado Em" — a pendência só vale para regularizar legado.
function ehLegado(id: string): boolean {
  return id.toLowerCase().includes('legado');
}

function mapItem(p: ProjetoRow & { area_nome: string | null }, atualizadoEm: string | null): MeuProjetoItem {
  const at = temAtualizadoEm(atualizadoEm) ? atualizadoEm : null;
  return {
    id: p.id,
    nome: p.nome,
    status: p.status,
    tipos_projeto: parseJson<string[]>(p.tipos_projeto) ?? [],
    especial: p.especial === 1,
    area_nome: p.area_nome ?? p.area ?? null,
    ganho_total_mensal: p.ganho_total_mensal,
    created_at: p.created_at,
    updated_at: p.updated_at,
    submitted_at: p.submitted_at,
    arquivos_nomes: parseJson<string[]>(p.arquivos_nomes) ?? [],
    atualizado_em: at,
    // Pendente = LEGADO (id "LEGADO-…") e sem "Atualizado Em" no Sheets → precisa ser
    // editado/reenviado para regularizar. Projetos comuns submetidos pelo app NUNCA
    // são pendentes (mesmo sem Atualizado Em).
    pendente: ehLegado(p.id) && !at,
  };
}

export async function listarMeusProjetos(email: string): Promise<MeuProjetoItem[]> {
  // Sheets é a fonte da verdade: antes de listar, espelha do Sheets os projetos
  // deste usuário (legados que só existem na planilha, edições manuais). Falha de
  // leitura da planilha não pode quebrar a tela — cai de volta no SQLite.
  // Reaproveita as linhas lidas para mapear o "Atualizado Em" de cada projeto.
  const atualizadoMap = new Map<string, string>();
  try {
    const { rows } = await syncOwnerRowsFromSheet(email);
    for (const r of rows) {
      const id = (r['ID Projeto'] ?? '').trim().toLowerCase();
      if (id) atualizadoMap.set(id, (r['Atualizado Em'] ?? '').trim());
    }
  } catch (e) {
    console.error('[meus-projetos] sync sob demanda falhou, usando SQLite:', e);
  }
  const rows = await getProjetosByOwnerEmail(email);
  // Refiltro em JS para evitar falso-positivo de LIKE com emails que são substring de outro.
  // "Atualizado Em": usa o valor recém-lido da planilha; se a leitura falhou (mapa
  // vazio), cai no espelho persistido no SQLite — nunca marca tudo como pendente.
  return rows
    .filter((p) => ehDono(p, email))
    .map((p) => mapItem(p, atualizadoMap.get(p.id.toLowerCase()) ?? p.atualizado_em ?? null));
}

/**
 * Contagem de projetos PENDENTES (legados sem "Atualizado Em") do usuário — p/ o
 * selo da home. Lê SÓ do SQLite (coluna `atualizado_em`, espelho do Sheets mantido
 * pelo sync reverso e pela submissão) — NÃO chama o Google Sheets, então é
 * instantânea. A precisão é mantida pelo cron horário, pela submissão (IDA marca na
 * hora) e pelo sync sob demanda ao abrir "Meus Projetos".
 */
export async function contarPendentes(email: string): Promise<{ count: number; prazo: string }> {
  const rows = await getProjetosByOwnerEmail(email);
  const count = rows
    .filter((p) => ehDono(p, email))
    .filter((p) => ehLegado(p.id) && !temAtualizadoEm(p.atualizado_em))
    .length;
  return { count, prazo: PRAZO_LEGADO };
}

/**
 * Exclui um RASCUNHO do usuário. Gate de ownership (email do header) + só permite
 * apagar projeto com status 'rascunho' (nunca submetido). Apaga em cascata.
 */
export async function excluirRascunho(email: string, projetoId: string): Promise<{ ok: true }> {
  const p = await getProjetoById(projetoId);
  if (!p) throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  if (!ehDono(p, email)) throw Object.assign(new Error('Sem permissão para excluir este projeto.'), { status: 403 });
  if (p.status !== 'rascunho') {
    throw Object.assign(new Error('Apenas rascunhos podem ser excluídos.'), { status: 400 });
  }
  await excluirProjetoCascade(projetoId);
  return { ok: true };
}

export async function getMeuProjeto(
  id: string,
  email: string,
): Promise<MeuProjetoDetalhes> {
  const data = await getProjetoWithRelations(id);
  if (!data) {
    throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  }
  // Dono (responsável ou membro) pode abrir/editar. Admins (emails do RPA
  // cadastrados na tabela `admins`) podem abrir/editar QUALQUER projeto.
  if (!ehDono(data, email) && !(await getAdminByEmail(email))) {
    throw Object.assign(new Error('Acesso negado.'), { status: 403 });
  }

  const docRow = data.documentacao?.[0];
  const docConteudo = docRow ? parseJson(docRow.conteudo) : null;

  const ultimaVersaoRow = await getLatestVersionByProjeto(id);
  let ultima_versao: VersaoSnapshot | null = null;
  if (ultimaVersaoRow) {
    ultima_versao = {
      versao_num: ultimaVersaoRow.versao_num,
      acao: ultimaVersaoRow.acao,
      snapshot_projeto: parseJson(ultimaVersaoRow.snapshot_projeto) ?? ({} as VersaoSnapshot['snapshot_projeto']),
      snapshot_doc: parseJson(ultimaVersaoRow.snapshot_doc ?? null),
      created_at: ultimaVersaoRow.created_at,
    };
  }

  // Detalhe não consulta o Sheets; usa o "Atualizado Em" espelhado no SQLite.
  const base = mapItem({ ...data, area_nome: data.area_nome ?? null }, data.atualizado_em ?? null);
  return {
    ...base,
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    escopo: data.escopo,
    servico_externo: data.servico_externo,
    membros: parseJson<string[]>(data.membros) ?? [],
    nome_projeto: data.nome,
    data_criacao_projeto: data.data_criacao_projeto,
    descricao_breve: data.descricao_breve,
    contexto_especial: data.contexto_especial,
    tipo_saving: data.tipo_saving,
    saving_horas: data.saving_horas,
    saving_reais: data.saving_reais,
    custo_externo_mensal: data.custo_externo_mensal,
    alguem_fazia: data.alguem_fazia,
    memorial_calculo: data.memorial_calculo,
    documentacao: docConteudo,
    ultima_versao,
  };
}

// Histórico de chat de um projeto do usuário — usado na RETOMADA de um rascunho
// quando não há snapshot local (ex.: outro navegador). Ownership idêntico ao
// getMeuProjeto: dono (responsável/membro) ou admin.
export async function getHistoricoMeuProjeto(
  id: string,
  email: string,
): Promise<Array<{ role: string; content: string; options: string[] | null }>> {
  const data = await getProjetoWithRelations(id);
  if (!data) {
    throw Object.assign(new Error('Projeto não encontrado.'), { status: 404 });
  }
  if (!ehDono(data, email) && !(await getAdminByEmail(email))) {
    throw Object.assign(new Error('Acesso negado.'), { status: 403 });
  }
  const msgs = await getChatMessages(id);
  return msgs.map((m) => ({
    role: m.role,
    content: m.content,
    options: parseJson<string[]>(m.options),
  }));
}
