/**
 * O SEGUNDO EIXO da estrela: o TAMANHO do impacto (10/09/2026).
 *
 * ⚠️ **O caso de origem é medido, não hipotético.** O «SendApp» saiu **2★ em três rodadas de
 * produção** (2, 2, 2), com o critério "executa" aplicado e evidência citada — sendo ~15% do
 * impacto líquido mensal de TODA a base aprovada (R$ 97.135 de R$ 630.566/mês). A nota estava
 * certa para a régua que existia: os seis verbos medem FUNÇÃO na cadeia e são cegos ao tamanho.
 * Dono do produto: *"pelo o que esta escrito e pelo impacto do prjoeto, ele claramente é um muda o
 * jogo… É 20% de todos os projetos da empresa em ganho liquido mensal"*.
 *
 * O eixo é PISO, calculado, e nunca desce nota.
 */
import { describe, it, expect } from 'vitest';
import {
  EIXO_IMPACTO,
  BASE_IMPACTO_MENSAL_REFERENCIA,
  CANDIDATO_ESCAPE_SHARE,
  PISO_IMPACTO_NAO_VALE_COM,
  TETO_AGENTE,
  pisoPorImpacto,
  descreverShare,
  descreverEixoImpacto,
} from '@/lib/estrelas-regua';
import { normalizarSaidaEstrela, saidaEstrelaFallback, buildPromptEstrela } from '@/lib/avaliacao/cerebro-estrela';

const ctx = { temVizinhos: false, notaHumana: null };
const B = BASE_IMPACTO_MENSAL_REFERENCIA;

describe('pisoPorImpacto — a régua do tamanho', () => {
  it('as faixas estão em ordem decrescente e nenhuma passa do teto do agente', () => {
    // Ordem importa: `find` devolve a PRIMEIRA que casa, então fora de ordem um projeto de 15%
    // receberia o piso de 0,5%.
    const shares = EIXO_IMPACTO.map((f) => f.shareMin);
    expect([...shares].sort((a, b) => b - a)).toEqual(shares);
    for (const f of EIXO_IMPACTO) expect(f.piso).toBeLessThanOrEqual(TETO_AGENTE);
  });

  it('os três casos REAIS que motivaram o eixo caem onde deviam', () => {
    // SendApp, Simulador de Custos e CX Hub, com os números de prod em 10/09/2026.
    expect(pisoPorImpacto({ impactoMensal: 97_135, totalBase: B })?.piso).toBe(5);
    expect(pisoPorImpacto({ impactoMensal: 70_538, totalBase: B })?.piso).toBe(5);
    expect(pisoPorImpacto({ impactoMensal: 31_605, totalBase: B })?.piso).toBe(5);
    // E a mediana da base (R$ 284/mês) não garante piso nenhum — é o que mantém o eixo raro.
    expect(pisoPorImpacto({ impactoMensal: 284, totalBase: B })).toBeNull();
  });

  it('⚠️ impacto ausente, zero ou negativo NÃO garante piso — e não castiga', () => {
    // Especial e ganho imensurável entram sem número por decisão de produto; "sem número" não
    // pode virar nem piso nem punição (mesma disciplina de `notaParaOPiso`).
    expect(pisoPorImpacto({ impactoMensal: null })).toBeNull();
    expect(pisoPorImpacto({ impactoMensal: undefined })).toBeNull();
    expect(pisoPorImpacto({ impactoMensal: 0 })).toBeNull();
    expect(pisoPorImpacto({ impactoMensal: -5_000 })).toBeNull();
    expect(pisoPorImpacto({ impactoMensal: Number.NaN })).toBeNull();
  });

  it('total inválido cai na referência medida, nunca divide por zero', () => {
    expect(pisoPorImpacto({ impactoMensal: 97_135, totalBase: 0 })?.piso).toBe(5);
    expect(pisoPorImpacto({ impactoMensal: 97_135, totalBase: null })?.piso).toBe(5);
    expect(pisoPorImpacto({ impactoMensal: 97_135, totalBase: Number.NaN })?.piso).toBe(5);
  });

  it('candidato ao escape só na altura declarada, e é candidato — não promoção', () => {
    const grande = pisoPorImpacto({ impactoMensal: CANDIDATO_ESCAPE_SHARE * B, totalBase: B });
    expect(grande?.candidatoAoEscape).toBe(true);
    // ⚠️ e o piso dele continua no teto do agente: entrar em 6-10 exige os 2 gatilhos citados.
    expect(grande?.piso).toBeLessThanOrEqual(TETO_AGENTE);
    const medio = pisoPorImpacto({ impactoMensal: 0.02 * B, totalBase: B });
    expect(medio?.candidatoAoEscape).toBe(false);
  });

  it('descreverShare fala como gente, com vírgula decimal', () => {
    expect(descreverShare(0.157)).toContain('15,7%');
    expect(descreverShare(0.005)).toContain('0,50%');
  });

  it('o prompt só ganha o bloco do tamanho quando o tamanho existe', () => {
    const semTamanho = descreverEixoImpacto(null);
    expect(semTamanho).not.toContain('TAMANHO DESTE PROJETO');
    const comTamanho = descreverEixoImpacto(pisoPorImpacto({ impactoMensal: 97_135, totalBase: B }));
    expect(comTamanho).toContain('TAMANHO DESTE PROJETO');
    expect(comTamanho).toContain('15,4%');
  });
});

describe('o piso entra na normalização — determinístico, não pedido ao modelo', () => {
  const bruto = { nota: 2, criterio_aplicado: 'Executa', racional: 'Roda sozinho toda semana.', evidencias: ['roda sem ninguém iniciar'] };

  it('eleva a nota e DIZ que foi o tamanho (o caso SendApp)', () => {
    const piso = pisoPorImpacto({ impactoMensal: 97_135, totalBase: B });
    const s = normalizarSaidaEstrela(bruto, { ...ctx, pisoDeImpacto: piso })!;
    expect(s.nota).toBe(5);
    expect(s.piso_impacto).toMatchObject({ de: 2, para: 5 });
    // ⚠️ O racional do modelo justificava o 2★; sem a linha do piso na frente, a ficha mostraria
    // "é 5★" ao lado de "porque executa uma rotina".
    expect(s.racional).toMatch(/pelo tamanho do impacto/);
    expect(s.racional).toContain('15,4%');
  });

  it('⚠️ NUNCA desce nota: projeto pequeno que garante/decide/assume fica onde está', () => {
    const s = normalizarSaidaEstrela({ ...bruto, nota: 4 }, { ...ctx, pisoDeImpacto: pisoPorImpacto({ impactoMensal: 300, totalBase: B }) })!;
    expect(s.nota).toBe(4);
    expect(s.piso_impacto).toBeNull();
  });

  it('⚠️ nota já acima do piso não é tocada, e o campo fica null', () => {
    const s = normalizarSaidaEstrela({ ...bruto, nota: 5 }, { ...ctx, pisoDeImpacto: pisoPorImpacto({ impactoMensal: 97_135, totalBase: B }) })!;
    expect(s.nota).toBe(5);
    expect(s.piso_impacto).toBeNull();
  });

  it('⚠️ projeto FORA DE USO não sobe por dinheiro', () => {
    // É o único jeito de um número grande num projeto parado não virar 5★.
    expect(PISO_IMPACTO_NAO_VALE_COM).toContain('fora_de_uso');
    const s = normalizarSaidaEstrela(
      { nota: 0, desqualificador: 'fora_de_uso', racional: 'Descontinuado em julho.', evidencias: [] },
      { ...ctx, pisoDeImpacto: pisoPorImpacto({ impactoMensal: 97_135, totalBase: B }) },
    )!;
    expect(s.nota).toBe(0);
    expect(s.piso_impacto).toBeNull();
  });

  it('⚠️ os outros desqualificadores NÃO bloqueiam — "marginal" com 15% da base é contradição', () => {
    const s = normalizarSaidaEstrela(
      { nota: 0, desqualificador: 'marginal', racional: 'Atende um punhado de pessoas.', evidencias: [] },
      { ...ctx, pisoDeImpacto: pisoPorImpacto({ impactoMensal: 97_135, totalBase: B }) },
    )!;
    expect(s.nota).toBe(5);
  });

  it('⚠️ o FALLBACK do cérebro não recebe piso — elevar julgamento que não houve é pior que o zero', () => {
    const f = saidaEstrelaFallback('sem JSON', ctx);
    expect(f.nota).toBe(0);
    expect(f.piso_impacto).toBeNull();
    expect(f.avaliada).toBe(false);
  });

  it('o prompt carrega o eixo (fonte única, não redigitado)', () => {
    const msgs = buildPromptEstrela({
      dossieTexto: 'projeto x',
      vizinhos: [],
      pisoDeImpacto: pisoPorImpacto({ impactoMensal: 97_135, totalBase: B }),
    });
    const system = msgs[0].content;
    expect(system).toContain('SEGUNDO EIXO');
    expect(system).toContain('TAMANHO DESTE PROJETO');
  });
});
