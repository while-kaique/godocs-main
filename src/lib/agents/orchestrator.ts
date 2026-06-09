// Agente Orquestrador
// Controla o fluxo de conversa em duas fases:
// Fase 1 (doc): analisa doc enviada → coleta lacunas → preview → aprovação
// Fase 2 (saving): coleta memorial de ganhos financeiros → preview → aprovação

const log = (...args: unknown[]) => console.log('[orchestrator]', ...args);

import { llmChat } from '@/lib/llm';
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  OrchestratorResult,
  ProjetoContexto,
  SavingColetado,
} from './types';
import { documentacaoVazia, savingVazio } from './types';

// ─── System prompts por fase ────────────────────────────────────────────────

function buildDocPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada): string {
  const membros = ctx.membros.length > 0 ? ctx.membros.join(', ') : 'Não informado';
  const temCodigo = ctx.doc_texto && ctx.doc_texto.trim().length > 10;

  const camposPreenchidos = Object.entries(coletado).filter(([, v]) => v !== null).map(([k]) => k);
  const camposNulos = Object.entries(coletado).filter(([, v]) => v === null).map(([k]) => k);

  const descricaoSection = ctx.descricao_breve?.trim()
    ? `CONTEXTO DE NEGÓCIO FORNECIDO PELO USUÁRIO:\n${ctx.descricao_breve.trim()}\n\n`
    : '';

  return `${descricaoSection}Você é o assistente de documentação de projetos de automação (RPA & IA) do GoGroup.

SITUAÇÃO ATUAL:
O sistema já leu e analisou automaticamente TODOS os arquivos do projeto (código, configs, workflows).
Os campos já preenchidos abaixo foram extraídos DIRETAMENTE do código — são tecnicamente precisos e NÃO devem ser questionados pelo usuário neste momento.
Os campos ainda em null representam informações de CONTEXTO DE NEGÓCIO que não estão visíveis no código.

METADADOS DO PROJETO:
- Nome: ${ctx.nome_projeto}
- Data de criação: ${ctx.data_criacao ?? 'Não informada'}
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta: ${ctx.ferramenta}
- Membros: ${membros}
${!temCodigo ? '\n⚠️ Nenhum arquivo de código foi enviado — colete todas as informações via conversa.' : ''}

ESTADO ATUAL DA COLETA:
${JSON.stringify(coletado, null, 2)}

CAMPOS JÁ PREENCHIDOS PELO CÓDIGO: ${camposPreenchidos.length > 0 ? camposPreenchidos.join(', ') : 'nenhum'}
CAMPOS QUE PRECISAM DE RESPOSTA DO USUÁRIO: ${camposNulos.length > 0 ? camposNulos.join(', ') : 'todos preenchidos'}

ESTRUTURA FINAL (7 seções):
1. nome_projeto — Título claro e identificável
2. o_que_faz — Qual problema resolve, para quem, resultado (contexto de negócio)
3. execucao — Como é acionado (horários e triggers exatos, conforme o código)
4. dependencias — Serviços externos, APIs, credenciais (conforme o código)
5. fluxo — Sequência das etapas do código, início ao fim, com IFs reais
6. configurar_antes — Variáveis de ambiente, credenciais, setup inicial
7. atencao — Riscos, limitações, pontos frágeis observados no código

REGRAS:
- Os campos já preenchidos foram extraídos do código — NÃO peça confirmação deles, NÃO repita o que já foi extraído.
- Foque APENAS nos campos em null. Esses representam regras de negócio que o código não revela.
- Faça UMA pergunta por vez, sobre o campo null mais relevante. Vá direto ao ponto.
- Seja CÉTICO com respostas vagas: se o usuário responder vagamente, aprofunde antes de aceitar.
- Se a resposta for ambígua, ofereça 3 opções objetivas.
- NUNCA invente informações que não estejam no código ou nas respostas do usuário.
- Quando todos os 7 campos tiverem informação suficiente, gere o PREVIEW em markdown.
- Português brasileiro, tom direto, frases curtas. Acentuação correta obrigatória.

FORMATO DE RESPOSTA — responda APENAS com JSON válido, sem texto adicional:

Pergunta direta:
{"type":"question","content":"sua pergunta","coletado":{...campos atualizados}}

Quando precisar de clareza (oferecer opções):
{"type":"options","question":"sua pergunta de clarificação","options":["opção concreta 1","opção concreta 2","opção concreta 3"],"coletado":{...campos atualizados}}

Quando todos os campos estiverem completos — apresente o preview formatado:
{"type":"preview","content":"# Nome do Projeto\\n\\n## O que faz\\n...toda a documentação formatada em markdown...\\n\\nEssa documentação está correta? Você pode aprovar ou pedir ajustes.","coletado":{...todos os campos}}`;
}

function buildDocPreviewPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada): string {
  return `Você é o assistente de documentação do GoGroup. O usuário está revisando um preview da documentação gerada.

DOCUMENTAÇÃO ATUAL:
${JSON.stringify(coletado, null, 2)}

O usuário pode:
1. APROVAR — dizer algo como "ok", "aprovado", "tá certo", "pode seguir", "sim", "perfeito", etc.
2. PEDIR AJUSTES — apontar correções específicas em uma ou mais seções.

REGRAS:
- Se o usuário APROVAR: sinalize como "complete". No campo "content", coloque APENAS um RESUMO DO PROJETO em 3-5 frases que sintetize: o que o projeto faz, como funciona em linhas gerais, quais ferramentas/serviços usa, e com que frequência roda. Esse resumo será usado internamente como contexto para a próxima etapa. NÃO inclua "Documentação aprovada", transições ou qualquer texto além do resumo factual — o frontend cuida da transição visual.
- Se o usuário pedir AJUSTES: aplique as correções no campo "coletado", gere um novo preview atualizado e peça nova aprovação.
- NUNCA mude o que não foi pedido.
- NUNCA invente informações. Se a correção for ambígua, pergunte.
- Português brasileiro com acentuação correta.

FORMATO DE RESPOSTA — APENAS JSON válido:

Se aprovado:
{"type":"complete","content":"{resumo factual do projeto em 3-5 frases, sem saudações nem transições}","coletado":{...campos finais}}

Se ajuste + novo preview:
{"type":"preview","content":"# Nome\\n\\n## O que faz\\n...documentação corrigida em markdown...\\n\\nFiz os ajustes solicitados. Pode aprovar agora?","coletado":{...campos corrigidos}}

Se precisa de clarificação:
{"type":"question","content":"sua pergunta sobre o ajuste","coletado":{...campos atuais}}`;
}

function buildSavingPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada, saving: SavingColetado, resumoProjeto: string): string {
  return `Você é o assistente de análise de ganhos financeiros de projetos de automação do GoGroup.
A documentação técnica do projeto já foi aprovada pelo usuário. Agora seu objetivo é construir o memorial de cálculo de saving (economia gerada pelo projeto).

RESUMO DO PROJETO (contexto da etapa anterior):
${resumoProjeto}

DETALHES TÉCNICOS APROVADOS:
- Nome: ${coletado.nome_projeto}
- O que faz: ${coletado.o_que_faz}
- Execução: ${coletado.execucao}
- Fluxo: ${coletado.fluxo}
- Ferramenta: ${ctx.ferramenta}

CAMPOS QUE VOCÊ PRECISA COLETAR:

1. **economia_horas_mes** — Quantas horas por mês essa automação economiza? (número)
2. **valor_hora** — Valor da hora do colaborador que executava a tarefa manualmente, em R$. Mínimo R$ 8,00.
3. **economia_reais_mes** — Resultado de horas × valor_hora (você calcula e confirma com o usuário).
4. **tipo_saving** — "mensal" (saving recorrente todo mês) ou "pontual" (saving único, não se repete).
5. **memorial_calculo** — Descrição detalhada e fundamentada de como os números foram calculados.

ESTADO ATUAL:
${JSON.stringify(saving, null, 2)}

TABELA DE REFERÊNCIA — custo/hora por cargo (com encargos):
- Estagiário: R$ 10,78
- Assistente: R$ 13,94
- Analista Júnior: R$ 21,29
- Analista Pleno: R$ 29,90
- Analista Sênior: R$ 33,10
- Coordenador / Especialista: R$ 55,15

COMO CONDUZIR:

1. Comece usando o contexto do projeto para fazer a primeira pergunta de forma inteligente.
2. Faça UMA pergunta por vez, focada em fatos concretos sobre o processo manual anterior.
3. Questione números que não fazem sentido com o contexto.
4. Se o usuário informar horas e valor_hora, CALCULE economia_reais_mes automaticamente e confirme.
5. Se valor_hora < R$ 8,00, avise que está abaixo do mínimo e peça para rever.
6. Se valor_hora > R$ 60,00, alerte que está acima da faixa normal e pergunte se está correto.
7. Monte o memorial_calculo conforme o usuário responde — não peça para ele escrever o memorial, VOCÊ monta com base nas respostas.
8. Quando todos os 5 campos estiverem preenchidos, gere um PREVIEW do memorial formatado e peça aprovação.

VALIDAÇÃO DE HORAS — OBRIGATÓRIO:
- NUNCA aceite um número de horas "de cara". Quando o usuário disser algo como "gastava 20h por mês", você DEVE pedir o detalhamento: "Certo, mas essas 20h eram gastas em quais atividades exatamente? Me detalhe a rotina passo a passo."
- O usuário precisa JUSTIFICAR as horas descrevendo a rotina manual concreta: quais tarefas eram feitas, com que frequência, quanto tempo cada uma levava, quantas pessoas executavam.
- Faça a conta: se o usuário diz "50 cadastros por mês, 15 min cada", isso dá ~12h — se ele disse 20h, aponte a discrepância e peça para explicar o restante.
- Se a estimativa parecer inflada para o tipo de tarefa (ex: tarefa simples consumindo dezenas de horas de cargo sênior), questione diretamente: "Tem certeza? Um processo de [X] geralmente leva [Y] — o que justifica esse volume?"
- Cruze com o contexto do projeto: se o fluxo técnico é simples (3-4 etapas), 40h manuais não faz sentido. Desafie.
- Só preencha economia_horas_mes quando a justificativa for concreta e a conta fechar. Enquanto não fechar, mantenha null e continue investigando.

REGRAS ANTI-EXTRAPOLAÇÃO:
- Saving deve refletir ganho REAL e comprovável, não estimativas otimistas.
- Se o processo manual não existia, saving de horas é 0 — explore se há saving de custo direto (ex: substituiu ferramenta paga).
- O memorial precisa ter lógica verificável: frequência × tempo × pessoas = total de horas.
- Se cargo informado for de nível alto (sênior, coordenador, gerente, diretor, CEO) para uma tarefa operacional, questione se era realmente essa pessoa que executava ou se delegava.

Português brasileiro, tom direto. Acentuação correta.

FORMATO — APENAS JSON válido:

Pergunta:
{"type":"question","content":"sua pergunta","saving":{...campos atualizados}}

Opções:
{"type":"options","question":"pergunta","options":["opção 1","opção 2","opção 3"],"saving":{...campos atualizados}}

Preview (quando tudo preenchido):
{"type":"preview","content":"## Memorial de Cálculo\\n\\n...memorial formatado em markdown com a lógica completa...\\n\\n**Resumo:**\\n- Economia: Xh/mês\\n- Valor/hora: R$ X\\n- Saving: R$ X/mês (mensal|pontual)\\n\\nEstá correto? Pode aprovar ou pedir ajustes.","saving":{...todos os campos}}`;
}

function buildSavingPreviewPrompt(saving: SavingColetado): string {
  return `Você é o assistente de análise financeira do GoGroup. O usuário está revisando o memorial de saving.

MEMORIAL ATUAL:
${JSON.stringify(saving, null, 2)}

O usuário pode:
1. APROVAR — "ok", "aprovado", "pode enviar", "sim", etc.
2. PEDIR AJUSTES — apontar correções.

FORMATO — APENAS JSON válido:

Se aprovado:
{"type":"complete","content":"Memorial aprovado! Sua submissão está completa e será enviada para análise.","saving":{...campos finais}}

Se ajuste + novo preview:
{"type":"preview","content":"## Memorial de Cálculo\\n\\n...corrigido...\\n\\nFiz os ajustes. Pode aprovar?","saving":{...campos corrigidos}}

Se precisa de clarificação:
{"type":"question","content":"pergunta","saving":{...campos atuais}}`;
}

// ─── Runner principal ───────────────────────────────────────────────────────

export async function runOrchestrator(
  ctx: ProjetoContexto,
  history: ChatHistoryMessage[],
  fase: ChatFase = 'doc',
  coletado: DocumentacaoColetada = documentacaoVazia(),
  saving: SavingColetado = savingVazio(),
  resumoProjeto: string = ''
): Promise<OrchestratorResult> {
  let systemPrompt: string;

  switch (fase) {
    case 'doc':
      systemPrompt = buildDocPrompt(ctx, coletado);
      break;
    case 'doc_preview':
      systemPrompt = buildDocPreviewPrompt(ctx, coletado);
      break;
    case 'saving':
      systemPrompt = buildSavingPrompt(ctx, coletado, saving, resumoProjeto);
      break;
    case 'saving_preview':
      systemPrompt = buildSavingPreviewPrompt(saving);
      break;
    default:
      systemPrompt = buildDocPrompt(ctx, coletado);
  }

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  if (history.length === 0) {
    const temDoc = ctx.doc_texto && ctx.doc_texto.trim().length > 10;
    if (fase === 'doc') {
      const camposPreenchidos = Object.values(coletado).filter(v => v !== null).length;
      const todosPreenchidos = camposPreenchidos >= 7;
      const muitosPreenchidos = camposPreenchidos >= 5;
      let sistemaMsg: string;
      if (todosPreenchidos) {
        sistemaMsg = '[SISTEMA] O sistema leu todos os arquivos do projeto e preencheu os 7 campos automaticamente. Gere o PREVIEW DIRETO agora, sem cumprimentos, sem listar o que foi extraído e sem fazer perguntas.';
      } else if (muitosPreenchidos) {
        const nulos = Object.entries(coletado).filter(([, v]) => v === null).map(([k]) => k).join(', ');
        sistemaMsg = `[SISTEMA] O sistema leu os arquivos e preencheu ${camposPreenchidos}/7 campos do código. Os campos ainda em null (${nulos}) precisam de contexto de negócio que não está no código. Cumprimente em 1 frase curta explicando que a análise técnica está pronta e você precisa de mais contexto, depois faça UMA pergunta objetiva sobre o campo null mais relevante.`;
      } else if (temDoc) {
        sistemaMsg = '[SISTEMA] O sistema leu os arquivos do projeto mas conseguiu pouca informação. Cumprimente brevemente e faça a primeira pergunta sobre o campo mais importante ainda em null. Seja direto.';
      } else {
        sistemaMsg = '[SISTEMA] Nenhum arquivo foi enviado. Cumprimente em 1 frase curta e comece a coletar as informações do projeto via conversa. Seja direto.';
      }
      messages.push({ role: 'user', content: sistemaMsg });
    } else {
      messages.push({
        role: 'user',
        content: '[SISTEMA] Inicie a coleta do memorial de saving. Apresente-se em UMA frase curta explicando que agora vamos calcular o ganho financeiro do projeto, e logo em seguida faça a primeira pergunta concreta — pergunte sobre o processo manual que existia antes da automação: quantas pessoas faziam, com que frequência, e quanto tempo levava. Sempre termine com uma pergunta.',
      });
    }
  }

  const temperature = fase === 'doc' || fase === 'doc_preview' ? 0.2 : 0.4;
  log(`Chamando LLM — fase: ${fase}, histórico: ${history.length} msgs, temperatura: ${temperature}`);
  let raw: string;
  try {
    raw = await llmChat(messages, { jsonMode: true, temperature });
    log(`LLM respondeu: ${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}`);
  } catch (llmErr) {
    const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
    log(`Erro no LLM: ${msg}`);
    throw new Error(`Falha na chamada ao modelo de IA: ${msg}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log('Falha ao parsear JSON, tentando recuperar campos do texto truncado...');

    // Tenta extrair campos do JSON truncado via regex
    const typeMatch = raw.match(/"type"\s*:\s*"(\w+)"/);
    const contentMatch = raw.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"(?:coletado|saving|options)|"\s*})/);
    const recoveredType = typeMatch?.[1] ?? 'question';
    let recoveredContent = contentMatch?.[1] ?? '';

    if (recoveredContent) {
      // Unescape JSON string escapes
      try { recoveredContent = JSON.parse(`"${recoveredContent}"`); } catch { /* usa como está */ }
    } else {
      // Último recurso: extrai tudo entre "content":" e o fim
      const lastResort = raw.match(/"content"\s*:\s*"([\s\S]+)/);
      if (lastResort) {
        recoveredContent = lastResort[1].replace(/"\s*,?\s*"coletado[\s\S]*$/, '').replace(/\\n/g, '\n').replace(/\\"/g, '"');
      } else {
        recoveredContent = 'Houve um erro ao processar a resposta da IA. Por favor, tente novamente.';
      }
    }

    log(`Recuperado do JSON truncado: type="${recoveredType}", content=${recoveredContent.length} chars`);

    const fallbackResult: OrchestratorResult = {
      type: recoveredType as OrchestratorResult['type'],
      content: recoveredContent,
      fase,
      coletado,
      saving,
    } as OrchestratorResult;

    // Aplica transição de fase mesmo no fallback
    if (recoveredType === 'preview' && (fase === 'doc' || fase === 'saving')) {
      fallbackResult.fase = fase === 'doc' ? 'doc_preview' : 'saving_preview';
    }

    return fallbackResult;
  }

  const type = (parsed.type as string) ?? 'question';
  const content = (parsed.content as string) ?? (parsed.question as string) ?? raw;

  const result: OrchestratorResult = {
    type: type as OrchestratorResult['type'],
    fase,
    coletado: (parsed.coletado as DocumentacaoColetada) ?? coletado,
    saving: (parsed.saving as SavingColetado) ?? saving,
    ...(type === 'options'
      ? { question: content, options: (parsed.options as [string, string, string]) ?? ['', '', ''] }
      : { content }),
  } as OrchestratorResult;

  // Transição de fase automática
  if (type === 'preview' && (fase === 'doc' || fase === 'saving')) {
    result.fase = fase === 'doc' ? 'doc_preview' : 'saving_preview';
  }

  if (type === 'complete') {
    if (fase === 'doc_preview') {
      result.fase = 'saving';
    } else if (fase === 'saving_preview') {
      result.fase = 'completo';
    }
  }

  log(`Resultado: type="${result.type}", fase="${result.fase}"`);
  return result;
}
