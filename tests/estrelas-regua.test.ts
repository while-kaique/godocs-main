import { describe, it, expect } from 'vitest';
import {
  TETO_AGENTE,
  NOTA_MAX,
  FAIXA_ESCAPE,
  PISO_ZERO,
  NIVEL_ZERO,
  CRITERIOS_ESTRELA,
  ESCAPE_MUDA_O_JOGO,
  GATILHOS_ESCAPE,
  DISTRIBUICAO_ESPERADA,
  nivelDe,
  ehEscape,
  normalizarNota,
  aplicarPromocao,
  descreverReguaAgente,
  descreverEscape,
  escapeValido,
  confiancaDe,
  conferirCalibragem,
  deveIrParaHumano,
  montarContestacao,
  contarFrases,
  detectarAchatamento,
  CONTESTACAO_MAX_FRASES,
  LIMIAR_ACHATAMENTO,
} from '@/lib/estrelas-regua';

const TODOS_NIVEIS = [NIVEL_ZERO, ...CRITERIOS_ESTRELA];

describe('estrutura da régua', () => {
  it('tem exatamente os 5 níveis do agente, 1 a 5, com verbo e critério', () => {
    expect(CRITERIOS_ESTRELA.map((n) => n.nota)).toEqual([1, 2, 3, 4, 5]);
    expect(CRITERIOS_ESTRELA.map((n) => n.verbo)).toEqual([
      'Informa',
      'Executa',
      'Garante',
      'Decide',
      'Assume',
    ]);
    for (const n of CRITERIOS_ESTRELA) expect(n.criterio.length).toBeGreaterThan(40);
  });

  it('o 0★ é um nível com nome, não só uma lista de exclusões', () => {
    expect(NIVEL_ZERO.nota).toBe(0);
    expect(NIVEL_ZERO.verbo).toBe('Experimenta');
  });

  it('todo nível traz classe de artefato e ao menos 2 exemplos reais', () => {
    for (const n of TODOS_NIVEIS) {
      expect(n.artefatos.length).toBeGreaterThan(10);
      expect(n.exemplos.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('o escape é UMA caixa — os 5 verbos antigos não voltam sem decisão do dono', () => {
    expect(ESCAPE_MUDA_O_JOGO.verbo).toBe('Muda o Jogo');
    expect(FAIXA_ESCAPE).toEqual({ min: 6, max: 10 });
    expect(ESCAPE_MUDA_O_JOGO.tracos.length).toBeGreaterThanOrEqual(3);
    const t = descreverEscape();
    for (const morto of ['Habilita', 'Suporta', 'Concentra', 'Redefine', 'Funda'])
      expect(t).not.toContain(morto);
  });

  it('o piso do 0 tem os 7 desqualificadores, e o do número exige o "se resume"', () => {
    expect(PISO_ZERO.map((p) => p.chave)).toEqual([
      'apenas_mensuravel',
      'so_o_autor',
      'simples_local',
      'fora_de_uso',
      'marginal',
      'experimentacao',
      'ressubmissao',
    ]);
    // O T1 mediu o texto antigo ("o ganho é mensurável") zerando 484 de 484: ter número não zera.
    const item = PISO_ZERO.find((p) => p.chave === 'apenas_mensuravel')!;
    expect(item.texto).toMatch(/RESUME/);
    expect(item.texto).toMatch(/Ter número NÃO zera/);
  });

  it('nenhum critério cita valor em R$ — a régua é para impacto imensurável', () => {
    const tudo = TODOS_NIVEIS.map((n) => n.criterio)
      .concat(PISO_ZERO.map((p) => p.texto))
      .concat(ESCAPE_MUDA_O_JOGO.criterio, ...ESCAPE_MUDA_O_JOGO.tracos)
      .join(' ');
    expect(tudo).not.toMatch(/R\$|reais|\/m[êe]s|\/ano/i);
  });

  it('nenhum critério se define pelo vizinho (autossuficiência)', () => {
    const tudo = TODOS_NIVEIS.map((n) => n.criterio).join(' ');
    expect(tudo).not.toMatch(/o mesmo do|idem|igual ao anterior/i);
  });

  it('o CRITÉRIO não nomeia projeto da base — quem nomeia é o campo `exemplos`', () => {
    const tudo = TODOS_NIVEIS.map((n) => n.criterio).join(' ');
    expect(tudo).not.toMatch(/PIAPP|GoBrands|GoPrice|SAIBBI|Damidash|CTR Machine/i);
    expect(CRITERIOS_ESTRELA[4].exemplos).toContain('GoBrands');
  });

  it('nivelDe cobre 0–5 e para na fronteira do agente', () => {
    expect(nivelDe(0)?.verbo).toBe('Experimenta');
    expect(nivelDe(3)?.verbo).toBe('Garante');
    expect(nivelDe(5)?.verbo).toBe('Assume');
    expect(nivelDe(6)).toBeNull();
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

  it('NUNCA leva ao escape — entrar em 6 exige os dois gatilhos', () => {
    expect(aplicarPromocao(5, true)).toBe(TETO_AGENTE);
  });

  it('não promove 0 nem age sem dependente nomeado', () => {
    expect(aplicarPromocao(0, true)).toBe(0);
    expect(aplicarPromocao(3, false)).toBe(3);
  });
});

describe('calibragem do lote', () => {
  it('acusa lote inflado — nota alta demais para a forma esperada', () => {
    const r = conferirCalibragem([5, 5, 4, 4, 1]);
    expect(r.desvio).toBe('inflado');
    expect(r.proporcaoAcimaDe3).toBeGreaterThan(DISTRIBUICAO_ESPERADA.maxAcimaDe3);
  });

  it('acusa lote achatado mesmo dentro da faixa esperada', () => {
    expect(conferirCalibragem([1, 1, 1, 1, 0, 2]).desvio).toBe('achatado');
  });

  it('aceita a forma esperada: fundo cheio, cauda curta', () => {
    const r = conferirCalibragem([0, 0, 0, 1, 1, 1, 2, 2, 3, 5]);
    expect(r.ok).toBe(true);
    expect(r.desvio).toBeNull();
  });

  it('lote vazio não acusa nada', () => {
    expect(conferirCalibragem([]).ok).toBe(true);
  });
});

describe('render para o prompt', () => {
  it('a faixa do agente traz piso, princípio, os verbos, exemplos e a promoção', () => {
    const t = descreverReguaAgente();
    expect(t).toContain('PRINCÍPIO ORDENADOR');
    for (const n of TODOS_NIVEIS) {
      expect(t).toContain(`${n.nota}★ — ${n.verbo}`);
      for (const ex of n.exemplos) expect(t).toContain(ex);
    }
    expect(t).toContain('NOMEADO');
    // Classe de artefato é pista, e o prompt tem de dizer isso — senão vira gate.
    expect(t).toMatch(/PISTA/i);
  });

  it('o escape exige os dois gatilhos e devolve o NÚMERO ao comitê', () => {
    const t = descreverEscape();
    for (const g of GATILHOS_ESCAPE) expect(t).toContain(g.texto);
    expect(t).toMatch(/comitê humano/);
    expect(t).toMatch(/NÃO escolha o número/);
  });

  it('a distribuição esperada NÃO vai para o prompt — seria cota, não critério', () => {
    const t = descreverReguaAgente() + descreverEscape();
    expect(t).not.toContain(DISTRIBUICAO_ESPERADA.texto);
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
    criterioAplicado: 'Assume',
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
