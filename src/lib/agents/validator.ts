// Agente Validador
// Analisa a documentação gerada e decide: aprovado ou rejeitado
// Usa critérios configuráveis via tabela configuracoes

import { llmChat } from '@/lib/llm';
import { getConfiguracao, parseJson } from '@/integrations/db/client.server';
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
    nome: 'Propósito claro',
    descricao: 'A seção "O que faz" descreve com clareza o problema resolvido, o público-alvo e o resultado esperado.',
    peso: 'obrigatorio',
  },
  {
    nome: 'Trigger definido',
    descricao: 'A seção "Execução" explica como e quando o projeto é acionado (schedule, webhook, manual, etc.).',
    peso: 'obrigatorio',
  },
  {
    nome: 'Dependências completas',
    descricao: 'Todos os serviços externos, APIs e credenciais necessárias estão listados na seção "Dependências".',
    peso: 'obrigatorio',
  },
  {
    nome: 'Fluxo lógico e completo',
    descricao: 'A seção "Fluxo" apresenta a sequência de etapas do início ao fim, sem pular passos, incluindo ramificações condicionais.',
    peso: 'obrigatorio',
  },
  {
    nome: 'Configuração inicial documentada',
    descricao: 'A seção "Configurar antes de usar" lista os passos necessários para alguém novo conseguir rodar o projeto.',
    peso: 'importante',
  },
  {
    nome: 'Riscos e limitações identificados',
    descricao: 'A seção "Atenção" contém riscos reais e específicos, não genéricos.',
    peso: 'desejavel',
  },
];

async function getCriterios(): Promise<CriterioValidacao[]> {
  const row = await getConfiguracao('validation_criteria');
  const valor = row ? parseJson<CriterioValidacao[]>(row.valor) : null;

  if (!valor || !Array.isArray(valor) || valor.length === 0) {
    return CRITERIOS_DEFAULT;
  }

  return valor;
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
