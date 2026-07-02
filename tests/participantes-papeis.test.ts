// Papéis dos participantes: distribuição nas 4 colunas do Sheets (IDA) e montagem
// do payload a partir do formulário. Funções puras.
import { describe, it, expect } from 'vitest';
import { derivarColunasPapeis } from '@/lib/google/sync';
import { montarMembrosPapeis } from '@/lib/submeter/constants';

describe('derivarColunasPapeis (membros + papéis → 4 colunas do Sheets)', () => {
  it('distribui cada participante na coluna do seu papel', () => {
    const membros = ['coex@gocase.com', 'plan@gocase.com', 'ideia@gocase.com', 'ref@gocase.com'];
    const papeis = {
      'coex@gocase.com': 'coexecutor',
      'plan@gocase.com': 'planejador',
      'ideia@gocase.com': 'idealizador',
      'ref@gocase.com': 'referencia_tecnica',
    };
    expect(derivarColunasPapeis(membros, papeis)).toEqual({
      coexecutor: 'coex@gocase.com',
      planejador: 'plan@gocase.com',
      idealizador: 'ideia@gocase.com',
      referencia_tecnica: 'ref@gocase.com',
    });
  });

  it('agrupa múltiplos e-mails do mesmo papel (join por vírgula)', () => {
    const membros = ['a@gocase.com', 'b@gocase.com'];
    const papeis = { 'a@gocase.com': 'idealizador', 'b@gocase.com': 'idealizador' };
    const r = derivarColunasPapeis(membros, papeis);
    expect(r.idealizador).toBe('a@gocase.com, b@gocase.com');
    expect(r.coexecutor).toBe('');
    expect(r.planejador).toBe('');
    expect(r.referencia_tecnica).toBe('');
  });

  it('papel ausente/desconhecido cai em coexecutor (retrocompatível)', () => {
    const membros = ['legado@gocase.com', 'ruido@gocase.com'];
    const papeis = { 'ruido@gocase.com': 'papel_invalido' };
    const r = derivarColunasPapeis(membros, papeis);
    expect(r.coexecutor).toBe('legado@gocase.com, ruido@gocase.com');
  });

  it('lookup do papel é tolerante a caixa do e-mail', () => {
    const membros = ['Fulano@Gocase.com'];
    const papeis = { 'fulano@gocase.com': 'planejador' };
    expect(derivarColunasPapeis(membros, papeis).planejador).toBe('Fulano@Gocase.com');
  });

  it('sem participantes → todas as colunas vazias (viram "—" no padronizarLinha)', () => {
    expect(derivarColunasPapeis([], {})).toEqual({
      coexecutor: '', planejador: '', idealizador: '', referencia_tecnica: '',
    });
  });
});

describe('montarMembrosPapeis (formulário → payload membros_papeis)', () => {
  it('só inclui participantes atuais com papel escolhido (descarta vazios)', () => {
    const participantes = ['a@gocase.com', 'b@gocase.com', 'c@gocase.com'];
    const papeis = {
      'a@gocase.com': 'coexecutor' as const,
      'b@gocase.com': '' as const, // ainda não escolhido → não entra
      'c@gocase.com': 'idealizador' as const,
    };
    expect(montarMembrosPapeis(participantes, papeis)).toEqual({
      'a@gocase.com': 'coexecutor',
      'c@gocase.com': 'idealizador',
    });
  });

  it('ignora papéis de e-mails que não estão mais na lista', () => {
    const participantes = ['a@gocase.com'];
    const papeis = { 'a@gocase.com': 'planejador' as const, 'removido@gocase.com': 'coexecutor' as const };
    expect(montarMembrosPapeis(participantes, papeis)).toEqual({ 'a@gocase.com': 'planejador' });
  });
});
