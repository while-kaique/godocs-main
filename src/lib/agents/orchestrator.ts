// Agente Orquestrador
// Analisa o histórico do chat, extrai o que já foi coletado e decide a próxima ação:
// - Fazer uma pergunta direta
// - Oferecer 3 opções (quando a resposta pode ser ambígua)
// - Sinalizar que a coleta está completa

import { llmChat } from '@/lib/llm';
import type {
  ChatHistoryMessage,
  DocumentacaoColetada,
  OrchestratorResult,
  ProjetoContexto,
} from './types';
import { documentacaoVazia } from './types';

function buildSystemPrompt(ctx: ProjetoContexto, coletado: DocumentacaoColetada): string {
  const membros = ctx.membros.length > 0 ? ctx.membros.join(', ') : 'Não informado';

  return `Você é um assistente especializado em documentação de projetos de automação interna da Gocase.

Seu objetivo é coletar informações para documentar um projeto de automação através de conversa natural e amigável.

CONTEXTO JÁ COLETADO (etapa anterior do formulário):
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta utilizada: ${ctx.ferramenta}
- Membros do time: ${membros}

CAMPOS QUE VOCÊ PRECISA COLETAR:
1. nome_projeto — Nome do projeto ou automação
2. problema_resolve — Qual problema ela resolve? Como era o processo manual antes?
3. como_funciona — Como a automação funciona? Descreva o fluxo em linhas gerais.
4. economia_horas_mes — Quantas horas por mês essa automação economiza? (número)
5. valor_hora — Valor da hora trabalhada em R$ (mínimo R$ 8,00)
6. economia_reais_mes — Total economizado por mês em R$ (horas × valor_hora)
7. memorial_calculo — Como chegaram a esses números? Explique o cálculo detalhadamente.
8. beneficios_adicionais — Outros benefícios além do financeiro (qualidade, erros evitados, etc.)

ESTADO ATUAL DA COLETA:
${JSON.stringify(coletado, null, 2)}

REGRAS:
- Faça UMA pergunta por vez, de forma natural
- Se a resposta do usuário for vaga ou puder ter múltiplas interpretações, SEMPRE ofereça 3 opções objetivas
- As opções devem ser específicas e relevantes para o contexto da resposta do usuário
- Quando TODOS os campos acima tiverem sido coletados com informação suficiente, sinalize como completo
- Converse em português brasileiro, tom profissional mas acessível
- Nunca repita perguntas sobre campos já coletados

FORMATO DE RESPOSTA — responda APENAS com JSON válido, sem texto adicional:

Pergunta direta:
{"type":"question","content":"sua pergunta","coletado":{...campos atualizados}}

Quando precisar de clareza (oferecer opções):
{"type":"options","question":"sua pergunta de clarificação","options":["opção concreta 1","opção concreta 2","opção concreta 3"],"coletado":{...campos atualizados}}

Quando todos os campos estiverem completos:
{"type":"complete","content":"mensagem final resumindo o que foi coletado","coletado":{...todos os campos}}`;
}

export async function runOrchestrator(
  ctx: ProjetoContexto,
  history: ChatHistoryMessage[],
  coletado: DocumentacaoColetada = documentacaoVazia()
): Promise<OrchestratorResult> {
  const systemPrompt = buildSystemPrompt(ctx, coletado);

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

  // Se não há histórico ainda, pede para iniciar a coleta
  if (history.length === 0) {
    messages.push({
      role: 'user',
      content: '[SISTEMA] Inicie a conversa apresentando-se brevemente e fazendo a primeira pergunta.',
    });
  }

  const raw = await llmChat(messages, { jsonMode: true, temperature: 0.5 });

  let parsed: OrchestratorResult;
  try {
    parsed = JSON.parse(raw) as OrchestratorResult;
  } catch {
    // Fallback se o LLM não retornar JSON válido
    parsed = {
      type: 'question',
      content: raw,
      coletado,
    };
  }

  // Garante que o campo coletado sempre existe
  if (!parsed.coletado) {
    parsed.coletado = coletado;
  }

  return parsed;
}

export function camposFaltando(coletado: DocumentacaoColetada): string[] {
  return (Object.keys(coletado) as (keyof DocumentacaoColetada)[]).filter(
    (k) => coletado[k] === null || coletado[k] === undefined
  );
}

export function coleta_completa(coletado: DocumentacaoColetada): boolean {
  return camposFaltando(coletado).length === 0;
}
