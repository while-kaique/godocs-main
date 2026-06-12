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
  getLatestAnalise,
  parseJson,
} from '@/integrations/db/client.server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import { compilarDocumentacao } from '@/lib/agents/doc-compiler';
import { validarDocumentacao } from '@/lib/agents/validator';
import { analisarProjeto as analisarProjetoAgent } from '@/lib/agents/analyzer';
import { enviarEmailAprovacao, enviarEmailRejeicao } from '@/lib/agents/email-agent';
import { extractTextFromMultipleFiles } from '@/lib/extract-text.server';
import { extrairCamposDocumentacao } from '@/lib/agents/extractor';
import type {
  ChatFase,
  ChatHistoryMessage,
  DocumentacaoColetada,
  ProjetoContexto,
  ReceitaColetada,
  SavingColetado,
  SavingLinha,
} from '@/lib/agents/types';
import { documentacaoVazia, receitaVazia, savingVazio, CARGOS } from '@/lib/agents/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  area: z.string().min(1).max(100),
  ferramenta: z.string().min(1).max(200),
  escopo: z.enum(['interno', 'externo']).optional(),
  servico_externo: z.string().max(200).optional(),
  membros: z.array(z.string()).default([]),
  nome_projeto: z.string().min(1).max(200),
  data_criacao: z.string(),
  tipo_projeto: z.enum(['saving', 'receita_incremental']).optional(),
  tipos_projeto: z.array(z.enum(['saving', 'receita_incremental'])).optional(),
  descricao_breve: z.string().max(1000).optional(),
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
      area: data.area,
      ferramenta: data.ferramenta,
      escopo: data.escopo ?? null,
      servico_externo: data.servico_externo ?? null,
      membros: data.membros,
      nome: data.nome_projeto,
      data_criacao_projeto: data.data_criacao,
      tipo_projeto: data.tipo_projeto ?? null,
      tipos_projeto: data.tipos_projeto ?? null,
      descricao_breve: data.descricao_breve ?? null,
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
  await insertChatMessage({
    projeto_id: data.projeto_id,
    role: 'assistant',
    content: JSON.stringify(resultado),
    options: resultado.type === 'options' ? resultado.options : null,
  });

  if (resultado.fase === 'completo') {
    log('enviarMensagem', 'Fluxo completo — salvando dados financeiros...');
    const docRow = await getDocumentacao(data.projeto_id);

    if (docRow) {
      const doc = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;
      const tiposProjetoCtx = getTiposProjeto(ctx);
      if (tiposProjetoCtx.includes('saving')) doc.saving = resultado.saving;
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
  console.log('│ 👤 Usuário:');
  data.content.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  console.log('│ 🤖 IA:');
  respContent2.split('\n').forEach((line: string) => console.log(`│    ${line}`));
  if (resultado.type === 'options') {
    console.log(`│ 📋 Opções: ${(resultado as { options: string[] }).options.join(' | ')}`);
  }
  const campos = resultado.coletado;
  const preenchidos = Object.entries(campos).filter(([, v]) => v !== null).map(([k]) => k);
  const vazios = Object.entries(campos).filter(([, v]) => v === null).map(([k]) => k);
  console.log(`│ ✅ Preenchidos: ${preenchidos.join(', ') || 'nenhum'}`);
  console.log(`│ ❌ Faltando: ${vazios.join(', ') || 'nenhum'}`);
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
  if (Object.keys(campos).length > 0) {
    await updateProjeto(data.projeto_id, campos);
  }

  // 2. Sem arquivos novos → nada a reiniciar; o agente já vê os metadados frescos.
  if (!temDocs) {
    return { ok: true, reset: false };
  }

  // 3. Arquivos mudaram → re-extrai texto, re-roda o extrator e REINICIA a doc.
  let docTexto = '';
  try {
    docTexto = await extractTextFromMultipleFiles(data.docs!);
    log('atualizarMetadados', `Texto re-extraído de ${data.docs!.length} arquivo(s): ${docTexto.length} chars`);
  } catch (extractErr) {
    err('atualizarMetadados', 'Erro na re-extração de texto:', extractErr);
    docTexto = '';
  }

  // Limpa a conversa inteira (doc + impacto) — a base mudou, recomeçamos do zero.
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
  });

  // Persiste a complexidade no projeto
  await updateProjeto(projeto_id, { complexidade: resultado.complexidade });

  log('analisarProjeto', `Resultado: ${resultado.resultado} (${resultado.pontuacao_total}/${resultado.pontuacao_maxima}, complexidade=${resultado.complexidade})`);

  return resultado;
}

// ─── Submeter para validação ─────────────────────────────────────────────────

export async function submeterParaValidacao(rawData: unknown) {
  const { projeto_id } = submeterValidacaoSchema.parse(rawData);
  log('submeterParaValidacao', `projeto=${projeto_id}`);

  const docRow = await getDocumentacao(projeto_id);

  if (!docRow) throw new Error('Documentação ainda não foi gerada. Conclua o chat primeiro.');

  const conteudo = (parseJson<Record<string, unknown>>(docRow.conteudo) ?? {}) as Record<string, unknown>;
  const saving = conteudo.saving as Record<string, unknown> | undefined;

  const projeto = await getProjetoById(projeto_id);

  if (!projeto) throw new Error('Projeto não encontrado.');

  if (projeto.nome) {
    const duplicata = await findDuplicateProjeto(projeto.nome, projeto_id);
    if (duplicata) {
      throw new Error(`Já existe um projeto submetido com o nome "${projeto.nome}".`);
    }
  }

  const status = projeto.area === 'RPA' ? 'aprovado' : 'em_validacao';
  const now = new Date().toISOString();

  // ── Calcular ganho_total_mensal (saving mensalizado + receita/10 mensalizada) ──
  const receita = conteudo.receita as Record<string, unknown> | undefined;
  const savingReais = (saving?.economia_reais_mes as number) ?? 0;
  const savingTipo = (saving?.tipo_saving as string) ?? 'mensal';
  const savingMensal = savingTipo === 'pontual' ? savingReais / 12 : savingReais;

  const receitaValor = (receita?.valor_ganho_mensal as number) ?? 0;
  const receitaTipo = (receita?.tipo_saving as string) ?? 'mensal';
  const receitaMensal = receitaTipo === 'pontual' ? receitaValor / 12 : receitaValor;
  const receitaEquivalente = receitaMensal / 10;

  const ganhoTotalMensal = savingMensal + receitaEquivalente;

  await updateProjeto(projeto_id, {
    status,
    submitted_at: now,
    saving_horas: (saving?.economia_horas_mes as number) ?? null,
    saving_reais: (saving?.economia_reais_mes as number) ?? null,
    tipo_saving: (saving?.tipo_saving as string) ?? null,
    memorial_calculo: (saving?.memorial_calculo as string) ?? null,
    ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : null,
  });

  log('submeterParaValidacao', `Status: ${status}`);

  // ── Carregar análise do Agente Analisador (se existir) ──
  const analise = await getLatestAnalise(projeto_id);
  const analiseResultado = analise?.resultado ?? null;

  // ── Enviar dados ao n8n (registra na planilha + Drive + notifica Google Chat) ──
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
  if (n8nWebhookUrl) {
    try {
      const membros = parseJson<string[]>(projeto.membros) ?? [];
      const tiposProjeto = parseJson<string[]>(projeto.tipos_projeto) ?? [];

      const n8nPayload = {
        projeto_id: projeto_id,
        responsavel_nome: projeto.responsavel_nome,
        responsavel_email: projeto.responsavel_email,
        area: projeto.area ?? '—',
        ferramenta: projeto.ferramenta,
        escopo: projeto.escopo ?? null,
        membros,
        nome_projeto: projeto.nome ?? '',
        descricao_breve: projeto.descricao_breve ?? '',
        data_criacao_projeto: projeto.data_criacao_projeto ?? null,
        tipos_projeto: tiposProjeto,
        status: analiseResultado === 'rejeitado' ? 'Em Revisão' : (status === 'aprovado' ? 'Aprovado' : 'Pendente'),
        saving_horas: (saving?.economia_horas_mes as number) ?? 0,
        saving_reais: (saving?.economia_reais_mes as number) ?? 0,
        tipo_saving: (saving?.tipo_saving as string) ?? '',
        memorial_calculo: (saving?.memorial_calculo as string) ?? '',
        custo_externo_mensal: projeto.custo_externo_mensal ?? 0,
        saving_linhas: JSON.stringify(saving?.linhas ?? []),
        receita_valor_mensal: (receita?.valor_ganho_mensal as number) ?? 0,
        receita_tipo_saving: (receita?.tipo_saving as string) ?? '',
        receita_memorial: (receita?.memorial_calculo as string) ?? '',
        ganho_total_mensal: ganhoTotalMensal > 0 ? Math.round(ganhoTotalMensal * 100) / 100 : 0,
        complexidade: projeto.complexidade ?? null,
        documentacao: conteudo,
        // Dados da análise IA
        analise_resultado: analiseResultado,
        analise_pontuacao_total: analise?.pontuacao_total ?? null,
        analise_pontuacao_maxima: analise?.pontuacao_maxima ?? null,
        analise_justificativa: analise?.justificativa ?? null,
        analise_criterios: analise ? JSON.stringify({
          hardcoded: parseJson(analise.criterios_hardcoded),
          dinamicos: parseJson(analise.criterios_dinamicos),
        }) : null,
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
