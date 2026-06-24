// Testes: base das horas (padrão CLT 220h/mês) — escopo do gate + prompt.
// O gate Sim/Não é determinístico (chat.functions.ts); aqui cobrimos as peças
// puras exportadas do orquestrador e o escopo do bloco no prompt do saving.
import { describe, it, expect } from 'vitest';
import {
  aplicaConfirmacaoBaseHoras,
  totalEconomiaHoras,
  buildSavingPrompt,
  unidadeHorasDe,
  periodoSavingInfo,
} from '@/lib/agents/orchestrator';
import { savingVazio } from '@/lib/agents/types';
import type { ProjetoContexto, DocumentacaoColetada, SavingColetado, SavingLinha } from '@/lib/agents/types';

const ctxBase = (over: Partial<ProjetoContexto> = {}): ProjetoContexto => ({
  responsavel_nome: 'X',
  responsavel_email: 'x@y.com',
  area: null,
  ferramenta: 'Python',
  membros: [],
  nome_projeto: 'P',
  data_criacao: null,
  doc_texto: null,
  ...over,
});

const linha = (over: Partial<SavingLinha> = {}): SavingLinha => ({
  cargo: 'Analista Pleno',
  horas_antes: 40,
  horas_depois: 2,
  valor_hora: 29.9,
  economia_horas_mes: 38,
  economia_reais_mes: 0,
  ...over,
});

const savingRotinaReal = (over: Partial<SavingColetado> = {}): SavingColetado => ({
  ...savingVazio(),
  linhas: [linha()],
  economia_horas_mes: 38,
  tipo_saving: 'mensal',
  ...over,
});

const doc: DocumentacaoColetada = {
  nome_projeto: 'P', o_que_faz: 'x', execucao: 'x', dependencias: 'x',
  fluxo: 'x', configurar_antes: 'x', atencao: 'x',
};

describe('aplicaConfirmacaoBaseHoras (escopo: rotina manual real e mensal)', () => {
  it('TRUE para rotina real mensal (horas_antes > 0)', () => {
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), savingRotinaReal())).toBe(true);
  });

  it('FALSE no contrafactual ("ninguém fazia")', () => {
    expect(aplicaConfirmacaoBaseHoras(ctxBase({ alguem_fazia: 'nao' }), savingRotinaReal())).toBe(false);
  });

  it('FALSE no saving pontual', () => {
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), savingRotinaReal({ tipo_saving: 'pontual' }))).toBe(false);
  });

  it('FALSE quando nenhuma linha tem horas_antes > 0', () => {
    const so0 = savingRotinaReal({ linhas: [linha({ horas_antes: 0, horas_depois: 5, economia_horas_mes: 0 })] });
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), so0)).toBe(false);
  });

  it('FALSE sem linhas', () => {
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), savingVazio())).toBe(false);
  });
});

describe('totalEconomiaHoras', () => {
  it('usa economia_horas_mes quando presente', () => {
    expect(totalEconomiaHoras(savingRotinaReal({ economia_horas_mes: 50 }))).toBe(50);
  });

  it('soma das linhas quando o total é null', () => {
    const s = savingRotinaReal({ economia_horas_mes: null, linhas: [linha({ economia_horas_mes: 12 }), linha({ economia_horas_mes: 8 })] });
    expect(totalEconomiaHoras(s)).toBe(20);
  });
});

describe('buildSavingPrompt — bloco BASE DAS HORAS', () => {
  it('inclui o bloco, a régua 220h e o TETO por pessoa em rotina real mensal', () => {
    const p = buildSavingPrompt(ctxBase(), doc, savingRotinaReal(), 'resumo');
    expect(p).toContain('BASE DAS HORAS');
    expect(p).toContain('220');
    expect(p).toContain('22 dias úteis');
    expect(p).toContain('TETO');
  });

  it('traz a exceção de trabalho HUMANO em fim de semana e o teto de 30 dias', () => {
    const p = buildSavingPrompt(ctxBase(), doc, savingRotinaReal(), 'resumo');
    expect(p).toContain('fim de semana');
    expect(p).toContain('30 dias úteis');
    // distinção crítica humano × automação
    expect(p.toLowerCase()).toContain('automação');
    expect(p).toContain('300h');
  });

  it('a confirmação é CONDUZIDA PELO SISTEMA (o LLM não pergunta)', () => {
    const p = buildSavingPrompt(ctxBase(), doc, savingRotinaReal(), 'resumo');
    expect(p).toContain('CONDUZIDA PELO SISTEMA');
    // não deve instruir o LLM a fazer a pergunta ele mesmo
    expect(p).not.toContain('você DEVE perguntar');
  });

  it('menciona o gate de linha acima do teto (uma pessoa × várias unidades)', () => {
    const p = buildSavingPrompt(ctxBase(), doc, savingRotinaReal(), 'resumo');
    expect(p).toContain('LINHA ACIMA DO TETO');
    expect(p.toLowerCase()).toContain('várias pessoas/unidades');
  });

  it('NÃO inclui o bloco no contrafactual', () => {
    const p = buildSavingPrompt(ctxBase({ alguem_fazia: 'nao' }), doc, savingRotinaReal(), 'resumo');
    expect(p).not.toContain('BASE DAS HORAS');
  });

  it('NÃO inclui o bloco no pontual', () => {
    const p = buildSavingPrompt(ctxBase(), doc, savingRotinaReal({ tipo_saving: 'pontual' }), 'resumo');
    expect(p).not.toContain('BASE DAS HORAS');
  });

  it('NÃO inclui o bloco no trimestral/semestral (base não é o mês)', () => {
    const t = buildSavingPrompt(ctxBase(), doc, savingRotinaReal({ tipo_saving: 'trimestral' }), 'resumo');
    const s = buildSavingPrompt(ctxBase(), doc, savingRotinaReal({ tipo_saving: 'semestral' }), 'resumo');
    expect(t).not.toContain('BASE DAS HORAS');
    expect(s).not.toContain('BASE DAS HORAS');
  });
});

describe('periodicidade trimestral/semestral', () => {
  it('aplicaConfirmacaoBaseHoras é FALSE para trimestral e semestral mesmo com rotina real', () => {
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), savingRotinaReal({ tipo_saving: 'trimestral' }))).toBe(false);
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), savingRotinaReal({ tipo_saving: 'semestral' }))).toBe(false);
    // sanidade: mensal segue TRUE
    expect(aplicaConfirmacaoBaseHoras(ctxBase(), savingRotinaReal({ tipo_saving: 'mensal' }))).toBe(true);
  });

  it('periodoSavingInfo mapeia a cadência (e null para mensal/pontual)', () => {
    expect(periodoSavingInfo('trimestral')).toEqual({ nome: 'trimestre', meses: 3 });
    expect(periodoSavingInfo('semestral')).toEqual({ nome: 'semestre', meses: 6 });
    expect(periodoSavingInfo('mensal')).toBeNull();
    expect(periodoSavingInfo('pontual')).toBeNull();
  });

  it('unidadeHorasDe reflete a cadência (acumulado do período)', () => {
    expect(unidadeHorasDe('mensal')).toBe('h/mês');
    expect(unidadeHorasDe('trimestral')).toBe('h/trimestre');
    expect(unidadeHorasDe('semestral')).toBe('h/semestre');
    expect(unidadeHorasDe('pontual')).toBe('h (total único)');
  });

  it('prompt trimestral instrui o ACUMULADO do período e proíbe mensalizar', () => {
    const p = buildSavingPrompt(ctxBase(), doc, savingRotinaReal({ tipo_saving: 'trimestral' }), 'resumo');
    expect(p).toContain('TIPO DE SAVING — TRIMESTRAL');
    expect(p).toContain('ACUMULADO');
    expect(p).toContain('h/trimestre');
    expect(p).toContain('NÃO divida por 3');
  });

  it('o gate de ECONOMIA ALTA (≥44h) NÃO dispara em trimestral, mas dispara em mensal', () => {
    const trimestral = buildSavingPrompt(
      ctxBase(),
      doc,
      savingRotinaReal({ tipo_saving: 'trimestral', economia_horas_mes: 132, linhas: [linha({ economia_horas_mes: 132 })] }),
      'resumo',
    );
    const mensal = buildSavingPrompt(
      ctxBase(),
      doc,
      savingRotinaReal({ tipo_saving: 'mensal', economia_horas_mes: 132, linhas: [linha({ economia_horas_mes: 132 })] }),
      'resumo',
    );
    expect(trimestral).not.toContain('ECONOMIA ALTA DETECTADA');
    expect(mensal).toContain('ECONOMIA ALTA DETECTADA');
  });
});
