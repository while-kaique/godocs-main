// Rastreabilidade do analisador: campo LEGADO vazio × custo evitado nomeado.
//
// Origem (caso real "Bot de Faturamento V2", 05/08/2026): o projeto eliminou um
// contrato de equipe terceirizada de R$ 3.600/mês — um ponteiro de CUSTO nomeado e
// conferível — e mesmo assim saiu ZONA CINZENTA, com o analisador escrevendo que
// não havia "indicador nomeado e verificável com ponteiro movido preenchido".
//
// Duas causas, cobertas aqui:
//   1. `ponteiro_movido`/`ponteiro_evidencia` são LEGADO (nada os escreve desde
//      03/08/2026) mas eram enviados SEMPRE, como `null` — um sinal FALSO de
//      "o autor não respondeu", em toda submissão nova.
//   2. O analisador recebia o TOTAL do custo evitado, mas não os ITENS que nomeiam
//      o contrato encerrado — e a régua não dizia que contrato encerrado vale como
//      indicador.
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserMessage } from '@/lib/agents/analyzer';

/** Normaliza para asserção robusta: minúsculas, sem acento, espaços colapsados. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Extrai o JSON que `buildUserMessage` embute na mensagem. */
function payload(projeto: Record<string, unknown>, conteudo: Record<string, unknown>) {
  const msg = buildUserMessage(projeto, conteudo);
  const json = msg.slice(msg.indexOf('{'));
  return JSON.parse(json) as Record<string, any>;
}

const PROJETO_BASE = {
  nome: 'Bot de Faturamento V2',
  responsavel_nome: 'Fulano',
  responsavel_email: 'fulano@x.com',
  contrafactual_afetados: 'time:OPERACOES',
};

describe('campos LEGADO de ponteiro não são enviados vazios', () => {
  it('OMITE ponteiro_movido/ponteiro_evidencia quando nulos (submissão nova)', () => {
    const p = payload({ ...PROJETO_BASE, ponteiro_movido: null, ponteiro_evidencia: null }, {});

    // A CHAVE não pode existir: presente-e-nula, o analisador a lê como
    // "o autor não preencheu" e rebaixa a rastreabilidade.
    expect(p.metadados).not.toHaveProperty('ponteiro_movido');
    expect(p.metadados).not.toHaveProperty('ponteiro_evidencia');
    // O contrafactual (esse SIM ainda é coletado) continua indo.
    expect(p.metadados.contrafactual_afetados).toBe('time:OPERACOES');
  });

  it('OMITE também quando ausentes ou string vazia', () => {
    const p = payload({ ...PROJETO_BASE, ponteiro_evidencia: '' }, {});
    expect(p.metadados).not.toHaveProperty('ponteiro_movido');
    expect(p.metadados).not.toHaveProperty('ponteiro_evidencia');
  });

  it('ENVIA quando realmente preenchidos (submissão legada vale como resposta do autor)', () => {
    const p = payload(
      { ...PROJETO_BASE, ponteiro_movido: 'Custo de frete', ponteiro_evidencia: 'Painel de logística' },
      {},
    );
    expect(p.metadados.ponteiro_movido).toBe('Custo de frete');
    expect(p.metadados.ponteiro_evidencia).toBe('Painel de logística');
  });
});

describe('itens do custo evitado chegam nomeados ao analisador', () => {
  const itens = [
    { nome: 'Equipe Terceirizada', valor: 3600, recorrencia: 'mensal', justificativa: 'Fazia o faturamento manual.' },
  ];

  it('inclui custo_evitado_itens no memorial_saving', () => {
    const p = payload(
      { ...PROJETO_BASE, custo_evitado_itens: JSON.stringify(itens) },
      { saving: { custo_evitado_reais: 3600, economia_horas_mes: 10 } },
    );

    expect(p.memorial_saving.custo_evitado_reais).toBe(3600);
    expect(p.memorial_saving.custo_evitado_itens).toHaveLength(1);
    expect(p.memorial_saving.custo_evitado_itens[0].nome).toBe('Equipe Terceirizada');
  });

  it('cai em lista vazia quando não há itens (não quebra nem inventa)', () => {
    const p = payload({ ...PROJETO_BASE, custo_evitado_itens: null }, { saving: { custo_evitado_reais: 0 } });
    expect(p.memorial_saving.custo_evitado_itens).toEqual([]);
  });
});

describe('a régua declara que contrato encerrado é indicador nomeado', () => {
  const PROMPT = norm(buildSystemPrompt());

  it('diz que serviço/contrato externo encerrado comprova a rastreabilidade pelo custo', () => {
    expect(PROMPT).toContain('contrato/servico externo encerrado e indicador nomeado');
    expect(PROMPT).toContain('custo_evitado_itens');
  });

  it('proíbe rebaixar por faltar painel/KPI quando o ponteiro é o custo', () => {
    expect(PROMPT).toContain('nao rebaixe por faltar painel ou kpi');
  });

  it('mantém a trava de que o próprio entregável NÃO conta (não afrouxou a régua)', () => {
    expect(PROMPT).toContain('o proprio entregavel nao conta como indicador');
  });
});
