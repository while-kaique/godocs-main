// Registry dinâmico de prompts — importa as funções reais dos agentes e gera
// PromptEntry[] com metadados + texto renderizado com dados mock.

import type { ChatFase, ProjetoContexto, DocumentacaoColetada, SavingColetado, ReceitaColetada } from '@/lib/agents/types';
import { documentacaoVazia, savingVazio, receitaVazia } from '@/lib/agents/types';

import {
  buildDocPrompt,
  buildDocPreviewPrompt,
  buildSavingPrompt,
  buildSavingPreviewPrompt,
  buildReceitaPrompt,
  buildReceitaPreviewPrompt,
} from '@/lib/agents/orchestrator';

import { buildExtractorPrompt, buildConsolidatorPrompt } from '@/lib/agents/extractor';
import { SYSTEM_PROMPT as DOC_COMPILER_PROMPT } from '@/lib/agents/doc-compiler';
import { buildSystemPrompt as buildAnalyzerPrompt } from '@/lib/agents/analyzer';
import { buildValidatorPrompt, CRITERIOS_DEFAULT } from '@/lib/agents/validator';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type PromptEntry = {
  id: string;
  agent: string;
  agentColor: string;
  functionName: string;
  filePath: string;
  fase: ChatFase | null;
  description: string;
  llmParams: {
    temperature: number;
    maxTokens: number;
    modelTier: 'fast' | 'strong';
    jsonMode: boolean;
  };
  contextParams: string[];
  getPromptText: () => string;
};

// ─── Dados mock ─────────────────────────────────────────────────────────────

// Contexto de revisão: simula uma EDIÇÃO de projeto já submetido. Quando presente,
// os prompts de doc/saving/receita ganham o bloco "CONTEXTO DE REVISÃO (EDIÇÃO)"
// com a documentação anterior aprovada — o agente valida só o que mudou.
const MOCK_REVISAO = {
  doc: {
    o_que_faz: 'Consulta a API do SAP B1, gera relatório PDF e envia por email para a equipe comercial.',
    execucao: 'Cron job diário às 07:00 no servidor interno.',
    fluxo: '1. Cron dispara: 07:00\n2. Conecta SAP B1: Service Layer\n3. Gera PDF e envia email',
    dependencias: 'SAP B1 Service Layer; SMTP Google Workspace; PostgreSQL 15',
    configurar_antes: 'SAP_URL; SAP_USER; SMTP_USER',
    atencao: 'API SAP fora: falha silenciosa',
  },
  saving: {
    memorial_calculo: 'Analista Pleno gastava 40h/mês compilando relatórios manualmente; passou a 2h/mês de conferência. Estagiário fazia 20h/mês de coleta, zeradas.',
    linhas: [
      { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2 },
      { cargo: 'Estagiário', horas_antes: 20, horas_depois: 0 },
    ],
    economia_horas_mes: 58,
    economia_reais_mes: 1351.8,
    tipo_saving: 'mensal',
    alguem_fazia: 'sim',
    custo_externo_mensal: 0,
  },
  receita: null,
};

const MOCK_CTX: ProjetoContexto = {
  responsavel_nome: 'Maria Silva',
  responsavel_email: 'maria.silva@gogroup.com.br',
  area: 'Tecnologia',
  ferramenta: 'Python + SAP B1 API',
  membros: ['dev1@gogroup.com.br', 'dev2@gogroup.com.br'],
  nome_projeto: 'Automação de Relatórios Diários',
  data_criacao: '2025-01-15',
  doc_texto: '# Automação de Relatórios\nScript Python que roda via cron...',
  descricao_breve: 'Automação de relatórios diários que consulta o ERP e envia por email.',
  tipo_projeto: 'saving',
  tipos_projeto: ['saving'],
  escopo: 'interno',
};

// Contexto idêntico ao MOCK_CTX, mas em modo EDIÇÃO (com documentação anterior).
// Usado nos previews de prompt para exibir o bloco de revisão no inspector.
const MOCK_CTX_REVISAO: ProjetoContexto = { ...MOCK_CTX, revisao: MOCK_REVISAO };

const MOCK_COLETADO: DocumentacaoColetada = {
  nome_projeto: 'Automação de Relatórios Diários',
  o_que_faz: 'Consulta a API do SAP B1, gera relatório PDF e envia por email para a equipe comercial.',
  execucao: 'Cron job diário às 07:00 no servidor interno.',
  dependencias: 'Python 3.11, SAP B1 Service Layer, SMTP Google Workspace, PostgreSQL 15.',
  fluxo: '1. Cron dispara\n2. Conecta SAP B1\n3. Consulta pedidos\n4. Gera PDF\n5. Envia email\n6. Loga resultado',
  configurar_antes: 'SAP_URL, SAP_USER, SAP_PASSWORD, SMTP_USER, DB_HOST, EMAIL_DESTINATARIOS',
  atencao: 'API SAP fora = falha silenciosa. Sem retry. Template PDF hardcoded (max 500 linhas).',
};

const MOCK_SAVING: SavingColetado = {
  linhas: [
    { cargo: 'Analista Pleno', horas_antes: 40, horas_depois: 2, valor_hora: 29.9, economia_horas_mes: 38, economia_reais_mes: 1136.2 },
    { cargo: 'Estagiário', horas_antes: 20, horas_depois: 0, valor_hora: 10.78, economia_horas_mes: 20, economia_reais_mes: 215.6 },
  ],
  economia_horas_mes: 58,
  economia_reais_mes: 1351.8,
  tipo_saving: 'mensal',
  memorial_calculo: null,
  valor_ganho_mensal: null,
  // Custo evitado coletado no FORMULÁRIO (não pelo agente). O backend mensaliza
  // cada item: serviço pontual de R$ 2.700 (cobrança única) ÷12 = R$ 225/mês, que
  // soma cheio ao economia_reais_mes. O agente apenas reconhece e descreve (sem R$).
  custo_evitado_reais: 225,
  custo_evitado_tipo: 'mensal',
  custo_evitado_descricao: 'Serviço externo de implementação (R$ 2700.00, pontual) — cobrança única eliminada pela automação',
};

const MOCK_RECEITA: ReceitaColetada = {
  tipo_saving: 'mensal',
  valor_ganho_mensal: 25000,
  memorial_calculo: null,
  racional: 'Aumento de 15% na conversão = R$25k/mês.',
};

const MOCK_RESUMO = 'Projeto de automação de relatórios diários que consulta a API do SAP B1, gera PDFs e envia por email. Usa Python com cron diário às 7h. Depende de SAP B1 Service Layer, SMTP Google e PostgreSQL.';

// ─── Cores por agente ───────────────────────────────────────────────────────

export const AGENT_COLORS = {
  Orquestrador: '#0059A9',
  Extrator: '#16a34a',
  Compilador: '#e8920c',
  Analisador: '#e53e3e',
  Validador: '#8b5cf6',
} as const;

// ─── Registry ───────────────────────────────────────────────────────────────

export function getPromptRegistry(): PromptEntry[] {
  return [
    // ── Orquestrador (7) ──
    {
      id: 'orchestrator.doc',
      agent: 'Orquestrador',
      agentColor: AGENT_COLORS.Orquestrador,
      functionName: 'buildDocPrompt',
      filePath: 'src/lib/agents/orchestrator.ts',
      fase: 'doc',
      description: 'Prompt principal da fase de documentação. A IA analisa os arquivos enviados, usa os campos já extraídos pelo extrator, e coleta via conversa o que ficou pendente (campos null). Faz uma pergunta por vez, é cética com respostas vagas, e gera o preview quando os 7 campos estão completos. Projeto especial NÃO passa por aqui — pula o agente e é submetido direto (doc montada sem IA). IA COMO FUNCIONALIDADE (3 passos): (1) infere internamente dos arquivos se há IA como funcionalidade e registra em ia_inferida_dos_arquivos; (2) SEMPRE pergunta com type:"options" antes do preview — menciona o que percebeu nos arquivos se inferiu algo, caso contrário faz a pergunta neutra; (2.5) se o usuário responder "Sim" mas não souber/descrever COMO a IA é usada (e os arquivos não deixaram claro), faz UMA pergunta curta para entender em que parte do projeto a IA atua — aceitando resposta simples — e incorpora isso no o_que_faz/fluxo; (3) registra tem_ia_como_funcionalidade pela resposta do usuário e define ia_contradição:true se a resposta contradiz a inferência dos arquivos (sem questionar o usuário — aceita e segue). Não repete a pergunta se já respondida. REVISÃO (edição): quando ctx.revisao existe (projeto já submetido), o prompt ganha o bloco "CONTEXTO DE REVISÃO" com a doc anterior aprovada — o agente parte dela e valida só o que mudou, sem recomeçar do zero. (O preview abaixo está em modo edição para mostrar esse bloco.)',
      llmParams: { temperature: 0.2, maxTokens: 4096, modelTier: 'fast', jsonMode: true },
      contextParams: ['ProjetoContexto', 'DocumentacaoColetada', 'RevisaoContexto (só em edição)'],
      getPromptText: () => buildDocPrompt(MOCK_CTX_REVISAO, documentacaoVazia()),
    },
    {
      id: 'orchestrator.doc_preview',
      agent: 'Orquestrador',
      agentColor: AGENT_COLORS.Orquestrador,
      functionName: 'buildDocPreviewPrompt',
      filePath: 'src/lib/agents/orchestrator.ts',
      fase: 'doc_preview',
      description: 'Revisão do preview da documentação. O usuário pode aprovar (gerando um resumo interno de 3-5 frases para contexto da fase 2) ou pedir ajustes específicos. A IA nunca muda o que não foi pedido.',
      llmParams: { temperature: 0.2, maxTokens: 4096, modelTier: 'fast', jsonMode: true },
      contextParams: ['ProjetoContexto', 'DocumentacaoColetada'],
      getPromptText: () => buildDocPreviewPrompt(MOCK_CTX, MOCK_COLETADO),
    },
    {
      id: 'orchestrator.saving',
      agent: 'Orquestrador',
      agentColor: AGENT_COLORS.Orquestrador,
      functionName: 'buildSavingPrompt',
      filePath: 'src/lib/agents/orchestrator.ts',
      fase: 'saving',
      description: 'Validação de horas do memorial de saving PADRONIZADO. A IA coleta pontos obrigatórios na ordem fixa (Seções 1-5: Contexto, Saving de Pessoas, Contratos/Serviços Evitados, Custo da Automação, Resumo) — cada ponto é obrigatório e a IA insiste até ter resposta. Recebe as linhas de saving (cargo + horas antes/depois) já preenchidas pelo formulário, valida cada pessoa com perguntas concretas sobre a rotina manual, e monta o memorial_calculo automaticamente. VALIDAÇÃO DE PLAUSIBILIDADE: além do "antes", valida o "depois" e a magnitude da redução (um "depois" subestimado infla o ganho tanto quanto um "antes" exagerado) — quando a automação elimina a maior parte do tempo, sonda o que ainda consome as horas residuais; reconcilia respostas ambíguas/contraditórias (correções, mistura de unidades semana×mês, total×por-tarefa) reafirmando a leitura e exigindo confirmação explícita antes de fechar números; calibra a profundidade pela materialidade (mais sondagem para ganhos altos e relações antes/depois extremas; sem burocracia para ganhos pequenos e plausíveis). Nunca expõe valores em R$ (injetados pelo backend via enriquecerMemorial). CUSTO EVITADO: investiga sempre (interno e externo) se o projeto deixou de pagar alguma ferramenta/serviço — recorrente ou pontual — e captura em custo_evitado_reais/tipo/descricao; o backend soma ao saving em R$ (pontual ÷12). Custo evitado é saving (dinheiro que deixou de ser gasto), não receita. REGRA ANTI-ZERO: o ganho pode vir das horas OU do custo evitado — só bloqueia quando economia_horas_mes = 0 E não há custo evitado; nesse caso orienta projeto especial. ABERTURA DETERMINÍSTICA: o prompt computa o perfil das horas (todas 0h antes, 0h antes+0h depois, custo de monitoramento, ou rotina real) e injeta uma diretiva "COMO ABRIR A CONVERSA" que VENCE as regras genéricas — proíbe perguntar sobre rotina manual em linhas com 0h antes (evita perguntas que contradizem os dados informados). NINGUÉM FAZIA (alguem_fazia="nao"): quando o usuário marcou no formulário que ninguém fazia a tarefa, as horas_antes NÃO são uma rotina real — são o EQUIVALENTE manual ESTIMADO (o tempo que o trabalho levaria se alguém tivesse que fazer à mão, e qual cargo). A diretiva proíbe pedir o passo a passo de uma rotina inexistente e manda VALIDAR a estimativa (volume × tempo, cruzando com o fluxo técnico); é saving contrafactual legítimo, registrado no memorial como equivalente manual estimado. REVISÃO (edição): quando o projeto já foi submetido, o prompt ganha o bloco "CONTEXTO DE REVISÃO" com o memorial e as horas antes/depois anteriores (financeiro staff-only) — o agente valida só o que mudou em vez de recoletar a rotina inteira. (Preview em modo edição.)',
      llmParams: { temperature: 0.4, maxTokens: 4096, modelTier: 'fast', jsonMode: true },
      contextParams: ['ProjetoContexto', 'DocumentacaoColetada', 'SavingColetado', 'resumoProjeto', 'RevisaoContexto (só em edição)'],
      getPromptText: () => buildSavingPrompt(MOCK_CTX_REVISAO, MOCK_COLETADO, MOCK_SAVING, MOCK_RESUMO),
    },
    {
      id: 'orchestrator.saving_preview',
      agent: 'Orquestrador',
      agentColor: AGENT_COLORS.Orquestrador,
      functionName: 'buildSavingPreviewPrompt',
      filePath: 'src/lib/agents/orchestrator.ts',
      fase: 'saving_preview',
      description: 'Revisão do memorial de saving. Mesma mecânica de aprovação/ajuste do doc_preview. Se aprovado e há receita pendente, transita para fase receita; senão, marca completo. REGRA ANTI-ZERO: NUNCA emite complete sem ganho — bloqueia só quando economia_horas_mes <= 0 E custo_evitado_reais nulo/zero (ganho válido pode vir das horas OU do custo evitado). Usa valores recomputados das linhas (não os reportados pelo LLM) como fonte de verdade na safety net.',
      llmParams: { temperature: 0.4, maxTokens: 4096, modelTier: 'fast', jsonMode: true },
      contextParams: ['SavingColetado'],
      getPromptText: () => buildSavingPreviewPrompt(MOCK_SAVING),
    },
    {
      id: 'orchestrator.receita',
      agent: 'Orquestrador',
      agentColor: AGENT_COLORS.Orquestrador,
      functionName: 'buildReceitaPrompt',
      filePath: 'src/lib/agents/orchestrator.ts',
      fase: 'receita',
      description: 'Validação de receita incremental PADRONIZADA. A IA coleta pontos obrigatórios na ordem fixa (Seção 6: O que gera, Como aumenta, Antes vs. depois, Base de cálculo, Valor, Tipo) — cada ponto é obrigatório e a IA insiste até ter resposta. Desafia o número CRUZANDO o racional com o que o projeto faz (RESUMO + DETALHES TÉCNICOS): se o racional for inconsistente com o projeto, questiona diretamente; se for consistente, aprofunda como o projeto leva ao ganho. Perguntas genéricas são proibidas. DISTINÇÃO OBRIGATÓRIA: receita incremental = dinheiro novo (mais vendas/conversão/faturamento); saving = economia operacional. Se o racional descrever saving disfarçado, bloqueia e manda reclassificar. REVISÃO (edição): quando o projeto já foi submetido, o prompt ganha o bloco "CONTEXTO DE REVISÃO" com o memorial e o valor de receita anterior — o agente valida só o que mudou.',
      llmParams: { temperature: 0.4, maxTokens: 4096, modelTier: 'fast', jsonMode: true },
      contextParams: ['ProjetoContexto', 'DocumentacaoColetada', 'ReceitaColetada', 'resumoProjeto', 'RevisaoContexto (só em edição)'],
      getPromptText: () => buildReceitaPrompt(MOCK_CTX, MOCK_COLETADO, MOCK_RECEITA, MOCK_RESUMO),
    },
    {
      id: 'orchestrator.receita_preview',
      agent: 'Orquestrador',
      agentColor: AGENT_COLORS.Orquestrador,
      functionName: 'buildReceitaPreviewPrompt',
      filePath: 'src/lib/agents/orchestrator.ts',
      fase: 'receita_preview',
      description: 'Revisão do memorial de receita. Aprovação ou ajuste. REGRA ANTI-ZERO: NUNCA emite complete se valor_ganho_mensal <= 0. DETECÇÃO DE SAVING DISFARÇADO: se o memorial usa linguagem de economia operacional (horas/minutos, custo/hora, economia laboral), bloqueia e manda reclassificar como saving antes de aprovar.',
      llmParams: { temperature: 0.4, maxTokens: 4096, modelTier: 'fast', jsonMode: true },
      contextParams: ['ReceitaColetada'],
      getPromptText: () => buildReceitaPreviewPrompt(MOCK_RECEITA),
    },

    // ── Extrator (2) ──
    {
      id: 'extractor.map',
      agent: 'Extrator',
      agentColor: AGENT_COLORS.Extrator,
      functionName: 'buildExtractorPrompt',
      filePath: 'src/lib/agents/extractor.ts',
      fase: null,
      description: 'Pré-extração automática (map). Antes do chat, 1 chamada ao LLM (temp 0) lê o material enviado e preenche os 7 campos da documentação. Campos técnicos saem do código; campos de negócio ficam null se não revelados. Ceticismo alto: na dúvida, retorna null.',
      llmParams: { temperature: 0, maxTokens: 4096, modelTier: 'strong', jsonMode: true },
      contextParams: ['ProjetoContexto', 'isLote: boolean'],
      getPromptText: () => buildExtractorPrompt(MOCK_CTX, false),
    },
    {
      id: 'extractor.reduce',
      agent: 'Extrator',
      agentColor: AGENT_COLORS.Extrator,
      functionName: 'buildConsolidatorPrompt',
      filePath: 'src/lib/agents/extractor.ts',
      fase: null,
      description: 'Consolidação (reduce). Quando o material é grande demais para 1 chamada, o extrator divide em lotes e extrai cada um em paralelo. Este prompt consolida as extrações parciais num conjunto único sem redundância.',
      llmParams: { temperature: 0, maxTokens: 8192, modelTier: 'strong', jsonMode: true },
      contextParams: ['(constantes CAMPOS e FORMATO)'],
      getPromptText: () => buildConsolidatorPrompt(),
    },

    // ── Compilador (1) ──
    {
      id: 'compiler.system',
      agent: 'Compilador',
      agentColor: AGENT_COLORS.Compilador,
      functionName: 'SYSTEM_PROMPT',
      filePath: 'src/lib/agents/doc-compiler.ts',
      fase: null,
      description: 'Compilação final da documentação. Transforma os 7 campos coletados pelo orquestrador em documentação estruturada com 6 seções (o_que_faz, execução, dependências, fluxo, configurar_antes, atenção). Critérios de qualidade rigorosos. Até 3 tentativas de obter JSON válido.',
      llmParams: { temperature: 0.3, maxTokens: 8192, modelTier: 'strong', jsonMode: true },
      contextParams: ['ProjetoContexto', 'DocumentacaoColetada'],
      getPromptText: () => DOC_COMPILER_PROMPT,
    },

    // ── Analisador (1) ──
    {
      id: 'analyzer.system',
      agent: 'Analisador',
      agentColor: AGENT_COLORS.Analisador,
      functionName: 'buildSystemPrompt',
      filePath: 'src/lib/agents/analyzer.ts',
      fase: null,
      description: 'Análise holística pré-submissão. Avalia toda a submissão com 10 critérios fixos + 2-3 dinâmicos por projeto. Classifica complexidade (automação/inteligência/autonomia). Gera parecer, resumo e pontuação. Considera também o TEXTO EXTRAÍDO dos arquivos que a pessoa enviou (documentacao_enviada_usuario). COMPLEXIDADE pela AUTOMAÇÃO EM SI (não pela ferramenta): usa_ia = a automação, quando EXECUTA, usa IA em algum passo (gera/classifica/extrai/decide); Claude Code/GoDeploy são ferramentas de construção/hospedagem e NÃO elevam para inteligencia por si só (CRUD/dashboards/alertas-por-regra feitos com Claude+GoDeploy = automacao). Roda em background após o envio — incl. PROJETOS ESPECIAIS: para eles o analisador NÃO decide status (validação é humana), mas classifica complexidade e dá um PARECER avaliando criticamente se o projeto realmente se enquadra como especial (alto impacto + difícil mensuração objetiva) ou se é uma automação padrão mal rotulada que deveria ir como saving/receita.',
      llmParams: { temperature: 0.2, maxTokens: 4096, modelTier: 'strong', jsonMode: true },
      contextParams: ['(projeto + documentação + saving/receita do banco)'],
      getPromptText: () => buildAnalyzerPrompt(),
    },

    // ── Validador (1) ──
    {
      id: 'validator.system',
      agent: 'Validador',
      agentColor: AGENT_COLORS.Validador,
      functionName: 'buildValidatorPrompt',
      filePath: 'src/lib/agents/validator.ts',
      fase: null,
      description: 'Validação automática da documentação gerada. Avalia contra critérios configuráveis (via tabela configuracoes, com fallback para 6 critérios default). Regras: todos OBRIGATÓRIOS devem passar, pelo menos 1 IMPORTANTE. Retorna aprovado/rejeitado com parecer.',
      llmParams: { temperature: 0.2, maxTokens: 2048, modelTier: 'strong', jsonMode: true },
      contextParams: ['CriterioValidacao[]', 'DocumentacaoGerada'],
      getPromptText: () => buildValidatorPrompt(CRITERIOS_DEFAULT),
    },
  ];
}
