import { describe, it, expect } from 'vitest';
import {
  descreverCorrecao,
  ensinaAlgo,
  licoesPara,
  blocoCorrecoes,
  correcoesDoLog,
  MOTIVO_MIN,
  type Correcao,
  type EixoCorrecao,
} from '@/lib/correcoes';

const base = (over: Partial<Correcao> = {}): Correcao => ({
  tipo: 'estrela',
  eixo: null,
  veredito_de: null,
  veredito_para: null,
  projeto_id: 'p1',
  projeto_nome: 'Projeto 1',
  de: 0,
  para: 4,
  recomendado: 0,
  leitura_agente: 'Fica em 0 porque não comprova uso recorrente.',
  motivo: 'Roda em 3 marcas e o Growth decide o preço a partir dele.',
  quando: '2026-09-05T10:00:00Z',
  ...over,
});

describe('o que ensina, e o que não', () => {
  // ⚠️ Sem o porquê, tudo que a correção ensina é "a nota é essa porque sim" — que é o
  // decorar-gabarito que o dono do produto vetou explicitamente.
  it('correção sem motivo NÃO vira lição', () => {
    expect(ensinaAlgo(base({ motivo: null }))).toBe(false);
    expect(ensinaAlgo(base({ motivo: '  ' }))).toBe(false);
    expect(ensinaAlgo(base({ motivo: 'x'.repeat(MOTIVO_MIN - 1) }))).toBe(false);
  });

  it('correção que CONFIRMA o agente não vira lição', () => {
    expect(ensinaAlgo(base({ recomendado: 4, para: 4 }))).toBe(false);
  });

  it('divergência COM motivo ensina', () => {
    expect(ensinaAlgo(base())).toBe(true);
  });
});

describe('quais lições entram, e em que ordem', () => {
  // ⚠️ Mostrar ao agente a nota que a triagem já cravou NAQUELE cartão não é ensinar critério,
  // é entregar a resposta.
  it('nunca mostra a correção do próprio projeto julgado', () => {
    const cs = [base({ projeto_id: 'alvo' }), base({ projeto_id: 'outro' })];
    expect(licoesPara(cs, 'alvo').map((c) => c.projeto_id)).toEqual(['outro']);
  });

  // ⚠️ E a exclusão vale mesmo com a CAIXA diferente. A planilha guarda o legado em MAIÚSCULA
  // (`LEGADO-049`) e o sync reverso cria a linha em minúscula: com comparação sensível a caixa,
  // a correção do próprio projeto em julgamento vazava para o prompt como se fosse lição.
  it('exclui o próprio projeto mesmo quando o id chega em outra CAIXA', () => {
    const cs = [base({ projeto_id: 'LEGADO-049' }), base({ projeto_id: 'outro' })];
    expect(licoesPara(cs, 'legado-049').map((c) => c.projeto_id)).toEqual(['outro']);
    // E o inverso: id do banco em minúscula, correção gravada em maiúscula.
    const cs2 = [base({ projeto_id: 'legado-049' }), base({ projeto_id: 'outro' })];
    expect(licoesPara(cs2, 'LEGADO-049').map((c) => c.projeto_id)).toEqual(['outro']);
  });

  it('reconhece o VIZINHO mesmo com a caixa diferente', () => {
    const cs = [
      base({ projeto_id: 'recente', quando: '2026-09-05T23:00:00Z' }),
      base({ projeto_id: 'LEGADO-100', quando: '2026-01-01T00:00:00Z' }),
    ];
    expect(licoesPara(cs, 'alvo', ['legado-100']).map((c) => c.projeto_id)).toEqual([
      'LEGADO-100',
      'recente',
    ]);
  });

  /**
   * ⚠️ A ordem é o desenho: o que ensina é a correção de um projeto PARECIDO, não a mais
   * recente. Os vizinhos vêm do RAG, que já rodou — por isso não existe tool nem base nova.
   */
  it('a correção de um VIZINHO vem antes de uma mais recente que não é vizinha', () => {
    const cs = [
      base({ projeto_id: 'recente', quando: '2026-09-05T23:00:00Z' }),
      base({ projeto_id: 'vizinho', quando: '2026-01-01T00:00:00Z' }),
    ];
    expect(licoesPara(cs, 'alvo', ['vizinho']).map((c) => c.projeto_id)).toEqual([
      'vizinho',
      'recente',
    ]);
  });

  it('sem vizinhos, a ordem é cronológica', () => {
    const cs = [
      base({ projeto_id: 'velho', quando: '2026-01-01T00:00:00Z' }),
      base({ projeto_id: 'novo', quando: '2026-09-05T23:00:00Z' }),
    ];
    expect(licoesPara(cs, 'alvo').map((c) => c.projeto_id)).toEqual(['novo', 'velho']);
  });

  it('casa o id do vizinho sem depender de caixa', () => {
    const cs = [base({ projeto_id: 'LEGADO-032' }), base({ projeto_id: 'outro' })];
    expect(licoesPara(cs, 'alvo', ['legado-032'])[0].projeto_id).toBe('LEGADO-032');
  });
});

describe('o bloco do prompt', () => {
  it('mostra o PAR: o que o agente argumentou e o que a triagem respondeu', () => {
    const t = blocoCorrecoes([base()]);
    expect(t).toContain('o agente argumentou');
    expect(t).toContain('a triagem respondeu');
    expect(t).toContain('não comprova uso recorrente');
    expect(t).toContain('Roda em 3 marcas');
  });

  it('manda usar o critério e PROÍBE copiar a nota', () => {
    expect(blocoCorrecoes([base()])).toMatch(/nunca para copiar a nota/i);
  });

  it('sem lição, não injeta bloco nenhum no prompt', () => {
    expect(blocoCorrecoes([base({ motivo: null })])).toBe('');
    expect(blocoCorrecoes([])).toBe('');
  });

  // ⚠️ O prompt tem um punhado de linhas de atenção: encher de exemplos dilui a régua, que é
  // quem manda. Foi por isso que a tool de consulta foi descartada — não há prompt crescendo.
  it('respeita o teto de lições', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => base({ projeto_id: `p${i}` }));
    const linhas = blocoCorrecoes(muitas).split('•').length - 1;
    expect(linhas).toBe(6);
  });
});

describe('leitura do log de atividade', () => {
  const linha = (meta: Record<string, unknown>, id = 'p1') => ({
    acao: 'estrelas',
    projeto_id: id,
    projeto_nome: 'Projeto',
    meta_json: JSON.stringify(meta),
    created_at: '2026-09-05T10:00:00Z',
  });

  it('lê a nota, a anterior, a recomendada, o motivo e o texto do agente', () => {
    const [c] = correcoesDoLog([
      linha({
        estrelas: 4,
        estrelas_anterior: 0,
        recomendado_pelo_agente: 0,
        motivo: 'roda em 3 marcas',
        leitura_do_agente: 'fica em 0',
      }),
    ]);
    expect(c).toMatchObject({ para: 4, de: 0, recomendado: 0, motivo: 'roda em 3 marcas' });
  });

  it('ignora ação que não é de estrela, e meta corrompida', () => {
    expect(correcoesDoLog([{ ...linha({ estrelas: 4 }), acao: 'status' }])).toHaveLength(0);
    expect(correcoesDoLog([{ ...linha({}), meta_json: '{quebrado' }])).toHaveLength(0);
  });

  // ⚠️ Uma por projeto: o que ensina é onde a triagem PAROU, não o caminho. E repetir o mesmo
  // projeto gastaria as poucas linhas que o bloco tem.
  it('guarda só a correção mais recente de cada projeto', () => {
    const cs = correcoesDoLog([
      linha({ estrelas: 5, motivo: 'a mais nova' }),
      linha({ estrelas: 2, motivo: 'a antiga' }),
    ]);
    expect(cs).toHaveLength(1);
    expect(cs[0].para).toBe(5);
  });
});


// ─── T5 · o EIXO da correção e o 3º tipo (veredito) ───────────────────────────

/**
 * Uma correção de VEREDITO não é numérica: o que mudou foi "reprovar" → "aprovar". Por isso ela
 * chega com `de`/`para`/`recomendado` nulos e a mudança vive em `veredito_de`/`veredito_para`.
 */
const baseVeredito = (over: Partial<Correcao> = {}): Correcao =>
  base({
    tipo: 'veredito',
    eixo: 'impacto_irrelevante',
    de: null,
    para: null as unknown as number,
    recomendado: null,
    veredito_de: 'reprovar',
    veredito_para: 'aprovar',
    leitura_agente: 'Reprovo: o ganho de R$ 18,16/mês não paga a manutenção.',
    motivo: 'O ganho é baixo mas o projeto elimina um risco fiscal que ninguém cobria.',
    ...over,
  });

describe('o EIXO que errou entra na lição', () => {
  // ⚠️ Sem o eixo, a lição diz "você errou" sem dizer ONDE. O eixo é qual lente do agente falhou,
  // e é o que permite generalizar para um projeto que não se parece nada com este.
  it('a linha da lição NOMEIA o eixo quando há eixo', () => {
    const t = descreverCorrecao(base({ eixo: 'financeiro' }));
    expect(t).toMatch(/financeiro/i);
  });

  it('cada eixo do union aparece nomeado na própria linha', () => {
    const eixos: EixoCorrecao[] = [
      'horas',
      'financeiro',
      'precedente',
      'impacto_irrelevante',
      'outro',
    ];
    for (const eixo of eixos) {
      const t = descreverCorrecao(base({ eixo }));
      expect(t).toMatch(new RegExp(eixo.replace('_', '[ _]'), 'i'));
    }
  });

  // ⚠️ Correção sem eixo é o caso legado (o log de estrelas de antes da discordância) e ela
  // continua sendo lição: o par argumento/réplica é o que ensina, o eixo é o refinamento.
  it('sem eixo, a linha segue montada e sem placeholder vazio', () => {
    const t = descreverCorrecao(base({ eixo: null }));
    expect(t).toContain('o agente argumentou');
    expect(t).toContain('a triagem respondeu');
    expect(t).not.toMatch(/null|undefined/);
  });
});

describe('correção de VEREDITO (o 3º tipo)', () => {
  it('descreve a mudança pelos TEXTOS de veredito, não por número', () => {
    const t = descreverCorrecao(baseVeredito());
    expect(t).toContain('reprovar');
    expect(t).toContain('aprovar');
    // hoje a linha interpola `c.para`, que num veredito é nulo — o número não pode vazar na tela
    expect(t).not.toMatch(/null|undefined|NaN/);
  });

  it('o PAR continua sendo a lição, mesmo no veredito', () => {
    const t = descreverCorrecao(baseVeredito());
    expect(t).toContain('o agente argumentou');
    expect(t).toContain('a triagem respondeu');
    expect(t).toContain('não paga a manutenção');
    expect(t).toContain('risco fiscal');
  });

  it('veredito trocado COM motivo ensina', () => {
    expect(ensinaAlgo(baseVeredito())).toBe(true);
  });

  // ⚠️ O portão do motivo (>= MOTIVO_MIN) vale para os 3 tipos: sem a razão, tudo que a correção
  // ensina é "é assim porque sim" — o decorar-gabarito que o dono do produto vetou.
  it('veredito sem motivo NÃO vira lição', () => {
    expect(ensinaAlgo(baseVeredito({ motivo: null }))).toBe(false);
    expect(ensinaAlgo(baseVeredito({ motivo: '  ' }))).toBe(false);
    expect(ensinaAlgo(baseVeredito({ motivo: 'x'.repeat(MOTIVO_MIN - 1) }))).toBe(false);
  });

  // A régua equivalente à numérica: se o veredito não mudou, a triagem CONFIRMOU o agente.
  it('veredito que CONFIRMA o agente não vira lição', () => {
    expect(ensinaAlgo(baseVeredito({ veredito_de: 'aprovar', veredito_para: 'aprovar' }))).toBe(
      false,
    );
    expect(ensinaAlgo(baseVeredito({ veredito_de: null }))).toBe(false);
  });

  it('lição de veredito entra no bloco do prompt', () => {
    const t = blocoCorrecoes([baseVeredito()]);
    expect(t).toContain('reprovar');
    expect(t).toContain('aprovar');
    expect(t).toMatch(/nunca para copiar a nota/i);
  });
});

// ─── T6 · a SEGUNDA ação do log: a discordância da ficha de triagem ───────────

describe('leitura da discordância registrada na ficha', () => {
  const discordancia = (meta: Record<string, unknown>, id = 'd1') => ({
    acao: 'avaliacao_discordancia',
    projeto_id: id,
    projeto_nome: 'Projeto discordado',
    meta_json: JSON.stringify(meta),
    created_at: '2026-09-08T10:00:00Z',
  });

  it('com nota_certa, sai uma correção de ESTRELA', () => {
    const [c] = correcoesDoLog([
      discordancia({
        eixo: 'precedente',
        motivo: 'outros projetos rodam em cima dele, é plataforma',
        leitura_do_agente: 'Alcance limitado a uma marca.',
        veredito_do_agente: 'aprovar',
        nota_certa: 5,
        recomendado_pelo_agente: 2,
      }),
    ]);
    expect(c).toMatchObject({
      tipo: 'estrela',
      eixo: 'precedente',
      projeto_id: 'd1',
      para: 5,
      recomendado: 2,
      motivo: 'outros projetos rodam em cima dele, é plataforma',
      leitura_agente: 'Alcance limitado a uma marca.',
    });
    expect(ensinaAlgo(c)).toBe(true);
  });

  it('com veredito_certo, sai uma correção de VEREDITO', () => {
    const [c] = correcoesDoLog([
      discordancia({
        eixo: 'impacto_irrelevante',
        motivo: 'o ganho é pequeno, mas elimina um risco fiscal que ninguém cobria',
        leitura_do_agente: 'Reprovo: R$ 18,16/mês não paga a manutenção.',
        veredito_do_agente: 'reprovar',
        veredito_certo: 'aprovar',
      }),
    ]);
    expect(c).toMatchObject({
      tipo: 'veredito',
      eixo: 'impacto_irrelevante',
      veredito_de: 'reprovar',
      veredito_para: 'aprovar',
    });
    expect(ensinaAlgo(c)).toBe(true);
  });

  // ⚠️ Eixo é union DECLARADO: o que vem torto do meta vira `null`, nunca um eixo inventado.
  it('eixo inválido ou ausente vira null', () => {
    const [semEixo] = correcoesDoLog([discordancia({ nota_certa: 3, motivo: 'motivo qualquer' })]);
    expect(semEixo.eixo).toBe(null);
    const [torto] = correcoesDoLog([
      discordancia({ nota_certa: 3, motivo: 'motivo qualquer', eixo: 'jornada' }, 'd2'),
    ]);
    expect(torto.eixo).toBe(null);
  });

  // ⚠️ Ampliar o union de ações não pode virar porta aberta: ação desconhecida segue IGNORADA.
  it('log MISTO: as 2 ações conhecidas viram correção, a desconhecida não', () => {
    const cs = correcoesDoLog([
      {
        acao: 'estrelas',
        projeto_id: 'p-estrela',
        projeto_nome: 'Pela coluna',
        meta_json: JSON.stringify({
          estrelas: 4,
          estrelas_anterior: 0,
          recomendado_pelo_agente: 0,
          motivo: 'roda em 3 marcas e o Growth usa',
        }),
        created_at: '2026-09-08T12:00:00Z',
      },
      discordancia(
        {
          eixo: 'financeiro',
          motivo: 'o custo evitado já estava no contrato encerrado',
          veredito_do_agente: 'aprovar',
          veredito_certo: 'ajuste',
        },
        'p-discordancia',
      ),
      {
        acao: 'acao_que_ninguem_conhece',
        projeto_id: 'p-desconhecido',
        projeto_nome: 'Ação futura',
        meta_json: JSON.stringify({ estrelas: 9, nota_certa: 9, motivo: 'não deve virar lição' }),
        created_at: '2026-09-08T13:00:00Z',
      },
    ]);
    expect(cs.map((c) => c.projeto_id).sort()).toEqual(['p-discordancia', 'p-estrela']);
    expect(cs.find((c) => c.projeto_id === 'p-estrela')?.tipo).toBe('estrela');
    expect(cs.find((c) => c.projeto_id === 'p-discordancia')?.tipo).toBe('veredito');
  });

  it('discordância sem projeto_id, ou com meta corrompida, é descartada sem lançar', () => {
    expect(
      correcoesDoLog([{ ...discordancia({ nota_certa: 4 }), projeto_id: null }]),
    ).toHaveLength(0);
    expect(
      correcoesDoLog([{ ...discordancia({ nota_certa: 4 }), meta_json: '{quebrado' }]),
    ).toHaveLength(0);
  });

  // A regra que já existia vale para a ação nova: uma por projeto, a mais recente.
  it('guarda só a discordância mais recente de cada projeto', () => {
    const cs = correcoesDoLog([
      discordancia({ nota_certa: 5, motivo: 'a mais nova, e é esta que vale' }),
      discordancia({ nota_certa: 2, motivo: 'a antiga, que já foi respondida' }),
    ]);
    expect(cs).toHaveLength(1);
    expect(cs[0].para).toBe(5);
  });
});
