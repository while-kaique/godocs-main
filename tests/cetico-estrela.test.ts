import { describe, it, expect } from 'vitest';
import {
  buildPromptCeticoEstrela,
  normalizarCeticoEstrela,
  ceticoEstrelaFallback,
  travaEscapeSemCitacao,
} from '@/lib/avaliacao/cetico-estrela';
import { conservarSugestaoDeValor, MOTIVO_SUGESTAO_RECUSADA } from '@/lib/avaliacao/cerebro-merito';
import type { SaidaEstrela } from '@/lib/avaliacao/cerebro-estrela';

function estrela(over: Partial<SaidaEstrela> = {}): SaidaEstrela {
  return {
    nota: 4,
    criterio_aplicado: 'Decide',
    desqualificador: null,
    evidencias: [],
    sem_evidencia: false,
    promocao: { aplicada: false, dependente: null },
    escape: { indicado: false, valido: false, evidencias: {} },
    tipo: null,
    nivel: null,
    racional: 'decide preço sozinho',
    contestacao: null,
    ancora_congelada: false,
    sinais: { temEvidenciaCitada: true, temVizinhos: true },
    ...over,
  };
}

describe('cético da ESTRELA — só rebaixa', () => {
  it('⚠️ nota sugerida ACIMA da proposta é cortada no teto da proposta', () => {
    // É aqui que o "só rebaixa" deixa de depender do prompt. Um falso 8★ vira âncora
    // congelada (D9) e contamina a nota de todos os projetos que vierem depois.
    const r = normalizarCeticoEstrela({ refuta: true, nota_sugerida: 9, motivo: 'acho grande' }, 4);
    expect(r?.nota_sugerida).toBe(4);
    expect(r?.refuta).toBe(false); // refutar sem BAIXAR a nota não é refutação
  });

  it('refuta de verdade quando baixa a nota E nomeia o motivo', () => {
    const r = normalizarCeticoEstrela(
      { refuta: true, nota_sugerida: 2, motivo: 'o racional descreve um painel que alguém lê' },
      4,
    );
    expect(r?.refuta).toBe(true);
    expect(r?.nota_sugerida).toBe(2);
  });

  it('⚠️ refutação SEM motivo nomeado não conta (mesma régua do cético do mérito)', () => {
    const r = normalizarCeticoEstrela({ refuta: true, nota_sugerida: 1, motivo: '' }, 4);
    expect(r?.refuta).toBe(false);
    expect(r?.nota_sugerida).toBe(4);
  });

  it('nota ilegível mantém a proposta — não refuta por acidente', () => {
    const r = normalizarCeticoEstrela({ refuta: true, nota_sugerida: 'abc', motivo: 'x' }, 3);
    expect(r?.nota_sugerida).toBe(3);
    expect(r?.refuta).toBe(false);
  });

  it('fallback não refuta e preserva a nota', () => {
    expect(ceticoEstrelaFallback(5)).toMatchObject({ refuta: false, nota_sugerida: 5, fallback: true });
  });
});

describe('trava determinística do escape (antes de qualquer LLM)', () => {
  it('escape sem as DUAS citações é refutado pela régua, e cai para o teto do agente', () => {
    const t = travaEscapeSemCitacao(
      estrela({ nota: 8, escape: { indicado: true, valido: false, evidencias: { nao_existiria: 'x' } } }),
    );
    expect(t?.refuta).toBe(true);
    expect(t?.nota_sugerida).toBe(5);
    expect(t?.motivo).toMatch(/sem citação/i);
  });

  it('escape com as duas citações não é travado — aí quem julga é o cético', () => {
    expect(
      travaEscapeSemCitacao(
        estrela({
          nota: 8,
          escape: {
            indicado: true,
            valido: true,
            evidencias: { nao_existiria: 'a fila roda hoje só por causa dele', sem_volta: 'o manual foi desligado' },
          },
        }),
      ),
    ).toBeNull();
  });

  it('fora do escape a trava não se aplica', () => {
    expect(travaEscapeSemCitacao(estrela({ nota: 4 }))).toBeNull();
  });
});

describe('prompt do cético da estrela', () => {
  it('diz que só rebaixa e mostra as citações do escape para serem atacadas', () => {
    const p = buildPromptCeticoEstrela({
      dossieTexto: 'dossiê',
      estrela: estrela({ nota: 7, escape: { indicado: true, valido: true, evidencias: { nao_existiria: 'a fila do Fiscal' } } }),
      vizinhos: [{ id: 'a', nome: 'Godash', nota: 1, similaridade: 0.8, resumo: 'painel' }],
    });
    const txt = p.map((m) => m.content).join('\n');
    expect(txt).toMatch(/nunca pode ser MAIOR/);
    expect(txt).toContain('a fila do Fiscal');
    expect(txt).toContain('Godash');
    // a régua do "não é auditável" não vale como motivo — igual ao cético do mérito
    expect(txt).toMatch(/não há anexo/);
  });
});

describe('financeiro — a sugestão de valor só desce ou confirma', () => {
  const base = { absurdo: true, justificativa: 'as 271 h do contrato já estavam pagas no custo evitado' };

  it('sugestão MENOR passa', () => {
    expect(conservarSugestaoDeValor({ ...base, valor_sugerido: 8844 }, 12621)?.valor_sugerido).toBe(8844);
  });

  it('⚠️ sugerir o MESMO valor é resposta válida ("auditei e se sustenta")', () => {
    expect(conservarSugestaoDeValor({ ...base, valor_sugerido: 12621 }, 12621)?.valor_sugerido).toBe(12621);
  });

  it('⚠️ sugestão MAIOR é descartada — quem aumenta o ganho é gente', () => {
    const r = conservarSugestaoDeValor({ ...base, valor_sugerido: 20000 }, 12621);
    expect(r?.valor_sugerido).toBeNull();
    expect(r?.justificativa).toContain(MOTIVO_SUGESTAO_RECUSADA.sobe);
  });

  it('sem valor declarado não há de onde descer', () => {
    const r = conservarSugestaoDeValor({ ...base, valor_sugerido: 500 }, null);
    expect(r?.valor_sugerido).toBeNull();
    expect(r?.justificativa).toContain(MOTIVO_SUGESTAO_RECUSADA.sem_declarado);
  });

  it('justificativa curta demais não permite conferir', () => {
    const r = conservarSugestaoDeValor({ absurdo: true, valor_sugerido: 100, justificativa: 'alto' }, 500);
    expect(r?.valor_sugerido).toBeNull();
  });

  it('a auditoria NUNCA é apagada — só a sugestão cai', () => {
    const r = conservarSugestaoDeValor({ ...base, valor_sugerido: 99999 }, 100);
    expect(r?.absurdo).toBe(true);
    expect(r?.justificativa).toContain('271 h');
  });

  it('sem sugestão, passa intacto', () => {
    const v = { absurdo: false, valor_sugerido: null, justificativa: 'coerente' };
    expect(conservarSugestaoDeValor(v, 500)).toEqual(v);
    expect(conservarSugestaoDeValor(null, 500)).toBeNull();
  });
});
