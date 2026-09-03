// T6 (v2) — `salvarGanhos`: a rota que grava o ganho da Etapa 3 e materializa os 3 impactos.
// Prende: 404 sem projeto · gate de ownership (dono, editor delegado, admin não participante;
// participante VENCE admin) · categorias inválidas → 400 · UM único UPDATE com o ganho e os 3
// `impacto_*` juntos · anexos vão para `ganho_anexos_links` em UPDATE separado e NUNCA derrubam
// a gravação · frequência suja lança ANTES de gravar (derivado parcial é pior que nenhum).
// Por quê: a revisão de conformidade da v2 apontou que a rota não tinha teste nenhum.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProjetoById = vi.fn<(id: string) => Promise<Record<string, unknown> | undefined>>();
const updateProjeto = vi.fn<(id: string, patch: Record<string, unknown>) => Promise<void>>();
const isAdmin = vi.fn<(email: string) => Promise<boolean>>();
const uploadDocsToDrive = vi.fn<(docs: unknown[]) => Promise<string[]>>();

vi.mock('@/integrations/db/client.server', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getProjetoById: (...a: unknown[]) => getProjetoById(...(a as [string])),
  updateProjeto: (...a: unknown[]) => updateProjeto(...(a as [string, Record<string, unknown>])),
}));
vi.mock('@/lib/auth.functions', () => ({ isAdmin: (...a: unknown[]) => isAdmin(...(a as [string])) }));
vi.mock('@/lib/google/drive', () => ({ uploadDocsToDrive: (...a: unknown[]) => uploadDocsToDrive(...(a as [unknown[]])) }));

import { salvarGanhos } from '@/lib/ganhos.functions';

const DONO = 'ana.silva@gocase.com';
const OUTRO = 'joao@gocase.com';
const DELEGADO = 'bia@gocase.com';

function projeto(over: Record<string, unknown> = {}) {
  return {
    id: 'P1',
    nome: 'Robô de Conciliação',
    responsavel_email: DONO,
    membros: JSON.stringify([DONO, DELEGADO, OUTRO]),
    editores_delegados: JSON.stringify([DELEGADO]),
    ...over,
  };
}

function payload(over: Record<string, unknown> = {}, ganhosOver: Record<string, unknown> = {}) {
  return {
    projeto_id: 'P1',
    ganhos: {
      categorias: ['saving_efetivado'],
      savingEfetivado: { valorAntes: 20000, valorAgora: 5000, frequencia: 'mensal', evidencia: 'Relatório de fechamento do RH' },
      ...ganhosOver,
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getProjetoById.mockResolvedValue(projeto());
  updateProjeto.mockResolvedValue(undefined);
  isAdmin.mockResolvedValue(false);
  uploadDocsToDrive.mockResolvedValue(['https://drive.google.com/x']);
});

describe('salvarGanhos — quem pode e o que é recusado', () => {
  it('projeto inexistente → 404 e nada gravado', async () => {
    getProjetoById.mockResolvedValue(undefined);
    await expect(salvarGanhos(payload(), DONO)).rejects.toMatchObject({ status: 404 });
    expect(updateProjeto).not.toHaveBeenCalled();
  });

  it('quem não é dono, nem delegado, nem admin → 403 e nada gravado', async () => {
    await expect(salvarGanhos(payload(), OUTRO)).rejects.toMatchObject({ status: 403 });
    expect(updateProjeto).not.toHaveBeenCalled();
  });

  it('editor delegado (em membros e em editores_delegados) grava', async () => {
    const r = await salvarGanhos(payload(), DELEGADO);
    expect(r.ok).toBe(true);
    expect(updateProjeto).toHaveBeenCalledTimes(1);
  });

  it('admin que NÃO participa grava; admin que É participante leva 403 (participante vence admin)', async () => {
    isAdmin.mockResolvedValue(true);
    await expect(salvarGanhos(payload(), 'admin@gocase.com')).resolves.toMatchObject({ ok: true });
    await expect(salvarGanhos(payload(), OUTRO)).rejects.toMatchObject({ status: 403 });
  });

  it('projeto sem dono não bloqueia (submissão nova)', async () => {
    getProjetoById.mockResolvedValue(projeto({ responsavel_email: null }));
    await expect(salvarGanhos(payload(), OUTRO)).resolves.toMatchObject({ ok: true });
  });

  it('categorias vazias → 400 antes de qualquer UPDATE', async () => {
    await expect(salvarGanhos(payload({}, { categorias: [] }), DONO)).rejects.toMatchObject({ status: 400 });
    expect(updateProjeto).not.toHaveBeenCalled();
  });

  it('frequência fora do enum é recusada pelo schema, sem gravar', async () => {
    await expect(
      salvarGanhos(payload({}, { savingEfetivado: { valorAntes: 1, valorAgora: 0, frequencia: 'anual', evidencia: 'x' } }), DONO),
    ).rejects.toBeTruthy();
    expect(updateProjeto).not.toHaveBeenCalled();
  });
});

describe('salvarGanhos — o que é gravado', () => {
  it('UM único UPDATE com o ganho e os 3 impacto_* juntos; o resultado devolve os impactos', async () => {
    const r = await salvarGanhos(payload(), DONO);
    expect(updateProjeto).toHaveBeenCalledTimes(1);
    const [id, patch] = updateProjeto.mock.calls[0];
    expect(id).toBe('P1');
    expect(patch).toMatchObject({ saving_efetivado_valor_antes: 20000, saving_efetivado_valor_agora: 5000, saving_efetivado_frequencia: 'mensal' });
    for (const k of ['impacto_bruto', 'impacto_liquido', 'impacto_liquido_mensal']) expect(patch, `falta ${k}`).toHaveProperty(k);
    expect(typeof patch.impacto_bruto).toBe('number');
    expect(r.impacto.bruto).toBe(patch.impacto_bruto);
    expect(r.impacto.liquidoMensal).toBe(patch.impacto_liquido_mensal);
    expect(r.categorias).toEqual(['saving_efetivado']);
  });

  it('saving efetivado = antes − agora, mensal: bruto 15000', async () => {
    const r = await salvarGanhos(payload(), DONO);
    expect(r.impacto.bruto).toBe(15000);
    expect(r.impacto.liquidoMensal).toBe(15000);
  });

  it('custo evitado deriva o R$ das horas no servidor (nunca aceita do cliente)', async () => {
    const r = await salvarGanhos(
      payload({}, {
        categorias: ['custo_evitado'],
        savingEfetivado: undefined,
        custoEvitado: {
          frequencia: 'mensal',
          linhasHoras: [{ funcao: 'Analista', horasAntes: 10, horasDepois: 0 }],
          valorHoras: 999999, // o cliente tenta mandar; o servidor recalcula
          naoContratado: 0,
          racional: 'Deixou de fazer à mão',
        },
      }),
      DONO,
    );
    expect(r.ok).toBe(true);
    const patch = updateProjeto.mock.calls[0][1];
    expect(patch.custo_evitado_horas_valor).not.toBe(999999);
    expect(typeof patch.custo_evitado_horas_valor).toBe('number');
    expect(patch.custo_evitado_horas_valor as number).toBeGreaterThan(0);
  });
});

describe('salvarGanhos — anexos são best-effort', () => {
  it('com anexos: sobe ao Drive e grava ganho_anexos_links num 2º UPDATE (nunca em arquivos_links)', async () => {
    await salvarGanhos(payload({ anexos: [{ base64: 'QUJD', filename: 'print.png' }] }), DONO);
    expect(uploadDocsToDrive).toHaveBeenCalledTimes(1);
    expect(updateProjeto).toHaveBeenCalledTimes(2);
    const segundo = updateProjeto.mock.calls[1][1];
    expect(segundo).toEqual({ ganho_anexos_links: ['https://drive.google.com/x'] });
    expect(segundo).not.toHaveProperty('arquivos_links');
  });

  it('Drive lançando → o ganho já está gravado e a chamada resolve ok', async () => {
    uploadDocsToDrive.mockRejectedValue(new Error('Drive 403'));
    const r = await salvarGanhos(payload({ anexos: [{ base64: 'QUJD', filename: 'print.png' }] }), DONO);
    expect(r.ok).toBe(true);
    expect(updateProjeto).toHaveBeenCalledTimes(1);
  });

  it('sem anexos não toca o Drive', async () => {
    await salvarGanhos(payload(), DONO);
    expect(uploadDocsToDrive).not.toHaveBeenCalled();
  });
});
