// Cobrança de legados pendentes por e-mail (painel admin).
//
// Dispara um e-mail para os DONOS de projetos LEGADO (id contém "legado") que ainda
// NÃO foram regularizados — ou seja, sem "Atualizado Em" (vazio/—/-). Os legados já
// atualizados ficam de fora (têm data → `temAtualizadoEm` = true). Um e-mail POR PESSOA,
// listando todos os projetos pendentes dela (dedup por e-mail). O texto é editável pelo
// admin (persistido em `configuracoes`) e cada disparo é registrado em `email_disparos`
// para mostrar "já enviado em…" e evitar envio duplicado acidental.

import {
  getLegadosRows,
  getConfiguracao,
  upsertConfiguracao,
  insertEmailDisparo,
  getUltimosDisparosPorEmail,
  createEmailLote,
  advanceEmailLote,
  finalizeEmailLote,
  getEmailLote,
  requestCancelEmailLote,
  parseJson,
} from '@/integrations/db/client.server';
import { temAtualizadoEm, PRAZO_LEGADO } from '@/lib/meus-projetos.functions';
// Envio via Gmail API impersonando rpa_ia@gocase.com (Service Account + DWD).
import { sendGmail } from '@/lib/google/gmail';

// URL pública do GoDocs (link "Meus Projetos" no corpo do e-mail). Override por env.
// ⚠️ Lido DENTRO da função (lazy): no runtime do worker `process` não existe no momento
// da avaliação do módulo — acessar process.env no topo quebra o bootstrap do worker.
function linkMeusProjetos(): string {
  const base = process.env.APP_BASE_URL ?? 'https://godocs.devgogroup.com';
  return `${base.replace(/\/$/, '')}/meus-projetos`;
}

const CHAVE_ASSUNTO = 'email_legado_assunto';
const CHAVE_CORPO = 'email_legado_corpo';

// Template padrão (PT-BR, com acentos). Placeholders suportados: {{nome}}, {{projetos}},
// {{prazo}}, {{link}}.
export const TEMPLATE_PADRAO = {
  assunto: 'GoDocs - Projetos Pendentes',
  corpo: `Olá, {{nome}}!

Identificamos que você é responsável por projeto(s) importado(s) para o GoDocs que ainda precisam ser revisados e reenviados para ficarem completos:

{{projetos}}

Para regularizar, acesse "Meus Projetos", abra cada projeto, revise as informações e salve. É rápido e garante que o impacto do seu trabalho fique documentado corretamente.

Prazo para regularização: {{prazo}}.

{{link}}

Em caso de dúvida, fale com o time de RPA & IA. Obrigado!`,
};

export type EmailTemplate = { assunto: string; corpo: string };

export type LegadoRecipient = {
  email: string;
  nome: string | null;
  projetos: { id: string; nome: string | null }[];
  // Último disparo registrado para este e-mail (null = nunca enviado).
  ultimoEnvio: { data: string | null; status: string } | null;
};

export type PreviewLegados = {
  recipients: LegadoRecipient[];
  totalPessoas: number;
  totalProjetos: number;
  template: EmailTemplate;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Template (persistência) ───────────────────────────────────────────────

export async function getTemplateEmailLegado(): Promise<EmailTemplate> {
  const [a, c] = await Promise.all([
    getConfiguracao(CHAVE_ASSUNTO),
    getConfiguracao(CHAVE_CORPO),
  ]);
  const assunto = a ? parseJson<string>(a.valor) : null;
  const corpo = c ? parseJson<string>(c.valor) : null;
  return {
    assunto: assunto ?? TEMPLATE_PADRAO.assunto,
    corpo: corpo ?? TEMPLATE_PADRAO.corpo,
  };
}

export async function salvarTemplateEmailLegado(
  template: EmailTemplate,
  adminEmail: string,
): Promise<void> {
  const assunto = (template.assunto ?? '').trim();
  const corpo = (template.corpo ?? '').trim();
  if (!assunto) throw new Error('O assunto do e-mail não pode ficar vazio.');
  if (!corpo) throw new Error('A mensagem do e-mail não pode ficar vazia.');
  await upsertConfiguracao(CHAVE_ASSUNTO, assunto, adminEmail, 'Assunto do e-mail de cobrança de legados');
  await upsertConfiguracao(CHAVE_CORPO, corpo, adminEmail, 'Corpo do e-mail de cobrança de legados');
}

// ─── Lista de destinatários ──────────────────────────────────────────────────

// Calcula a lista de destinatários ao vivo a partir do SQLite: legados pendentes,
// deduplicados por e-mail do dono. NUNCA usa número fixo — o total é o que a base tem.
export async function listarLegadosPendentes(): Promise<PreviewLegados> {
  const rows = await getLegadosRows();
  const pendentes = rows.filter((r) => !temAtualizadoEm(r.atualizado_em));

  const porPessoa = new Map<string, LegadoRecipient>();
  let totalProjetos = 0;
  for (const r of pendentes) {
    const email = (r.responsavel_email ?? '').trim();
    if (!email) continue; // sem e-mail não há como cobrar
    totalProjetos++;
    const key = email.toLowerCase();
    const existente = porPessoa.get(key);
    if (existente) {
      existente.projetos.push({ id: r.id, nome: r.nome });
    } else {
      porPessoa.set(key, {
        email,
        nome: r.responsavel_nome ?? null,
        projetos: [{ id: r.id, nome: r.nome }],
        ultimoEnvio: null,
      });
    }
  }

  const disparos = await getUltimosDisparosPorEmail();
  const recipients = [...porPessoa.values()]
    .map((r) => {
      const d = disparos.get(r.email.toLowerCase());
      return { ...r, ultimoEnvio: d ? { data: d.created_at, status: d.status } : null };
    })
    .sort((a, b) => (a.nome ?? a.email).localeCompare(b.nome ?? b.email, 'pt-BR'));

  return {
    recipients,
    totalPessoas: recipients.length,
    totalProjetos,
    template: await getTemplateEmailLegado(),
  };
}

export async function getPreviewLegados(): Promise<PreviewLegados> {
  return listarLegadosPendentes();
}

// ─── Renderização do e-mail ──────────────────────────────────────────────────

// Substitui placeholders e embrulha o corpo num shell HTML com a identidade GoGroup.
export function renderEmailLegado(
  template: EmailTemplate,
  recipient: Pick<LegadoRecipient, 'nome' | 'projetos'>,
): { assunto: string; html: string } {
  const nome = escapeHtml(recipient.nome?.trim() || 'tudo bem?');

  // Assunto: texto puro, só {{nome}} e {{prazo}}.
  const assunto = (template.assunto || TEMPLATE_PADRAO.assunto)
    .replace(/\{\{\s*nome\s*\}\}/g, recipient.nome?.trim() || '')
    .replace(/\{\{\s*prazo\s*\}\}/g, PRAZO_LEGADO)
    .trim();

  // Só o NOME do projeto — o id interno ("LEGADO-233") não significa nada para quem
  // recebe o e-mail (fica só na lista do admin).
  const projetosHtml = recipient.projetos.length
    ? `<ul style="margin: 12px 0; padding-left: 20px; line-height: 1.8; color: #1a1a1a;">${recipient.projetos
        .map((p) => `<li><strong>${escapeHtml(p.nome?.trim() || 'Projeto sem nome')}</strong></li>`)
        .join('')}</ul>`
    : '<p style="color: #6b7280;">—</p>';

  const linkHtml = `<a href="${linkMeusProjetos()}" style="display: inline-block; background: #0059A9; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 22px; border-radius: 8px; margin: 8px 0;">Acessar Meus Projetos</a>`;

  // Corpo: escapa, converte quebras de linha em <br> e injeta os placeholders já como HTML.
  const corpoHtml = escapeHtml(template.corpo || TEMPLATE_PADRAO.corpo)
    .replace(/\n/g, '<br>')
    .replace(/\{\{\s*nome\s*\}\}/g, nome)
    .replace(/\{\{\s*prazo\s*\}\}/g, PRAZO_LEGADO)
    // {{projetos}} e {{link}} são blocos próprios — removem o <br> imediatamente após.
    .replace(/\{\{\s*projetos\s*\}\}(<br>)?/g, projetosHtml)
    .replace(/\{\{\s*link\s*\}\}(<br>)?/g, linkHtml);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; background: #FBF4EE; font-family: Arial, Helvetica, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px;">
    <div style="background: #0059A9; border-radius: 12px 12px 0 0; padding: 20px 24px;">
      <h1 style="margin: 0; color: #ffffff; font-size: 20px;">GoDocs</h1>
    </div>
    <div style="background: #ffffff; border: 1px solid #eadfd3; border-top: none; border-radius: 0 0 12px 12px; padding: 24px; color: #1a1a1a; line-height: 1.6; font-size: 15px;">
      ${corpoHtml}
    </div>
    <p style="margin: 16px 4px 0; color: #8a8a8a; font-size: 12px;">GoDocs · Hub interno de automações (RPA &amp; IA) · Gocase</p>
  </div>
</body>
</html>`;

  return { assunto, html };
}

// ─── Disparo ──────────────────────────────────────────────────────────────────

export type ProgressoLote = {
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  status: 'enviando' | 'cancelando' | 'concluido' | 'erro' | 'cancelado';
};

const STATUS_LOTE = ['enviando', 'cancelando', 'concluido', 'erro', 'cancelado'];
const CHUNK_SIZE = 8; // e-mails por requisição (mantém cada chamada curta, dentro do limite)

function progressoDeLote(lote: {
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  status: string;
}): ProgressoLote {
  const status = (STATUS_LOTE.includes(lote.status) ? lote.status : 'enviando') as ProgressoLote['status'];
  return {
    total: lote.total,
    processados: lote.processados,
    enviados: lote.enviados,
    falhas: lote.falhas,
    status,
  };
}

// Filtra os destinatários pelos e-mails escolhidos no front (interseção com a lista
// AUTORITATIVA de pendentes — não dá pra enviar a um endereço fora dos legados pendentes).
// Lista vazia/ausente = todos.
function filtrarPorEmails(recipients: LegadoRecipient[], emails?: string[]): LegadoRecipient[] {
  if (!emails || emails.length === 0) return recipients;
  const set = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return recipients.filter((r) => set.has(r.email.toLowerCase()));
}

// Cria o lote congelando a lista de e-mails alvo (cursor estável entre chunks). O envio
// NÃO roda em background (o runtime mata tarefas longas) — o front chama processarChunkLote
// em sequência até concluir.
export async function iniciarDisparoLegados(
  adminEmail: string,
  emails?: string[],
): Promise<{ loteId: string; total: number }> {
  const { recipients } = await listarLegadosPendentes();
  const alvos = filtrarPorEmails(recipients, emails).map((r) => r.email);
  const loteId = await createEmailLote(alvos.length, adminEmail, alvos);
  return { loteId, total: alvos.length };
}

// Lê o progresso de um lote (resiliência/retomada do front).
export async function getProgressoLote(loteId: string): Promise<ProgressoLote | null> {
  const lote = await getEmailLote(loteId);
  if (!lote) return null;
  return progressoDeLote(lote);
}

// Pede o cancelamento de um lote em andamento (o próximo chunk finaliza como 'cancelado').
export async function cancelarDisparoLegados(loteId: string): Promise<void> {
  await requestCancelEmailLote(loteId);
}

// Processa UM chunk do lote (chamado em sequência pelo front). Envia os próximos
// CHUNK_SIZE alvos a partir do cursor (`processados`), atualizando o cursor a CADA e-mail
// (resumível: se a requisição morrer no meio, retoma exatamente de onde parou, sem
// reenviar). Respeita o pedido de cancelamento. Devolve o progresso atualizado.
export async function processarChunkLote(adminEmail: string, loteId: string): Promise<ProgressoLote | null> {
  const lote = await getEmailLote(loteId);
  if (!lote) return null;

  // Já terminou? devolve como está.
  if (lote.status === 'concluido' || lote.status === 'erro' || lote.status === 'cancelado') {
    return progressoDeLote(lote);
  }
  // Cancelamento pedido → finaliza agora.
  if (lote.status === 'cancelando') {
    await finalizeEmailLote(loteId, 'cancelado');
    return progressoDeLote({ ...lote, status: 'cancelado' });
  }
  // Cursor chegou ao fim → conclui.
  if (lote.processados >= lote.total) {
    await finalizeEmailLote(loteId, 'concluido');
    return progressoDeLote({ ...lote, status: 'concluido' });
  }

  const alvos = parseJson<string[]>(lote.alvos) ?? [];
  const fatia = alvos.slice(lote.processados, lote.processados + CHUNK_SIZE);

  // Mapa email → recipient (nome/projetos) a partir da lista autoritativa de pendentes.
  const { recipients, template } = await listarLegadosPendentes();
  const porEmail = new Map(recipients.map((r) => [r.email.toLowerCase(), r]));

  for (const email of fatia) {
    const r = porEmail.get(email.toLowerCase());
    // Não está mais pendente (editou nesse meio tempo) → pula, só avança o cursor.
    if (!r) {
      await advanceEmailLote(loteId, { processados: 1 });
      continue;
    }
    const { assunto, html } = renderEmailLegado(template, r);
    const projetoIds = r.projetos.map((p) => p.id);
    try {
      await sendGmail(r.email, assunto, html);
      await insertEmailDisparo({
        email: r.email,
        nome: r.nome,
        projetoIds,
        assunto,
        enviadoPor: adminEmail,
        status: 'sucesso',
      });
      await advanceEmailLote(loteId, { processados: 1, enviados: 1 });
    } catch (e) {
      await insertEmailDisparo({
        email: r.email,
        nome: r.nome,
        projetoIds,
        assunto,
        enviadoPor: adminEmail,
        status: 'falha',
        erro: e instanceof Error ? e.message : String(e),
      });
      await advanceEmailLote(loteId, { processados: 1, falhas: 1 });
    }
  }

  // Relê para devolver o estado atualizado e finalizar se acabou.
  const atual = await getEmailLote(loteId);
  if (!atual) return null;
  if (atual.status === 'cancelando') {
    await finalizeEmailLote(loteId, 'cancelado');
    return progressoDeLote({ ...atual, status: 'cancelado' });
  }
  if (atual.processados >= atual.total) {
    await finalizeEmailLote(loteId, 'concluido');
    return progressoDeLote({ ...atual, status: 'concluido' });
  }
  return progressoDeLote(atual);
}

// Envia um e-mail de teste só para o próprio admin, com dados de exemplo. Não registra
// no log (não é uma cobrança real).
export async function enviarEmailTeste(adminEmail: string): Promise<void> {
  const template = await getTemplateEmailLegado();
  const { assunto, html } = renderEmailLegado(template, {
    nome: 'Maria (exemplo)',
    projetos: [
      { id: 'legado-000', nome: 'Projeto de Exemplo' },
      { id: 'legado-001', nome: 'Outro Projeto Pendente' },
    ],
  });
  await sendGmail(adminEmail, `[TESTE] ${assunto}`, html);
}
