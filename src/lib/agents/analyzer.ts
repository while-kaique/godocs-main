// Agente Analisador — análise holística pré-submissão
// Avalia toda a submissão (doc + saving/receita + metadados) com critérios fixos + dinâmicos

import { llmChat } from '@/lib/llm';
import {
  getProjetoById,
  getDocumentacao,
  parseJson,
} from '@/integrations/db/client.server';
import type { ResultadoAnalise, CriterioResult, Complexidade } from './types';

const log = (...args: unknown[]) => console.log('[analyzer]', ...args);
const err = (...args: unknown[]) => console.error('[analyzer]', ...args);

// ─── Critérios hardcoded ────────────────────────────────────────────────────

export const CRITERIOS_HARDCODED = [
  {
    id: 'proposito_claro',
    nome: 'Propósito de negócio claro',
    descricao:
      'A seção "O que faz" descreve com clareza o PROBLEMA de negócio resolvido, quem é o público-alvo e qual o resultado concreto entregue. Não basta descrever o que o código faz tecnicamente — precisa explicar o POR QUÊ.',
  },
  {
    id: 'trigger_definido',
    nome: 'Modo de execução (trigger) especificado',
    descricao:
      'A seção "Execução" contém informação concreta sobre como e quando o projeto é acionado: schedule (com frequência), webhook (com origem), manual (com instruções), evento, etc. Respostas genéricas como "é executado automaticamente" NÃO contam.',
  },
  {
    id: 'dependencias_completas',
    nome: 'Dependências externas listadas',
    descricao:
      'Todos os serviços externos, APIs, credenciais, bancos de dados e integrações de terceiros necessários estão enumerados na seção "Dependências". Cada um com nome claro e descrição do uso.',
  },
  {
    id: 'fluxo_logico',
    nome: 'Fluxo sequencial, completo e coerente',
    descricao:
      'A seção "Fluxo" apresenta a sequência de etapas do início ao fim, sem lacunas evidentes, incluindo ramificações condicionais (IF/ELSE) quando aplicável. Um leitor novo deve conseguir entender o caminho completo da execução.',
  },
  {
    id: 'configuracao_documentada',
    nome: 'Pré-requisitos de setup documentados',
    descricao:
      'A seção "Configurar antes de usar" lista passos concretos: variáveis de ambiente, credenciais a obter, serviços a configurar, permissões necessárias. Se não há nada a configurar, deve estar explicitamente dito.',
  },
  {
    id: 'riscos_especificos',
    nome: 'Riscos e limitações específicos',
    descricao:
      'A seção "Atenção" contém riscos REAIS e ESPECÍFICOS do projeto, não frases genéricas como "pode falhar se a API cair". Deve mencionar cenários concretos: limites de taxa, dados sensíveis, dependência de formato específico, pontos de falha únicos, etc.',
  },
  {
    id: 'saving_coerente',
    nome: 'Memorial de cálculo com lógica sólida',
    descricao:
      'O memorial de saving/receita apresenta uma lógica de cálculo coerente: as horas antes/depois são justificadas com detalhamento da rotina manual, os valores são compatíveis com a complexidade descrita no projeto, e não há extrapolação evidente.',
  },
  {
    id: 'ferramenta_compativel',
    nome: 'Ferramenta coerente com o projeto',
    descricao:
      'A ferramenta informada no cadastro (ex: n8n, Python, Power Automate) é coerente com o que está descrito na documentação técnica. O fluxo e as dependências fazem sentido para a ferramenta indicada.',
  },
  {
    id: 'descricao_alinhada',
    nome: 'Descrição breve alinhada com documentação',
    descricao:
      'A descrição breve do projeto é coerente e consistente com o conteúdo completo da documentação técnica e do memorial. Não há contradições nem informações que divergem entre a descrição e os documentos detalhados.',
  },
  {
    id: 'completude_geral',
    nome: 'Submissão completa sem lacunas evidentes',
    descricao:
      'A submissão como um todo está completa: todos os campos obrigatórios preenchidos, sem seções vazias ou com respostas placeholder, e as diferentes partes (doc técnica + memorial) se complementam formando um quadro coerente do projeto.',
  },
] as const;

// ─── System prompt ──────────────────────────────────────────────────────────

export function buildSystemPrompt(): string {
  const criteriosStr = CRITERIOS_HARDCODED.map(
    (c, i) => `${i + 1}. **${c.nome}** (id: ${c.id}): ${c.descricao}`
  ).join('\n');

  return `Você é um analista sênior de qualidade da área de RPA & IA do GoGroup. Sua função é avaliar CRITICAMENTE a submissão de um projeto de automação ANTES de ele ser enviado para triagem humana.

Você receberá TODOS os dados do projeto: metadados (título, área, ferramenta, descrição breve), documentação técnica completa (7 campos), e memorial de saving e/ou receita incremental. Analise TUDO com ceticismo saudável.

## POSTURA

- Seja criterioso e cético, mas justo. Não sinalize ajustes por preciosismo — sinalize por falta real de substância.
- Avalie a COERÊNCIA entre as partes: a descrição breve bate com a documentação? O saving faz sentido dado o fluxo descrito? A ferramenta é compatível com as dependências?
- Identifique informações vagas, genéricas ou que parecem geradas sem reflexão real do usuário.
- Considere que o responsável pode ter respondido de forma resumida mas correta — não penalize brevidade se o conteúdo for preciso.

## CRITÉRIOS FIXOS (avalie cada um com 0 ou 1 ponto)

${criteriosStr}

## CRITÉRIOS DINÂMICOS

Além dos 10 critérios fixos, gere de 2 a 3 critérios ADICIONAIS específicos para este projeto. Cada critério dinâmico vale **+1** (atendido) ou **-1** (violado).

Baseie seus critérios dinâmicos no que você observa nos dados — exemplos:
- Tratamento de erros e exceções está documentado
- Dados sensíveis (PII, credenciais) são tratados com cuidado
- O escopo do saving não é extrapolado além do razoável
- Há coerência entre a complexidade do fluxo e as horas economizadas
- Se usa serviço externo, o custo está considerado

NÃO invente critérios genéricos. Cada critério dinâmico deve ser relevante para ESTE projeto específico.

## REGRAS DE APROVAÇÃO

1. Calcule: \`pontuacao_total = soma(pontos_hardcoded) + soma(pontos_dinamicos)\`
2. Calcule: \`pontuacao_maxima = 10 + quantidade_criterios_dinamicos\`
3. Se \`pontuacao_total >= 70% de pontuacao_maxima\` E pelo menos 6 dos 10 critérios fixos forem aprovados → **"aprovado"**
4. Caso contrário → **"rejeitado"** (significa que o time de RPA conversará com o responsável para ajustar — NÃO é uma negação do projeto)

## JUSTIFICATIVA

Escreva a justificativa em português usando markdown estruturado com as seções abaixo. Use bullet points (- ) dentro de cada seção. Seja direto e conciso — **máximo 4 bullets por seção** (priorize os mais relevantes). Cada bullet deve ser uma frase completa, com acentuação correta e letra maiúscula no início.

## Pontos fortes
- (liste os aspectos positivos mais relevantes da submissão, máximo 4 bullets)

## Pontos de atenção
- (liste os problemas encontrados, máximo 4 bullets — omita esta seção se não houver)

## Conclusão
- Uma frase clara explicando o resultado. Se não aprovado, deixe claro que o projeto será revisado junto com o time de RPA para ajustes — não é uma rejeição.

## Recomendações
- (liste ações concretas de melhoria, mesmo se aprovado, máximo 4 bullets)

## RESUMO

Além da justificativa completa, gere um campo "resumo": um texto curto (2-4 frases) com a conclusão principal da análise. Esse resumo é o que o usuário verá na tela. Deve ser claro, direto e explicar o veredito em linguagem simples. Se o resultado for "rejeitado", NÃO use a palavra "rejeitado" nem "reprovado" — diga que a submissão será encaminhada para revisão conjunta com o time de RPA. Use markdown básico (**negrito** para ênfase).

## CLASSIFICAÇÃO DE COMPLEXIDADE

Classifique o projeto em EXATAMENTE um dos 3 níveis de complexidade, analisando a documentação técnica em conjunto com a descrição breve:

- **"automacao"**: Nível básico. O projeto apenas automatiza algo que antes era manual ou mais complexo. Não usa IA de forma significativa — é uma automação direta de processo (ex: RPA que preenche planilha, bot que envia e-mails, script que move arquivos).
- **"inteligencia"**: Nível intermediário. O projeto usa IA para analisar ou executar atividades de forma minimamente inteligente, mudando o processo de alguma forma significativa. A IA tem papel ativo na tomada de decisão ou análise (ex: classificação automática de tickets, análise de sentimento, extração inteligente de dados).
- **"autonomia"**: Nível mais alto. O projeto elimina completamente ou quase completamente o envolvimento humano do processo E ao mesmo tempo utiliza IA de forma inteligente. A combinação de automação total + IA é o que define este nível (ex: agente que resolve tickets sozinho, pipeline que processa e decide sem intervenção humana).

Critérios para decidir:
1. O projeto usa IA (LLM, ML, NLP, visão computacional, etc.) de forma ativa? Se NÃO → "automacao"
2. Se SIM, a IA é usada para análise/decisão mas ainda requer intervenção humana significativa? → "inteligencia"
3. Se a IA é usada E o processo roda de ponta a ponta sem (ou quase sem) intervenção humana? → "autonomia"

## FORMATO DE RESPOSTA

Responda APENAS com JSON válido, exatamente neste formato.

IMPORTANTE:
- No campo "criterio", use o **nome legível em português com acentuação correta** (ex: "Propósito de negócio claro"), NÃO o id em snake_case.
- Avalie TODOS os 10 critérios fixos + dinâmicos internamente para calcular a pontuação.
- Mas no JSON de resposta, retorne APENAS os **4 critérios aprovados mais relevantes** e os **4 critérios reprovados mais relevantes** (ou menos, se não houver tantos). O total de critérios retornados deve ser no MÁXIMO 8.
- Priorize os critérios que mais impactam a qualidade da submissão. Critérios óbvios ou triviais (que qualquer submissão atenderia) NÃO precisam aparecer.

{
  "resultado": "aprovado" | "rejeitado",
  "pontuacao_total": <number>,
  "pontuacao_maxima": <number>,
  "justificativa": "<texto detalhado em markdown com seções ## Pontos fortes, ## Pontos de atenção, ## Conclusão, ## Recomendações>",
  "resumo": "<2-4 frases claras resumindo o resultado para o usuário>",
  "complexidade": "automacao" | "inteligencia" | "autonomia",
  "criterios_hardcoded": [
    ...apenas os mais relevantes entre os 10 fixos (max 4 aprovados + max 4 reprovados)...
    {"criterio": "Nome legível do critério", "pontos": 0 | 1, "justificativa": "<explicação>"}
  ],
  "criterios_dinamicos": [
    ...apenas os mais relevantes (max 2-3 no total, contando no limite de 8)...
    {"criterio": "<Nome legível em português>", "pontos": 1 | -1, "justificativa": "<explicação>"}
  ]
}`;
}

// ─── User message (dados do projeto) ────────────────────────────────────────

function buildUserMessage(
  projeto: Record<string, unknown>,
  conteudo: Record<string, unknown>,
): string {
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  const dados: Record<string, unknown> = {
    metadados: {
      titulo: projeto.nome ?? conteudo.titulo ?? '(sem título)',
      descricao_breve: projeto.descricao_breve ?? '(sem descrição)',
      area: projeto.area ?? '(sem área)',
      ferramenta: projeto.ferramenta ?? '(sem ferramenta)',
      escopo: projeto.escopo ?? null,
      responsavel: `${projeto.responsavel_nome} (${projeto.responsavel_email})`,
      tipo_projeto: projeto.tipo_projeto ?? null,
    },
    documentacao_tecnica: {
      o_que_faz: conteudo.o_que_faz ?? '(não preenchido)',
      execucao: conteudo.execucao ?? '(não preenchido)',
      dependencias: conteudo.dependencias ?? '(não preenchido)',
      fluxo: conteudo.fluxo ?? '(não preenchido)',
      configurar_antes: conteudo.configurar_antes ?? '(não preenchido)',
      atencao: conteudo.atencao ?? '(não preenchido)',
    },
  };

  if (saving) {
    dados.memorial_saving = {
      linhas: saving.linhas ?? [],
      economia_horas_mes: saving.economia_horas_mes ?? 0,
      economia_reais_mes: saving.economia_reais_mes ?? 0,
      tipo_saving: saving.tipo_saving ?? null,
      memorial_calculo: saving.memorial_calculo ?? '(sem memorial)',
    };
  }

  if (receita) {
    dados.memorial_receita = {
      tipo_saving: receita.tipo_saving ?? null,
      valor_ganho_mensal: receita.valor_ganho_mensal ?? 0,
      memorial_calculo: receita.memorial_calculo ?? '(sem memorial)',
    };
  }

  return `Analise criticamente a seguinte submissão de projeto de automação:\n\n${JSON.stringify(dados, null, 2)}`;
}

// ─── Função principal ───────────────────────────────────────────────────────

export async function analisarProjeto(projetoId: string): Promise<ResultadoAnalise> {
  log(`Iniciando análise do projeto ${projetoId}`);

  const projeto = await getProjetoById(projetoId);
  if (!projeto) throw new Error('Projeto não encontrado.');

  const docRow = await getDocumentacao(projetoId);
  if (!docRow) throw new Error('Documentação não encontrada. Conclua o chat primeiro.');

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(projeto as unknown as Record<string, unknown>, conteudo);

  log(`Chamando LLM para análise (${userMessage.length} chars de contexto)...`);

  const raw = await llmChat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { jsonMode: true, temperature: 0.2, maxTokens: 4096 }
  );

  log(`LLM respondeu (${raw.length} chars)`);

  let resultado: ResultadoAnalise;
  try {
    resultado = JSON.parse(raw) as ResultadoAnalise;
  } catch (parseErr) {
    err('Falha ao parsear resposta da LLM:', parseErr);
    // Tenta extrair JSON de dentro de markdown code blocks
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      resultado = JSON.parse(jsonMatch[1].trim()) as ResultadoAnalise;
    } else {
      throw new Error('Resposta da análise não é JSON válido.');
    }
  }

  // Validação básica da estrutura
  if (!resultado.resultado || !['aprovado', 'rejeitado'].includes(resultado.resultado)) {
    throw new Error('Resultado da análise inválido — campo "resultado" ausente ou incorreto.');
  }
  if (!Array.isArray(resultado.criterios_hardcoded)) {
    resultado.criterios_hardcoded = [];
  }
  if (!Array.isArray(resultado.criterios_dinamicos)) {
    resultado.criterios_dinamicos = [];
  }
  if (!resultado.resumo) {
    // Fallback: usa as primeiras 3 frases da justificativa como resumo
    const frases = (resultado.justificativa ?? '').split(/(?<=[.!?])\s+/).slice(0, 3);
    resultado.resumo = frases.join(' ') || 'Análise concluída.';
  }

  // Valida e normaliza complexidade
  const COMPLEXIDADES_VALIDAS: Complexidade[] = ['automacao', 'inteligencia', 'autonomia'];
  if (!resultado.complexidade || !COMPLEXIDADES_VALIDAS.includes(resultado.complexidade)) {
    resultado.complexidade = 'automacao'; // fallback conservador
  }

  // O LLM avalia todos os critérios internamente mas retorna só os mais relevantes.
  // Usamos pontuacao_total e pontuacao_maxima calculados pelo LLM (que viu todos).
  // Validação básica: garante que os valores existem.
  if (typeof resultado.pontuacao_total !== 'number') resultado.pontuacao_total = 0;
  if (typeof resultado.pontuacao_maxima !== 'number') resultado.pontuacao_maxima = 1;

  log(`Análise concluída: ${resultado.resultado} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`);

  return resultado;
}
