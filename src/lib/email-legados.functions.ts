// Disparo de e-mails do painel admin — por SEGMENTO/público.
//
// A tela começou como "Cobrança de legados" (um único público) e foi generalizada para
// disparar e-mails a TRÊS segmentos, cada um com sua própria lista de destinatários
// (calculada ao vivo), seu template editável e seu histórico de "enviado em":
//
//   • 'legado'  — donos de projetos LEGADO ainda não regularizados (id contém "legado" +
//                 "Atualizado Em" vazio). Fonte: SQLite (getLegadosRows + !temAtualizadoEm).
//   • 'reenvio' — quem está com Status = "Reenvio Pendente" na PLANILHA (marcado à mão pela
//                 equipe; o sync grava sempre "Pendente", então esse status só existe no
//                 Sheets). A mensagem inclui o MOTIVO da revisão (coluna "Observações").
//   • 'todos'   — qualquer dono de projeto na planilha (broadcast). Fonte: Sheets.
//
// O envio reusa a máquina de LOTES/chunks (o runtime do Godeploy mata tarefas longas de
// `waitUntil`, então o front chama os chunks em sequência). Cada lote CONGELA um snapshot
// (`payload`: destinatários + template) no momento do disparo — o chunk lê desse snapshot,
// sem reler o Sheets/SQLite a cada requisição (mais robusto e sem race com o status mudando
// no meio do envio). Trade-off consciente: é um mail-merge ponto-no-tempo (quem regularizar
// DURANTE o envio ainda recebe).

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
// Fonte da verdade dos segmentos 'reenvio'/'todos' (lê a aba inteira chaveada por nome).
import { readAllRows } from '@/lib/google/sheets';
// Envio via Gmail API impersonando rpa_ia@gocase.com (Service Account + DWD).
import { sendGmail } from '@/lib/google/gmail';

// ─── Segmentos (públicos) ────────────────────────────────────────────────────

export type Audiencia = 'legado' | 'reenvio' | 'todos';
export const AUDIENCIAS: Audiencia[] = ['legado', 'reenvio', 'todos'];

// Normaliza um valor externo (query string / coluna do banco) para um segmento válido.
export function normalizarAudiencia(v: string | null | undefined): Audiencia {
  return v === 'reenvio' || v === 'todos' ? v : 'legado';
}

// URL pública do GoDocs (link "Meus Projetos" no corpo do e-mail). Override por env.
// ⚠️ Lido DENTRO da função (lazy): no runtime do worker `process` não existe no momento
// da avaliação do módulo — acessar process.env no topo quebra o bootstrap do worker.
function linkMeusProjetos(): string {
  const base = process.env.APP_BASE_URL ?? 'https://godocs.devgogroup.com';
  return `${base.replace(/\/$/, '')}/meus-projetos`;
}

// Chaves de persistência do template POR segmento (legado mantém as chaves antigas p/ compat).
const CHAVES_TEMPLATE: Record<Audiencia, { assunto: string; corpo: string }> = {
  legado: { assunto: 'email_legado_assunto', corpo: 'email_legado_corpo' },
  reenvio: { assunto: 'email_reenvio_assunto', corpo: 'email_reenvio_corpo' },
  todos: { assunto: 'email_todos_assunto', corpo: 'email_todos_corpo' },
};

export type EmailTemplate = { assunto: string; corpo: string };

// Template padrão por segmento (PT-BR, com acentos). Placeholders: {{nome}}, {{projetos}},
// {{prazo}} (só legado), {{link}}.
export const TEMPLATES_PADRAO: Record<Audiencia, EmailTemplate> = {
  legado: {
    assunto: 'GoDocs - Projetos Pendentes',
    corpo: `Olá, {{nome}}!

Identificamos que você é responsável por projeto(s) importado(s) para o GoDocs que ainda precisam ser revisados e reenviados para ficarem completos:

{{projetos}}

Para regularizar, acesse "Meus Projetos", abra cada projeto, revise as informações e salve. É rápido e garante que o impacto do seu trabalho fique documentado corretamente.

Prazo para regularização: {{prazo}}.

{{link}}

Em caso de dúvida, fale com o time de RPA & IA. Obrigado!`,
  },
  reenvio: {
    assunto: 'GoDocs - Ajuste solicitado no seu projeto',
    corpo: `Olá, {{nome}}!

Revisamos o(s) seu(s) projeto(s) no GoDocs e ele(s) precisa(m) de um ajuste antes de seguir. Veja o que foi apontado em cada um:

{{projetos}}

Para resolver, acesse "Meus Projetos", abra cada projeto sinalizado, corrija os pontos acima e reenvie. Assim que reenviar, voltamos a analisar.

{{link}}

Qualquer dúvida, fale com o time de RPA & IA. Obrigado!`,
  },
  todos: {
    assunto: 'GoDocs - Comunicado',
    corpo: `Olá, {{nome}}!

Passando para lembrar de manter seus projetos no GoDocs sempre atualizados — a documentação correta garante que o impacto do seu trabalho fique registrado.

Seus projetos:
{{projetos}}

{{link}}

Equipe de RPA & IA.`,
  },
};

// Projeto exibido na lista do e-mail. `motivo` só é usado no segmento 'reenvio'.
export type ProjetoRecipiente = { id: string; nome: string | null; motivo?: string | null };

export type EmailRecipient = {
  email: string;
  nome: string | null;
  projetos: ProjetoRecipiente[];
  // Último disparo registrado para este e-mail NESTE segmento (null = nunca enviado).
  ultimoEnvio: { data: string | null; status: string } | null;
};

export type PreviewDisparo = {
  audiencia: Audiencia;
  recipients: EmailRecipient[];
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

// ─── Template (persistência, por segmento) ───────────────────────────────────

export async function getTemplate(audiencia: Audiencia): Promise<EmailTemplate> {
  const chaves = CHAVES_TEMPLATE[audiencia];
  const [a, c] = await Promise.all([
    getConfiguracao(chaves.assunto),
    getConfiguracao(chaves.corpo),
  ]);
  const assunto = a ? parseJson<string>(a.valor) : null;
  const corpo = c ? parseJson<string>(c.valor) : null;
  const padrao = TEMPLATES_PADRAO[audiencia];
  return { assunto: assunto ?? padrao.assunto, corpo: corpo ?? padrao.corpo };
}

export async function salvarTemplate(
  audiencia: Audiencia,
  template: EmailTemplate,
  adminEmail: string,
): Promise<void> {
  const assunto = (template.assunto ?? '').trim();
  const corpo = (template.corpo ?? '').trim();
  if (!assunto) throw new Error('O assunto do e-mail não pode ficar vazio.');
  if (!corpo) throw new Error('A mensagem do e-mail não pode ficar vazia.');
  const chaves = CHAVES_TEMPLATE[audiencia];
  await upsertConfiguracao(chaves.assunto, assunto, adminEmail, `Assunto do e-mail de disparo (${audiencia})`);
  await upsertConfiguracao(chaves.corpo, corpo, adminEmail, `Corpo do e-mail de disparo (${audiencia})`);
}

// ─── Fontes de destinatários (por segmento) ──────────────────────────────────

type ItemDestinatario = { email: string; nome: string | null; projeto: ProjetoRecipiente };

// Agrupa itens {email, nome, projeto} por e-mail (dedup case-insensitive), agregando os
// projetos de cada pessoa. Pula itens sem e-mail (não há como cobrar). `totalProjetos` conta
// só os projetos de pessoas COM e-mail.
function agruparPorEmail(itens: ItemDestinatario[]): {
  recipients: Omit<EmailRecipient, 'ultimoEnvio'>[];
  totalProjetos: number;
} {
  const porPessoa = new Map<string, Omit<EmailRecipient, 'ultimoEnvio'>>();
  let totalProjetos = 0;
  for (const it of itens) {
    const email = (it.email ?? '').trim();
    if (!email) continue;
    totalProjetos++;
    const key = email.toLowerCase();
    const existente = porPessoa.get(key);
    if (existente) existente.projetos.push(it.projeto);
    else porPessoa.set(key, { email, nome: it.nome ?? null, projetos: [it.projeto] });
  }
  return { recipients: [...porPessoa.values()], totalProjetos };
}

// 'legado' — SQLite: legados (id contém "legado") ainda sem "Atualizado Em".
async function fonteLegado() {
  const rows = await getLegadosRows();
  const pendentes = rows.filter((r) => !temAtualizadoEm(r.atualizado_em));
  return agruparPorEmail(
    pendentes.map((r) => ({
      email: r.responsavel_email ?? '',
      nome: r.responsavel_nome ?? null,
      projeto: { id: r.id, nome: r.nome },
    })),
  );
}

// Status do Sheets que contam como "reenvio pendente" (mesma normalização do StatusBadge).
const STATUS_REENVIO = new Set(['reenvio pendente', 'rejeitado']);

// 'reenvio' — Sheets: linhas com Status normalizado em STATUS_REENVIO. Inclui o MOTIVO
// (coluna "Observações") por projeto.
async function fonteReenvio() {
  const rows = await readAllRows();
  const itens: ItemDestinatario[] = rows
    .filter((r) => STATUS_REENVIO.has((r['Status'] ?? '').trim().toLowerCase()))
    .map((r) => ({
      email: (r['Email'] ?? '').trim(),
      nome: (r['Nome Completo'] ?? '').trim() || null,
      projeto: {
        id: (r['ID Projeto'] ?? '').trim(),
        nome: (r['Projeto'] ?? '').trim() || null,
        motivo: (r['Observações'] ?? '').trim() || null,
      },
    }));
  return agruparPorEmail(itens);
}

// 'todos' — Sheets: toda linha com e-mail (broadcast). Rascunho nunca está na planilha.
async function fonteTodos() {
  const rows = await readAllRows();
  const itens: ItemDestinatario[] = rows.map((r) => ({
    email: (r['Email'] ?? '').trim(),
    nome: (r['Nome Completo'] ?? '').trim() || null,
    projeto: { id: (r['ID Projeto'] ?? '').trim(), nome: (r['Projeto'] ?? '').trim() || null },
  }));
  return agruparPorEmail(itens);
}

// Calcula a lista de destinatários ao vivo para um segmento, anexa o último disparo (selo
// "já enviado em…", escopado por segmento) e o template do segmento. NUNCA usa número fixo.
export async function listarDestinatarios(audiencia: Audiencia): Promise<PreviewDisparo> {
  const { recipients: base, totalProjetos } =
    audiencia === 'legado'
      ? await fonteLegado()
      : audiencia === 'reenvio'
        ? await fonteReenvio()
        : await fonteTodos();

  const disparos = await getUltimosDisparosPorEmail(audiencia);
  const recipients: EmailRecipient[] = base
    .map((r) => {
      const d = disparos.get(r.email.toLowerCase());
      return { ...r, ultimoEnvio: d ? { data: d.created_at, status: d.status } : null };
    })
    .sort((a, b) => (a.nome ?? a.email).localeCompare(b.nome ?? b.email, 'pt-BR'));

  return {
    audiencia,
    recipients,
    totalPessoas: recipients.length,
    totalProjetos,
    template: await getTemplate(audiencia),
  };
}

export async function getPreviewDisparo(audiencia: Audiencia): Promise<PreviewDisparo> {
  return listarDestinatarios(audiencia);
}

// ─── Renderização do e-mail ──────────────────────────────────────────────────

// Substitui placeholders e embrulha o corpo num shell HTML com a identidade GoGroup.
export function renderEmailDisparo(
  template: EmailTemplate,
  recipient: Pick<EmailRecipient, 'nome' | 'projetos'>,
  audiencia: Audiencia,
): { assunto: string; html: string } {
  const padrao = TEMPLATES_PADRAO[audiencia];
  const nome = escapeHtml(recipient.nome?.trim() || 'tudo bem?');

  // Assunto: texto puro, só {{nome}} e {{prazo}}.
  const assunto = (template.assunto || padrao.assunto)
    .replace(/\{\{\s*nome\s*\}\}/g, recipient.nome?.trim() || '')
    .replace(/\{\{\s*prazo\s*\}\}/g, PRAZO_LEGADO)
    .trim();

  // Só o NOME do projeto (o id interno não significa nada para quem recebe). No 'reenvio',
  // cada item ganha uma linha "Motivo: …" (coluna Observações), quando houver.
  const projetosHtml = recipient.projetos.length
    ? `<ul style="margin: 12px 0; padding-left: 20px; line-height: 1.7; color: #1a1a1a;">${recipient.projetos
        .map((p) => {
          const titulo = `<strong>${escapeHtml(p.nome?.trim() || 'Projeto sem nome')}</strong>`;
          const motivo =
            audiencia === 'reenvio' && p.motivo?.trim()
              ? `<br><span style="color: #6b7280; font-size: 14px;">Motivo: ${escapeHtml(p.motivo.trim())}</span>`
              : '';
          return `<li style="margin-bottom: 6px;">${titulo}${motivo}</li>`;
        })
        .join('')}</ul>`
    : '<p style="color: #6b7280;">—</p>';

  const linkHtml = `<a href="${linkMeusProjetos()}" style="display: inline-block; background: #0059A9; color: #ffffff; text-decoration: none; font-weight: 600; padding: 12px 22px; border-radius: 8px; margin: 8px 0;">Acessar Meus Projetos</a>`;

  // Corpo: escapa, converte quebras de linha em <br> e injeta os placeholders já como HTML.
  const corpoHtml = escapeHtml(template.corpo || padrao.corpo)
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

// ─── Disparo (lote + chunks) ─────────────────────────────────────────────────

export type ProgressoLote = {
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  status: 'enviando' | 'cancelando' | 'concluido' | 'erro' | 'cancelado';
};

const STATUS_LOTE = ['enviando', 'cancelando', 'concluido', 'erro', 'cancelado'];
const CHUNK_SIZE = 8; // e-mails por requisição (mantém cada chamada curta, dentro do limite)

// Snapshot congelado no lote (lido pelo chunk, sem reler Sheets/SQLite).
type LotePayload = { recipients: EmailRecipient[]; template: EmailTemplate };

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
// AUTORITATIVA do segmento — não dá pra enviar a um endereço fora dela). Lista vazia = todos.
function filtrarPorEmails(recipients: EmailRecipient[], emails?: string[]): EmailRecipient[] {
  if (!emails || emails.length === 0) return recipients;
  const set = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  return recipients.filter((r) => set.has(r.email.toLowerCase()));
}

// Cria o lote congelando o segmento + o payload (destinatários filtrados + template) no
// momento do disparo. O envio NÃO roda em background — o front chama processarChunkLote em
// sequência até concluir.
export async function iniciarDisparo(
  adminEmail: string,
  audiencia: Audiencia,
  emails?: string[],
): Promise<{ loteId: string; total: number }> {
  const { recipients, template } = await listarDestinatarios(audiencia);
  const escolhidos = filtrarPorEmails(recipients, emails);
  const payload: LotePayload = { recipients: escolhidos, template };
  const alvos = escolhidos.map((r) => r.email);
  const loteId = await createEmailLote(alvos.length, adminEmail, alvos, audiencia, payload);
  return { loteId, total: alvos.length };
}

// Lê o progresso de um lote (resiliência/retomada do front).
export async function getProgressoLote(loteId: string): Promise<ProgressoLote | null> {
  const lote = await getEmailLote(loteId);
  if (!lote) return null;
  return progressoDeLote(lote);
}

// Pede o cancelamento de um lote em andamento (o próximo chunk finaliza como 'cancelado').
export async function cancelarDisparo(loteId: string): Promise<void> {
  await requestCancelEmailLote(loteId);
}

// Processa UM chunk do lote (chamado em sequência pelo front). Envia os próximos CHUNK_SIZE
// destinatários a partir do cursor (`processados`), lendo do PAYLOAD CONGELADO — avança o
// cursor a CADA e-mail (resumível: se a requisição morrer no meio, retoma de onde parou, sem
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

  const audiencia = normalizarAudiencia(lote.audiencia);
  const payload = parseJson<LotePayload>(lote.payload) ?? {
    recipients: [],
    template: TEMPLATES_PADRAO[audiencia],
  };
  const fatia = payload.recipients.slice(lote.processados, lote.processados + CHUNK_SIZE);

  for (const r of fatia) {
    const { assunto, html } = renderEmailDisparo(payload.template, r, audiencia);
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
        audiencia,
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
        audiencia,
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

// Envia um e-mail de teste só para o próprio admin, com dados de exemplo do segmento. Não
// registra no log (não é uma cobrança real).
export async function enviarEmailTeste(adminEmail: string, audiencia: Audiencia): Promise<void> {
  const template = await getTemplate(audiencia);
  const projetosExemplo: ProjetoRecipiente[] =
    audiencia === 'reenvio'
      ? [
          { id: 'exemplo-1', nome: 'Projeto de Exemplo', motivo: 'Faltou a composição das horas do cargo Analista.' },
          { id: 'exemplo-2', nome: 'Outro Projeto', motivo: 'Revisar a base de cálculo do memorial de receita.' },
        ]
      : [
          { id: 'exemplo-1', nome: 'Projeto de Exemplo' },
          { id: 'exemplo-2', nome: 'Outro Projeto Pendente' },
        ];
  const { assunto, html } = renderEmailDisparo(
    template,
    { nome: 'Maria (exemplo)', projetos: projetosExemplo },
    audiencia,
  );
  await sendGmail(adminEmail, `[TESTE] ${assunto}`, html);
}
