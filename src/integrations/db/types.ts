// Tipos compatíveis com o schema SQLite
// Mantém a mesma interface que o antigo types.ts do Supabase para minimizar mudanças

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProjetoStatus = 'rascunho' | 'em_validacao' | 'validado' | 'rejeitado' | 'aprovado';

export type Projeto = {
  id: string;
  nome: string | null;
  responsavel_nome: string;
  responsavel_email: string;
  area: string | null;
  area_id: string | null;
  ferramenta: string;
  escopo: string | null;
  servico_externo: string | null;
  membros: Json | null;
  status: ProjetoStatus | null;
  chat_completo: boolean | null;
  data_criacao_projeto: string | null;
  tipo_projeto: string | null;
  tipos_projeto: string[] | null;
  descricao_breve: string | null;
  saving_horas: number | null;
  saving_reais: number | null;
  tipo_saving: string | null;
  memorial_calculo: string | null;
  custo_externo_mensal: number | null;
  ganho_total_mensal: number | null;
  complexidade: string | null;
  observacoes: string | null;
  submitted_at: string | null;
  validated_at: string | null;
  validated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type Area = {
  id: string;
  nome: string;
  created_at: string | null;
};

export type ChatMessage = {
  id: string;
  projeto_id: string;
  role: string;
  content: string;
  options: Json | null;
  selected_option: number | null;
  created_at: string | null;
};

export type Documentacao = {
  id: string;
  projeto_id: string;
  conteudo: Json;
  versao: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type Validacao = {
  id: string;
  projeto_id: string;
  resultado: string;
  parecer: string;
  criterios: Json | null;
  admin_email: string | null;
  email_enviado: boolean | null;
  created_at: string | null;
};

export type Analise = {
  id: string;
  projeto_id: string;
  resultado: 'aprovado' | 'rejeitado';
  pontuacao_total: number;
  pontuacao_maxima: number;
  justificativa: string;
  resumo: string | null;
  criterios_hardcoded: Json | null;
  criterios_dinamicos: Json | null;
  created_at: string | null;
};

export type Configuracao = {
  id: string;
  chave: string;
  valor: Json;
  descricao: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export const Constants = {
  public: {
    Enums: {
      projeto_status: ['rascunho', 'em_validacao', 'validado', 'rejeitado', 'aprovado'],
    },
  },
} as const;
