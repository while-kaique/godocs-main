// Tipos compartilhados entre todos os agentes

// ─── Fases do chat ──────────────────────────────────────────────────────────

export type ChatFase = 'doc' | 'doc_preview' | 'saving' | 'saving_preview' | 'receita' | 'receita_preview' | 'completo';

// ─── Agente 1: Documentação técnica (6 seções do template) ───────────────────

export type DocumentacaoColetada = {
  nome_projeto: string | null;
  o_que_faz: string | null;
  execucao: string | null;
  dependencias: string | null;
  fluxo: string | null;
  configurar_antes: string | null;
  atencao: string | null;
  // Indica se o projeto usa IA como funcionalidade (mesmo que secundária).
  // null = ainda não perguntado; true/false = resposta do usuário ou inferência da doc.
  tem_ia_como_funcionalidade?: boolean | null;
};

export const documentacaoVazia = (): DocumentacaoColetada => ({
  nome_projeto: null,
  o_que_faz: null,
  execucao: null,
  dependencias: null,
  fluxo: null,
  configurar_antes: null,
  atencao: null,
  tem_ia_como_funcionalidade: null,
});

// ─── Tabela de cargos (source of truth) ────────────────────────────────────

export const CARGOS = [
  { label: 'Estagiário', valor_hora: 10.78 },
  { label: 'Assistente', valor_hora: 13.94 },
  { label: 'Analista Júnior', valor_hora: 21.29 },
  { label: 'Analista Pleno', valor_hora: 29.90 },
  { label: 'Analista Sênior', valor_hora: 33.10 },
  { label: 'Especialista / Gestor / Head', valor_hora: 55.15 },
] as const;

export type CargoLabel = typeof CARGOS[number]['label'];

// ─── Agente 2: Memorial de saving ───────────────────────────────────────────

// Uma linha = uma pessoa/cargo que executava a tarefa manualmente.
export type SavingLinha = {
  cargo: string;
  horas_antes: number;
  horas_depois: number;
  valor_hora: number;          // derivado do cargo (tabela CARGOS)
  economia_horas_mes: number;  // horas_antes - horas_depois
  economia_reais_mes: number;  // economia_horas_mes * valor_hora
};

export type SavingColetado = {
  linhas: SavingLinha[];               // detalhamento por pessoa/cargo
  economia_horas_mes: number | null;   // total: soma das linhas
  economia_reais_mes: number | null;   // total líquido (já abatido o custo externo)
  tipo_saving: 'mensal' | 'pontual' | null;
  memorial_calculo: string | null;
  valor_ganho_mensal: number | null;
};

export const savingVazio = (): SavingColetado => ({
  linhas: [],
  economia_horas_mes: null,
  economia_reais_mes: null,
  tipo_saving: null,
  memorial_calculo: null,
  valor_ganho_mensal: null,
});

// ─── Agente 3: Receita incremental ──────────────────────────────────────────

export type ReceitaColetada = {
  tipo_saving: 'mensal' | 'pontual' | null;
  valor_ganho_mensal: number | null;
  memorial_calculo: string | null;
  // Racional curto informado pela pessoa no formulário (ex: "as estampas com IA
  // vendem esse valor por mês"). Serve de ponto de partida — o agente o desafia e
  // aprofunda para montar o memorial_calculo.
  racional: string | null;
};

export const receitaVazia = (): ReceitaColetada => ({
  tipo_saving: null,
  valor_ganho_mensal: null,
  memorial_calculo: null,
  racional: null,
});

// ─── Resultados do orquestrador ─────────────────────────────────────────────

export type OrchestratorResult =
  | { type: 'question'; content: string; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado; receita?: ReceitaColetada }
  | { type: 'options'; question: string; options: [string, string, string]; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado; receita?: ReceitaColetada }
  | { type: 'preview'; content: string; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado; receita?: ReceitaColetada }
  | { type: 'complete'; content: string; fase: ChatFase; coletado: DocumentacaoColetada; saving: SavingColetado; receita?: ReceitaColetada };

// ─── Agente Analisador ──────────────────────────────────────────────────────

export type CriterioResult = {
  criterio: string;
  pontos: number;
  justificativa: string;
};

export type Complexidade = 'automacao' | 'inteligencia' | 'autonomia';

export type ResultadoAnalise = {
  resultado: 'aprovado' | 'rejeitado';
  pontuacao_total: number;
  pontuacao_maxima: number;
  justificativa: string;
  resumo: string;
  complexidade: Complexidade;
  complexidade_justificativa?: string;
  // Gate determinístico: o LLM declara se há uma IA decidindo o caminho/ação do
  // processo. Se false, a complexidade é forçada para 'automacao' no backend
  // (evita classificar automação sofisticada/sem IA como 'inteligencia').
  ia_decide_caminho?: boolean;
  criterios_hardcoded: CriterioResult[];
  criterios_dinamicos: CriterioResult[];
};

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
  tipos_projeto?: ('saving' | 'receita_incremental')[] | null;
  escopo?: 'interno' | 'externo' | null;
  // Projeto especial: flag + contexto que a pessoa escreveu para explicar o impacto.
  especial?: boolean;
  contexto_especial?: string | null;
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
    linhas: SavingLinha[];
    economia_horas_mes: number;
    economia_reais_mes: number;
    tipo_saving: 'mensal' | 'pontual';
    memorial_calculo: string;
  };
  gerado_em: string;
};
