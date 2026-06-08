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

// ─── Agente 2: Memorial de saving ───────────────────────────────────────────

export type SavingColetado = {
  economia_horas_mes: number | null;
  valor_hora: number | null;
  economia_reais_mes: number | null;
  tipo_saving: 'mensal' | 'pontual' | null;
  memorial_calculo: string | null;
};

export const savingVazio = (): SavingColetado => ({
  economia_horas_mes: null,
  valor_hora: null,
  economia_reais_mes: null,
  tipo_saving: null,
  memorial_calculo: null,
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
