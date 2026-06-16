// Funções de negócio do chat — sem dependência de TanStack Start.
// Chamadas diretamente pelo worker (src/worker.ts).
// Fluxo: doc → doc_preview → saving → saving_preview → completo

const log = (fn: string, ...args: unknown[]) => console.log(`[chat.functions/${fn}]`, ...args);
const err = (fn: string, ...args: unknown[]) => console.error(`[chat.functions/${fn}]`, ...args);

import { z } from 'zod';
import {
  insertProjeto,
  insertChatMessage,
  getChatMessagesExcludeRole,
  getProjetoContextoData,
  getDocMessage,
  upsertDocumentacao,
  getDocumentacao,
  getProjetoById,
  findDuplicateProjeto,
  updateProjeto,
  deleteChatMessagesByProjeto,
  deleteChatMessagesAfterFaseMarker,
  insertValidacao,
  updateValidacaoEmailEnviado,
  insertAnalise,
  parseJson,
} from '@/integrations/db/client.server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { compilarDocumentacao } from '@/lib/agents/doc-compiler';
import { validarDocumentacao } from '@/lib/agents/validator';
import { analisarProjeto as analisarProjetoAgent } from '@/lib/agents/analyzer';
import { enviarEmailAprovacao, enviarEmailRejeicao } from '@/lib/agents/email-agent';
import { extractTextFromMultipleFiles } from '@/lib/extract-text.server';
import { extrairCamposDocumentacao } from '@/lib/agents/extractor';
import { stripMarkdown } from '@/lib/strip-markdown';
import { deriveAreaFromEmail } from '@/lib/areas/teamguide.server';
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  DocumentacaoGerada,
  ProjetoContexto,
  ReceitaColetada,
  SavingColetado,
  SavingLinha,
} from '@/lib/agents/types';
import { documentacaoVazia, receitaVazia, savingVazio, CARGOS } from '@/lib/agents/types';
import { recomputarSavingFinanceiro } from '@/lib/agents/saving-calc';

// ─── Helpers ────────────────────────────────────────────────────────────────

// Nomes amigáveis dos campos de documentação (7 campos)
const DOC_FIELD_LABELS: Record<string, string> = {
  nome_projeto: 'nome do projeto',
  o_que_faz: 'o que faz',
  execucao: 'execução',
  dependencias: 'dependências',
  fluxo: 'fluxo',
  configurar_antes: 'configurar antes',
  atencao: 'atenção/riscos',
};

// Nomes amigáveis dos campos de saving
const SAVING_FIELD_LABELS: Record<string, string> = {
  linhas: 'pessoas/cargos',
  economia_horas_mes: 'economia de horas',
  tipo_saving: 'tipo de saving',
  memorial_calculo: 'memorial de cálculo',
};

// Nomes amigáveis dos campos de receita
const RECEITA_FIELD_LABELS: Record<string, string> = {
  tipo_saving: 'tipo de ganho',
  valor_ganho_mensal: 'valor de receita',
  memorial_calculo: 'memorial de cálculo',
};

function progressoDocumentacao(coletado: DocumentacaoColetada): string {
  const campos = Object.entries(coletado);
  const total = campos.length; // 7
  const preenchidos = campos.filter(([, v]) => v !== null).length;
  const faltando = campos.filter(([, v]) => v === null).map(([k]) => DOC_FIELD_LABELS[k] ?? k);
  if (faltando.length === 0) return `documentação ${preenchidos}/${total} ✓ completa`;
  return `documentação ${preenchidos}/${total} (falta: ${faltando.join(', ')})`;
}

function progressoSaving(saving: SavingColetado): string {
  const checks: [string, boolean][] = [
    ['pessoas/cargos', saving.linhas != null && saving.linhas.length > 0],
    ['economia de horas', saving.economia_horas_mes != null],
    ['tipo de saving', saving.tipo_saving != null],
    ['memorial de cálculo', saving.memorial_calculo != null],
  ];
  const total = checks.length;
  const preenchidos = checks.filter(([, ok]) => ok).length;
  const faltando = checks.filter(([, ok]) => !ok).map(([nome]) => nome);
  if (faltando.length === 0) return `memorial saving ${preenchidos}/${total} ✓ completo`;
  return `memorial saving ${preenchidos}/${total} (falta: ${faltando.join(', ')})`;
}

function progressoReceita(receita: ReceitaColetada): string {
  const checks: [string, boolean][] = [
    ['tipo de ganho', receita.tipo_saving != null],
    ['valor de receita', receita.valor_ganho_mensal != null],
    ['memorial de cálculo', receita.memorial_calculo != null],
  ];
  const total = checks.length;
  const preenchidos = checks.filter(([, ok]) => ok).length;
  const faltando = checks.filter(([, ok]) => !ok).map(([nome]) => nome);
  if (faltando.length === 0) return `memorial receita ${preenchidos}/${total} ✓ completo`;
  return `memorial receita ${preenchidos}/${total} (falta: ${faltando.join(', ')})`;
}

function progressoPorFase(fase: ChatFase, coletado: DocumentacaoColetada, saving: SavingColetado, receita: ReceitaColetada): string {
  switch (fase) {
    case 'doc':
    case 'doc_preview':
      return progressoDocumentacao(coletado);
    case 'saving':
    case 'saving_preview':
      return progressoSaving(saving);
    case 'receita':
    case 'receita_preview':
      return progressoReceita(receita);
    case 'completo':
      return 'fluxo completo ✓';
    default:
      return '';
  }
}

// Materialidade real do projeto: saving mensal + receita mensal cheia (pontual ÷ 12).
// NÃO usa o ÷10 do ganho_total_mensal (métrica de gestão/ranking) — aqui queremos o valor real
// para o gate de R$ 5.000/mês de validação humana obrigatória.
function calcularMaterialidade(
  saving: Record<string, unknown> | undefined,
  receita: Record<string, unknown> | undefined,
): number {
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const savingTipo = (saving?.tipo_saving as string) ?? 'mensal';
  const savingMensal = savingTipo === 'pontual' ? savingReais / 12 : savingReais;

  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  const receitaTipo = (receita?.tipo_saving as string) ?? 'mensal';
  const receitaMensal = receitaTipo === 'pontual' ? receitaValor / 12 : receitaValor;

  return savingMensal + receitaMensal;
}

async function getProjetoContexto(projeto_id: string): Promise<ProjetoContexto> {
  const data = await getProjetoContextoData(projeto_id);
  if (!data) throw new Error('Projeto não encontrado.');
  const docMsg = await getDocMessage(projeto_id);

  const tiposRaw = parseJson<string[]>(data.tipos_projeto);
  const tiposProjeto = Array.isArray(tiposRaw)
    ? (tiposRaw as ('saving' | 'receita_incremental')[])
    : null;

  return {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    ferramenta: data.ferramenta,
    // area_nome vem do join por area_id; cai no texto p.area quando não há id mapeado.
    area: data.area_nome ?? data.area ?? null,
    membros: parseJson<string[]>(data.membros) ?? [],
    nome_projeto: data.nome ?? '',
    data_criacao: data.data_criacao_projeto ?? null,
    doc_texto: docMsg?.content ?? null,
    descricao_breve: data.descricao_breve ?? null,
    tipo_projeto: (data.tipo_projeto as 'saving' | 'receita_incremental' | null) ?? null,
    tipos_projeto: tiposProjeto,
    escopo: (data.escopo as 'interno' | 'externo' | null) ?? null,
    especial: data.especial === 1,
    contexto_especial: data.contexto_especial ?? null,
  };
}

type EstadoChat = {
  fase: ChatFase;
  coletado: DocumentacaoColetada;
  saving: SavingColetado;
  receita: ReceitaColetada;
};

function extrairEstado(messages: { role: string; content: string }[]): EstadoChat {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msg.content) as Partial<EstadoChat>;
      return {
        fase: parsed.fase ?? 'doc',
        coletado: parsed.coletado ?? documentacaoVazia(),
        saving: parsed.saving ?? savingVazio(),
        receita: parsed.receita ?? receitaVazia(),
      };
    } catch {
      continue;
    }
  }
  return { fase: 'doc', coletado: documentacaoVazia(), saving: savingVazio(), receita: receitaVazia() };
}

function buildHistory(msgs: { role: string; content: string }[]): ChatHistoryMessage[] {
  return msgs
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'assistant') {
        try {
          const parsed = JSON.parse(m.content) as { content?: string; question?: string };
          return { role: 'assistant' as const, content: parsed.content ?? parsed.question ?? m.content };
        } catch {
          return { role: 'assistant' as const, content: m.content };
        }
      }
      return { role: 'user' as const, content: m.content };
    });
}

function extrairResumoProjeto(msgs: { role: string; content: string }[]): string {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const msg = msgs[i];
    if (msg.role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msg.content) as { type?: string; fase?: string; content?: string };
      if (parsed.type === 'complete' && (parsed.fase === 'saving' || parsed.fase === 'receita') && parsed.content) {
        return parsed.content;
      }
    } catch {
      continue;
    }
  }
  return '';
}

function buildPhaseHistory(
  msgs: { role: string; content: string }[],
  targetFase: 'saving' | 'receita',
): ChatHistoryMessage[] {
  // 1) Marcador de transição (type:complete + fase): a conversa da fase vem depois.
  let startIdx = -1;
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'assistant') continue;
    try {
      const parsed = JSON.parse(msgs[i].content) as { type?: string; fase?: string };
      if (parsed.type === 'complete' && parsed.fase === targetFase) {
        startIdx = i;
        break;
      }
    } catch {
      continue;
    }
  }
  // 2) Fallback: fase adicionada depois, sem transição (ex.: receita marcada após o
  //    saving já concluído). Ancora na PRIMEIRA mensagem da própria fase para isolar
  //    o histórico, sem arrastar a conversa do saving.
  if (startIdx < 0) {
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== 'assistant') continue;
      try {
        const parsed = JSON.parse(msgs[i].content) as { fase?: string };
        if (parsed.fase === targetFase) { startIdx = i - 1; break; }
      } catch {
        continue;
      }
    }
  }
  const phaseMsgs = startIdx >= 0 ? msgs.slice(startIdx + 1) : msgs;
  return buildHistory(phaseMsgs);
}

function formatResponse(resultado: ReturnType<typeof runOrchestrator> extends Promise<infer R> ? R : never) {
  return {
    type: resultado.type,
    content: resultado.type === 'options'
      ? (resultado as { question: string }).question
      : (resultado as { content: string }).content,
    options: resultado.type === 'options' ? resultado.options : null,
    fase: resultado.fase,
    isPreview: resultado.type === 'preview',
    isComplete: resultado.fase === 'completo',
    coletado: resultado.coletado,
    saving: resultado.saving,
    receita: resultado.receita,
  };
}

function getTiposProjeto(ctx: ProjetoContexto): ('saving' | 'receita_incremental')[] {
  if (ctx.tipos_projeto && ctx.tipos_projeto.length > 0) return ctx.tipos_projeto;
  if (ctx.tipo_projeto) return [ctx.tipo_projeto];
  return ['saving'];
}

// ─── Schemas de validação de entrada ────────────────────────────────────────

const iniciarSubmissaoSchema = z.object({
  responsavel_nome: z.string().min(1).max(120),
  responsavel_email: z.string().email().max(255),
  area_id: z.string().min(1).optional(),
  // A área não é mais escolhida no formulário — é derivada do email (TeamGuide)
  // na submissão (submeterParaValidacao). Aqui o projeto nasce sem área.
  area: z.string().min(1).max(100).optional(),
  ferramenta: z.string().min(1).max(200),
  escopo: z.enum(['interno', 'externo']).optional(),
  servico_externo: z.string().max(200).optional(),
  membros: z.array(z.string()).default([]),
  nome_projeto: z.string().min(1).max(200),
  data_criacao: z.string(),
  tipo_projeto: z.enum(['saving', 'receita_incremental']).optional(),
  tipos_projeto: z.array(z.enum(['saving', 'receita_incremental'])).optional(),
  descricao_breve: z.string().max(1000).optional(),
  // Projeto especial: altíssimo impacto que não se encaixa em saving/receita.
  // Quando true, o fluxo pula a análise financeira e o analisador IA (validação humana).
  especial: z.boolean().optional(),
  contexto_especial: z.string().max(2000).optional(),
  docs: z.array(
    z.object({ base64: z.string().min(1), filename: z.string().min(1) })
  ).min(1).max(5000),
});

const enviarMensagemSchema = z.object({
  projeto_id: z.string().min(1),
  content: z.string().min(1).max(4000),
  selected_option: z.number().optional(),
});

const iniciarSavingSchema = z.object({
  projeto_id: z.string().min(1),
  tipo_saving: z.enum(['mensal', 'pontual']),
  // Havia alguém fazendo/mantendo o processo manualmente antes da automação?
  alguem_fazia: z.enum(['sim', 'nao']).optional(),
  linhas: z.array(z.object({
    cargo: z.string(),
    horas_antes: z.number().min(0),
    horas_depois: z.number().min(0),
  })).optional(),
  custo_externo_mensal: z.number().min(0).optional(),
});

const iniciarReceitaSchema = z.object({
  projeto_id: z.string().min(1),
  tipo_saving: z.enum(['mensal', 'pontual']),
  // Valor de receita informado pela pessoa no formulário determinístico. O agente
  // recebe esse valor pré-preenchido e o DESAFIA (em vez de coletar do zero).
  valor_ganho_mensal: z.number().min(0).optional(),
  // Racional curto (de onde vem a receita) — ponto de partida para o agente aprofundar.
  racional: z.string().max(500).optional(),
});

const submeterValidacaoSchema = z.object({ projeto_id: z.string().min(1) });

// Monta a documentação de um projeto ESPECIAL sem nenhuma IA: usa a descrição
// breve (o que o projeto faz) e o contexto especial (por que é de alto impacto e
// difícil mensuração) que a pessoa escreveu. As demais seções (execução, fluxo,
// dependências…) não se aplicam a projetos fundacionais — ficam vazias/"—".
// O contexto especial também é enviado em campo próprio ao n8n (planilha).
function buildDocEspecial(data: {
  nome_projeto: string;
  responsavel_nome: string;
  responsavel_email: string;
  ferramenta: string;
  membros: string[];
  descricao_breve?: string;
  contexto_especial?: string;
}): DocumentacaoGerada {
  const descricao = data.descricao_breve?.trim() ?? '';
  const contexto = data.contexto_especial?.trim() ?? '';
  const oQueFaz =
    [descricao, contexto].filter(Boolean).join('\n\n') ||
    'Projeto de alto impacto e difícil mensuração — submetido para validação humana.';

  return {
    titulo: data.nome_projeto,
    responsavel: { nome: data.responsavel_nome, email: data.responsavel_email, area: null },
    ferramenta: data.ferramenta,
    membros: data.membros,
    o_que_faz: oQueFaz,
    execucao: '—',
    dependencias: [],
    fluxo: [],
    configurar_antes: [],
    atencao: [],
    gerado_em: new Date().toISOString(),
  };
}

// ─── Iniciar submissão ───────────────────────────────────────────────────────

export async function iniciarSubmissao(rawData: unknown) {
  const data = iniciarSubmissaoSchema.parse(rawData);
  log('iniciarSubmissao', `Iniciando para "${data.nome_projeto}" (${data.responsavel_email})`);

  let projeto;
  try {
    projeto = await insertProjeto({
      responsavel_nome: data.responsavel_nome,
      responsavel_email: data.responsavel_email,
      area_id: data.area_id ?? null,
      area: data.area ?? null,
      ferramenta: data.ferramenta,
      escopo: data.escopo ?? null,
      servico_externo: data.servico_externo ?? null,
      membros: data.membros,
      nome: data.nome_projeto,
      data_criacao_projeto: data.data_criacao,
      // Projeto especial: marca "Tipo de Projeto" como "especial" (banco + planilha)
      // e ignora os tipos financeiros — o fluxo não passa pelas fases de saving/receita.
      tipo_projeto: data.especial ? 'especial' : (data.tipo_projeto ?? null),
      tipos_projeto: data.especial ? ['especial'] : (data.tipos_projeto ?? null),
      descricao_breve: data.descricao_breve ?? null,
      especial: data.especial ?? false,
      contexto_especial: data.especial ? (data.contexto_especial ?? null) : null,
      status: 'rascunho',
    });
  } catch (projErr) {
    err('iniciarSubmissao', 'Falha ao criar projeto:', projErr);
    throw new Error(`Falha ao criar projeto: ${projErr instanceof Error ? projErr.message : 'erro desconhecido'}`);
  }
  log('iniciarSubmissao', `Projeto criado: ${projeto.id}`);

  let docTexto = '';
  try {
    docTexto = await extractTextFromMultipleFiles(data.docs);
    log('iniciarSubmissao', `Texto extraído de ${data.docs.length} arquivo(s): ${docTexto.length} chars`);
  } catch (extractErr) {
    err('iniciarSubmissao', 'Erro na extração de texto:', extractErr);
    docTexto = '';
  }

  await insertChatMessage({
    projeto_id: projeto.id,
    role: 'doc',
    content: docTexto || '(documento sem texto legível)',
  });

  // ── Projeto especial: pula o agente por completo ────────────────────────────
  // Projeto de alto impacto e difícil mensuração → não passa pela conversa, pela
  // análise financeira nem pelo analisador IA (validação é humana). A documentação
  // é montada direto da descrição + contexto especial (sem nenhuma chamada de IA) e
  // persistida, para que submeterParaValidacao tenha a doc exigida e o n8n receba o
  // objeto `documentacao`. O frontend chama submeter-validacao logo em seguida.
  if (data.especial) {
    const docEspecial = buildDocEspecial(data);
    await upsertDocumentacao(projeto.id, docEspecial);
    await updateProjeto(projeto.id, { chat_completo: true });
    log('iniciarSubmissao', `Projeto especial ${projeto.id}: doc montada sem IA, pronto para submissão.`);
    return { projeto_id: projeto.id, especial: true };
  }

  const ctx: ProjetoContexto = {
    responsavel_nome: data.responsavel_nome,
    responsavel_email: data.responsavel_email,
    area: null,
    ferramenta: data.ferramenta,
    membros: data.membros,
    nome_projeto: data.nome_projeto,
    data_criacao: data.data_criacao,
    doc_texto: docTexto || null,
    descricao_breve: data.descricao_breve ?? null,
    tipo_projeto: data.tipo_projeto ?? null,
    escopo: data.escopo ?? null,
  };

  let coletadoInicial: DocumentacaoColetada = {
    ...documentacaoVazia(),
    nome_projeto: data.nome_projeto,
  };

  if (docTexto || data.descricao_breve) {
    try {
      log('iniciarSubmissao', 'Rodando extrator automático...');
      coletadoInicial = await extrairCamposDocumentacao(ctx, docTexto || '');
      const preenchidos = Object.values(coletadoInicial).filter(v => v !== null).length;
      log('iniciarSubmissao', `Extrator: ${preenchidos}/7 campos preenchidos`);
    } catch (extractorErr) {
      err('iniciarSubmissao', 'Extrator falhou — continuando sem pré-preenchimento:', extractorErr);
      coletadoInicial = { ...documentacaoVazia(), nome_projeto: data.nome_projeto };
    }
  }

  log('iniciarSubmissao', 'Rodando orquestrador (fase doc)...');
  const resultado = await runOrchestrator(ctx, [], 'doc', coletadoInicial, savingVazio());

  await insertChatMessage({
    projeto_id: projeto.id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  const respContent = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 🆕 NOVA SUBMISSÃO: "${data.nome_projeto}"`);
  console.log(`│ 📄 Arquivos: ${data.docs.length} arquivo(s), ${docTexto ? docTexto.length + ' chars extraídos' : 'sem texto'}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoDocumentacao(resultado.coletado)}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return {
    projeto_id: projeto.id,
    response: formatResponse(resultado),
  };
}

// ─── Enviar mensagem ─────────────────────────────────────────────────────────

export async function enviarMensagem(rawData: unknown) {
  const data = enviarMensagemSchema.parse(rawData);
  log('enviarMensagem', `projeto=${data.projeto_id}`);

  // Histórico montado a partir das mensagens JÁ persistidas + o novo turno do
  // usuário (ainda NÃO persistido). Só gravamos a conversa depois que o turno é
  // concluído com sucesso — assim, se a compilação da doc falhar (ver abaixo),
  // nada fica salvo pela metade e o usuário pode simplesmente tentar de novo.
  const msgs = await getChatMessagesExcludeRole(data.projeto_id, 'doc');

  const estado = extrairEstado(msgs ?? []);

  let history: ChatHistoryMessage[];
  let resumoProjeto = '';
  if (estado.fase === 'saving' || estado.fase === 'saving_preview') {
    history = buildPhaseHistory(msgs ?? [], 'saving');
    resumoProjeto = extrairResumoProjeto(msgs ?? []);
  } else if (estado.fase === 'receita' || estado.fase === 'receita_preview') {
    history = buildPhaseHistory(msgs ?? [], 'receita');
    resumoProjeto = extrairResumoProjeto(msgs ?? []);
  } else {
    history = buildHistory(msgs ?? []);
  }
  history.push({ role: 'user', content: data.content });

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);
  log('enviarMensagem', `Fase: ${estado.fase}, histórico: ${history.length} msgs, tipos: ${tiposProjeto.join(',')}`);

  const resultado = await runOrchestrator(
    ctx,
    history,
    estado.fase,
    estado.coletado,
    estado.saving,
    resumoProjeto,
    tiposProjeto,
    estado.receita,
  );

  // ── SAFETY NET: memorial_calculo no objeto saving/receita ──────────────────
  // O LLM às vezes coloca o memorial apenas no campo "content" e deixa
  // saving.memorial_calculo / receita.memorial_calculo como null no JSON.
  // Isso faz o memorial virar "-" na planilha. Extraímos do content como fallback.
  if ((resultado.type === 'preview' || resultado.type === 'complete') && resultado.type !== 'options') {
    const conteudoMsg = (resultado as { content?: string }).content ?? '';
    const memorialTexto = conteudoMsg.replace(/\n+Está correto\?[\s\S]*$/, '').trim();
    if (memorialTexto.length > 50) {
      if ((estado.fase === 'saving' || estado.fase === 'saving_preview') &&
          resultado.saving && !resultado.saving.memorial_calculo) {
        resultado.saving = { ...resultado.saving, memorial_calculo: memorialTexto };
        log('enviarMensagem', 'memorial_calculo (saving) extraído do content — LLM não populou o campo');
      }
      if ((estado.fase === 'receita' || estado.fase === 'receita_preview') &&
          resultado.receita && !resultado.receita.memorial_calculo) {
        resultado.receita = { ...resultado.receita, memorial_calculo: memorialTexto };
        log('enviarMensagem', 'memorial_calculo (receita) extraído do content — LLM não populou o campo');
      }
    }
  }

  // ── VALIDAÇÃO ANTI-ZERO: safety net hardcoded ──────────────────────────────
  // Mesmo com prompts instruindo a IA, o LLM pode gerar complete/preview com
  // economia ou receita zeradas. Interceptamos aqui e forçamos volta à coleta.
  // Mutamos o resultado direto — são objetos locais, sem risco de side-effect.
  if (resultado.type === 'complete') {
    // Saving: economia_horas_mes NUNCA pode ser 0 ao completar
    if (tiposProjeto.includes('saving') && (estado.fase === 'saving_preview' || estado.fase === 'saving')) {
      const savingRecomputado = recomputarSavingFinanceiro(resultado.saving, 0);
      const econHoras = savingRecomputado.economia_horas_mes ?? 0;
      if (econHoras <= 0) {
        log('enviarMensagem', `⛔ Saving com economia_horas_mes=${econHoras} — bloqueando complete, forçando question`);
        Object.assign(resultado, {
          type: 'question',
          content: 'Não consigo finalizar o memorial com economia de 0h — o projeto precisa demonstrar algum ganho concreto de horas para ser submetido. Vamos revisar: em que etapa exatamente a automação economiza tempo comparado ao processo manual?',
          fase: 'saving',
        });
      }
    }

    // Receita: valor_ganho_mensal NUNCA pode ser 0 ao completar
    if (tiposProjeto.includes('receita_incremental') && (estado.fase === 'receita_preview' || estado.fase === 'receita')) {
      const ganho = resultado.receita?.valor_ganho_mensal ?? 0;
      if (ganho <= 0) {
        log('enviarMensagem', `⛔ Receita com valor_ganho_mensal=${ganho} — bloqueando complete, forçando question`);
        Object.assign(resultado, {
          type: 'question',
          content: 'Não consigo finalizar o memorial com ganho de R$ 0 — se o projeto gera receita incremental, preciso de um valor concreto. Vamos revisar: qual é o ganho real de receita que o projeto gera?',
          fase: 'receita',
        });
      }
    }
  }

  // Aprovação da documentação (doc_preview → impacto): a compilação da doc é o
  // CERNE do produto e é feita pelo agente — NÃO há fallback. Compilamos e
  // salvamos ANTES de confirmar a transição. Se a IA não devolver uma doc válida
  // (mesmo após os retries internos), compilarDocumentacao lança: abortamos o
  // turno SEM persistir nada, e o usuário continua no preview podendo aprovar de
  // novo (o frontend faz rollback da mensagem e exibe o erro).
  if ((resultado.fase === 'saving' || resultado.fase === 'receita') && estado.fase === 'doc_preview') {
    log('enviarMensagem', 'Doc aprovada — compilando documentação...');
    const doc = await compilarDocumentacao(ctx, resultado.coletado);
    await upsertDocumentacao(data.projeto_id, doc);
    log('enviarMensagem', 'Documentação compilada e salva.');
  }

  // Turno concluído com sucesso — agora sim persiste a mensagem do usuário e a resposta.
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'user',
    content: data.content,
    selected_option: data.selected_option ?? null,
  });

  // Se houve transição de fase (ex: doc_preview→saving), preserva a fase de
  // origem no JSON para que o Investigador agrupe a mensagem na fase correta.
  const persistido = resultado.fase !== estado.fase
    ? { ...resultado, fase_origem: estado.fase }
    : resultado;

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(persistido),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  if (resultado.fase === 'completo') {
    log('enviarMensagem', 'Fluxo completo — salvando dados financeiros...');
    const docRow = await getDocumentacao(data.projeto_id);

    if (docRow) {
      const doc = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;
      const tiposProjetoCtx = getTiposProjeto(ctx);
      if (tiposProjetoCtx.includes('saving')) {
        // R$ é sempre re-derivado das horas (o LLM pode ter reajustado horas sem
        // recalcular o valor) — ver recomputarSavingFinanceiro.
        const projetoCompleto = await getProjetoById(data.projeto_id);
        doc.saving = recomputarSavingFinanceiro(resultado.saving, projetoCompleto?.custo_externo_mensal ?? 0);
      }
      if (tiposProjetoCtx.includes('receita_incremental')) doc.receita = resultado.receita;
      await upsertDocumentacao(data.projeto_id, doc);
    }

    await updateProjeto(data.projeto_id, { chat_completo: true });
  }

  const respContent2 = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 💬 TURNO DE CONVERSA`);
  console.log(`│ 🔄 Fase: ${estado.fase} → ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoPorFase(resultado.fase, resultado.coletado, resultado.saving, resultado.receita ?? receitaVazia())}`);
  console.log('│ 👤 Usuário:');
  data.content.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('│ 🤖 IA:');
  respContent2.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  if (resultado.type === 'options') {
    console.log(`│ 📋 Opções: ${(resultado as { options: string[] }).options.join(' | ')}`);
  }
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Iniciar fase saving ─────────────────────────────────────────────────────

export async function iniciarSaving(rawData: unknown) {
  const data = iniciarSavingSchema.parse(rawData);
  log('iniciarSaving', `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  // Reinício limpo: se a pessoa voltou ao formulário determinístico e reenviou,
  // descarta a conversa anterior da fase saving (ancorada nos números antigos).
  // No primeiro início é no-op (ainda não há mensagens após o marcador).
  await deleteChatMessagesAfterFaseMarker(data.projeto_id, 'saving');

  // Persiste no projeto se havia trabalho manual antes (coluna mapeada no n8n/SQL).
  if (data.alguem_fazia) {
    await updateProjeto(data.projeto_id, { alguem_fazia: data.alguem_fazia });
  }

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  let saving = savingVazio();
  saving.tipo_saving = data.tipo_saving;

  if (tiposProjeto.includes('saving') && data.linhas && data.linhas.length > 0) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const linhas: SavingLinha[] = data.linhas.map((l) => {
      const valorHora = CARGOS.find(c => c.label === l.cargo)?.valor_hora ?? 0;
      const economiaHoras = Math.max(0, l.horas_antes - l.horas_depois);
      return {
        cargo: l.cargo,
        horas_antes: l.horas_antes,
        horas_depois: l.horas_depois,
        valor_hora: valorHora,
        economia_horas_mes: economiaHoras,
        economia_reais_mes: round2(economiaHoras * valorHora),
      };
    });
    const totalHoras = round2(linhas.reduce((s, l) => s + l.economia_horas_mes, 0));
    const totalReaisBruto = round2(linhas.reduce((s, l) => s + l.economia_reais_mes, 0));
    const custoExterno = data.custo_externo_mensal ?? 0;

    saving = {
      ...saving,
      linhas,
      economia_horas_mes: totalHoras,
      economia_reais_mes: round2(totalReaisBruto - custoExterno),
    };
  }

  const msgs = await getChatMessagesExcludeRole(data.projeto_id, 'doc');

  const resumoProjeto = extrairResumoProjeto(msgs ?? []);
  const estado = extrairEstado(msgs ?? []);

  const resultado = await runOrchestrator(
    ctx,
    [],
    'saving',
    estado.coletado,
    saving,
    resumoProjeto,
    tiposProjeto,
  );

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  const respContent = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 💰 INÍCIO SAVING: tipos_projeto=${tiposProjeto.join(',')}, tipo_saving=${data.tipo_saving}`);
  if (data.linhas?.length) console.log(`│ 👤 Linhas: ${data.linhas.map(l => `${l.cargo} ${l.horas_antes}→${l.horas_depois}h`).join(' | ')}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoSaving(resultado.saving)}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Iniciar fase receita incremental ────────────────────────────────────────

export async function iniciarReceita(rawData: unknown) {
  const data = iniciarReceitaSchema.parse(rawData);
  log('iniciarReceita', `projeto=${data.projeto_id}, tipo_saving=${data.tipo_saving}`);

  // Reinício limpo: se a pessoa voltou ao formulário determinístico e reenviou,
  // descarta a conversa anterior da fase receita. No primeiro início é no-op.
  await deleteChatMessagesAfterFaseMarker(data.projeto_id, 'receita');

  const ctx = await getProjetoContexto(data.projeto_id);
  const tiposProjeto = getTiposProjeto(ctx);

  const receita = receitaVazia();
  receita.tipo_saving = data.tipo_saving;
  receita.valor_ganho_mensal = data.valor_ganho_mensal ?? null;
  receita.racional = data.racional?.trim() || null;

  const msgs = await getChatMessagesExcludeRole(data.projeto_id, 'doc');

  const resumoProjeto = extrairResumoProjeto(msgs ?? []);
  const estado = extrairEstado(msgs ?? []);

  const resultado = await runOrchestrator(
    ctx,
    [],
    'receita',
    estado.coletado,
    estado.saving,
    resumoProjeto,
    tiposProjeto,
    receita,
  );

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  const respContent = resultado.type === 'options'
    ? (resultado as { question: string }).question
    : (resultado as { content: string }).content;
  console.log('\n┌─────────────────────────────────────────────');
  console.log(`│ 📈 INÍCIO RECEITA: tipos_projeto=${tiposProjeto.join(',')}, tipo_saving=${data.tipo_saving}, valor=${data.valor_ganho_mensal ?? '—'}, racional=${receita.racional ?? '—'}`);
  console.log(`│ 🔄 Fase: ${resultado.fase} | Tipo: ${resultado.type}`);
  console.log(`│ 📊 Progresso: ${progressoReceita(resultado.receita ?? receitaVazia())}`);
  console.log('│ 🤖 IA:');
  respContent.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('└─────────────────────────────────────────────\n');

  return formatResponse(resultado);
}

// ─── Atualizar tipos do projeto ──────────────────────────────────────────────
// Permite trocar o tipo (saving / receita_incremental) durante o fluxo do agente.
// O orquestrador e a submissão final leem tipos_projeto do banco, então a troca
// no formulário precisa persistir aqui para a fase de impacto refletir a mudança.

const atualizarTiposSchema = z.object({
  projeto_id: z.string().min(1),
  tipos_projeto: z.array(z.enum(['saving', 'receita_incremental'])).min(1),
});

export async function atualizarTipos(rawData: unknown) {
  const data = atualizarTiposSchema.parse(rawData);
  log('atualizarTipos', `projeto=${data.projeto_id}, tipos=${data.tipos_projeto.join(',')}`);
  await updateProjeto(data.projeto_id, {
    tipos_projeto: data.tipos_projeto,
    tipo_projeto: data.tipos_projeto[0],
  });
  return { ok: true };
}

// ─── Atualizar metadados do projeto durante o fluxo do agente ────────────────
// Pessoas voltam às etapas anteriores para corrigir contexto/arquivos/área/datas
// depois que o agente já começou. Os campos de TEXTO (descrição, nome, área,
// ferramenta, data, membros) são lidos frescos do banco a cada turno do agente
// (getProjetoContexto), então basta persisti-los aqui. Quando os ARQUIVOS mudam,
// a base da documentação muda: re-extraímos o texto, re-rodamos o extrator e
// REINICIAMOS a fase de doc (limpa a conversa) com uma nova primeira mensagem.

const atualizarMetadadosSchema = z.object({
  projeto_id: z.string().min(1),
  nome_projeto: z.string().min(1).max(200).optional(),
  area: z.string().min(1).max(100).optional(),
  ferramenta: z.string().min(1).max(200).optional(),
  membros: z.array(z.string()).optional(),
  data_criacao: z.string().optional(),
  descricao_breve: z.string().max(1000).optional(),
  // Projeto especial: contexto especial (entrada determinística da fase de doc).
  contexto_especial: z.string().max(2000).optional(),
  // Força reiniciar a documentação reusando os arquivos já enviados (sem novo upload).
  // Usado quando muda a entrada determinística do projeto especial (descrição/contexto).
  reset_doc: z.boolean().optional(),
  // Se enviados, substituem os arquivos e reiniciam a documentação.
  docs: z.array(
    z.object({ base64: z.string().min(1), filename: z.string().min(1) })
  ).max(5000).optional(),
});

export async function atualizarMetadados(rawData: unknown) {
  const data = atualizarMetadadosSchema.parse(rawData);
  const temDocs = !!data.docs && data.docs.length > 0;
  log('atualizarMetadados', `projeto=${data.projeto_id}, docs=${temDocs ? data.docs!.length : 0}`);

  // 1. Persiste os campos de texto fornecidos (o agente lê frescos no próximo turno).
  const campos: Record<string, unknown> = {};
  if (data.nome_projeto !== undefined) campos.nome = data.nome_projeto;
  if (data.area !== undefined) campos.area = data.area;
  if (data.ferramenta !== undefined) campos.ferramenta = data.ferramenta;
  if (data.membros !== undefined) campos.membros = data.membros;
  if (data.data_criacao !== undefined) campos.data_criacao_projeto = data.data_criacao;
  if (data.descricao_breve !== undefined) campos.descricao_breve = data.descricao_breve;
  if (data.contexto_especial !== undefined) campos.contexto_especial = data.contexto_especial;
  if (Object.keys(campos).length > 0) {
    await updateProjeto(data.projeto_id, campos);
  }

  // 2. Sem arquivos novos e sem pedido de reset → nada a reiniciar; o agente já vê
  // os metadados frescos no próximo turno.
  if (!temDocs && !data.reset_doc) {
    return { ok: true, reset: false };
  }

  // 3. Arquivos mudaram (ou reset_doc) → REINICIA a doc. Com novos arquivos, re-extrai
  // o texto; com reset_doc sem upload, reusa o texto já extraído (mensagem role=doc).
  let docTexto = '';
  if (temDocs) {
    try {
      docTexto = await extractTextFromMultipleFiles(data.docs!);
      log('atualizarMetadados', `Texto re-extraído de ${data.docs!.length} arquivo(s): ${docTexto.length} chars`);
    } catch (extractErr) {
      err('atualizarMetadados', 'Erro na re-extração de texto:', extractErr);
      docTexto = '';
    }
  } else {
    const docMsg = await getDocMessage(data.projeto_id);
    docTexto = docMsg?.content ?? '';
    log('atualizarMetadados', `reset_doc — reusando texto já extraído: ${docTexto.length} chars`);
  }

  // Limpa a conversa inteira (doc + impacto) — recomeçamos do zero.
  await deleteChatMessagesByProjeto(data.projeto_id);

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'doc',
    content: docTexto || '(documento sem texto legível)',
  });

  const ctx = await getProjetoContexto(data.projeto_id);

  let coletadoInicial: DocumentacaoColetada = {
    ...documentacaoVazia(),
    nome_projeto: ctx.nome_projeto,
  };
  if (docTexto || ctx.descricao_breve) {
    try {
      coletadoInicial = await extrairCamposDocumentacao(ctx, docTexto || '');
    } catch (extractorErr) {
      err('atualizarMetadados', 'Extrator falhou — seguindo sem pré-preenchimento:', extractorErr);
      coletadoInicial = { ...documentacaoVazia(), nome_projeto: ctx.nome_projeto };
    }
  }

  const resultado = await runOrchestrator(ctx, [], 'doc', coletadoInicial, savingVazio());

  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  log('atualizarMetadados', `Documentação reiniciada — fase: ${resultado.fase}`);
  return { ok: true, reset: true, response: formatResponse(resultado) };
}

// ─── Analisar projeto (pré-submissão) ───────────────────────────────────────

const analisarProjetoSchema = z.object({ projeto_id: z.string().min(1) });

export async function analisarProjetoFn(rawData: unknown) {
  const { projeto_id } = analisarProjetoSchema.parse(rawData);
  log('analisarProjeto', `projeto=${projeto_id}`);

  const resultado = await analisarProjetoAgent(projeto_id);

  await insertAnalise({
    projeto_id,
    resultado: resultado.resultado,
    pontuacao_total: resultado.pontuacao_total,
    pontuacao_maxima: resultado.pontuacao_maxima,
    justificativa: resultado.justificativa,
    resumo: resultado.resumo,
    criterios_hardcoded: resultado.criterios_hardcoded,
    criterios_dinamicos: resultado.criterios_dinamicos,
    complexidade_justificativa: resultado.complexidade_justificativa,
  });

  // Parecer da análise (campo `resumo`) → coluna "Observações". É uma mensagem de
  // STAFF (pontos de atenção), NÃO exibida ao usuário no front (gerava ansiedade).
  // Sem markdown na persistência (igual ao memorial).
  const observacoes = stripMarkdown(resultado.resumo || resultado.justificativa);

  // O veredito do analisador É a decisão de status (aprovado/rejeitado) — esta é a
  // função do analisador. Grava no projeto junto com complexidade e observações,
  // para o estado ficar correto de ponta a ponta (dashboard + planilha). Vale para
  // qualquer área, inclusive RPA (o veredito pode rebaixar uma auto-aprovação).
  const statusVeredito = resultado.resultado === 'aprovado' ? 'aprovado' : 'rejeitado';

  // Teto de materialidade: projetos acima de R$ 5k/mês exigem validação humana independente do veredito.
  const TETO_MATERIALIDADE_ANALISE = 5000;
  const materialidadeProjeto = calcularMaterialidade(
    conteudo.saving as Record<string, unknown> | undefined,
    conteudo.receita as Record<string, unknown> | undefined,
  );
  const statusFinal = materialidadeProjeto > TETO_MATERIALIDADE_ANALISE ? 'em_validacao' : statusVeredito;
  if (materialidadeProjeto > TETO_MATERIALIDADE_ANALISE) {
    log(`Materialidade R$ ${Math.round(materialidadeProjeto)}/mês > R$ ${TETO_MATERIALIDADE_ANALISE} → status forçado para em_validacao (analisador havia retornado '${statusVeredito}')`);
  }

  await updateProjeto(projeto_id, {
    complexidade: resultado.complexidade,
    observacoes,
    status: statusFinal,
    validated_at: new Date().toISOString(),
  });

  log('analisarProjeto', `Resultado: ${resultado.resultado} → status=${statusFinal} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`);

  // ── Enviar update ao n8n com dados da análise (atualiza linha na planilha pelo nome do projeto) ──
  const n8nUpdateUrl = process.env.N8N_WEBHOOK_URL_UPDATE;
  if (n8nUpdateUrl) {
    try {
      const projeto = await getProjetoById(projeto_id);
      // Status enviado é o VEREDITO do analisador (não o status de submissão):
      // aprovado → "Aprovado"; rejeitado → "Reenvio Pendente". Como é o veredito
      // recém-calculado neste mesmo request, não há risco de leitura defasada.
      const statusLabel = materialidadeProjeto > TETO_MATERIALIDADE_ANALISE ? 'Pendente' : (resultado.resultado === 'aprovado' ? 'Aprovado' : 'Reenvio Pendente');
      const updatePayload = {
        projeto: projeto?.nome ?? '',
        complexidade: resultado.complexidade,
        observacoes: observacoes ?? '',
        status: statusLabel,
      };

      const resp = await fetch(n8nUpdateUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });
      log('analisarProjeto', `n8n update respondeu ${resp.status}`);
    } catch (n8nErr) {
      err('analisarProjeto', 'Falha ao enviar update ao n8n:', n8nErr);
    }
  } else {
    log('analisarProjeto', 'N8N_WEBHOOK_URL_UPDATE não definida — update ao n8n pulado');
  }

  return resultado;
}

// ─── Submeter para validação ─────────────────────────────────────────────────

export async function submeterParaValidacao(rawData: unknown) {
  const { projeto_id } = submeterValidacaoSchema.parse(rawData);
  log('submeterParaValidacao', `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error('Documentação ainda não foi gerada. Conclua o chat primeiro.');

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;

  const projeto = await getProjetoById(projeto_id);

  if (!projeto) throw new Error('Projeto não encontrado.');

  // Rede de segurança: re-deriva R$ das horas antes de popular colunas/planilha.
  // Garante saving_reais correto mesmo que doc.saving tenha sido salvo com R$ zerado
  // por uma versão anterior ou por um turno que não passou pelo recálculo.
  if (conteudo.saving && typeof conteudo.saving === 'object') {
    conteudo.saving = recomputarSavingFinanceiro(
      conteudo.saving as SavingColetado,
      projeto.custo_externo_mensal ?? 0,
    );
  }
  const saving = conteudo.saving as Record<string, unknown> | undefined;
  const receita = conteudo.receita as Record<string, unknown> | undefined;

  if (projeto.nome) {
    const duplicata = await findDuplicateProjeto(projeto.nome, projeto_id);
    if (duplicata) {
      throw new Error(`Já existe um projeto submetido com o nome "${projeto.nome}".`);
    }
  }

  // ── Derivar a ÁREA pelo email do responsável (TeamGuide) ───────────────────
  // A pessoa não escolhe mais a área no formulário — derivamos do cadastro dela
  // na TeamGuide pelo email. Se não for encontrada (raríssimo — todo mundo está
  // cadastrado lá), a área vira o aviso "ÁREA NÃO IDENTIFICADA". Em caso de falha
  // da API (indisponibilidade), preservamos a área já gravada para não perder o
  // dado durante uma queda transitória.
  const AREA_NAO_IDENTIFICADA = 'ÁREA NÃO IDENTIFICADA';
  let areaFinal: string;
  try {
    const areaDerivada = await deriveAreaFromEmail(projeto.responsavel_email ?? '');
    areaFinal = areaDerivada ?? AREA_NAO_IDENTIFICADA;
    if (areaDerivada) {
      log('submeterParaValidacao', `Área derivada da TeamGuide: "${areaDerivada}" (${projeto.responsavel_email})`);
    } else {
      log('submeterParaValidacao', `Email não encontrado na TeamGuide → "${AREA_NAO_IDENTIFICADA}" (${projeto.responsavel_email})`);
    }
  } catch (tgErr) {
    err('submeterParaValidacao', 'TeamGuide indisponível ao derivar área — preservando área existente:', tgErr);
    areaFinal = projeto.area ?? AREA_NAO_IDENTIFICADA;
  }
  projeto.area = areaFinal;

  // Projeto especial nunca auto-aprova (nem na área RPA): a validação é humana,
  // então fica sempre 'em_validacao' (→ "Pendente" na planilha) até o humano avaliar.
  const ehEspecial = projeto.especial === 1;

  // Gate: bloqueia submissão com ganho zerado (skip projetos especiais)
  if (!ehEspecial) {
    const tiposProjetoGate = parseJson<string[]>(projeto.tipos_projeto) ?? [];
    if (tiposProjetoGate.includes('saving') &&
        (((saving?.economia_horas_mes as number) ?? 0) <= 0 || ((saving?.economia_reais_mes as number) ?? 0) <= 0)) {
      throw new Error(
        'Não é possível submeter este projeto como saving sem economia mensurável de horas. ' +
        'Uma troca de ferramenta que mantém a mesma rotina de trabalho não gera saving. ' +
        'Para submeter, comprove redução concreta de horas — ou reclassifique como receita incremental ou projeto especial.'
      );
    }
    if (tiposProjetoGate.includes('receita_incremental') &&
        (((receita?.valor_ganho_mensal as number) ?? 0) <= 0)) {
      throw new Error(
        'Não é possível submeter receita incremental com ganho de R$ 0. ' +
        'Revise o memorial de receita antes de enviar.'
      );
    }
  }

  // Teto de materialidade: projetos acima de R$ 5.000/mês vão sempre para validação humana.
  const TETO_MATERIALIDADE = 5000;
  const materialidade = calcularMaterialidade(saving, receita);
  const status = ehEspecial || materialidade > TETO_MATERIALIDADE
    ? 'em_validacao'
    : (projeto.area === 'RPA' ? 'aprovado' : 'em_validacao');
  if (materialidade > TETO_MATERIALIDADE) {
    log('submeterParaValidacao', `Materialidade R$ ${Math.round(materialidade)}/mês > R$ ${TETO_MATERIALIDADE} → em_validacao (validação humana obrigatória)`);
  }
  const now = new Date().toISOString();

  // ── Calcular ganho_total_mensal (saving mensalizado + receita/10 mensalizada) ──
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const savingTipo = (saving?.tipo_saving as string) ?? 'mensal';
  const savingMensal = savingTipo === 'pontual' ? savingReais / 12 : savingReais;

  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  const receitaTipo = (receita?.tipo_saving as string) ?? 'mensal';
  const receitaMensal = receitaTipo === 'pontual' ? receitaValor / 12 : receitaValor;
  const receitaEquivalente = receitaMensal / 10;

  const ganhoTotalMensal = savingMensal + receitaEquivalente;

  // Memorial sem markdown na persistência (Sheets/SQLite) — mantém quebras de linha,
  // remove `**`, `#`, backticks, etc. O markdown cru fica em documentacao.conteudo.
  const memorialLimpo = stripMarkdown(saving?.memorial_calculo as string | undefined);
  const receitaMemorialLimpo = stripMarkdown(receita?.memorial_calculo as string | undefined);

  await updateProjeto(projeto_id, {
    status,
    // Área derivada do email vira a fonte de verdade. Zera area_id para que o
    // area_nome (join por area_id, fallback p.area) reflita a área derivada.
    area: areaFinal,
    area_id: null,
    submitted_at: now,
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    saving_reais: (saving?.economia_reais_mes as number) ?? null,
    tipo_saving: (saving?.tipo_saving as string) ?? null,
    memorial_calculo: memorialLimpo,
    ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
  });

  log('submeterParaValidacao', `Status: ${status}`);

  // ── Enviar dados ao n8n (registra na planilha + Drive + notifica Google Chat) ──
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
  if (n8nWebhookUrl) {
    try {
      const membros = parseJson<string[]>(projeto.membros) ?? [];
      const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];

      // Campos de texto/categóricos sem informação chegam na planilha como "—"
      // (em vez de célula em branco). Não aplicar a numéricos — 0 é valor real
      // e vira "—" quebraria somas/fórmulas no Sheets.
      const ouTraco = (v: string | null | undefined): string =>
        v != null && v.trim() !== '' ? v : '—';

      const n8nPayload = {
        projeto_id: projeto_id,
        responsavel_nome: ouTraco(projeto.responsavel_nome),
        responsavel_email: ouTraco(projeto.responsavel_email),
        area: ouTraco(projeto.area),
        ferramenta: ouTraco(projeto.ferramenta),
        escopo: ouTraco(projeto.escopo),
        membros,
        nome_projeto: ouTraco(projeto.nome),
        descricao_breve: ouTraco(projeto.descricao_breve),
        // NÃO usar ouTraco aqui: o n8n já converte data ausente em "—" (ramo
        // falsy do ternário "Formatar Dados"). Mandar "—" cairia no split("-")
        // e geraria "undefined/undefined/—". Enviar a data crua ou null.
        data_criacao_projeto: projeto.data_criacao_projeto ?? null,
        tipos_projeto: tiposProjeto,
        // Flag do projeto especial + contexto coletado na etapa 2.5 (validação humana).
        especial: ehEspecial,
        contexto_especial: ouTraco(projeto.contexto_especial),
        status: status === 'aprovado' ? 'Aprovado' : 'Pendente',
        saving_horas: (saving?.economia_horas_mes as number) ?? 0,
        saving_reais: (saving?.economia_reais_mes as number) ?? 0,
        tipo_saving: ouTraco(saving?.tipo_saving as string | undefined),
        memorial_calculo: ouTraco(memorialLimpo),
        // Havia pessoa fazendo o processo manualmente antes da automação? ('sim'|'nao'|'')
        alguem_fazia: ouTraco(projeto.alguem_fazia),
        custo_externo_mensal: projeto.custo_externo_mensal ?? 0,
        saving_linhas: JSON.stringify(saving?.linhas ?? []),
        receita_valor_mensal: (receita?.valor_ganho_mensal as number) ?? 0,
        tipo_receita: ouTraco(receita?.tipo_saving as string | undefined),
        receita_memorial: ouTraco(receitaMemorialLimpo),
        ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : 0,
        documentacao: conteudo,
      };

      const n8nResp = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(n8nPayload),
      });
      const n8nResult = await n8nResp.json().catch(() => null);
      log('submeterParaValidacao', `n8n respondeu ${n8nResp.status}:`, n8nResult);
    } catch (n8nErr) {
      err('submeterParaValidacao', 'Falha ao enviar dados ao n8n:', n8nErr);
    }
  }

  return { ok: true, status };
}

// ─── Validar projeto ─────────────────────────────────────────────────────────

export async function validarProjeto(rawData: unknown) {
  const { projeto_id } = z.object({ projeto_id: z.string().min(1) }).parse(rawData);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error('Documentação não encontrada.');

  const doc = parseJson<Parameters<typeof validarDocumentacao>[0]>(docRow.conteudo) as Parameters<typeof validarDocumentacao>[0];
  const resultado = await validarDocumentacao(doc);

  await insertValidacao({
    projeto_id,
    resultado: resultado.resultado,
    parecer: resultado.parecer,
    criterios: resultado.criterios,
  });

  const novoStatus = resultado.resultado === 'aprovado' ? 'validado' : 'rejeitado';
  await updateProjeto(projeto_id, { status: novoStatus, validated_at: new Date().toISOString() });

  try {
    if (resultado.resultado === 'aprovado') {
      await enviarEmailAprovacao(doc, resultado);
    } else {
      await enviarEmailRejeicao(doc, resultado);
    }
    await updateValidacaoEmailEnviado(projeto_id);
  } catch (emailErr) {
    console.error('[email-agent] Falha ao enviar email:', emailErr);
  }

  return { resultado: resultado.resultado, parecer: resultado.parecer };
}
