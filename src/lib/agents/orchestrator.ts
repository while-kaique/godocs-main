// Agente Orquestrador
const log = (...args: unknown[]) => console.log('[orchestrator]', ...args);
const err = (...args: unknown[]) => console.error('[orchestrator]', ...args);
// Analisa a documentação enviada pelo usuário, extrai o que já está claro
// e faz perguntas de follow-up apenas sobre o que ainda falta ou está vago.

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
  const temDoc = ctx.doc_texto && ctx.doc_texto.trim().length > 10;

  const docSection = temDoc
    ? `DOCUMENTAÇÃO ENVIADA PELO USUÁRIO:
---
${ctx.doc_texto}
---`
    : `(Nenhuma documentação foi enviada — colete todas as informações via conversa.)`;

  return `Você é um assistente especializado em padronização de documentação de projetos de automação interna da Gocase.

${docSection}

DADOS JÁ CONHECIDOS DO PROJETO:
- Nome do projeto: ${ctx.nome_projeto}
- Data de criação: ${ctx.data_criacao ?? 'Não informada'}
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta utilizada: ${ctx.ferramenta}
- Membros do time: ${membros}

PADRÃO MÍNIMO DE DOCUMENTAÇÃO EXIGIDO (com critério de aceitação por campo):
1. problema_resolve — O que a automação resolve? Como era o processo manual antes?
   ✓ Aceito: descreve o problema concreto E como era feito manualmente
   ✗ Recusar: "economiza tempo", "automatiza processos" sem detalhe

2. como_funciona — Como a automação funciona? Descreva o fluxo em linhas gerais.
   ✓ Aceito: descreve ao menos 2 etapas do fluxo (entrada → processamento → saída)
   ✗ Recusar: "usa Make/n8n para automatizar" sem descrever o fluxo

3. economia_horas_mes — Quantas horas por mês essa automação economiza? (número inteiro ou decimal)
   ✓ Aceito: número plausível com alguma justificativa mínima
   ✗ Recusar: número sem nenhum contexto

4. valor_hora — Valor da hora trabalhada em R$ (mínimo R$ 8,00)
   ✓ Aceito: valor numérico ≥ 8
   ✗ Recusar: valor abaixo de R$ 8,00

5. economia_reais_mes — Total economizado por mês em R$
   ✓ Aceito: deve ser matematicamente consistente com economia_horas_mes × valor_hora (tolerância de 10%)
   ✗ Recusar: número que não bate com a conta ou sem justificativa

6. memorial_calculo — Como chegaram a esses números? Explicação detalhada do cálculo.
   ✓ Aceito SOMENTE SE: explica a origem dos números — quantas tarefas, quanto tempo cada uma, frequência, quem faz, etc.
   ✗ Recusar OBRIGATORIAMENTE: fórmulas soltas como "200 x 20", "horas × valor", uma linha sem contexto, respostas com menos de 30 palavras
   → Se recusar: peça especificamente o raciocínio por trás dos números (ex: "Quantas tarefas são feitas por mês? Quanto tempo cada uma levava antes?")

7. beneficios_adicionais — Outros benefícios além do financeiro
   ✓ Aceito: cita ao menos 1 benefício concreto (ex: redução de erros, rastreabilidade, disponibilidade 24/7)
   ✗ Recusar: "melhora o processo", "traz benefícios" sem especificar

ESTADO ATUAL DA COLETA:
${JSON.stringify(coletado, null, 2)}

REGRAS FUNDAMENTAIS:
- Seja CÉTICO: avalie criticamente se a resposta realmente satisfaz o critério do campo antes de marcá-lo como coletado
- Se a resposta for vaga, incompleta ou não satisfizer o critério acima, NÃO atualize o campo no "coletado" — deixe-o null e faça uma pergunta de aprofundamento
- Ao iniciar (primeira mensagem com doc), liste brevemente o que já extraiu antes de perguntar o que falta
- Faça perguntas APENAS sobre o que ainda está ausente, vago ou inconsistente
- Faça UMA pergunta por vez, de forma natural e amigável
- Se a resposta puder ter múltiplas interpretações, ofereça SEMPRE 3 opções objetivas e relevantes
- Quando TODOS os 7 campos tiverem informação suficiente segundo os critérios acima, sinalize como completo
- Tom: profissional mas acessível, português brasileiro
- Seja direto — não elogie cada resposta, não use frases genéricas
- NUNCA aceite uma resposta insatisfatória só para avançar — a qualidade da documentação é o objetivo

FORMATO DE RESPOSTA — responda SOMENTE com JSON válido, sem texto adicional:

Pergunta direta:
{"type":"question","content":"sua pergunta","coletado":{...campos atualizados}}

Quando precisar de clareza (oferecer opções):
{"type":"options","question":"sua pergunta de clarificação","options":["opção concreta 1","opção concreta 2","opção concreta 3"],"coletado":{...campos atualizados}}

Quando todos os campos estiverem completos:
{"type":"complete","content":"mensagem final confirmando que a documentação está completa e pronta para envio","coletado":{...todos os campos}}`;
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

  if (history.length === 0) {
    const temDoc = ctx.doc_texto && ctx.doc_texto.trim().length > 10;
    messages.push({
      role: 'user',
      content: temDoc
        ? '[SISTEMA] O usuário enviou a documentação acima. Analise-a e responda em JSON: atualize o campo "coletado" com tudo que conseguiu extrair do documento; no campo "content" escreva primeiro um resumo de 1-2 linhas do que já encontrou no documento (ex: "Já identifiquei que a automação faz X e economiza Y horas/mês."), depois faça a primeira pergunta sobre o campo mais importante que ainda está ausente ou vago. Se todos os campos estiverem cobertos, responda com type "complete".'
        : '[SISTEMA] Inicie a conversa apresentando-se brevemente e fazendo a primeira pergunta para documentar o projeto.',
    });
  }

  log(`Chamando LLM — histórico: ${history.length} msgs, doc: ${ctx.doc_texto ? ctx.doc_texto.length + ' chars' : 'nenhum'}`);
  let raw: string;
  try {
    raw = await llmChat(messages, { jsonMode: true, temperature: 0.4 });
    log(`LLM respondeu: ${raw.slice(0, 200)}${raw.length > 200 ? '...' : ''}`);
  } catch (llmErr) {
    err('Falha na chamada LLM:', llmErr);
    throw llmErr;
  }

  let parsed: OrchestratorResult;
  try {
    parsed = JSON.parse(raw) as OrchestratorResult;
    log(`JSON parseado: type="${parsed.type}"`);
  } catch (parseErr) {
    err('Falha ao parsear JSON do LLM:', parseErr, '\nRaw:', raw.slice(0, 500));
    parsed = {
      type: 'question',
      content: raw,
      coletado,
    };
  }

  if (!parsed.coletado) {
    parsed.coletado = coletado;
  }

  return parsed;
}

export function camposFaltando(coletado: DocumentacaoColetada): string[] {
  return (Object.keys(coletado) as (keyof DocumentacaoColetada)[]).filter(
    (k) => k !== 'nome_projeto' && (coletado[k] === null || coletado[k] === undefined)
  );
}

export function coleta_completa(coletado: DocumentacaoColetada): boolean {
  return camposFaltando(coletado).length === 0;
}
