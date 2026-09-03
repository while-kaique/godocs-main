// Rascunho local NÃO guarda bytes de anexo (A1 da revisão de qualidade da v2): base64 de até
// 5 MB por print serializado a cada tecla estourava a cota do localStorage e o rascunho inteiro
// deixava de persistir em silêncio. O que a pessoa digitou fica; os anexos ela reanexa.
import { describe, it, expect, beforeEach } from 'vitest';
import { saveDraft, loadDraft, semAnexosNoRascunho } from '@/lib/submeter/draft-storage';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe('semAnexosNoRascunho', () => {
  it('zera os 3 arrays de anexo e preserva o resto', () => {
    const g = { savingValorAntes: '20000', savingAnexos: [{ base64: 'x'.repeat(100), filename: 'a.png' }], receitaAnexos: [{ base64: 'y', filename: 'b.png' }], imensuravelAnexos: [{ base64: 'z', filename: 'c.png' }], receitaValor: '10' };
    const r = semAnexosNoRascunho(g)!;
    expect(r.savingAnexos).toEqual([]);
    expect(r.receitaAnexos).toEqual([]);
    expect(r.imensuravelAnexos).toEqual([]);
    expect(r.savingValorAntes).toBe('20000');
    expect(r.receitaValor).toBe('10');
  });

  it('undefined passa como undefined (rascunho da v1 sem ganhos)', () => {
    expect(semAnexosNoRascunho(undefined)).toBeUndefined();
  });
});

describe('saveDraft', () => {
  it('o snapshot gravado não carrega base64 de anexo, mas carrega o que foi digitado', () => {
    const grande = 'A'.repeat(50_000);
    saveDraft(
      {
        projetoId: 'P1',
        step: 3,
        form: {} as never,
        nomesExistentes: [],
        docExistenteInvalidado: false,
        completedSteps: [1, 2],
        agentMeta: null as never,
        agentArquivosSig: '',
        ganhos: { savingValorAntes: '20000', savingAnexos: [{ base64: grande, filename: 'print.png' }] } as never,
      } as never,
      'teste',
    );
    const raw = store.get('teste')!;
    expect(raw).not.toContain(grande);
    expect(raw.length).toBeLessThan(2000);
    const lido = loadDraft('teste')!;
    expect((lido.ganhos as { savingValorAntes: string }).savingValorAntes).toBe('20000');
    expect((lido.ganhos as { savingAnexos: unknown[] }).savingAnexos).toEqual([]);
  });
});
