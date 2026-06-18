// Funções de negócio para "Meus Projetos" — lista e detalhe de projetos do usuário.
// O email do solicitante vem SEMPRE do header Godeploy (nunca do body/query).

import {
  getProjetosByOwnerEmail,
  getProjetoWithRelations,
  getLatestVersionByProjeto,
  getAdminByEmail,
  parseJson,
} from '@/integrations/db/client.server';
import type { ProjetoRow } from '@/integrations/db/client.server';

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
};

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
  if (projeto.responsavel_email === email) return true;
  const membros = parseJson<string[]>(projeto.membros) ?? [];
  return membros.includes(email);
}

function mapItem(p: ProjetoRow & { area_nome: string | null }): MeuProjetoItem {
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
  };
}

export async function listarMeusProjetos(email: string): Promise<MeuProjetoItem[]> {
  const rows = await getProjetosByOwnerEmail(email);
  // Refiltro em JS para evitar falso-positivo de LIKE com emails que são substring de outro
  return rows
    .filter((p) => ehDono(p, email))
    .map(mapItem);
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

  const base = mapItem({ ...data, area_nome: data.area_nome ?? null });
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
