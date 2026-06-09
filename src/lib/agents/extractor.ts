// Extrator de campos de documentação — chamada única ao LLM, sem chat
// Lê TODOS os arquivos de código/config → preenche os 7 campos diretamente
// Campos técnicos vêm do código; campos de negócio ficam null para o chat pedir

const log = (...args: unknown[]) => console.log('[extractor]', ...args);

import { llmChat } from '@/lib/llm';
import type { DocumentacaoColetada, ProjetoContexto } from './types';
import { documentacaoVazia } from './types';

export async function extrairCamposDocumentacao(
  ctx: ProjetoContexto,
  docTexto: string,
): Promise<DocumentacaoColetada> {
  const descricao = ctx.descricao_breve?.trim() || '';
  const temConteudo = docTexto.trim().length > 10;

  if (!temConteudo && !descricao) {
    log('Sem conteúdo — retornando vazio com nome_projeto');
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }

  const system = `Você é um analisador técnico de projetos de automação.
Recebeu o conteúdo completo dos arquivos do projeto — código, configs e documentação.
Sua tarefa é preencher os 7 campos da documentação padrão DIRETAMENTE a partir do que está nos arquivos.

REGRAS:
- Campos TÉCNICOS (execucao, dependencias, fluxo, configurar_antes): preencha sempre que encontrar no código. NÃO deixe null se a informação existir nos arquivos.
- Campos de NEGÓCIO (o_que_faz, atencao): preencha o que conseguir inferir do código, mas podem ficar null se não houver contexto de negócio suficiente.
- nome_projeto: use o nome informado nos metadados se não estiver claro no código.
- Seja preciso e técnico. Extraia URLs, nomes de APIs, horários de cron, nomes de variáveis de ambiente, nomes de workflows — use as informações EXATAS do código.
- Responda APENAS com JSON válido, sem texto adicional.

CAMPOS:
1. nome_projeto — Título do projeto (string ou null)
2. o_que_faz — O que faz, para quem, qual o resultado — precisa de contexto de negócio (string ou null)
3. execucao — Como é acionado: trigger, schedule (com horário/frequência exatos), webhook URL, evento (string ou null)
4. dependencias — Lista de serviços, APIs externas, variáveis de ambiente necessárias, credenciais (string ou null)
5. fluxo — Sequência DETALHADA das etapas do código do início ao fim, com condicionais reais (IFs, switches) (string ou null)
6. configurar_antes — Variáveis de ambiente, credenciais, configurações iniciais obrigatórias (string ou null)
7. atencao — Limitações, pontos frágeis, edge cases observados no código (string ou null)

Formato da resposta:
{"nome_projeto":"...","o_que_faz":"...","execucao":"...","dependencias":"...","fluxo":"...","configurar_antes":"...","atencao":"..."}

Use null APENAS quando realmente não há informação nos arquivos. Português brasileiro, acentuação correta.`;

  const userContent = [
    ctx.descricao_breve?.trim()
      ? `CONTEXTO DE NEGÓCIO FORNECIDO PELO USUÁRIO:\n${ctx.descricao_breve.trim()}`
      : '',
    `METADADOS: nome="${ctx.nome_projeto}", ferramenta="${ctx.ferramenta}", área="${ctx.area ?? ''}"`,
    `\nCONTEÚDO DOS ARQUIVOS DO PROJETO:\n\n${docTexto}`,
  ].filter(Boolean).join('\n\n');

  log(`Extraindo campos — conteúdo: ${docTexto.length} chars, descrição: ${descricao.length} chars`);

  let raw: string;
  try {
    raw = await llmChat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      { jsonMode: true, temperature: 0 },
    );
    log(`LLM respondeu: ${raw.slice(0, 300)}`);
  } catch (e) {
    log('Erro no LLM extractor:', e);
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DocumentacaoColetada>;
    const result: DocumentacaoColetada = {
      nome_projeto: norm(parsed.nome_projeto) ?? ctx.nome_projeto ?? null,
      o_que_faz: norm(parsed.o_que_faz),
      execucao: norm(parsed.execucao),
      dependencias: norm(parsed.dependencias),
      fluxo: norm(parsed.fluxo),
      configurar_antes: norm(parsed.configurar_antes),
      atencao: norm(parsed.atencao),
    };
    const preenchidos = Object.values(result).filter(v => v !== null).length;
    log(`Extração concluída: ${preenchidos}/7 campos preenchidos`);
    // nome_projeto vem do form, então 1 campo preenchido = extração falhou de fato
    if (preenchidos <= 1) {
      log(`⚠️ Extração praticamente vazia (${preenchidos}/7) — o chat vai coletar via perguntas. Conteúdo: ${docTexto.length} chars`);
    }
    return result;
  } catch {
    log('Falha ao parsear resposta do extractor — retornando vazio');
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }
}

/**
 * Normaliza um valor vindo do LLM para string limpa ou null.
 * Trata o caso comum em que o modelo devolve a STRING "null"/"undefined"/"n/a"
 * (entre aspas) em vez do literal JSON null — senão o campo fica preenchido
 * com o texto "null" e o preview sai todo nulo.
 */
function norm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    // Arrays/objetos: serializa; números/bool: converte
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  const t = value.trim();
  if (t === '') return null;
  const low = t.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'n/a' || low === 'none') return null;
  return t;
}
