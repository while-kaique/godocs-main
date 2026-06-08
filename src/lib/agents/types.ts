// Tipos compartilhados entre todos os agentes

export type DocumentacaoColetada = {
  nome_projeto: string | null;
  problema_resolve: string | null;
  como_funciona: string | null;
  economia_horas_mes: number | null;
  valor_hora: number | null;
  economia_reais_mes: number | null;
  memorial_calculo: string | null;
  beneficios_adicionais: string | null;
};

export const documentacaoVazia = (): DocumentacaoColetada => ({
  nome_projeto: null,
  problema_resolve: null,
  como_funciona: null,
  economia_horas_mes: null,
  valor_hora: null,
  economia_reais_mes: null,
  memorial_calculo: null,
  beneficios_adicionais: null,
});

export type OrchestratorResult =
  | { type: 'question'; content: string; coletado: DocumentacaoColetada }
  | { type: 'options'; question: string; options: [string, string, string]; coletado: DocumentacaoColetada }
  | { type: 'complete'; content: string; coletado: DocumentacaoColetada };

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

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

export type DocumentacaoGerada = {
  titulo: string;
  responsavel: { nome: string; email: string; area: string | null };
  ferramenta: string;
  membros: string[];
  problema_resolve: string;
  como_funciona: string;
  impacto: {
    economia_horas_mes: number;
    valor_hora: number;
    economia_reais_mes: number;
    memorial_calculo: string;
  };
  beneficios_adicionais: string;
  gerado_em: string;
};
