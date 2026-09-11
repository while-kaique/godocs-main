import { describe, it, expect } from 'vitest';
import {
  buildPromptCeticoEstrela,
  normalizarCeticoEstrela,
  ceticoEstrelaFallback,
  travaEscapeSemCitacao,
  reconciliarReplicaEstrela,
  derrubarEscapePorGatilho,
  QUEDA_MAX_POR_VOLTA_ESTRELA,
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
    ancora_congelada: false, avaliada: true,
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

describe('⚠️ trava da RÉPLICA (11/09/2026) — queda máx. 1 nível e escape só cai por gatilho nomeado', () => {
  const cetico = (over: Partial<ReturnType<typeof ceticoEstrelaFallback>> = {}) => ({
    refuta: true, nota_sugerida: 2, motivo: 'objeção genérica', sinais: [], fallback: false, gatilho_refutado: null as any, ...over,
  });
  const ESC = { indicado: true, valido: true, evidencias: { nao_existiria: 'o Super VIP self-service só existe por causa dele', sem_volta: 'o programa em planilha foi desligado' } };

  it('réplica que desaba 5★ → 2★ fica em 4★ (uma objeção move um degrau)', () => {
    const r = reconciliarReplicaEstrela(estrela({ nota: 5 }), estrela({ nota: 2, racional: 'organiza a operação' }), cetico());
    expect(r.nota).toBe(5 - QUEDA_MAX_POR_VOLTA_ESTRELA);
    expect(r.racional).toMatch(/Trava/);
  });

  it('réplica que desce 1 nível vale como está', () => {
    const r2 = estrela({ nota: 4, racional: 'r2' });
    expect(reconciliarReplicaEstrela(estrela({ nota: 5 }), r2, cetico())).toBe(r2);
  });

  it('⚠️ escape válido na 1ª avaliação FICA quando o cético não nomeou gatilho (caso Gocreators, 6★ humano)', () => {
    const r = reconciliarReplicaEstrela(estrela({ nota: 5, escape: ESC }), estrela({ nota: 2 }), cetico({ motivo: 'a gestão anterior existia em planilha' }));
    expect(r.escape.valido).toBe(true);
    expect(r.nota).toBe(5);
  });

  it('escape CAI quando o cético nomeia o gatilho derrubado (caso Torre de Controle Supply, 1★ humano)', () => {
    const r = reconciliarReplicaEstrela(
      estrela({ nota: 5, escape: ESC }),
      estrela({ nota: 3, escape: { indicado: false, valido: false, evidencias: {} } }),
      cetico({ gatilho_refutado: 'nao_existiria', motivo: 'o processo manual exigiria priorização, logo a atividade já existia' }),
    );
    expect(r.escape.valido).toBe(false);
    expect(r.nota).toBe(4); // e mesmo assim a queda respeita o teto de 1 nível
  });

  it('fallback do cérebro em qualquer das voltas não é reconciliado (não se inventa nota)', () => {
    const r2 = estrela({ nota: 0, avaliada: false });
    expect(reconciliarReplicaEstrela(estrela({ nota: 5 }), r2, cetico())).toBe(r2);
  });

  it('normalização lê "gatilho_refutado" só quando refuta e o nome é um gatilho real', () => {
    expect(normalizarCeticoEstrela({ refuta: true, nota_sugerida: 3, motivo: 'x', gatilho_refutado: 'sem_volta' }, 5)?.gatilho_refutado).toBe('sem_volta');
    expect(normalizarCeticoEstrela({ refuta: true, nota_sugerida: 3, motivo: 'x', gatilho_refutado: 'qualquer' }, 5)?.gatilho_refutado).toBeNull();
    expect(normalizarCeticoEstrela({ refuta: false, gatilho_refutado: 'sem_volta' }, 5)?.gatilho_refutado).toBeNull();
  });

  it('o prompt pede o gatilho nomeado e diz que versão manual de parte do trabalho não derruba "nao_existiria"', () => {
    const txt = buildPromptCeticoEstrela({ dossieTexto: 'd', estrela: estrela({ nota: 5, escape: ESC }), vizinhos: [] }).map((m) => m.content).join('\n');
    expect(txt).toContain('gatilho_refutado');
    expect(txt).toMatch(/versão MANUAL de parte do trabalho/);
  });
});

describe('⚠️ trava da RÉPLICA (2ª passada) — a réplica não sobe e o cético da 2ª volta pode derrubar o escape', () => {
  const cetico = (over: Record<string, unknown> = {}) => ({ refuta: true, nota_sugerida: 2, motivo: 'objeção', sinais: [], fallback: false, gatilho_refutado: null as any, ...over });
  const ESC = { indicado: true, valido: true, evidencias: { nao_existiria: 'atividade nova citada', sem_volta: 'o manual foi desligado' } };

  it('réplica que SOBE (3★ → 5★ com escape) volta para 3★ sem escape (caso AVD Central v2, 4★ humano)', () => {
    const r = reconciliarReplicaEstrela(estrela({ nota: 3 }), estrela({ nota: 5, escape: ESC }), cetico());
    expect(r.nota).toBe(3);
    expect(r.escape.valido).toBe(false);
    expect(r.racional).toMatch(/não sobe/);
  });

  it('réplica que inventa escape no mesmo 5★ perde o escape (caso CTR Machine Admaker, 4★ humano)', () => {
    const r = reconciliarReplicaEstrela(estrela({ nota: 5 }), estrela({ nota: 5, escape: ESC }), cetico());
    expect(r.nota).toBe(5);
    expect(r.escape.valido).toBe(false);
  });

  it('cético da 2ª volta que NOMEIA o gatilho derruba o escape mantido pela trava (caso Boletos Itaú, 2★ humano)', () => {
    const mantido = estrela({ nota: 5, escape: ESC });
    const r = derrubarEscapePorGatilho(mantido, cetico({ gatilho_refutado: 'nao_existiria', motivo: 'a automação não ampliou um volume novo' }));
    expect(r.escape.valido).toBe(false);
    expect(r.nota).toBe(5);
  });

  it('cético da 2ª volta SEM gatilho nomeado não mexe no escape', () => {
    const mantido = estrela({ nota: 5, escape: ESC });
    expect(derrubarEscapePorGatilho(mantido, cetico())).toBe(mantido);
  });
});
