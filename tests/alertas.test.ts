// RED: alerta proativo no Chat de Ajuda com dedup/cooldown por fonte (tabela
// `alerta_estado`). O módulo `@/lib/alertas.functions` ainda não existe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';

// Espiona o envio ao Chat sem tocar a rede.
vi.mock('@/lib/google/chat', () => ({
  sendChatNotification: vi.fn(async () => true),
}));

import { sendChatNotification } from '@/lib/google/chat';
import { criarDbMemoria } from './helpers/db-memoria';

const mockEnvio = vi.mocked(sendChatNotification);
const WEBHOOK_AJUDA = 'https://chat.googleapis.com/v1/spaces/AJUDA/messages?key=k&token=t';

let db: BetterSqlite3.Database;

async function carregarAlertas() {
  return await import('@/lib/alertas.functions');
}

describe('alertarErroIntegracao', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockEnvio.mockResolvedValue(true);
    process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA = WEBHOOK_AJUDA;
    db = await criarDbMemoria();
  });
  afterEach(() => {
    delete process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
  });

  it('a 1ª chamada de uma fonte ENVIA, com marca visível e o webhook de AJUDA explícito', async () => {
    const { alertarErroIntegracao } = await carregarAlertas();

    await alertarErroIntegracao('teamguide-sync', 'TeamGuide fora do ar', 'timeout após 3 tentativas');

    expect(mockEnvio).toHaveBeenCalledTimes(1);
    const [mensagem, opts] = mockEnvio.mock.calls[0];
    expect(mensagem).toContain('🔴');
    expect(mensagem).toContain('[SISTEMA]');
    expect(mensagem).toContain('teamguide-sync');
    expect(mensagem).toContain('TeamGuide fora do ar');
    expect(opts?.webhookUrl).toBe(WEBHOOK_AJUDA);
  });

  it('a 2ª chamada da MESMA fonte no cooldown NÃO reenvia (incrementa a contagem em silêncio)', async () => {
    const { alertarErroIntegracao } = await carregarAlertas();

    await alertarErroIntegracao('teamguide-sync', 'TeamGuide fora do ar');
    await alertarErroIntegracao('teamguide-sync', 'TeamGuide fora do ar de novo');

    // Só o primeiro pingou o Chat.
    expect(mockEnvio).toHaveBeenCalledTimes(1);

    // A supressão ficou registrada na tabela de estado (contagem incrementada).
    const row = db
      .prepare('SELECT contagem FROM alerta_estado WHERE chave = ?')
      .get('teamguide-sync') as { contagem: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.contagem).toBeGreaterThanOrEqual(1);
  });

  it('fontes DIFERENTES enviam as duas', async () => {
    const { alertarErroIntegracao } = await carregarAlertas();

    await alertarErroIntegracao('teamguide-sync', 'sync caiu');
    await alertarErroIntegracao('teamguide-token', 'token expira em 3 dias');

    expect(mockEnvio).toHaveBeenCalledTimes(2);
  });

  it('sem GOOGLE_CHAT_WEBHOOK_URL_AJUDA NÃO chama sendChatNotification (não cai no webhook default)', async () => {
    delete process.env.GOOGLE_CHAT_WEBHOOK_URL_AJUDA;
    const { alertarErroIntegracao } = await carregarAlertas();

    await alertarErroIntegracao('teamguide-sync', 'sync caiu');

    expect(mockEnvio).not.toHaveBeenCalled();
  });

  it('cooldown LONGO suprime uma repetição que o padrão (30min) já teria reenviado', async () => {
    const { alertarErroIntegracao } = await carregarAlertas();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-02T10:00:00Z'));
      await alertarErroIntegracao('teamguide-token', 'expira em 8 dias', undefined, 12 * 60 * 60 * 1000);
      expect(mockEnvio).toHaveBeenCalledTimes(1);

      // 1h depois: passou do cooldown de 30min, mas NÃO do de 12h → não reenvia.
      vi.setSystemTime(new Date('2026-09-02T11:00:00Z'));
      await alertarErroIntegracao('teamguide-token', 'expira em 8 dias', undefined, 12 * 60 * 60 * 1000);
      expect(mockEnvio).toHaveBeenCalledTimes(1);

      // 13h depois: passou do cooldown de 12h → reenvia.
      vi.setSystemTime(new Date('2026-09-02T23:00:00Z'));
      await alertarErroIntegracao('teamguide-token', 'expira em 8 dias', undefined, 12 * 60 * 60 * 1000);
      expect(mockEnvio).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('NUNCA lança, mesmo se o envio ao Chat rejeitar', async () => {
    mockEnvio.mockRejectedValueOnce(new Error('chat 500'));
    const { alertarErroIntegracao } = await carregarAlertas();

    await expect(
      alertarErroIntegracao('teamguide-sync', 'sync caiu'),
    ).resolves.toBeUndefined();
  });
});
