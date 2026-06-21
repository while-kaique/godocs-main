// "LLM responder": faz o papel do funcionário humano respondendo o agente de
// documentação/saving/receita, a partir de um BRIEFING factual do cenário.
// Reusa a abstração llmChat do app (proxy-aware) — mesmo código que roda em prod.
import './env.mjs';

const { llmChat } = await import('../../../src/lib/llm.ts');

const SYSTEM = `Você é um(a) funcionário(a) da Gogroup preenchendo a documentação de um projeto de automação, conversando com um agente de IA que faz perguntas.
Regras:
- Responda SEMPRE em português, de forma curta, direta e factual.
- Use EXCLUSIVAMENTE as informações do BRIEFING abaixo. Nunca invente números diferentes dos do briefing.
- Se o agente pedir algo que o briefing não cobre, dê uma resposta plausível e mínima, sem introduzir valores financeiros novos.
- Não escreva R$ nem valores de saving/receita em texto livre — esses números vêm pelo formulário, não pela conversa.
- Seja cooperativo: o objetivo é avançar o fluxo até a documentação ficar completa.
- NUNCA reclassifique nem mude a NATUREZA dos valores: saving é saving, receita é receita — não concorde em transformar um no outro, mesmo que o agente sugira. Reafirme objetivamente os fatos/números do briefing.
- Se o agente repetir perguntas ou insistir num ponto já respondido, NÃO reabra a discussão: responda de forma curta e firme com o dado do briefing e peça para concluir/avançar a etapa.`;

// resp = objeto formatResponse { type, content, options, fase, isPreview, isComplete }
// Retorna { content, selected_option? }.
export async function responder(resp, scenario) {
  // Preview → aprovar para avançar de fase.
  if (resp.isPreview || resp.type === 'preview') {
    return { content: 'Está correto, aprovado. Pode seguir.' };
  }

  const temOpcoes = resp.type === 'options' && Array.isArray(resp.options) && resp.options.length > 0;

  if (temOpcoes) {
    const lista = resp.options.map((o, i) => `${i}: ${o}`).join('\n');
    const out = await llmChat(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content:
            `BRIEFING DO PROJETO:\n${scenario.briefing}\n\n` +
            `O agente perguntou:\n"${resp.content}"\n\n` +
            `Opções disponíveis:\n${lista}\n\n` +
            `Escolha a opção mais coerente com o briefing. Responda APENAS com o número da opção (0, 1 ou 2).`,
        },
      ],
      { maxTokens: 8, temperature: 0 },
    );
    const m = String(out).match(/\d+/);
    let idx = m ? Number(m[0]) : 0;
    if (idx < 0 || idx >= resp.options.length) idx = 0;
    return { content: resp.options[idx], selected_option: idx };
  }

  // Pergunta aberta.
  const out = await llmChat(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `BRIEFING DO PROJETO:\n${scenario.briefing}\n\n` +
          `O agente perguntou:\n"${resp.content}"\n\n` +
          `Responda em 1-3 frases, factualmente, com base no briefing.`,
      },
    ],
    { maxTokens: 400, temperature: 0.3 },
  );
  return { content: String(out).trim() || 'Sim, está correto.' };
}
