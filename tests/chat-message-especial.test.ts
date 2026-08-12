import { describe, it, expect } from 'vitest';
import { buildSubmitMessage } from '@/lib/google/chat';

// Base de parâmetros de um projeto NÃO-especial (com saving/receita) para reuso.
const base = {
  projeto: 'Automação X',
  area: 'Operações',
  ferramenta: 'n8n',
  escopo: 'interno',
  tipos: 'saving',
  nomeCompleto: 'Fulano de Tal',
  email: 'fulano@gocase.com',
  participantes: 'Beltrano',
  descricao: 'Descrição do projeto.',
  savingHoras: 120,
  savingReais: 5000,
  tipoSaving: 'mensal',
  receitaValor: 0,
  tipoReceita: '',
  dataSubmissao: '08/07/2026',
  modo: 'novo' as const,
};

const SEPARADOR = '──────────────────────';

describe('buildSubmitMessage — alerta de projeto especial', () => {
  it('projeto padrão mantém as linhas de saving/escopo/tipos', () => {
    const msg = buildSubmitMessage(base);
    expect(msg).toContain('Saving estimado (horas/mês)');
    expect(msg).toContain('Saving estimado (R$/mês)');
    expect(msg).toContain('Escopo:');
    expect(msg).toContain('Tipos:');
  });

  it('projeto especial OMITE saving/receita/escopo/tipos e mostra a justificativa', () => {
    const msg = buildSubmitMessage({
      ...base,
      especial: true,
      contextoEspecial: 'Projeto de pesquisa sem saving mensurável, valor estratégico.',
    });
    // Linhas irrelevantes ao caso especial não aparecem.
    expect(msg).not.toContain('Saving estimado');
    expect(msg).not.toContain('Tipo de saving');
    expect(msg).not.toContain('Receita incremental');
    expect(msg).not.toContain('Escopo:');
    expect(msg).not.toContain('Tipos:');
    // Cabeçalho e justificativa próprios do especial.
    expect(msg).toContain('Projeto especial');
    expect(msg).toContain('Por que é um projeto especial:');
    expect(msg).toContain('Projeto de pesquisa sem saving mensurável, valor estratégico.');
    // Metadados que ainda fazem sentido continuam.
    expect(msg).toContain('Automação X');
    expect(msg).toContain('Fulano de Tal');
    expect(msg).toContain('Descrição do projeto.');
  });

  it('especial sem contexto cai no traço (nunca célula vazia)', () => {
    const msg = buildSubmitMessage({ ...base, especial: true, contextoEspecial: '' });
    expect(msg).toContain('Por que é um projeto especial:');
    expect(msg).toContain('—');
  });

  it('edição de projeto especial usa o cabeçalho de edição', () => {
    const msg = buildSubmitMessage({
      ...base,
      modo: 'edicao',
      especial: true,
      contextoEspecial: 'Contexto qualquer.',
    });
    expect(msg).toContain('Edição de projeto especial');
  });
});

// ─── Mensagem do ESPECIAL fica ENXUTA ────────────────────────────────────────
//
// O especial é o único caso que continua avisando o grupo NA SUBMISSÃO (não há líder
// para pré-aprovar). Como ele passou a ser a mensagem que o time lê no dia a dia, ela
// encolhe: fica só o que a triagem precisa para decidir se abre o projeto.
describe('buildSubmitMessage — o alerta do especial é ENXUTO', () => {
  const especial = {
    ...base,
    especial: true,
    contextoEspecial: 'Pesquisa exploratória sem ganho mensurável ainda.',
  };

  it('mantém o essencial: cabeçalho, projeto, área, solicitante, e-mail, descrição, motivo e link', () => {
    const msg = buildSubmitMessage(especial);
    expect(msg).toContain('Projeto especial');
    expect(msg).toContain('Automação X');
    expect(msg).toContain('Operações');
    expect(msg).toContain('Fulano de Tal');
    expect(msg).toContain('fulano@gocase.com');
    expect(msg).toContain('Descrição do projeto.');
    expect(msg).toContain('Por que é um projeto especial:');
    expect(msg).toContain('Pesquisa exploratória sem ganho mensurável ainda.');
    expect(msg).toContain('docs.google.com/spreadsheets');
  });

  it('NÃO traz mais Ferramenta, Participantes, Data da submissão nem separadores', () => {
    const msg = buildSubmitMessage(especial);
    // Pelo VALOR (o rótulo pode mudar de redação; o dado não pode estar lá).
    expect(msg).not.toContain('n8n');
    expect(msg).not.toContain('Beltrano');
    expect(msg).not.toContain('08/07/2026');
    // E pelos rótulos, que é o que a pessoa lê na tela.
    expect(msg).not.toMatch(/Ferramenta/i);
    expect(msg).not.toMatch(/Participantes/i);
    expect(msg).not.toMatch(/Data da submiss/i);
    expect(msg).not.toContain(SEPARADOR);
  });

  it('descrição muito longa é truncada (o alerta não vira um paredão)', () => {
    const descricao =
      'INICIO-DA-DESCRICAO ' + 'texto de encheção de linguiça. '.repeat(120) + 'FIM-DA-DESCRICAO';
    const msg = buildSubmitMessage({ ...especial, descricao });
    expect(msg).toContain('INICIO-DA-DESCRICAO');
    expect(msg).not.toContain('FIM-DA-DESCRICAO');
    expect(msg).not.toContain(descricao);
  });

  it('contexto especial muito longo também é truncado', () => {
    const contextoEspecial =
      'INICIO-DO-CONTEXTO ' + 'justificativa muito comprida. '.repeat(120) + 'FIM-DO-CONTEXTO';
    const msg = buildSubmitMessage({ ...especial, contextoEspecial });
    expect(msg).toContain('INICIO-DO-CONTEXTO');
    expect(msg).not.toContain('FIM-DO-CONTEXTO');
    expect(msg).not.toContain(contextoEspecial);
  });
});

// ─── Nota de "por que não há parecer de líder" ───────────────────────────────
//
// Quando ninguém vai pré-aprovar (autor é liderança / não tem líder / TeamGuide fora),
// o aviso sai na submissão MESMO ASSIM — e leva uma linha dizendo por quê, para quem lê
// o grupo não achar que o parecer está a caminho.
describe('buildSubmitMessage — nota da pré-aprovação', () => {
  const NOTA = 'Sem pré-aprovação: o autor não tem líder cadastrado na TeamGuide.';

  it('sem os parâmetros novos, a mensagem é a mesma de hoje (não regride)', () => {
    const hoje = buildSubmitMessage(base);
    const comNulos = buildSubmitMessage({ ...base, notaPreAprovacao: null, preAprovacao: null });
    expect(comNulos).toBe(hoje);
  });

  it('a nota aparece na mensagem do fluxo normal', () => {
    const msg = buildSubmitMessage({ ...base, notaPreAprovacao: NOTA });
    expect(msg).toContain(NOTA);
  });

  it('a nota aparece também na mensagem do especial', () => {
    const msg = buildSubmitMessage({
      ...base,
      especial: true,
      contextoEspecial: 'Pesquisa.',
      notaPreAprovacao: NOTA,
    });
    expect(msg).toContain(NOTA);
  });

  it('nota vazia/ausente não inventa linha nenhuma', () => {
    const semNota = buildSubmitMessage(base);
    expect(buildSubmitMessage({ ...base, notaPreAprovacao: '' })).toBe(semNota);
    expect(buildSubmitMessage({ ...base, notaPreAprovacao: null })).toBe(semNota);
  });
});

// ─── Mensagem disparada PELA pré-aprovação do líder ──────────────────────────
describe('buildSubmitMessage — projeto pré-aprovado pelo líder', () => {
  const parecer = { por: 'Lucas Gonçalves Queiroz', em: '11/08/2026 14:32' };

  it('o cabeçalho anuncia a PRÉ-APROVAÇÃO, não o "aguardando análise" de hoje', () => {
    const semParecer = buildSubmitMessage(base);
    const comParecer = buildSubmitMessage({ ...base, preAprovacao: parecer });
    expect(comParecer).not.toBe(semParecer);
    expect(comParecer).toMatch(/pré-aprova/i);
  });

  it('o corpo cita quem pré-aprovou e quando', () => {
    const msg = buildSubmitMessage({ ...base, preAprovacao: parecer });
    expect(msg).toContain('Lucas Gonçalves Queiroz');
    expect(msg).toContain('11/08/2026 14:32');
  });

  it('os dados do projeto continuam na mensagem (é ela que a triagem lê)', () => {
    const msg = buildSubmitMessage({ ...base, preAprovacao: parecer });
    expect(msg).toContain('Automação X');
    expect(msg).toContain('Fulano de Tal');
    expect(msg).toContain('Saving estimado (horas/mês)');
  });
});
