// Fatia C — reordenar wizard (doc paralela, refino no final).
// Encoda o COMPORTAMENTO CORRETO das 4 funções PURAS novas (ainda não implementadas):
//   1. reorderDocFinal()        — flag opt-in LAZY  (@/lib/agents/doc-async)
//   2. coletadoVazio()          — 6 campos de substância vazios (@/lib/agents/doc-async)
//   3. coletadoInicialDoBlob()  — recupera coletado_inicial do blob (@/lib/agents/doc-async)
//   4. proximaFase()            — FONTE ÚNICA do mapa de transição (@/lib/agents/orchestrator)
// + 1 invariante existente: mergeDocCompilada preserva coletado_inicial.

import { afterEach, describe, expect, it } from 'vitest';
import type { ChatFase, DocumentacaoColetada } from '@/lib/agents/types';
import { documentacaoVazia } from '@/lib/agents/types';
import {
  coletadoIgual,
  coletadoInicialDoBlob,
  coletadoVazio,
  mergeDocCompilada,
  reorderDocFinal,
  resolverColetadoFinanceiro,
} from '@/lib/agents/doc-async';
import { proximaFase } from '@/lib/agents/orchestrator';

const comSubstancia = (extra: Partial<DocumentacaoColetada> = {}): DocumentacaoColetada => ({
  ...documentacaoVazia(),
  nome_projeto: 'P',
  o_que_faz: 'faz algo',
  ...extra,
});

// ─── Função 1 — reorderDocFinal() (flag opt-in, LAZY) ───────────────────────
describe('reorderDocFinal()', () => {
  const original = process.env.REORDER_DOC_FINAL;
  afterEach(() => {
    if (original === undefined) delete process.env.REORDER_DOC_FINAL;
    else process.env.REORDER_DOC_FINAL = original;
  });

  function comEnv(valor: string | undefined): boolean {
    if (valor === undefined) delete process.env.REORDER_DOC_FINAL;
    else process.env.REORDER_DOC_FINAL = valor;
    return reorderDocFinal();
  }

  it('unset → false', () => expect(comEnv(undefined)).toBe(false));
  it('"1" → true', () => expect(comEnv('1')).toBe(true));
  it('"true" → true', () => expect(comEnv('true')).toBe(true));
  it('"TRUE" → true (case-insensitive)', () => expect(comEnv('TRUE')).toBe(true));
  it('" 1 " → true (trim)', () => expect(comEnv(' 1 ')).toBe(true));
  it('"0" → false', () => expect(comEnv('0')).toBe(false));
  it('"false" → false', () => expect(comEnv('false')).toBe(false));
  it('"sim" → false', () => expect(comEnv('sim')).toBe(false));
  it('"" (vazio) → false', () => expect(comEnv('')).toBe(false));
});

// ─── Função 2 — coletadoVazio() ──────────────────────────────────────────────
describe('coletadoVazio()', () => {
  it('documentacaoVazia() → true (tudo null)', () => {
    expect(coletadoVazio(documentacaoVazia())).toBe(true);
  });

  it('nome_projeto preenchido NÃO conta → true', () => {
    expect(coletadoVazio({ ...documentacaoVazia(), nome_projeto: 'X' })).toBe(true);
  });

  it('o_que_faz preenchido → false', () => {
    expect(coletadoVazio({ ...documentacaoVazia(), o_que_faz: 'faz algo' })).toBe(false);
  });

  it('os 6 campos de substância preenchidos → false', () => {
    const cheio: DocumentacaoColetada = {
      ...documentacaoVazia(),
      o_que_faz: 'a',
      execucao: 'b',
      dependencias: 'c',
      fluxo: 'd',
      configurar_antes: 'e',
      atencao: 'f',
    };
    expect(coletadoVazio(cheio)).toBe(false);
  });

  it('só whitespace num campo de substância conta como vazio → true', () => {
    expect(coletadoVazio({ ...documentacaoVazia(), fluxo: '   ' })).toBe(true);
  });
});

// ─── Função 3 — coletadoInicialDoBlob() ──────────────────────────────────────
describe('coletadoInicialDoBlob()', () => {
  it('null → null', () => expect(coletadoInicialDoBlob(null)).toBeNull());
  it('undefined → null', () => expect(coletadoInicialDoBlob(undefined)).toBeNull());
  it('{} (ausente) → null', () => expect(coletadoInicialDoBlob({})).toBeNull());
  it('{coletado_inicial: null} → null', () =>
    expect(coletadoInicialDoBlob({ coletado_inicial: null })).toBeNull());
  it('{coletado_inicial: "string"} (não-objeto) → null', () =>
    expect(coletadoInicialDoBlob({ coletado_inicial: 'string' })).toBeNull());
  it('presente e objeto → devolve o objeto', () => {
    const obj = { nome_projeto: 'X', o_que_faz: 'y' };
    expect(coletadoInicialDoBlob({ coletado_inicial: obj })).toEqual(obj);
  });
});

// ─── Função 4 — proximaFase() — a TRANSIÇÃO (núcleo da fatia) ─────────────────
describe('proximaFase()', () => {
  type Opts = { hasSaving: boolean; hasReceita: boolean; reorderDocFinal: boolean };
  const opts = (o: Partial<Opts> = {}): Opts => ({
    hasSaving: false,
    hasReceita: false,
    reorderDocFinal: false,
    ...o,
  });

  describe('type "preview" (independe de reorder/has*)', () => {
    it('doc → doc_preview', () =>
      expect(proximaFase('doc', 'preview', opts())).toBe<ChatFase>('doc_preview'));
    it('saving → saving_preview', () =>
      expect(proximaFase('saving', 'preview', opts())).toBe<ChatFase>('saving_preview'));
    it('receita → receita_preview', () =>
      expect(proximaFase('receita', 'preview', opts())).toBe<ChatFase>('receita_preview'));
    it('faseAtual sem preview definido → inalterada', () =>
      expect(proximaFase('completo', 'preview', opts())).toBe<ChatFase>('completo'));
  });

  describe('type "complete", reorderDocFinal=false (ordem ATUAL doc→financeiro)', () => {
    it('doc_preview + hasSaving → saving', () =>
      expect(proximaFase('doc_preview', 'complete', opts({ hasSaving: true }))).toBe<ChatFase>(
        'saving',
      ));
    it('doc_preview + !hasSaving + hasReceita → receita', () =>
      expect(proximaFase('doc_preview', 'complete', opts({ hasReceita: true }))).toBe<ChatFase>(
        'receita',
      ));
    it('doc_preview + !ambos → completo', () =>
      expect(proximaFase('doc_preview', 'complete', opts())).toBe<ChatFase>('completo'));
    it('saving_preview + hasReceita → receita', () =>
      expect(proximaFase('saving_preview', 'complete', opts({ hasReceita: true }))).toBe<ChatFase>(
        'receita',
      ));
    it('saving_preview + !hasReceita → completo', () =>
      expect(proximaFase('saving_preview', 'complete', opts())).toBe<ChatFase>('completo'));
    it('receita_preview → completo', () =>
      expect(proximaFase('receita_preview', 'complete', opts())).toBe<ChatFase>('completo'));
    it('faseAtual não-preview → inalterada', () =>
      expect(proximaFase('doc', 'complete', opts({ hasSaving: true }))).toBe<ChatFase>('doc'));
  });

  describe('type "complete", reorderDocFinal=true (ordem INVERTIDA financeiro→doc-refino)', () => {
    it('saving_preview + hasReceita → receita', () =>
      expect(
        proximaFase('saving_preview', 'complete', opts({ hasReceita: true, reorderDocFinal: true })),
      ).toBe<ChatFase>('receita'));
    it('saving_preview + !hasReceita → doc', () =>
      expect(
        proximaFase('saving_preview', 'complete', opts({ reorderDocFinal: true })),
      ).toBe<ChatFase>('doc'));
    it('receita_preview → doc', () =>
      expect(
        proximaFase('receita_preview', 'complete', opts({ reorderDocFinal: true })),
      ).toBe<ChatFase>('doc'));
    it('doc_preview → completo', () =>
      expect(
        proximaFase('doc_preview', 'complete', opts({ hasSaving: true, reorderDocFinal: true })),
      ).toBe<ChatFase>('completo'));
  });

  describe('qualquer outro type → faseAtual inalterada', () => {
    it('type "question" em saving_preview → saving_preview', () =>
      expect(
        proximaFase('saving_preview', 'question', opts({ hasReceita: true })),
      ).toBe<ChatFase>('saving_preview'));
    it('type "options" em doc_preview → doc_preview', () =>
      expect(proximaFase('doc_preview', 'options', opts({ hasSaving: true }))).toBe<ChatFase>(
        'doc_preview',
      ));
  });
});

// ─── Invariante existente — mergeDocCompilada preserva coletado_inicial ───────
describe('mergeDocCompilada() preserva coletado_inicial (invariante existente)', () => {
  it('não apaga coletado_inicial do blob atual', () => {
    const resultado = mergeDocCompilada(
      { coletado_inicial: { nome_projeto: 'X' }, saving: { foo: 1 } },
      { o_que_faz: 'z' },
      documentacaoVazia(),
    );
    expect(resultado).toHaveProperty('coletado_inicial');
    expect(resultado.coletado_inicial).toEqual({ nome_projeto: 'X' });
  });
});

// ─── resolverColetadoFinanceiro — memorial financeiro nunca sai em branco ──────
describe('resolverColetadoFinanceiro() — escolhe o coletado do preview financeiro', () => {
  it('fluxo normal: chat tem substância → usa o do chat (blob ignorado)', () => {
    const chat = comSubstancia({ o_que_faz: 'do chat' });
    const blob = comSubstancia({ o_que_faz: 'do blob' });
    expect(resolverColetadoFinanceiro(chat, blob)).toBe(chat);
  });
  it('fluxo REORDENADO: chat vazio → usa o coletado_inicial do blob', () => {
    const chat = documentacaoVazia();
    const blob = comSubstancia({ o_que_faz: 'do blob' });
    expect(resolverColetadoFinanceiro(chat, blob)).toBe(blob);
  });
  it('chat vazio E blob nulo → devolve o do chat (não piora)', () => {
    const chat = documentacaoVazia();
    expect(resolverColetadoFinanceiro(chat, null)).toBe(chat);
  });
  it('chat vazio E blob também vazio → devolve o do chat', () => {
    const chat = documentacaoVazia();
    expect(resolverColetadoFinanceiro(chat, documentacaoVazia())).toBe(chat);
  });
  it('nome_projeto no chat não conta como substância → cai no blob', () => {
    const chat = { ...documentacaoVazia(), nome_projeto: 'só o nome' };
    const blob = comSubstancia();
    expect(resolverColetadoFinanceiro(chat, blob)).toBe(blob);
  });
});

// ─── coletadoIgual — comparação estável (recompila doc só no delta) ────────────
describe('coletadoIgual() — igualdade campo a campo (independe da ordem das chaves)', () => {
  it('mesmos valores em ordem de chaves diferente → iguais', () => {
    const a: DocumentacaoColetada = { nome_projeto: 'P', o_que_faz: 'x', execucao: 'e', dependencias: null, fluxo: null, configurar_antes: null, atencao: null, tem_ia_como_funcionalidade: true };
    // Mesmos valores, chaves inseridas em ordem inversa (JSON.stringify divergiria).
    const b: DocumentacaoColetada = { tem_ia_como_funcionalidade: true, atencao: null, configurar_antes: null, fluxo: null, dependencias: null, execucao: 'e', o_que_faz: 'x', nome_projeto: 'P' };
    expect(coletadoIgual(a, b)).toBe(true);
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false); // prova que stringify falharia
  });
  it('um campo de substância diferente → diferentes (refino mudou → recompila)', () => {
    expect(coletadoIgual(comSubstancia({ fluxo: 'A' }), comSubstancia({ fluxo: 'B' }))).toBe(false);
  });
  it('null vs objeto → diferentes (recompila, direção segura)', () => {
    expect(coletadoIgual(null, comSubstancia())).toBe(false);
  });
  it('ambos null/undefined → iguais', () => {
    expect(coletadoIgual(null, null)).toBe(true);
    expect(coletadoIgual(undefined, undefined)).toBe(true);
  });
  it('null em campo trata igual a ausente (?? null)', () => {
    const a = { ...comSubstancia(), atencao: null };
    const b = { ...comSubstancia() };
    delete (b as Record<string, unknown>).atencao;
    expect(coletadoIgual(a, b as DocumentacaoColetada)).toBe(true);
  });
});
