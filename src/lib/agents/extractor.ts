// Extrator de campos de documentação — lê a codebase e preenche os 7 campos.
// Campos técnicos vêm do código; campos de negócio ficam null para o chat pedir.
//
// Estratégia por tamanho:
// - Conteúdo pequeno (<= SINGLE_CALL_MAX_CHARS): 1 chamada ao LLM (rápido).
// - Conteúdo grande: map-reduce — divide em lotes por arquivo, extrai cada um
//   em paralelo (map) e consolida num passo final (reduce). Mantém qualidade
//   no teto de 200k tokens, onde uma única chamada degrada (o modelo "desiste").

const log = (...args: unknown[]) => console.log('[extractor]', ...args);

import { llmChat } from '@/lib/llm';
import type { DocumentacaoColetada, ProjetoContexto } from './types';
import { documentacaoVazia } from './types';

// ~4 chars/token. Abaixo de ~20k tokens, uma chamada extrai bem.
const SINGLE_CALL_MAX_CHARS = 80_000;
// Lotes de ~17k tokens — tamanho onde a extração é confiável.
const CHUNK_CHARS = 70_000;

const CAMPOS = `CAMPOS:
1. nome_projeto — Título do projeto (string ou null)
2. o_que_faz — O que faz, para quem, qual o resultado — precisa de contexto de negócio (string ou null)
3. execucao — Como é acionado: trigger, schedule (com horário/frequência exatos), webhook URL, evento (string ou null)
4. dependencias — Lista de serviços, APIs externas, variáveis de ambiente necessárias, credenciais (string ou null)
5. fluxo — Sequência DETALHADA das etapas do código do início ao fim, com condicionais reais (IFs, switches) (string ou null)
6. configurar_antes — Variáveis de ambiente, credenciais, configurações iniciais obrigatórias (string ou null)
7. atencao — Limitações, pontos frágeis, edge cases observados no código (string ou null)`;

const FORMATO = `Formato da resposta — APENAS JSON válido, sem texto adicional:
{"nome_projeto":"...","o_que_faz":"...","execucao":"...","dependencias":"...","fluxo":"...","configurar_antes":"...","atencao":"..."}
Para campos sem informação use o literal JSON null (sem aspas), NUNCA a string "null". Português brasileiro, acentuação correta.`;

const CAMPO_KEYS = [
  'nome_projeto', 'o_que_faz', 'execucao', 'dependencias',
  'fluxo', 'configurar_antes', 'atencao',
] as const;

// ─── Entry point ──────────────────────────────────────────────────────────────

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

  let result: DocumentacaoColetada;
  if (docTexto.length <= SINGLE_CALL_MAX_CHARS) {
    log(`Extração em 1 chamada — ${docTexto.length} chars, descrição: ${descricao.length} chars`);
    result = await extrairLote(ctx, docTexto, false);
  } else {
    const chunks = dividirEmLotes(docTexto, CHUNK_CHARS);
    log(`Conteúdo grande (${docTexto.length} chars) — map-reduce em ${chunks.length} lote(s)`);
    const parciais = await Promise.all(chunks.map((c, i) => {
      log(`  → lote ${i + 1}/${chunks.length}: ${c.length} chars`);
      return extrairLote(ctx, c, true);
    }));
    result = await consolidar(ctx, parciais);
  }

  // nome_projeto sempre cai pro nome do form se o modelo não achou
  result.nome_projeto = result.nome_projeto ?? ctx.nome_projeto ?? null;

  const preenchidos = Object.values(result).filter((v) => v !== null).length;
  log(`Extração concluída: ${preenchidos}/7 campos preenchidos`);
  if (preenchidos <= 1) {
    log(`⚠️ Extração praticamente vazia (${preenchidos}/7) — o chat vai coletar via perguntas. Conteúdo: ${docTexto.length} chars`);
  }
  return result;
}

// ─── Map: extrai os 7 campos de um lote ─────────────────────────────────────────

async function extrairLote(
  ctx: ProjetoContexto,
  texto: string,
  isLote: boolean,
): Promise<DocumentacaoColetada> {
  const escopo = isLote
    ? `Você recebeu uma PARTE de um projeto maior. Extraia apenas o que estiver presente neste trecho; deixe null o que não aparecer aqui.`
    : `Você recebeu o conteúdo completo dos arquivos do projeto.`;

  const system = `Você é um analisador técnico de projetos de automação.
${escopo}
Sua tarefa é preencher os 7 campos da documentação padrão DIRETAMENTE a partir do que está nos arquivos.

REGRAS:
- Campos TÉCNICOS (execucao, dependencias, fluxo, configurar_antes): preencha sempre que encontrar no código.
- Campos de NEGÓCIO (o_que_faz, atencao): preencha o que conseguir inferir; podem ficar null se não houver contexto.
- nome_projeto: use o nome dos metadados se não estiver claro no código.
- Seja preciso: extraia URLs, nomes de APIs, horários de cron, variáveis de ambiente, nomes de workflows EXATOS.

${CAMPOS}

${FORMATO}`;

  const userContent = [
    ctx.descricao_breve?.trim()
      ? `CONTEXTO DE NEGÓCIO FORNECIDO PELO USUÁRIO:\n${ctx.descricao_breve.trim()}`
      : '',
    `METADADOS: nome="${ctx.nome_projeto}", ferramenta="${ctx.ferramenta}", área="${ctx.area ?? ''}"`,
    `\nCONTEÚDO${isLote ? ' (PARTE)' : ''}:\n\n${texto}`,
  ].filter(Boolean).join('\n\n');

  return chamarEParsear(system, userContent, ctx);
}

// ─── Reduce: consolida as extrações parciais num conjunto limpo ─────────────────

async function consolidar(
  ctx: ProjetoContexto,
  parciais: DocumentacaoColetada[],
): Promise<DocumentacaoColetada> {
  // Junta os valores não-nulos de cada campo vindos dos lotes
  const agregado: Record<string, string[]> = {};
  for (const key of CAMPO_KEYS) {
    agregado[key] = parciais
      .map((p) => p[key])
      .filter((v): v is string => v != null && v.trim().length > 0);
  }

  // Se nenhum campo técnico/negócio veio preenchido, nem chama o LLM
  const totalValores = Object.values(agregado).reduce((a, b) => a + b.length, 0);
  if (totalValores === 0) {
    log('Consolidação: nenhum lote trouxe conteúdo — retornando vazio');
    return { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto || null };
  }

  const system = `Você consolida extrações parciais de um mesmo projeto em UMA documentação coesa.
Recebeu, por campo, uma lista de trechos extraídos de partes diferentes do projeto.
Funda cada campo num texto único, sem redundância, mantendo todos os detalhes técnicos relevantes.
Não invente nada além do que está nos trechos.

${CAMPOS}

${FORMATO}`;

  const userContent = `METADADOS: nome="${ctx.nome_projeto}", ferramenta="${ctx.ferramenta}", área="${ctx.area ?? ''}"

EXTRAÇÕES PARCIAIS POR CAMPO (JSON):
${JSON.stringify(agregado, null, 2)}`;

  log(`Consolidando ${parciais.length} extração(ões) parciais...`);
  return chamarEParsear(system, userContent, ctx);
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Chama o LLM (jsonMode, temp 0), parseia e normaliza os 7 campos */
async function chamarEParsear(
  system: string,
  userContent: string,
  ctx: ProjetoContexto,
): Promise<DocumentacaoColetada> {
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
    return {
      nome_projeto: norm(parsed.nome_projeto),
      o_que_faz: norm(parsed.o_que_faz),
      execucao: norm(parsed.execucao),
      dependencias: norm(parsed.dependencias),
      fluxo: norm(parsed.fluxo),
      configurar_antes: norm(parsed.configurar_antes),
      atencao: norm(parsed.atencao),
    };
  } catch {
    log('Falha ao parsear resposta do extractor — retornando vazio');
    return documentacaoVazia();
  }
}

/**
 * Divide o texto em lotes de até maxChars, respeitando os limites de arquivo
 * (separador "\n\n---\n\n" usado por extractTextFromMultipleFiles). Um arquivo
 * maior que maxChars vira um lote sozinho (cortado se necessário no backend).
 */
export function dividirEmLotes(texto: string, maxChars: number): string[] {
  const SEP = '\n\n---\n\n';
  const arquivos = texto.split(SEP);
  const lotes: string[] = [];
  let atual = '';

  for (const arq of arquivos) {
    if (atual && atual.length + arq.length + SEP.length > maxChars) {
      lotes.push(atual);
      atual = '';
    }
    if (arq.length > maxChars) {
      // Arquivo gigante: empurra o lote acumulado e fatia o arquivo
      if (atual) { lotes.push(atual); atual = ''; }
      for (let i = 0; i < arq.length; i += maxChars) {
        lotes.push(arq.slice(i, i + maxChars));
      }
      continue;
    }
    atual = atual ? atual + SEP + arq : arq;
  }
  if (atual) lotes.push(atual);
  return lotes;
}

/**
 * Normaliza um valor vindo do LLM para string limpa ou null.
 * Trata o caso comum em que o modelo devolve a STRING "null"/"undefined"/"n/a"
 * (entre aspas) em vez do literal JSON null — senão o campo fica preenchido
 * com o texto "null" e o preview sai todo nulo.
 */
export function norm(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  const t = value.trim();
  if (t === '') return null;
  const low = t.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'n/a' || low === 'none') return null;
  return t;
}
