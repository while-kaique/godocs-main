// Alerta proativo de erro de integração no Google Chat de AJUDA (server-only).
//
// Objetivo: descobrir que uma integração caiu ANTES do cliente. Hoje o único sinal de que a
// TeamGuide (ou outra integração) falhou é o usuário travar. Este helper manda 1 mensagem
// `🔴 [SISTEMA]` no MESMO espaço do widget de Ajuda (`GOOGLE_CHAT_WEBHOOK_URL_AJUDA`), com
// dedup/cooldown para NÃO virar N pings iguais.
//
// ⚠️ Genérico de propósito (a `fonte` é livre), mas por ora só a TeamGuide o usa (Fronteiras
// do plano). É a BASE para um agente de autocura futuro — não implementar isso agora.

import { getAlertaEstado, upsertAlertaEstado } from '@/integrations/db/client.server';
import { sendChatNotification } from '@/lib/google/chat';
import { runBackground } from '@/lib/background';

/** Janela em que uma repetição da MESMA fonte é contada em silêncio, não reenviada. */
export const COOLDOWN_ALERTA_MS = 30 * 60 * 1000;

function formatarMensagem(
  fonte: string,
  titulo: string,
  detalhe: string | undefined,
  ocorrencias: number,
): string {
  // Sintaxe de TEXTO do Google Chat (`*negrito*`) — este webhook entrega mensagem de texto,
  // não cartão (ao contrário do Gomoon, que usa `<b>`). Ver CLAUDE.md (D22).
  const linhas = [`🔴 *[SISTEMA]* ${fonte}: ${titulo}`];
  if (detalhe && detalhe.trim()) linhas.push(detalhe.trim());
  if (ocorrencias > 1) linhas.push(`_(${ocorrencias}ª ocorrência desde o último aviso)_`);
  return linhas.join('\n');
}

/**
 * Dispara (ou suprime, no cooldown) um alerta de erro de integração.
 *
 * - **NUNCA lança**: alertar é acessório; não pode derrubar quem chamou (ex.: o `catch` do
 *   sync da TeamGuide). Qualquer erro interno é engolido com `console.error`.
 * - **Cooldown por `fonte`**: a 1ª vez envia; repetições dentro de `COOLDOWN_ALERTA_MS` só
 *   incrementam a contagem (para o próximo aviso dizer "Nª ocorrência").
 * - **Webhook EXPLÍCITO de AJUDA**: sem `GOOGLE_CHAT_WEBHOOK_URL_AJUDA` no ambiente, PULA o
 *   envio — nunca cai no webhook default de projetos do `sendChatNotification` (senão erros
 *   de sistema iriam para o grupo das submissões). Env lida LAZY, dentro da função.
 */
export async function alertarErroIntegracao(
  fonte: string,
  titulo: string,
  detalhe?: string,
): Promise<void> {
  try {
    const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
    if (!webhookUrl) return; // sem canal de Ajuda → não alerta (e não cai no default)

    const agora = Date.now();
    const estado = await getAlertaEstado(fonte);
    const ultimoEm = estado?.ultimo_em ?? null;
    const suprimidas = estado?.contagem ?? 0;

    // Ainda no cooldown → conta em silêncio e sai.
    if (ultimoEm != null && agora - ultimoEm < COOLDOWN_ALERTA_MS) {
      await upsertAlertaEstado({ chave: fonte, ultimo_em: ultimoEm, contagem: suprimidas + 1 });
      return;
    }

    const mensagem = formatarMensagem(fonte, titulo, detalhe, suprimidas + 1);
    // O envio é fire-and-forget (o `sendChatNotification` já é try/catch → boolean); o estado
    // é gravado JÁ, para o cooldown valer mesmo que o POST demore/falhe.
    runBackground(sendChatNotification(mensagem, { webhookUrl }));
    await upsertAlertaEstado({ chave: fonte, ultimo_em: agora, contagem: 0 });
  } catch (e) {
    console.error(`[alertas] falha ao alertar '${fonte}' (ignorado):`, e);
  }
}
