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
  const temDoc = ctx.doc_texto && ctx.doc_texto.trim().length > 10;

  const docSection = temDoc
    ? `DOCUMENTAÇÃO ENVIADA PELO USUÁRIO:
---
${ctx.doc_texto}
---`
    : `(Nenhuma documentação foi enviada — colete todas as informações via conversa.)`;

  return `Você é o assistente de documentação de projetos de automação (RPA & IA) do GoGroup.
Seu objetivo é analisar a documentação enviada pelo usuário, validar as informações, e reorganizar tudo no formato padrão.

${docSection}

DADOS JÁ CONHECIDOS DO PROJETO:
- Nome do projeto: ${ctx.nome_projeto}
- Data de criação: ${ctx.data_criacao ?? 'Não informada'}
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta utilizada: ${ctx.ferramenta}
- Membros do time: ${membros}

O DOCUMENTO FINAL SEGUE ESTA ESTRUTURA (6 seções):

1. **Nome do Projeto** (nome_projeto) — Título claro e identificável.
2. **O que faz** (o_que_faz) — Parágrafo de 2-4 frases: qual problema resolve, para quem, e qual o resultado da execução.
3. **Execução** (execucao) — Como o projeto é acionado: trigger manual, schedule (horário/frequência), webhook, evento de sistema, etc.
4. **Dependências** (dependencias) — Lista de serviços externos, APIs, credenciais e acessos necessários para funcionar.
5. **Fluxo** (fluxo) — Sequência das etapas principais da execução, do início ao fim, incluindo ramificações condicionais (IF/ELSE).
6. **Configurar antes de usar** (configurar_antes) — O que fazer antes de rodar o projeto pela primeira vez.
7. **Atenção** (atencao) — Riscos, limitações conhecidas, pontos frágeis ou decisões técnicas que merecem destaque.

ESTADO ATUAL DA COLETA:
${JSON.stringify(coletado, null, 2)}

REGRAS FUNDAMENTAIS:
- A documentação enviada é a fonte de verdade deste projeto — não a compare com os metadados (nome, ferramenta, responsável). Extraia os 7 campos diretamente do conteúdo do arquivo, independente de quem escreveu ou qual ferramenta menciona
- Se o arquivo cobrir todos os 7 campos com qualidade suficiente, gere o PREVIEW direto — não faça perguntas desnecessárias
- Seja CÉTICO nas respostas do usuário: avalie criticamente se cada resposta satisfaz o critério do campo antes de marcá-lo como coletado
- Se uma resposta for vaga, incompleta ou não satisfizer o critério acima, NÃO atualize o campo no "coletado" — deixe-o null e faça uma pergunta de aprofundamento
- Ao iniciar com doc, liste brevemente o que já extraiu do arquivo antes de perguntar o que falta
- Faça perguntas APENAS sobre o que ainda está ausente, vago ou inconsistente
- Faça UMA pergunta por vez, de forma natural e amigável
- Se a resposta puder ter múltiplas interpretações, ofereça SEMPRE 3 opções objetivas e relevantes
- Quando TODOS os 7 campos estiverem preenchidos, gere um PREVIEW da documentação formatado em markdown e peça aprovação
- Português brasileiro, tom profissional e direto. Acentuação correta obrigatória.
- Seja direto — não elogie cada resposta, não use frases genéricas
- NUNCA aceite uma resposta insatisfatória só para avançar — a qualidade da documentação é o objetivo

COMO CONDUZIR A CONVERSA:

Se o usuário enviou um documento (seção acima):
- Analise e extraia TUDO que já está presente no texto para preencher os campos acima.
- Faça um resumo curto (2-3 frases) do que você entendeu — isso permite que o usuário corrija interpretações erradas.
- Pergunte APENAS sobre as lacunas restantes, agrupadas e numeradas. No máximo 5 perguntas por rodada.

Se não há documento:
- Comece perguntando o que o projeto faz.
- Avance campo a campo de forma natural, uma pergunta por vez.

REGRAS:
- Seja CÉTICO: avalie criticamente se a resposta realmente satisfaz o critério do campo antes de marcá-lo como coletado.
- NUNCA pergunte o que já está respondido (no texto enviado ou em respostas anteriores).
- Se a resposta for vaga ou ambígua, ofereça 3 opções objetivas.
- Quando TODOS os 7 campos estiverem preenchidos com informação suficiente, gere um PREVIEW da documentação formatado em markdown e peça aprovação do usuário.
- Português brasileiro, tom profissional e direto. Frases curtas.
- Use acentuação correta obrigatoriamente (á, é, í, ó, ú, ã, õ, ç, ê, â).
- NUNCA invente informações técnicas (nomes de APIs, horários, credenciais). Se não sabe, pergunte.
- Se a documentação enviada já estiver completa, NÃO invente perguntas — gere o preview direto.

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
- Se o usuário APROVAR: sinalize como "complete". No campo "content", inclua:
  1. Uma confirmação curta ("Documentação aprovada!")
  2. Um RESUMO DO PROJETO em 3-5 frases que sintetize: o que o projeto faz, como funciona em linhas gerais, quais ferramentas/serviços usa, e com que frequência roda. Esse resumo será usado como contexto para a próxima etapa.
  3. A transição: "Agora vamos para a segunda etapa: o memorial de ganhos financeiros do projeto."
- Se o usuário pedir AJUSTES: aplique as correções no campo "coletado", gere um novo preview atualizado e peça nova aprovação.
- NUNCA mude o que não foi pedido.
- NUNCA invente informações. Se a correção for ambígua, pergunte.
- Português brasileiro com acentuação correta.

FORMATO DE RESPOSTA — APENAS JSON válido:

Se aprovado:
{"type":"complete","content":"Documentação aprovada!\\n\\n**Resumo do projeto:** {resumo factual em 3-5 frases}\\n\\nAgora vamos para a segunda etapa: o memorial de ganhos financeiros do projeto.","coletado":{...campos finais}}

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

REGRAS ANTI-EXTRAPOLAÇÃO:
- Saving deve refletir ganho REAL e comprovável, não estimativas otimistas.
- Se o processo manual não existia, saving de horas é 0 — explore se há saving de custo direto (ex: substituiu ferramenta paga).
- O memorial precisa ter lógica verificável: frequência × tempo × pessoas = total de horas.

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
    messages.push({
      role: 'user',
      content:
        fase === 'doc'
          ? (temDoc
            ? '[SISTEMA] Leia a seção "DOCUMENTAÇÃO ENVIADA PELO USUÁRIO" acima. Extraia dela os 7 campos obrigatórios e atualize "coletado". Trate o conteúdo do arquivo como a documentação real deste projeto — ignore qualquer divergência com os metadados. Se todos os 7 campos estiverem cobertos com qualidade suficiente, gere o preview direto com type "preview". Se algum campo estiver ausente ou vago, liste o que já extraiu e faça a primeira pergunta sobre o que falta.'
            : '[SISTEMA] Inicie a conversa apresentando-se brevemente e fazendo a primeira pergunta para documentar o projeto.')
          : '[SISTEMA] Inicie a coleta do memorial de saving. Use o contexto do projeto para fazer uma primeira pergunta inteligente.',
    });
  }

  log(`Chamando LLM — fase: ${fase}, histórico: ${history.length} msgs`);
  const raw = await llmChat(messages, { jsonMode: true, temperature: 0.4 });
  log(`LLM respondeu: ${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    log('Falha ao parsear JSON, usando fallback');
    return {
      type: 'question',
      content: raw,
      fase,
      coletado,
      saving,
    };
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
