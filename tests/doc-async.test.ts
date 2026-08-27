import { afterEach, describe, expect, it } from 'vitest';
import type { DocumentacaoColetada } from '@/lib/agents/types';
import {
  coletadoDePendente,
  docCompilacaoAssincronaAtiva,
  mergeDocCompilada,
  placeholderDocPendente,
  precisaCompilarDoc,
  soCamposDaDoc,
} from '@/lib/agents/doc-async';

// Coletado mínimo reusável nos casos.
function coletadoMinimo(
  extra: Partial<DocumentacaoColetada> = {},
): DocumentacaoColetada {
  return {
    nome_projeto: 'X',
    o_que_faz: 'faz',
    execucao: null,
    dependencias: null,
    fluxo: null,
    configurar_antes: null,
    atencao: null,
    ...extra,
  };
}

// Frente 1 — compilação ASSÍNCRONA da doc (tirar do caminho crítico) + reconciliação.
describe('docCompilacaoAssincronaAtiva — flag opt-in, env LAZY', () => {
  afterEach(() => {
    delete process.env.DOC_COMPILE_ASYNC;
  });

  it('ausente → false (default de hoje = síncrono)', () => {
    delete process.env.DOC_COMPILE_ASYNC;
    expect(docCompilacaoAssincronaAtiva()).toBe(false);
  });

  it('"1" → true', () => {
    process.env.DOC_COMPILE_ASYNC = '1';
    expect(docCompilacaoAssincronaAtiva()).toBe(true);
  });

  it('"true" (case-insensitive) → true', () => {
    process.env.DOC_COMPILE_ASYNC = 'TRUE';
    expect(docCompilacaoAssincronaAtiva()).toBe(true);
  });

  it('valor qualquer ("0"/"nao") → false', () => {
    process.env.DOC_COMPILE_ASYNC = '0';
    expect(docCompilacaoAssincronaAtiva()).toBe(false);
    process.env.DOC_COMPILE_ASYNC = 'nao';
    expect(docCompilacaoAssincronaAtiva()).toBe(false);
  });
});

describe('placeholderDocPendente — marca a doc para compilar depois', () => {
  it('carrega a flag, o coletado e o tem_ia', () => {
    const coletado = coletadoMinimo({ tem_ia_como_funcionalidade: true });
    const ph = placeholderDocPendente(coletado);
    expect(ph.compilacao_pendente).toBe(true);
    expect(ph.coletado_pendente).toEqual(coletado);
    expect(ph.tem_ia_como_funcionalidade).toBe(true);
  });

  it('tem_ia ausente → null', () => {
    const coletado = coletadoMinimo();
    const ph = placeholderDocPendente(coletado);
    expect(ph.tem_ia_como_funcionalidade).toBeNull();
  });
});

describe('precisaCompilarDoc — só quando a flag está estritamente true', () => {
  it('flag === true → true', () => {
    expect(precisaCompilarDoc({ compilacao_pendente: true })).toBe(true);
  });

  it('null → false', () => {
    expect(precisaCompilarDoc(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(precisaCompilarDoc(undefined)).toBe(false);
  });

  it('objeto sem a flag → false', () => {
    expect(precisaCompilarDoc({ o_que_faz: 'faz' })).toBe(false);
  });

  it('flag truthy porém !== true → false', () => {
    expect(precisaCompilarDoc({ compilacao_pendente: 'sim' as unknown as boolean })).toBe(
      false,
    );
  });
});

describe('coletadoDePendente — extrai o coletado guardado', () => {
  it('devolve o coletado_pendente quando é objeto', () => {
    const coletado = coletadoMinimo();
    expect(coletadoDePendente({ coletado_pendente: coletado })).toEqual(coletado);
  });

  it('sem coletado_pendente → null', () => {
    expect(coletadoDePendente({ compilacao_pendente: true })).toBeNull();
  });

  it('null/undefined → null', () => {
    expect(coletadoDePendente(null)).toBeNull();
    expect(coletadoDePendente(undefined)).toBeNull();
  });
});

describe('mergeDocCompilada — funde a doc compilada preservando o financeiro', () => {
  it('preserva saving e receita intactos', () => {
    const atual = {
      saving: { horas: 10 },
      receita: { valor: 5 },
      compilacao_pendente: true,
      coletado_pendente: coletadoMinimo(),
    };
    const docCompilada = { o_que_faz: 'faz X', fluxo: 'passo a passo' };
    const coletado = coletadoMinimo();
    const res = mergeDocCompilada(atual, docCompilada, coletado);
    expect(res.saving).toEqual({ horas: 10 });
    expect(res.receita).toEqual({ valor: 5 });
  });

  it('sobrepõe os campos da doc compilada (compilada vence)', () => {
    const atual = { o_que_faz: 'antigo' };
    const docCompilada = { o_que_faz: 'novo', fluxo: 'f' };
    const res = mergeDocCompilada(atual, docCompilada, coletadoMinimo());
    expect(res.o_que_faz).toBe('novo');
    expect(res.fluxo).toBe('f');
  });

  it('remove as chaves de pendência do resultado', () => {
    const atual = {
      saving: { horas: 10 },
      compilacao_pendente: true,
      coletado_pendente: coletadoMinimo(),
    };
    const res = mergeDocCompilada(atual, { o_que_faz: 'faz' }, coletadoMinimo());
    expect('compilacao_pendente' in res).toBe(false);
    expect('coletado_pendente' in res).toBe(false);
  });

  it('tem_ia vem do coletado quando presente', () => {
    const res = mergeDocCompilada(
      { tem_ia_como_funcionalidade: false },
      { o_que_faz: 'faz' },
      coletadoMinimo({ tem_ia_como_funcionalidade: true }),
    );
    expect(res.tem_ia_como_funcionalidade).toBe(true);
  });

  it('tem_ia cai no de atual quando o coletado não tem', () => {
    const res = mergeDocCompilada(
      { tem_ia_como_funcionalidade: false },
      { o_que_faz: 'faz' },
      coletadoMinimo(),
    );
    expect(res.tem_ia_como_funcionalidade).toBe(false);
  });

  it('tem_ia = null quando nem coletado nem atual têm', () => {
    const res = mergeDocCompilada({}, { o_que_faz: 'faz' }, coletadoMinimo());
    expect(res.tem_ia_como_funcionalidade).toBeNull();
  });

  it('atual null/undefined é aceito (funde sobre {})', () => {
    const docCompilada = { o_que_faz: 'faz' };
    const coletado = coletadoMinimo();
    expect(mergeDocCompilada(null, docCompilada, coletado).o_que_faz).toBe('faz');
    expect(mergeDocCompilada(undefined, docCompilada, coletado).o_que_faz).toBe('faz');
  });

  it('NÃO deixa um saving/receita alucinado na doc compilada sobrescrever o financeiro (§9.B)', () => {
    const atual = { saving: { horas: 10 }, receita: { valor: 5 } };
    // O LLM "alucinou" saving/receita no JSON da doc compilada.
    const docCompilada = {
      o_que_faz: 'faz',
      saving: { horas: 999 },
      receita: { valor: 999 },
    };
    const res = mergeDocCompilada(atual, docCompilada, coletadoMinimo());
    expect(res.o_que_faz).toBe('faz');
    expect(res.saving).toEqual({ horas: 10 }); // financeiro autoritativo preservado
    expect(res.receita).toEqual({ valor: 5 });
  });
});

describe('soCamposDaDoc — remove as chaves protegidas (financeiro/controle)', () => {
  it('tira saving/receita/compilacao_pendente/coletado_pendente e mantém os campos da doc', () => {
    const limpo = soCamposDaDoc({
      o_que_faz: 'faz',
      fluxo: 'f',
      saving: { horas: 1 },
      receita: { valor: 2 },
      compilacao_pendente: true,
      coletado_pendente: { nome_projeto: 'X' },
    });
    expect(limpo).toEqual({ o_que_faz: 'faz', fluxo: 'f' });
  });
});
