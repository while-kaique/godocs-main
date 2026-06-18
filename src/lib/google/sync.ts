// Orquestrador: sync fire-and-forget para Google Sheets + Chat.
// Chamado por chat.functions.ts após submissão/análise de projetos.
// Nunca propaga erros — tudo é logado via console.error.

import type { ProjetoRow } from '@/integrations/db/client.server';
import { appendRow, updateRowByProjectId, type SheetColumn } from './sheets';
import { sendChatNotification, buildSubmitMessage, buildUpdateMessage } from './chat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ouTraco = (v: string | null | undefined): string =>
  v != null && v.trim() !== '' ? v : '—';

function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function nowFortaleza(): string {
  const now = new Date();
  const utcMs = now.getTime();
  const fortalezaMs = utcMs - 3 * 60 * 60 * 1000;
  const d = new Date(fortalezaMs);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ─── Tipos dos parâmetros de sync ────────────────────────────────────────────

export type SubmitSyncParams = {
  projetoId: string;
  modo: 'novo' | 'edicao';
  projeto: ProjetoRow;
  conteudo: Record<string, unknown>;
  saving: Record<string, unknown> | null | undefined;
  receita: Record<string, unknown> | null | undefined;
  membros: string[];
  tiposProjeto: string[];
  status: 'Aprovado' | 'Pendente';
  area: string;
  memorialLimpo: string;
  receitaMemorialLimpo: string;
  ganhoTotalMensal: number;
};

export type UpdateSyncParams = {
  projetoId: string;
  projectName: string;
  complexidade: string;
  observacoes: string;
  status: string;
};

// ─── Submit: Sheets → Chat (fire-and-forget) ────────────────────────────────

export async function syncSubmitToGoogle(p: SubmitSyncParams): Promise<void> {
  try {
    const dataSubmissao = nowFortaleza();
    const dataCriacao = formatDateBR(p.projeto.data_criacao_projeto);
    const participantes = p.membros.join(', ') || '—';
    const tiposStr = p.tiposProjeto.join(', ') || '—';

    const savingHoras = (p.saving?.economia_horas_mes as number) ?? 0;
    const savingReais = (p.saving?.economia_reais_mes as number) ?? 0;
    const receitaValor = (p.receita?.valor_ganho_mensal as number) ?? 0;
    const ganhoTotal = p.ganhoTotalMensal > 0 ? Math.round(p.ganhoTotalMensal * 100) / 100 : 0;

    // Colunas preenchidas pelo sistema na submissão. As colunas manuais
    // (Diff*/Memorial anterior) e as do analisador (Complexidade/Observações)
    // são deliberadamente omitidas — não são escritas aqui.
    const row: Partial<Record<SheetColumn, string | number>> = {
      'Data Submissão': dataSubmissao,
      'ID Projeto': p.projetoId,
      'Data Criação': dataCriacao,
      'Área': p.area,
      'Nome Completo': ouTraco(p.projeto.responsavel_nome),
      'Email': ouTraco(p.projeto.responsavel_email),
      'Projeto': ouTraco(p.projeto.nome),
      'Participantes': participantes,
      'Descrição': ouTraco(p.projeto.descricao_breve),
      'URL': '—',
      'Ferramenta': ouTraco(p.projeto.ferramenta),
      'Escopo': ouTraco(p.projeto.escopo),
      'Tipos Projeto': tiposStr,
      'Alguém Fazia?': ouTraco(p.projeto.alguem_fazia),
      'Saving Horas': savingHoras,
      'Saving Reais': savingReais,
      'Tipo de Saving': ouTraco(p.saving?.tipo_saving as string | undefined),
      'Memorial de Saving': ouTraco(p.memorialLimpo),
      'Custo Externo Mensal': p.projeto.custo_externo_mensal ?? 0,
      'Receita Mensal': receitaValor,
      'Tipo de Receita': ouTraco(p.receita?.tipo_saving as string | undefined),
      'Receita Memorial': ouTraco(p.receitaMemorialLimpo),
      'Status': p.status,
      'Ganho Total': ganhoTotal,
      'Contexto do Projeto Especial': ouTraco(p.projeto.contexto_especial),
      'Especial?': p.projeto.especial === 1 ? 'Sim' : 'Não',
      'Custo Evitado': ouTraco(p.projeto.custo_evitado),
      'Justificativa Custo Evitado': ouTraco(p.projeto.custo_evitado_justificativa),
    };

    // Edição: atualiza a linha existente (match por ID Projeto). Nunca faz append
    // — só dá pra editar um projeto que já está na planilha. Nova: append.
    try {
      if (p.modo === 'edicao') {
        await updateRowByProjectId(p.projetoId, row);
      } else {
        await appendRow(row);
      }
    } catch (sheetsErr) {
      console.error(
        `[google/sync] Falha ao ${p.modo === 'edicao' ? 'atualizar' : 'inserir'} na planilha:`,
        sheetsErr,
      );
    }

    // 2. Notificação Google Chat
    try {
      const message = buildSubmitMessage({
        projeto: ouTraco(p.projeto.nome),
        area: p.area,
        ferramenta: ouTraco(p.projeto.ferramenta),
        escopo: ouTraco(p.projeto.escopo),
        tipos: tiposStr,
        nomeCompleto: ouTraco(p.projeto.responsavel_nome),
        email: ouTraco(p.projeto.responsavel_email),
        participantes,
        descricao: ouTraco(p.projeto.descricao_breve),
        savingHoras,
        savingReais,
        tipoSaving: ouTraco(p.saving?.tipo_saving as string | undefined),
        receitaValor,
        tipoReceita: ouTraco(p.receita?.tipo_saving as string | undefined),
        dataSubmissao,
      });
      await sendChatNotification(message);
    } catch (chatErr) {
      console.error('[google/sync] Falha ao notificar Google Chat:', chatErr);
    }
  } catch (e) {
    console.error('[google/sync] Erro inesperado no syncSubmitToGoogle:', e);
  }
}

// ─── Update: Sheets + Chat (fire-and-forget) ────────────────────────────────

export async function syncUpdateToGoogle(p: UpdateSyncParams): Promise<void> {
  try {
    // 1. Update na planilha (match por ID Projeto — estável e único)
    try {
      await updateRowByProjectId(p.projetoId, {
        'Complexidade': p.complexidade,
        'Observações': p.observacoes,
        'Status': p.status,
      });
    } catch (sheetsErr) {
      console.error('[google/sync] Falha ao update na planilha:', sheetsErr);
    }

    // 2. Notificação Google Chat
    try {
      const message = buildUpdateMessage({
        projeto: p.projectName,
        status: p.status,
      });
      await sendChatNotification(message);
    } catch (chatErr) {
      console.error('[google/sync] Falha ao notificar Google Chat:', chatErr);
    }
  } catch (e) {
    console.error('[google/sync] Erro inesperado no syncUpdateToGoogle:', e);
  }
}
