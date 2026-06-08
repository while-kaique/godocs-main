// Agente Validador
// Analisa a documentação gerada e decide: aprovado ou rejeitado
// Usa critérios configuráveis via tabela configuracoes

import { llmChat } from '@/lib/llm';
import { supabaseAdmin } from '@/integrations/supabase/client.server';
import type { DocumentacaoGerada } from './types';

type CriterioValidacao = {
  nome: string;
  descricao: string;
  peso: 'obrigatorio' | 'importante' | 'desejavel';
};

type ResultadoCriterio = {
  criterio: string;
  aprovado: boolean;
  observacao: string;
};

export type ResultadoValidacao = {
  resultado: 'aprovado' | 'rejeitado';
  parecer: string;
  criterios: ResultadoCriterio[];
  pontuacao: number; // 0-100
};

const CRITERIOS_DEFAULT: CriterioValidacao[] = [
  {
    nome: 'Problema bem definido',
    descricao: 'O problema que a automação resolve está claramente descrito com contexto suficiente.',
    peso: 'obrigatorio',
  },
  {
    nome: 'Funcionamento descrito',
    descricao: 'O fluxo de como a automação funciona está explicado de forma compreensível.',
    peso: 'obrigatorio',
  },
  {
    nome: 'Cálculo de economia consistente',
    descricao: 'O cálculo de economia (horas × valor hora = R$) está correto e o memorial explica como chegou aos números.',
    peso: 'obrigatorio',
  },
  {
    nome: 'Valor da hora dentro do limite',
    descricao: 'O valor da hora utilizado é de pelo menos R$ 8,00.',
    peso: 'obrigatorio',
  },
  {
    nome: 'ROI justificado',
    descricao: 'A economia gerada justifica o esforço de criação e manutenção da automação.',
    peso: 'importante',
  },
  {
    nome: 'Benefícios além do financeiro',
    descricao: 'Foram listados benefícios qualitativos além da economia monetária.',
    peso: 'desejavel',
  },
];

async function getCriterios(): Promise<CriterioValidacao[]> {
  const { data } = await supabaseAdmin
    .from('configuracoes')
    .select('valor')
    .eq('chave', 'validation_criteria')
    .single();

  if (!data || !Array.isArray(data.valor) || data.valor.length === 0) {
    return CRITERIOS_DEFAULT;
  }

  return data.valor as CriterioValidacao[];
}

export async function validarDocumentacao(
  doc: DocumentacaoGerada
): Promise<ResultadoValidacao> {
  const criterios = await getCriterios();

  const systemPrompt = `Você é um analista sênior responsável por validar projetos de automação interna da Gocase antes de irem para produção.

Avalie a documentação do projeto com base nos critérios fornecidos e retorne APENAS JSON válido.

CRITÉRIOS DE VALIDAÇÃO:
${criterios.map((c, i) => `${i + 1}. [${c.peso.toUpperCase()}] ${c.nome}: ${c.descricao}`).join('\n')}

REGRAS DE APROVAÇÃO:
- Todos os critérios OBRIGATORIOS devem ser aprovados
- Pelo menos 1 critério IMPORTANTE deve ser aprovado
- Critérios DESEJÁVEIS são bonus

Responda com JSON exatamente neste formato:
{
  "resultado": "aprovado" ou "rejeitado",
  "parecer": "texto explicando a decisão de forma clara para o responsável pelo projeto",
  "criterios": [
    {"criterio": "nome do critério", "aprovado": true/false, "observacao": "explicação"}
  ],
  "pontuacao": 0-100
}`;

  const userMsg = `Valide a seguinte documentação de projeto:

${JSON.stringify(doc, null, 2)}`;

  const raw = await llmChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ],
    { jsonMode: true, temperature: 0.2 }
  );

  return JSON.parse(raw) as ResultadoValidacao;
}
