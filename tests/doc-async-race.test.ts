import { describe, it, expect, beforeEach } from 'vitest';
import type BetterSqlite3 from 'better-sqlite3';
import { criarDbMemoria } from './helpers/db-memoria';

// Frente 1 (§9.B) — a RACE de lost-update do `documentacao.conteudo`.
//
// Antes: a compilação em segundo plano fazia read-modify-write do blob inteiro e o turno
// `completo` fazia OUTRO read-modify-write com full-replace. Se o background lia antes de o
// saving ser gravado e escrevia depois, o financeiro sumia. A correção: os escritores de
// doc concorrentes gravam SÓ os campos da doc, ATOMICAMENTE, via `json_patch` — as chaves
// não citadas (`saving`/`receita`) ficam intactas. Este teste prova esse invariante contra
// um SQLite de verdade (o mesmo json_patch que roda em produção).

let db: BetterSqlite3.Database;

async function inserirConteudo(projetoId: string, conteudo: Record<string, unknown>) {
  const { upsertDocumentacao } = await import('@/integrations/db/client.server');
  await upsertDocumentacao(projetoId, conteudo);
}

async function lerConteudo(projetoId: string): Promise<Record<string, unknown>> {
  const { getDocumentacao } = await import('@/integrations/db/client.server');
  const row = await getDocumentacao(projetoId);
  return JSON.parse((row as { conteudo: string }).conteudo) as Record<string, unknown>;
}

describe('patchDocumentacaoConteudo — merge atômico sem lost-update (fix da race §9.B)', () => {
  beforeEach(async () => {
    db = await criarDbMemoria();
    // Sem FK: o teste foca no blob de documentacao, não precisa de um projeto real.
    db.pragma('foreign_keys = OFF');
  });

  it('preserva saving/receita ao gravar os campos da doc (o cenário do lost-update)', async () => {
    const { patchDocumentacaoConteudo } = await import('@/integrations/db/client.server');
    // Estado que o turno `completo` deixou: placeholder + financeiro já gravado.
    await inserirConteudo('p1', {
      compilacao_pendente: true,
      coletado_pendente: { nome_projeto: 'X' },
      saving: { horas: 10, saving_reais: 1234 },
      receita: { valor: 5 },
    });

    // O background compila e grava SÓ os campos da doc + limpa a pendência.
    await patchDocumentacaoConteudo('p1', {
      o_que_faz: 'Faz X',
      fluxo: [{ etapa: 'A', descricao: 'passo' }],
      tem_ia_como_funcionalidade: true,
      compilacao_pendente: null,
      coletado_pendente: null,
    });

    const c = await lerConteudo('p1');
    // Financeiro INTACTO — o que a race apagava.
    expect(c.saving).toEqual({ horas: 10, saving_reais: 1234 });
    expect(c.receita).toEqual({ valor: 5 });
    // Campos da doc gravados.
    expect(c.o_que_faz).toBe('Faz X');
    expect(c.fluxo).toEqual([{ etapa: 'A', descricao: 'passo' }]);
    expect(c.tem_ia_como_funcionalidade).toBe(true);
    // Chaves de pendência REMOVIDAS (null no patch deleta).
    expect('compilacao_pendente' in c).toBe(false);
    expect('coletado_pendente' in c).toBe(false);
  });

  it('funciona quando ainda não há saving (submissão nova) — grava doc, sem inventar saving', async () => {
    const { patchDocumentacaoConteudo } = await import('@/integrations/db/client.server');
    await inserirConteudo('p2', {
      compilacao_pendente: true,
      coletado_pendente: { nome_projeto: 'Y' },
    });

    await patchDocumentacaoConteudo('p2', {
      o_que_faz: 'Faz Y',
      compilacao_pendente: null,
      coletado_pendente: null,
    });

    const c = await lerConteudo('p2');
    expect(c.o_que_faz).toBe('Faz Y');
    expect('saving' in c).toBe(false);
    expect('compilacao_pendente' in c).toBe(false);
  });

  it('devolve 0 quando não há row para o projeto (sinaliza fallback)', async () => {
    const { patchDocumentacaoConteudo } = await import('@/integrations/db/client.server');
    const linhas = await patchDocumentacaoConteudo('inexistente', { o_que_faz: 'z' });
    expect(linhas).toBe(0);
  });
});
