// Tipos compartilhados entre todos os agentes

// ─── Fases do chat ──────────────────────────────────────────────────────────

export type ChatFase = 'doc' | 'doc_preview' | 'saving' | 'saving_preview' | 'completo';

// ─── Agente 1: Documentação técnica (6 seções do template) ───────────────────

export type DocumentacaoColetada = {
  nome_projeto: string | null;
  o_que_faz: string | null;
  execucao: string | null;
  dependencias: string | null;
  fluxo: string | null;
  configurar_antes: string | null;
  atencao: string | null;
};

export const documentacaoVazia = (): DocumentacaoColetada => ({
  nome_projeto: null,
  o_que_faz: null,
  execucao: null,
  dependencias: null,
  fluxo: null,
  configurar_antes: null,
  atencao: null,
});

// ─── Tabela de cargos (source of truth) ────────────────────────────────────

export const CARGOS = [
  { label: 'Estagiário', valor_hora: 10.78 },
  { label: 'Assistente', valor_hora: 13.94 },
  { label: 'Analista Júnior', valor_hora: 21.29 },
  { label: 'Analista Pleno', valor_hora: 29.90 },
  { label: 'Analista Sênior', valor_hora: 33.10 },
  { label: 'Coordenador / Especialista', valor_hora: 55.15 },
] as const;

export type CargoLabel = typeof CARGOS[number]['label'];

// ─── Agente 2: Memorial de saving ───────────────────────────────────────────

export type SavingColetado = {
  cargo: string | null;
  horas_antes: number | null;
  horas_depois: number | null;
  economia_horas_mes: number | null;
  valor_hora: number | null;
  economia_reais_mes: number | null;
  tipo_saving: 'mensal' | 'pontual' | null;
  memorial_calculo: string | null;
  valor_ganho_mensal: number | null;
};

export const savingVazio = (): SavingColetado => ({
  cargo: null,
  horas_antes: null,
  horas_depois: null,
  economia_horas_mes: null,
  valor_hora: null,
  economia_reais_mes: null,
  tipo_saving: null,
  memorial_calculo: null,
  valor_ganho_mensal: null,
});

// ─── Resultados do orquestrador ─────────────────────────────────────────────

export type OrchestratorResult =
  | { type: 'question'; content: string; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado }
  | { type: 'options'; question: string; options: [string, string, string]; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado }
  | { type: 'preview'; content: string; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado }
  | { type: 'complete'; content: string; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado };

// ─── Mensagem de chat ───────────────────────────────────────────────────────

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ─── Contexto do projeto (vem do formulário + doc enviado) ──────────────────

export type ProjetoContexto = {
  responsavel_nome: string;
  responsavel_email: string;
  area: string | null;
  ferramenta: string;
  membros: string[];
  nome_projeto: string;
  data_criacao: string | null;
  doc_texto: string | null;
  descricao_breve?: string | null;
  tipo_projeto?: 'saving' | 'receita_incremental' | null;
};

// ─── Documentação gerada (output do compiler) ───────────────────────────────

export type DocumentacaoGerada = {
  titulo: string;
  responsavel: { nome: string; email: string; area: string | null };
  ferramenta: string;
  membros: string[];
  o_que_faz: string;
  execucao: string;
  dependencias: { servico: string; descricao: string }[];
  fluxo: { etapa: string; descricao: string; condicoes?: { se: string; acao: string }[] }[];
  configurar_antes: string[];
  atencao: { titulo: string; descricao: string }[];
  saving?: {
    economia_horas_mes: number;
    valor_hora: number;
    economia_reais_mes: number;
    tipo_saving: 'mensal' | 'pontual';
    memorial_calculo: string;
  };
  gerado_em: string;
};
