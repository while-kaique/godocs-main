// Papéis dos participantes: distribuição nas 3 colunas do Sheets (IDA) e montagem
// do payload a partir do formulário. Funções puras.
// Papéis atuais: coexecutor("Coautor"→"Participantes") · planejador("Participante"→
// "Participantes 2") · contribuidor("Contribuidor"→"Contribuidor"). Os `value` internos
// coexecutor/planejador foram mantidos ao renomear rótulos/colunas.
import { describe, it, expect } from 'vitest';
import { derivarColunasPapeis } from '@/lib/google/sync';
import { montarMembrosPapeis } from '@/lib/submeter/constants';

describe('derivarColunasPapeis (membros + papéis → 3 colunas do Sheets)', () => {
  it('distribui cada participante na coluna do seu papel', () => {
    const membros = ['coex@gocase.com', 'plan@gocase.com', 'contrib@gocase.com'];
    const papeis = {
      'coex@gocase.com': 'coexecutor',
      'plan@gocase.com': 'planejador',
      'contrib@gocase.com': 'contribuidor',
    };
    expect(derivarColunasPapeis(membros, papeis)).toEqual({
      coexecutor: 'coex@gocase.com',
      planejador: 'plan@gocase.com',
      contribuidor: 'contrib@gocase.com',
    });
  });

  it('agrupa múltiplos e-mails do mesmo papel (join por vírgula)', () => {
    const membros = ['a@gocase.com', 'b@gocase.com'];
    const papeis = { 'a@gocase.com': 'contribuidor', 'b@gocase.com': 'contribuidor' };
    const r = derivarColunasPapeis(membros, papeis);
    expect(r.contribuidor).toBe('a@gocase.com, b@gocase.com');
    expect(r.coexecutor).toBe('');
    expect(r.planejador).toBe('');
  });

  it('papéis LEGADOS (idealizador/referencia_tecnica) caem em contribuidor', () => {
    const membros = ['ideia@gocase.com', 'ref@gocase.com'];
    const papeis = { 'ideia@gocase.com': 'idealizador', 'ref@gocase.com': 'referencia_tecnica' };
    const r = derivarColunasPapeis(membros, papeis);
    expect(r.contribuidor).toBe('ideia@gocase.com, ref@gocase.com');
    expect(r.coexecutor).toBe('');
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
      coexecutor: '', planejador: '', contribuidor: '',
    });
  });
});

describe('montarMembrosPapeis (formulário → payload membros_papeis)', () => {
  it('só inclui participantes atuais com papel escolhido (descarta vazios)', () => {
    const participantes = ['a@gocase.com', 'b@gocase.com', 'c@gocase.com'];
    const papeis = {
      'a@gocase.com': 'coexecutor' as const,
      'b@gocase.com': '' as const, // ainda não escolhido → não entra
      'c@gocase.com': 'contribuidor' as const,
    };
    expect(montarMembrosPapeis(participantes, papeis)).toEqual({
      'a@gocase.com': 'coexecutor',
      'c@gocase.com': 'contribuidor',
    });
  });

  it('ignora papéis de e-mails que não estão mais na lista', () => {
    const participantes = ['a@gocase.com'];
    const papeis = { 'a@gocase.com': 'planejador' as const, 'removido@gocase.com': 'coexecutor' as const };
    expect(montarMembrosPapeis(participantes, papeis)).toEqual({ 'a@gocase.com': 'planejador' });
  });
});

// T3/RF-104: editar SÓ participantes/papéis precisa disparar `metaChanged`
// (submeter.tsx compara JSON.stringify de {participantes, participantesPapeis} entre o
// seed `agentMeta` e o `snapshotMeta`, ambos normalizados por `montarMembrosPapeis`).
// Este teste guarda a comparação "apples-to-apples": mudança dispara, "sem mudança" não.
describe('metaChanged por participantes/papéis (edição participante-only)', () => {
  // Assinatura idêntica à comparada em submeter.tsx (só a parte de participantes).
  const sig = (participantes: string[], papeis: Record<string, 'coexecutor' | 'planejador' | 'contribuidor' | ''>) =>
    JSON.stringify({ participantes, participantesPapeis: montarMembrosPapeis(participantes, papeis) });

  const membros = ['a@gocase.com', 'b@gocase.com'];
  const papeisSeed = { 'a@gocase.com': 'coexecutor' as const, 'b@gocase.com': 'contribuidor' as const };
  const seed = sig(membros, papeisSeed);

  it('edição sem alteração NÃO dispara metaChanged (evita reprocesso falso)', () => {
    expect(sig(membros, papeisSeed)).toBe(seed);
  });

  it('trocar o papel de um participante dispara metaChanged', () => {
    const depois = sig(membros, { ...papeisSeed, 'b@gocase.com': 'planejador' });
    expect(depois).not.toBe(seed);
  });

  it('adicionar um participante dispara metaChanged', () => {
    const depois = sig(
      [...membros, 'c@gocase.com'],
      { ...papeisSeed, 'c@gocase.com': 'coexecutor' },
    );
    expect(depois).not.toBe(seed);
  });

  it('remover um participante dispara metaChanged', () => {
    const depois = sig(['a@gocase.com'], { 'a@gocase.com': 'coexecutor' });
    expect(depois).not.toBe(seed);
  });
});
