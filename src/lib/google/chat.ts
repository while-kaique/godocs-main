// Notificação via webhook do Google Chat (não precisa de auth Google — URL contém key+token).

// Projetos de teste E2E (nome com prefixo "[E2E-") NÃO notificam o Google Chat —
// o harness de validação roda contra produção e gravaria N pings no espaço do time.
// A gravação na planilha continua normal (é o alvo da validação); só o Chat é mudo.
// Ver scripts/e2e/ e CLAUDE.md. Reverter junto com o harness quando a validação terminar.
export function ehProjetoTesteE2E(nome: string | null | undefined): boolean {
  return typeof nome === 'string' && nome.startsWith('[E2E-');
}

// Envia uma notificação de texto a um espaço do Google Chat. Por padrão usa o
// webhook de PROJETOS (GOOGLE_CHAT_WEBHOOK_URL); `opts.webhookUrl` permite apontar
// para outro espaço (ex.: o webhook do widget de Ajuda, GOOGLE_CHAT_WEBHOOK_URL_AJUDA).
// Defensivo: sem URL → warn + no-op. Retorna `true` só quando o Chat aceitou (200),
// para o chamador registrar o resultado (ex.: chat_status do chamado de ajuda).
export async function sendChatNotification(
  message: string,
  opts?: { webhookUrl?: string },
): Promise<boolean> {
  const webhookUrl = opts?.webhookUrl ?? process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[google/chat] webhook do Google Chat não configurado, pulando notificação');
    return false;
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[google/chat] Falha ao enviar notificação (${resp.status}): ${body}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[google/chat] Erro ao enviar notificação:', e);
    return false;
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

// Mensagem do widget de Ajuda & Suporte. Mão única: a pessoa envia, Luis+Kaique
// leem no espaço dedicado. O print (quando há) vai como LINK do Drive — texto plain,
// sem card (decisão D3 da spec). A linha do print é OMITIDA quando não há anexo.
export function buildAjudaMessage(p: {
  tipo: 'duvida' | 'problema';
  nome: string;
  email: string;
  mensagem: string;
  pagina?: string | null;
  printLink?: string | null;
  data: string;
}): string {
  const cabecalho =
    p.tipo === 'problema'
      ? '\u{1F41E} *Novo PROBLEMA relatado no GoDocs*'
      : '❓ *Nova DÚVIDA no GoDocs*';

  const lines = [
    SEPARATOR,
    '',
    cabecalho,
    '',
    `\u{1F464} *De:* ${p.nome} (${p.email})`,
    `\u{1F4C4} *Página:* ${p.pagina || '—'}`,
    `\u{1F552} *Quando:* ${p.data}`,
    '',
    `\u{1F4DD} *Mensagem:*`,
    p.mensagem,
  ];

  if (p.printLink) {
    lines.push('', `\u{1F5BC}️ *Print:* ${p.printLink}`);
  }

  lines.push('', SEPARATOR);
  return lines.join('\n');
}
