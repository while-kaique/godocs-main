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
  // null = ainda não perguntado; true/false = resposta do usuário.
  tem_ia_como_funcionalidade?: boolean | null;
  // O que o agente inferiu dos arquivos ANTES de perguntar ao usuário.
  // null = não foi possível inferir (arquivos insuficientes).
  ia_inferida_dos_arquivos?: boolean | null;
  // true quando o usuário contradiz a inferência dos arquivos.
  // Sinaliza para o analisador que vale investigar a inconsistência.
  ia_contradição?: boolean | null;
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
  { label: 'Supervisor', valor_hora: 42.75 },
  { label: 'Especialista+', valor_hora: 55.15 },
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
  economia_reais_mes: number | null;   // total líquido (horas×cargo + custo evitado − custo externo)
  tipo_saving: 'mensal' | 'pontual' | null;
  memorial_calculo: string | null;
  valor_ganho_mensal: number | null;
  // Custo que o projeto passou a EVITAR (ex: serviço externo/licença que deixou de
  // ser paga). É um saving monetário ALÉM das horas — soma ao economia_reais_mes
  // (valor cheio, pontual NÃO divide por 12). Coletado pelo agente na conversa do memorial,
  // não pelo formulário. Distingue-se do custo_externo_mensal (custo INCORRIDO, que
  // subtrai). Os três campos juntos viabilizam a auditoria do cálculo.
  custo_evitado_reais: number | null;
  custo_evitado_tipo: 'mensal' | 'pontual' | null;
  custo_evitado_descricao: string | null;
};

export const savingVazio = (): SavingColetado => ({
  linhas: [],
  economia_horas_mes: null,
  economia_reais_mes: null,
  tipo_saving: null,
  memorial_calculo: null,
  valor_ganho_mensal: null,
  custo_evitado_reais: null,
  custo_evitado_tipo: null,
  custo_evitado_descricao: null,
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
  // Gate determinístico: o LLM declara se o produto final usa IA como
  // funcionalidade (IA usada só para construir/desenvolver NÃO conta).
  // Se false → automacao; se true → pelo menos inteligencia.
  usa_ia?: boolean;
  criterios_hardcoded: CriterioResult[];
  criterios_dinamicos: CriterioResult[];
};

// ─── Mensagem de chat ───────────────────────────────────────────────────────

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// ─── Contexto de revisão (edição de projeto já submetido) ───────────────────
// Quando o usuário EDITA um projeto que já foi submetido e documentado, o
// agente precisa partir da documentação anterior — não recomeçar do zero. Estes
// campos carregam o que foi APROVADO na submissão anterior (doc técnica + memoriais
// + horas/valores financeiros, inclusive os que ficam staff-only). O agente usa
// isso para validar APENAS o que mudou. Só é populado em edição (null no fluxo novo).
export type RevisaoContexto = {
  // Seções técnicas aprovadas na submissão anterior (vindas de documentacao.conteudo).
  doc: {
    o_que_faz?: string | null;
    execucao?: string | null;
    fluxo?: string | null;
    dependencias?: string | null;
    configurar_antes?: string | null;
    atencao?: string | null;
  } | null;
  // Memorial e números do saving anterior (horas antes/depois por cargo + financeiro).
  // Os valores em R$ aqui são staff-only — NUNCA expostos ao usuário no chat.
  saving: {
    memorial_calculo?: string | null;
    linhas?: { cargo: string; horas_antes: number; horas_depois: number }[] | null;
    economia_horas_mes?: number | null;
    economia_reais_mes?: number | null;
    tipo_saving?: string | null;
    alguem_fazia?: string | null;
    custo_externo_mensal?: number | null;
  } | null;
  // Memorial e valor da receita incremental anterior.
  receita: {
    memorial_calculo?: string | null;
    valor_ganho_mensal?: number | null;
  } | null;
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
  // Documentação anterior aprovada — presente apenas quando o projeto está sendo
  // EDITADO (já foi submetido antes). null no fluxo de primeira submissão.
  revisao?: RevisaoContexto | null;
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
