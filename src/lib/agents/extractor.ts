// Extrator de campos de documentação — chamada única ao LLM, sem chat
// Recebe doc + descrição breve → devolve DocumentacaoColetada preenchida

const log = (...args: unknown[]) => console.log('[extractor]', ...args);

import { llmChat } from '@/lib/llm';
import type { DocumentacaoColetada, ProjetoContexto } from './types';
import { documentacaoVazia } from './types';

export async function extrairCamposDocumentacao(
  ctx: ProjetoContexto,
  docTexto: string,
): Promise<DocumentacaoColetada> {
  const descricao = ctx.descricao_breve?.trim() || '';
  const temDoc = docTexto.trim().length > 10;

  if (!temDoc && !descricao) {
    log('Sem doc e sem descrição — retornando vazio com nome_projeto');
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }

  const docSection = temDoc
    ? `DOCUMENTAÇÃO ENVIADA:\n---\n${docTexto}\n---`
    : '(Nenhuma documentação foi enviada)';

  const descSection = descricao
    ? `DESCRIÇÃO BREVE DO PROJETO (fornecida pelo usuário):\n${descricao}`
    : '';

  const system = `Você é um extrator de dados de projetos de automação.
Analise o conteúdo abaixo e preencha os 7 campos da documentação.
Para cada campo, extraia o que conseguir. Se não houver informação suficiente, retorne null.
Responda APENAS com JSON válido, sem texto adicional.

CAMPOS:
1. nome_projeto — Título do projeto (string ou null)
2. o_que_faz — O que faz, para quem, resultado (string ou null)
3. execucao — Como é acionado: trigger, schedule, webhook (string ou null)
4. dependencias — Serviços externos, APIs, credenciais (string ou null)
5. fluxo — Sequência de etapas do início ao fim, com IFs (string ou null)
6. configurar_antes — O que fazer antes da primeira execução (string ou null)
7. atencao — Riscos, limitações, pontos frágeis (string ou null)

Responda no formato:
{"nome_projeto":"...","o_que_faz":"...","execucao":"...","dependencias":"...","fluxo":"...","configurar_antes":"...","atencao":"..."}

Use null para campos sem informação suficiente. Português brasileiro, acentuação correta.`;

  const userContent = [
    descSection,
    docSection,
    `DADOS CONHECIDOS: nome="${ctx.nome_projeto}", ferramenta="${ctx.ferramenta}", área="${ctx.area ?? ''}"`,
  ].filter(Boolean).join('\n\n');

  log(`Extraindo campos — doc: ${docTexto.length} chars, descrição: ${descricao.length} chars`);

  let raw: string;
  try {
    raw = await llmChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      { jsonMode: true, temperature: 0 },
    );
    log(`LLM respondeu: ${raw.slice(0, 200)}`);
  } catch (e) {
    log('Erro no LLM extractor:', e);
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DocumentacaoColetada>;
    const result: DocumentacaoColetada = {
      nome_projeto: parsed.nome_projeto ?? ctx.nome_projeto ?? null,
      o_que_faz: parsed.o_que_faz ?? null,
      execucao: parsed.execucao ?? null,
      dependencias: parsed.dependencias ?? null,
      fluxo: parsed.fluxo ?? null,
      configurar_antes: parsed.configurar_antes ?? null,
      atencao: parsed.atencao ?? null,
    };
    const preenchidos = Object.values(result).filter(v => v !== null).length;
    log(`Extração concluída: ${preenchidos}/7 campos preenchidos`);
    return result;
  } catch {
    log('Falha ao parsear resposta do extractor — retornando vazio');
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }
}
