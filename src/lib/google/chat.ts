// Notificação via webhook do Google Chat (não precisa de auth Google — URL contém key+token).

// Projetos de teste E2E (nome com prefixo "[E2E-") NÃO notificam o Google Chat —
// o harness de validação roda contra produção e gravaria N pings no espaço do time.
// A gravação na planilha continua normal (é o alvo da validação); só o Chat é mudo.
// Ver scripts/e2e/ e CLAUDE.md. Reverter junto com o harness quando a validação terminar.
export function ehProjetoTesteE2E(nome: string | null | undefined): boolean {
  return typeof nome === 'string' && nome.startsWith('[E2E-');
}

export async function sendChatNotification(message: string): Promise<void> {
  const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[google/chat] GOOGLE_CHAT_WEBHOOK_URL não configurada, pulando notificação');
    return;
  }

  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    console.error(`[google/chat] Falha ao enviar notificação (${resp.status}): ${body}`);
  }
}

// ─── Builders de mensagem ─────────────────────────────────────────────────

const SEPARATOR = '──────────────────────';
const SHEETS_URL = 'https://docs.google.com/spreadsheets/d/1xS2zIMu-PGiqxUDOnLNXTqSzUzPlJsQW0_R1Z_4Cxnk';

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildSubmitMessage(p: {
  projeto: string;
  area: string;
  ferramenta: string;
  escopo: string;
  tipos: string;
  nomeCompleto: string;
  email: string;
  participantes: string;
  descricao: string;
  savingHoras: number;
  savingReais: number;
  tipoSaving: string;
  receitaValor: number;
  tipoReceita: string;
  dataSubmissao: string;
}): string {
  const lines = [
    SEPARATOR,
    '',
    '\u{1F6A8} *Novo fluxo de automação cadastrado – aprovação aguardando análise*',
    '',
    `\u{1F4CC} *Projeto:* ${p.projeto}`,
    `\u{1F3F7}\uFE0F *Área:* ${p.area}`,
    `\u{1F6E0}\uFE0F *Ferramenta:* ${p.ferramenta}`,
    `\u{1F4CB} *Escopo:* ${p.escopo}`,
    `\u{1F4C2} *Tipos:* ${p.tipos}`,
    '',
    `\u{1F464} *Solicitante:* ${p.nomeCompleto}`,
    `\u{1F4E7} *E-mail:* ${p.email}`,
    `\u{1F465} *Participantes:* ${p.participantes || '\u2014'}`,
    '',
    `\u{1F4DD} *Descrição resumida:*`,
    p.descricao,
    '',
    `\u23F1\uFE0F *Saving estimado (horas/mês):* ${formatBRL(p.savingHoras)} horas`,
    `\u{1F4B0} *Saving estimado (R$/mês):* R$ ${formatBRL(p.savingReais)}`,
    `\u{1F4CA} *Tipo de saving:* ${p.tipoSaving}`,
  ];

  if (p.receitaValor > 0) {
    lines.push('');
    lines.push(`\u{1F4C8} *Receita incremental/mês:* R$ ${formatBRL(p.receitaValor)}`);
    lines.push(`\u{1F4CA} *Tipo de receita:* ${p.tipoReceita}`);
  }

  lines.push(
    '',
    `\u{1F4C5} *Data da submissão:* ${p.dataSubmissao}`,
    `\u{1F4CA} *Status atual:* Aguardando análise da IA`,
    '',
    `*Link da planilha de automações*: ${SHEETS_URL}`,
    '',
    SEPARATOR,
  );

  return lines.join('\n');
}

export function buildUpdateMessage(p: {
  projeto: string;
  status: string;
}): string {
  let emoji: string;
  let label: string;

  if (p.status === 'Aprovado') {
    emoji = '\u2705';
    label = 'Fluxo de automação aprovado';
  } else if (p.status === 'Pendente') {
    emoji = '\u{1F6A8}';
    label = 'Novo fluxo de automação cadastrado – Análise Pendente';
  } else {
    emoji = '\u{1F504}';
    label = 'Fluxo de automação reenviado para aprovação';
  }

  return [
    SEPARATOR,
    '',
    `${emoji} *${label}*`,
    `\u{1F4CC} *Projeto:* ${p.projeto}`,
    '',
    SEPARATOR,
  ].join('\n');
}
