// Agente Compilador de Documentação
// Recebe os campos coletados pelo orquestrador + contexto do projeto
// e gera a documentação final estruturada no padrão das 6 seções.
//
// Esta etapa é o CERNE do produto: o agente transforma os campos coletados em
// documentação profissional (6 seções, critérios de qualidade, dedup). Por isso
// NÃO há fallback determinístico — se a IA não devolver uma doc válida, lançamos
// erro para o chamador abortar a transição e o usuário tentar de novo. Nunca
// salvamos uma doc "de segunda categoria" que não passou pelo agente.

import { llmChat } from '@/lib/llm';
import type { DocumentacaoColetada, DocumentacaoGerada, ProjetoContexto } from './types';

const log = (...args: unknown[]) => console.log('[doc-compiler]', ...args);

// Teto de saída generoso: a doc completa (6 seções estruturadas) estoura fácil os
// 2048 default do llm.ts — e modelos de reasoning (gpt-5*) ainda consomem parte do
// orçamento com raciocínio. Sem isso, o JSON volta truncado.
const MAX_OUTPUT_TOKENS = 8192;

// Quantas vezes tentamos obter um JSON válido do agente antes de desistir.
const MAX_ATTEMPTS = 3;

export const SYSTEM_PROMPT = `Você é um especialista em documentação de projetos de automação corporativa do GoGroup.
Gere uma documentação técnica profissional e completa com base nas informações coletadas.

A documentação final deve seguir EXATAMENTE esta estrutura de 6 seções:

1. **O que faz** — Parágrafo objetivo de 2-4 frases: qual problema resolve, para quem resolve, e qual o resultado da execução.
2. **Execução** — Como o projeto é acionado (trigger manual, schedule com horário/frequência, webhook, evento, etc.).
3. **Dependências** — Lista de TODOS os serviços externos, APIs, credenciais e acessos necessários.
4. **Fluxo** — Sequência lógica e completa das etapas da execução, do início ao fim. Incluir ramificações condicionais (IF/ELSE) quando houver.
5. **Configurar antes de usar** — Passos mínimos para alguém que acabou de receber o projeto conseguir rodá-lo.
6. **Atenção** — Riscos reais, limitações conhecidas, pontos frágeis. Não invente riscos genéricos.

CRITÉRIOS DE QUALIDADE:
- "O que faz" deve ser compreensível por alguém que nunca viu o projeto.
- "Dependências" deve listar TODOS os serviços mencionados — não omita nenhum.
- "Fluxo" deve ser uma sequência lógica sem pular etapas.
- "Atenção" só deve ter itens reais. Se não houver riscos claros, use: "Nenhum risco crítico identificado no momento."
- NÃO repita informações entre seções.
- Escreva em português brasileiro com acentuação correta.

Responda APENAS com JSON válido seguindo exatamente a estrutura abaixo:
{
  "titulo": "nome do projeto",
  "responsavel": { "nome": "...", "email": "...", "area": "..." },
  "ferramenta": "...",
  "membros": ["..."],
  "o_que_faz": "parágrafo descritivo",
  "execucao": "descrição do trigger/agendamento",
  "dependencias": [{"servico": "Nome", "descricao": "para quê é usado"}],
  "fluxo": [{"etapa": "Nome", "descricao": "o que acontece", "condicoes": [{"se": "condição", "acao": "ação"}]}],
  "configurar_antes": ["passo 1", "passo 2"],
  "atencao": [{"titulo": "Título", "descricao": "descrição e recomendação"}],
  "gerado_em": "ISO date string"
}`;

export function buildUserMsg(ctx: ProjetoContexto, coletado: DocumentacaoColetada): string {
  return `Gere a documentação com base nestas informações coletadas:

CONTEXTO DO PROJETO:
- Responsável: ${ctx.responsavel_nome} (${ctx.responsavel_email})
- Área: ${ctx.area ?? 'Não informada'}
- Ferramenta: ${ctx.ferramenta}
- Membros: ${ctx.membros.join(', ') || 'Não informado'}

INFORMAÇÕES COLETADAS VIA CHAT:
- Nome do projeto: ${coletado.nome_projeto}
- O que faz: ${coletado.o_que_faz}
- Execução (trigger): ${coletado.execucao}
- Dependências: ${coletado.dependencias}
- Fluxo: ${coletado.fluxo}
- Configurar antes de usar: ${coletado.configurar_antes}
- Pontos de atenção: ${coletado.atencao}`;
}

/**
 * Faz o parse da resposta do LLM com tolerância a falhas. Retorna null quando o
 * JSON veio truncado/inválido ou sem o conteúdo mínimo esperado — o chamador
 * decide o que fazer (retry).
 */
export function parseDocJson(raw: string): DocumentacaoGerada | null {
  try {
    const parsed = JSON.parse(raw) as DocumentacaoGerada;
    if (parsed && typeof parsed === 'object' && (parsed.o_que_faz || parsed.titulo)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Compila a documentação final via agente. Tenta até MAX_ATTEMPTS vezes obter um
 * JSON válido; entre as tentativas, reapresenta a resposta anterior pedindo o JSON
 * completo. Se nenhuma tentativa produzir doc válida, LANÇA — não há fallback: a
 * documentação tem de passar pelo agente.
 */
export async function compilarDocumentacao(
  ctx: ProjetoContexto,
  coletado: DocumentacaoColetada,
): Promise<DocumentacaoGerada> {
  const baseMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserMsg(ctx, coletado) },
  ];

  let ultimaResposta = '';
  for (let tentativa = 1; tentativa <= MAX_ATTEMPTS; tentativa++) {
    // A partir da 2ª tentativa, mostramos a resposta anterior e pedimos o JSON completo.
    const messages = tentativa === 1
      ? baseMessages
      : [
          ...baseMessages,
          { role: 'assistant' as const, content: ultimaResposta },
          {
            role: 'user' as const,
            content:
              'Sua resposta anterior veio truncada ou inválida. Responda NOVAMENTE com APENAS o JSON completo e bem-formado (todas as chaves e colchetes fechados), sem nenhum texto fora do JSON. Se necessário, seja mais conciso nas descrições.',
          },
        ];

    ultimaResposta = await llmChat(messages, {
      jsonMode: true,
      temperature: 0.3,
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    const doc = parseDocJson(ultimaResposta);
    if (doc) {
      if (tentativa > 1) log(`Documentação compilada na tentativa ${tentativa}.`);
      if (!doc.gerado_em) doc.gerado_em = new Date().toISOString();
      return doc;
    }

    log(`Tentativa ${tentativa}/${MAX_ATTEMPTS}: JSON inválido/truncado.`);
  }

  // Sem fallback: a doc é o cerne do produto e tem de ser gerada pelo agente.
  throw new Error(
    `Não foi possível compilar a documentação técnica: a IA não retornou um JSON válido após ${MAX_ATTEMPTS} tentativas.`,
  );
}
