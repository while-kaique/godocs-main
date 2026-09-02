import { describe, it, expect } from 'vitest';
import {
  TETO_AGENTE,
  NOTA_MAX,
  PISO_ZERO,
  CRITERIOS_ESTRELA,
  NIVEIS_ESCAPE,
  GATILHOS_ESCAPE,
  nivelDe,
  ehEscape,
  normalizarNota,
  aplicarPromocao,
  descreverReguaAgente,
  descreverEscape,
  escapeValido,
  confiancaDe,
  deveIrParaHumano,
  montarContestacao,
  contarFrases,
  detectarAchatamento,
  CONTESTACAO_MAX_FRASES,
  LIMIAR_ACHATAMENTO,
} from '@/lib/estrelas-regua';

describe('estrutura da régua', () => {
  it('tem exatamente os 5 níveis do agente, 1 a 5, com verbo e critério', () => {
    expect(CRITERIOS_ESTRELA.map((n) => n.nota)).toEqual([1, 2, 3, 4, 5]);
    expect(CRITERIOS_ESTRELA.map((n) => n.verbo)).toEqual([
      'Informa',
      'Executa',
      'Garante',
      'Decide',
      'Responde pelo resultado',
    ]);
    for (const n of CRITERIOS_ESTRELA) expect(n.criterio.length).toBeGreaterThan(40);
  });

  it('tem os 5 níveis do escape, 6 a 10', () => {
    expect(NIVEIS_ESCAPE.map((n) => n.nota)).toEqual([6, 7, 8, 9, 10]);
    expect(NIVEIS_ESCAPE.map((n) => n.verbo)).toEqual([
      'Habilita',
      'Suporta',
      'Concentra',
      'Redefine',
      'Funda',
    ]);
  });

  it('o piso do 0 tem os 5 desqualificadores', () => {
    expect(PISO_ZERO.map((p) => p.chave)).toEqual([
      'mensuravel',
      'so_o_autor',
      'simples_local',
      'fora_de_uso',
      'ressubmissao',
    ]);
  });

  it('nenhum critério cita valor em R$ — a régua é para impacto imensurável', () => {
    const tudo = [...CRITERIOS_ESTRELA, ...NIVEIS_ESCAPE]
      .map((n) => n.criterio)
      .concat(PISO_ZERO.map((p) => p.texto))
      .join(' ');
    expect(tudo).not.toMatch(/R\$|reais|\/m[êe]s|\/ano/i);
  });

  it('nenhum critério se define pelo vizinho (autossuficiência)', () => {
    const tudo = [...CRITERIOS_ESTRELA, ...NIVEIS_ESCAPE].map((n) => n.criterio).join(' ');
    expect(tudo).not.toMatch(/o mesmo do|idem|igual ao anterior/i);
  });

  it('nenhum critério nomeia projeto, marca ou plataforma da base', () => {
    const tudo = [...CRITERIOS_ESTRELA, ...NIVEIS_ESCAPE].map((n) => n.criterio).join(' ');
    expect(tudo).not.toMatch(/PIAPP|GoBrands|Gocase|Gobeaut|VERSTA|Shopify|Meta Ads|marca/i);
  });

  it('nivelDe e ehEscape respeitam a fronteira do agente', () => {
    expect(nivelDe(3)?.verbo).toBe('Garante');
    expect(nivelDe(10)?.verbo).toBe('Funda');
    expect(nivelDe(11)).toBeNull();
    expect(ehEscape(TETO_AGENTE)).toBe(false);
    expect(ehEscape(6)).toBe(true);
    expect(ehEscape(NOTA_MAX + 1)).toBe(false);
  });
});

describe('normalizarNota', () => {
  it('clampa, arredonda e recusa o que não é número', () => {
    expect(normalizarNota('4')).toBe(4);
    expect(normalizarNota(4.6)).toBe(5);
    expect(normalizarNota(-3)).toBe(0);
    expect(normalizarNota(99)).toBe(NOTA_MAX);
    expect(normalizarNota('cinco')).toBeNull();
    expect(normalizarNota(undefined)).toBeNull();
  });
});

describe('promoção do dependente nomeado', () => {
  it('sobe um nível', () => {
    expect(aplicarPromocao(2, true)).toBe(3);
  });

  it('NUNCA leva ao escape — subir para 6 exige os dois gatilhos', () => {
    expect(aplicarPromocao(5, true)).toBe(TETO_AGENTE);
  });

  it('não promove 0 nem age sem dependente nomeado', () => {
    expect(aplicarPromocao(0, true)).toBe(0);
    expect(aplicarPromocao(3, false)).toBe(3);
  });
});

describe('render para o prompt', () => {
  it('a faixa do agente traz piso, princípio, os 5 verbos e a promoção', () => {
    const t = descreverReguaAgente();
    expect(t).toContain('PRINCÍPIO ORDENADOR');
    expect(t).toContain('0★');
    for (const n of CRITERIOS_ESTRELA) expect(t).toContain(`${n.nota}★ — ${n.verbo}`);
    expect(t).toContain('NOMEADO');
  });

  it('o escape deixa explícito que o agente não concede e exige os dois gatilhos', () => {
    const t = descreverEscape();
    expect(t).toMatch(/NÃO concede/);
    for (const g of GATILHOS_ESCAPE) expect(t).toContain(g.texto);
    for (const n of NIVEIS_ESCAPE) expect(t).toContain(`${n.nota}★ — ${n.verbo}`);
  });
});

describe('escapeValido', () => {
  const evid = {
    nao_existiria: 'a camada de conteúdo das 7 lojas não existia antes',
    sem_volta: 'o processo de 11,5h por produto entre 5 times foi desmontado',
  };

  it('aceita com os dois gatilhos citados e sugestão na faixa', () => {
    expect(escapeValido({ sugestao: 7, evidencias: evid })).toBe(true);
  });

  it('recusa com um gatilho só', () => {
    expect(escapeValido({ sugestao: 7, evidencias: { nao_existiria: evid.nao_existiria } })).toBe(
      false,
    );
  });

  it('recusa citação vazia — entusiasmo não é evidência', () => {
    expect(escapeValido({ sugestao: 8, evidencias: { ...evid, sem_volta: '   ' } })).toBe(false);
  });

  it('recusa sugestão fora de 6–10', () => {
    expect(escapeValido({ sugestao: 5, evidencias: evid })).toBe(false);
  });
});

describe('confiança e fila humana', () => {
  it('alta só com os três sinais', () => {
    expect(
      confiancaDe({ cerebrosConcordam: true, temEvidenciaCitada: true, temVizinhos: true }),
    ).toBe('alta');
  });

  it('falta um sinal → media; faltam dois → baixa', () => {
    expect(
      confiancaDe({ cerebrosConcordam: true, temEvidenciaCitada: true, temVizinhos: false }),
    ).toBe('media');
    expect(
      confiancaDe({ cerebrosConcordam: false, temEvidenciaCitada: true, temVizinhos: false }),
    ).toBe('baixa');
  });

  it('escape e confiança baixa vão sempre ao humano', () => {
    expect(deveIrParaHumano(7, 'alta')).toBe(true);
    expect(deveIrParaHumano(2, 'baixa')).toBe(true);
    expect(deveIrParaHumano(2, 'alta')).toBe(false);
  });
});

describe('contestação de âncora (D11)', () => {
  const base = {
    notaHumana: 8,
    notaRegua: 5,
    criterioAplicado: 'Responde pelo resultado',
    gatilhoQueFalhou: 'nao_existiria',
    racional: 'O gerenciamento manual existia. Eram 300h/mês declaradas na doc.',
    evidencia: 'se gastava quase 300hrs por mês gerenciando os orçamentos',
  };

  it('registra quando a régua dá nota MENOR que a humana', () => {
    expect(montarContestacao(base)).not.toBeNull();
  });

  it('não contesta para CIMA — subir âncora é decisão do comitê', () => {
    expect(montarContestacao({ ...base, notaRegua: 9 })).toBeNull();
    expect(montarContestacao({ ...base, notaRegua: 8 })).toBeNull();
  });

  it('exige evidência citada e gatilho nomeado', () => {
    expect(montarContestacao({ ...base, evidencia: '  ' })).toBeNull();
    expect(montarContestacao({ ...base, gatilhoQueFalhou: '' })).toBeNull();
  });

  it(`recusa racional acima de ${CONTESTACAO_MAX_FRASES} frases`, () => {
    expect(contarFrases(base.racional)).toBe(2);
    expect(
      montarContestacao({ ...base, racional: 'Uma. Duas. Três frases já é ensaio.' }),
    ).toBeNull();
  });
});

describe('achatamento (D12)', () => {
  it('acusa quando um destino concentra mais que o limiar', () => {
    const r = detectarAchatamento([2, 2, 2, 3, 1]);
    expect(r.suspeito).toBe(true);
    expect(r.destino).toBe(2);
    expect(r.proporcao).toBeGreaterThan(LIMIAR_ACHATAMENTO);
    expect(r.total).toBe(5);
  });

  it('empate na metade exata NÃO acusa — o limiar é estritamente maior', () => {
    const r = detectarAchatamento([2, 2, 3, 4]);
    expect(r.proporcao).toBe(0.5);
    expect(r.suspeito).toBe(false);
  });

  it('lote sem queda não acusa nada', () => {
    expect(detectarAchatamento([])).toEqual({
      suspeito: false,
      destino: null,
      proporcao: 0,
      total: 0,
    });
  });

  it('desempata pelo nível menor (o pior caso é o achatamento para baixo)', () => {
    const r = detectarAchatamento([1, 1, 4, 4]);
    expect(r.destino).toBe(1);
  });
});
