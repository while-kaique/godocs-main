// Widget de Ajuda & Suporte — lógica de negócio (server-only).
//
// Mão única (decisão D1 da spec): a pessoa abre o widget em qualquer página, escreve
// uma DÚVIDA ou relata um PROBLEMA, opcionalmente anexa um print, e envia. O backend:
//   1) sobe o print no Drive (não-fatal — print é opcional, nunca derruba o chamado);
//   2) persiste o chamado no SQLite (fonte de verdade do registro);
//   3) notifica um espaço dedicado do Google Chat em background (fire-and-forget).
// Não recebe respostas de volta no app, não mexe em Sheets/LLM/saving. Ver
// spec-docs/SPEC_WIDGET_AJUDA.md.

import { z } from 'zod';
import { runBackground } from '@/lib/background';
import { uploadFileToDrive } from '@/lib/google/drive';
import { sendChatNotification, buildAjudaMessage } from '@/lib/google/chat';
import {
  insertAjudaChamado,
  marcarChatStatusAjuda,
  getProjetosByOwnerEmail,
} from '@/integrations/db/client.server';

// Teto do print: base64 infla ~33%, então ~7M chars ≈ 5 MB de imagem.
const MAX_PRINT_B64 = 7_000_000;

const printSchema = z.object({
  base64: z.string().min(1).max(MAX_PRINT_B64, 'Imagem muito grande (máximo ~5 MB).'),
  filename: z.string().min(1).max(255),
});

export const ajudaSchema = z.object({
  tipo: z.enum(['duvida', 'problema', 'sugestao']),
  mensagem: z
    .string()
    .trim()
    .min(1, 'Escreva sua dúvida, problema ou sugestão.')
    .max(4000, 'Mensagem muito longa (máximo 4000 caracteres).'),
  pagina_url: z.string().max(2000).optional().nullable(),
  user_agent: z.string().max(1000).optional().nullable(),
  print: printSchema.optional().nullable(),
});

export type AjudaInput = z.infer<typeof ajudaSchema>;

// Lança um erro 400 com a 1ª mensagem de validação (o worker mapeia .status).
function erro400(mensagem: string): never {
  throw Object.assign(new Error(mensagem), { status: 400 });
}

// Melhor esforço para exibir o NOME da pessoa no Chat (CurrentUser só traz e-mail).
// Olha um projeto em que ela é a DONA e reusa o responsavel_nome. Fallback = e-mail.
async function derivarNome(email: string): Promise<string> {
  try {
    const projetos = await getProjetosByOwnerEmail(email);
    const meu = projetos.find(
      (p) =>
        p.responsavel_email?.toLowerCase() === email.toLowerCase() &&
        !!p.responsavel_nome?.trim(),
    );
    return meu?.responsavel_nome?.trim() || email;
  } catch (e) {
    console.error('[ajuda] falha ao derivar nome do usuário:', e);
    return email;
  }
}

// Carimbo de data/hora em pt-BR (fuso de SP) para a mensagem do Chat.
function agoraBR(): string {
  return new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function criarChamadoAjuda(
  email: string,
  body: unknown,
): Promise<{ id: string; ok: true }> {
  const parsed = ajudaSchema.safeParse(body);
  if (!parsed.success) {
    erro400(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
  }
  const dados = parsed.data;

  const nome = await derivarNome(email);

  // 1) Print (opcional) → Drive. NÃO-FATAL: loga e segue sem link.
  let printLink: string | null = null;
  let printFilename: string | null = null;
  if (dados.print) {
    printFilename = dados.print.filename;
    try {
      const { link } = await uploadFileToDrive(
        { base64: dados.print.base64, filename: dados.print.filename },
        { folderId: process.env.GOOGLE_DRIVE_FOLDER_ID_AJUDA || undefined },
      );
      printLink = link;
    } catch (e) {
      console.error('[ajuda] falha no upload do print (seguindo sem link):', e);
    }
  }

  // 2) Persiste o chamado (fonte de verdade).
  const chamado = await insertAjudaChamado({
    usuario_email: email,
    usuario_nome: nome,
    tipo: dados.tipo,
    mensagem: dados.mensagem,
    pagina_url: dados.pagina_url ?? null,
    user_agent: dados.user_agent ?? null,
    print_link: printLink,
    print_filename: printFilename,
    chat_status: 'pendente',
  });

  // 3) Notifica o Google Chat em background (fire-and-forget + waitUntil).
  const mensagemChat = buildAjudaMessage({
    tipo: dados.tipo,
    nome,
    email,
    mensagem: dados.mensagem,
    pagina: dados.pagina_url ?? null,
    printLink,
    data: agoraBR(),
  });
  // Notifica APENAS o espaço dedicado de ajuda. Se o webhook não estiver
  // configurado, NÃO usa o fallback de projetos do sendChatNotification — isso
  // postaria dúvidas no grupo das submissões. Pula o envio (chamado segue gravado,
  // chat_status fica 'pendente'); é o comportamento defensivo previsto na spec.
  const webhookAjuda = process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
  if (webhookAjuda) {
    runBackground(
      sendChatNotification(mensagemChat, { webhookUrl: webhookAjuda }).then((ok) =>
        marcarChatStatusAjuda(chamado.id, ok ? 'enviado' : 'falha'),
      ),
    );
  } else {
    console.warn(
      '[ajuda] GOOGLE_CHAT_WEBHOOK_URL_AJUDA não configurado — chamado gravado, Chat NÃO notificado (sem fallback p/ o grupo de projetos)',
    );
  }

  return { id: chamado.id, ok: true };
}
