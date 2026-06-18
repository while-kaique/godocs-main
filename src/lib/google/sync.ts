// Orquestrador: sync fire-and-forget para Google Sheets + Chat.
// Chamado por chat.functions.ts após submissão/análise de projetos.
// Nunca propaga erros — tudo é logado via console.error.

import type { ProjetoRow } from '@/integrations/db/client.server';
import { appendRow, updateRowByProjectName } from './sheets';
import { sendChatNotification, buildSubmitMessage, buildUpdateMessage } from './chat';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ouTraco = (v: string | null | undefined): string =>
  v != null && v.trim() !== '' ? v : '\u2014';

function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return '\u2014';
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
  projectName: string;
  complexidade: string;
  observacoes: string;
  status: string;
};

// ─── Submit: Drive → Sheets → Chat (fire-and-forget) ────────────────────────

export async function syncSubmitToGoogle(p: SubmitSyncParams): Promise<void> {
  try {
    const dataSubmissao = nowFortaleza();
    const dataCriacao = formatDateBR(p.projeto.data_criacao_projeto);
    const participantes = p.membros.join(', ') || '\u2014';
    const tiposStr = p.tiposProjeto.join(', ') || '\u2014';

    const savingHoras = (p.saving?.economia_horas_mes as number) ?? 0;
    const savingReais = (p.saving?.economia_reais_mes as number) ?? 0;
    const receitaValor = (p.receita?.valor_ganho_mensal as number) ?? 0;
    const ganhoTotal = p.ganhoTotalMensal > 0 ? Math.round(p.ganhoTotalMensal * 100) / 100 : 0;

    // 1. Append na planilha (26 colunas na ordem exata)
    const values: (string | number)[] = [
      /* 0  Data Submissão          */ dataSubmissao,
      /* 1  Data Criação            */ dataCriacao,
      /* 2  Área                    */ p.area,
      /* 3  Nome Completo           */ ouTraco(p.projeto.responsavel_nome),
      /* 4  Participantes           */ participantes,
      /* 5  Email                   */ ouTraco(p.projeto.responsavel_email),
      /* 6  Ferramenta              */ ouTraco(p.projeto.ferramenta),
      /* 7  Projeto                 */ ouTraco(p.projeto.nome),
      /* 8  Descrição               */ ouTraco(p.projeto.descricao_breve),
      /* 9  URL                     */ '\u2014',
      /* 10 Escopo                  */ ouTraco(p.projeto.escopo),
      /* 11 Tipos Projeto           */ tiposStr,
      /* 12 Saving Horas            */ savingHoras,
      /* 13 Saving Reais            */ savingReais,
      /* 14 Tipo de Saving          */ ouTraco(p.saving?.tipo_saving as string | undefined),
      /* 15 Memorial de Saving      */ ouTraco(p.memorialLimpo),
      /* 16 Custo Externo Mensal    */ p.projeto.custo_externo_mensal ?? 0,
      /* 17 Receita Mensal          */ receitaValor,
      /* 18 Receita Memorial        */ ouTraco(p.receitaMemorialLimpo),
      /* 19 Status                  */ p.status,
      /* 20 ID Projeto              */ p.projetoId,
      /* 21 Ganho Total             */ ganhoTotal,
      /* 22 Tipo de Receita         */ ouTraco(p.receita?.tipo_saving as string | undefined),
      /* 23 Alguém Fazia?           */ ouTraco(p.projeto.alguem_fazia),
      /* 24 Contexto Projeto Esp.   */ ouTraco(p.projeto.contexto_especial),
      /* 25 Especial?               */ p.projeto.especial === 1 ? 'Sim' : 'Não',
    ];

    try {
      await appendRow(values);
    } catch (sheetsErr) {
      console.error('[google/sync] Falha ao append na planilha:', sheetsErr);
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
    // 1. Update na planilha
    try {
      await updateRowByProjectName(p.projectName, {
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
