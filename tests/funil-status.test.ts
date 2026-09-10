/**
 * O funil do GoDocs tem TRÊS status (decisão do dono do produto, 09/09/2026), e a flag 6-10 é
 * aviso, não status.
 */
import { describe, it, expect } from 'vitest';
import {
  STATUS_FUNIL,
  entraNaFilaDoTime,
  statusDoFunil,
  statusFunilDeLegado,
  justificativaDaReprovacao,
  MOTIVO_REPROVADO_MAX,
  resumirPontos,
  PONTO_MAX,
  PONTOS_MAX,
  resumirEmUmaFrase,
  RESUMO_FALTA_MAX,
} from '@/lib/funil-status';

describe('statusDoFunil — o desfecho do time vira status', () => {
  it('são três, e só três', () => {
    expect([...STATUS_FUNIL]).toEqual(['Aprovado', 'Pendente', 'Reprovado']);
  });

  it('aprovar → Aprovado · reprovar → Reprovado', () => {
    expect(statusDoFunil({ saida: 'aprovar' }).status).toBe('Aprovado');
    expect(statusDoFunil({ saida: 'reprovar' }).status).toBe('Reprovado');
  });

  it('⚠️ a faixa 6-10 fica PENDENTE, com a flag, e o porquê diz que o agente aprovaria', () => {
    const d = statusDoFunil({ saida: 'humano', escape: true });
    expect(d.status).toBe('Pendente');
    expect(d.flag6a10).toBe(true);
    expect(d.porque).toMatch(/6 a 10/);
    expect(d.porque).toMatch(/se sustenta/);
  });

  it('a faixa 6-10 vence o desfecho: mesmo com o consenso em aprovar, falta o humano cravar', () => {
    // Não pode ir para Aprovado sem número: a régua se recusa a dizer se é 6 ou 10.
    expect(statusDoFunil({ saida: 'aprovar', escape: true }).status).toBe('Pendente');
  });

  it('`ajuste` NÃO é um 4º status: é Pendente', () => {
    expect(statusDoFunil({ saida: 'ajuste' }).status).toBe('Pendente');
    expect(statusDoFunil({ saida: 'humano' }).status).toBe('Pendente');
  });

  it('⚠️ desfecho DESCONHECIDO vira Pendente, nunca Aprovado nem Reprovado', () => {
    // Ampliar o enum do consenso sem passar por aqui não pode decidir projeto por acidente.
    for (const s of ['isento', 'dispensado', '', 'coisa_nova']) {
      expect(statusDoFunil({ saida: s }).status).toBe('Pendente');
    }
  });

  it('todo desfecho sai com um porquê (status sem justificativa não existe)', () => {
    for (const s of ['aprovar', 'reprovar', 'ajuste', 'humano', 'xpto']) {
      expect(statusDoFunil({ saida: s }).porque.length).toBeGreaterThan(20);
    }
  });
});

describe('statusFunilDeLegado — os seis textos antigos', () => {
  it('Em validação e Reenvio Pendente colapsam em Pendente', () => {
    expect(statusFunilDeLegado('Em validação')).toBe('Pendente');
    expect(statusFunilDeLegado('Reenvio Pendente')).toBe('Pendente');
    expect(statusFunilDeLegado('')).toBe('Pendente');
  });

  it('⚠️ Descontinuado devolve null: não é etapa de funil, é arquivo', () => {
    // `null` significa "não encoste na célula", diferente de "vira Pendente": o dono desligou a
    // automação, e julgar o mérito de algo desligado é gastar chamada num veredito inaplicável.
    expect(statusFunilDeLegado('Descontinuado')).toBeNull();
    expect(entraNaFilaDoTime('Descontinuado')).toBe(false);
    expect(entraNaFilaDoTime('Pendente')).toBe(true);
    expect(entraNaFilaDoTime('Reenvio Pendente')).toBe(true);
  });

  it('caixa e acento não decidem nada', () => {
    expect(statusFunilDeLegado('APROVADO')).toBe('Aprovado');
    expect(statusFunilDeLegado(' reprovado ')).toBe('Reprovado');
    expect(statusFunilDeLegado('rejeitado')).toBe('Reprovado');
  });
});

describe('justificativaDaReprovacao — a causa REAL, não um carimbo', () => {
  it('⚠️ reenvio que não voltou é reprovado POR ISSO, e o texto não fala de impacto', () => {
    const t = justificativaDaReprovacao({
      porques: ['O ganho declarado é de R$ 18,16 por mês, abaixo do piso.'],
      parecerDaMesa: 'Financeiro: a conta não fecha.',
      statusAnterior: 'Reenvio Pendente',
      motivoReenvio: 'Falta a evidência do contrato encerrado.',
    });
    expect(t).toMatch(/devolvido pela triagem/);
    expect(t).toMatch(/Falta a evidência do contrato encerrado/);
    expect(t).toMatch(/reenvie/i);
    // não pode carimbar a régua do impacto em quem foi reprovado por não ter reenviado
    expect(t).not.toMatch(/18,16|piso/);
  });

  it('sem o texto do pedido, ainda diz o que aconteceu e o que fazer', () => {
    const t = justificativaDaReprovacao({ porques: [], statusAnterior: 'Reenvio Pendente', motivoReenvio: '—' });
    expect(t).toMatch(/reenvio não chegou/);
    expect(t).toMatch(/Para corrigir/);
    expect(t).not.toMatch(/—/);
  });

  it('as outras causas seguem levando os porquês da junta e o parecer', () => {
    const t = justificativaDaReprovacao({
      porques: ['O ganho declarado é de R$ 18,16 por mês, abaixo do piso.'],
      parecerDaMesa: 'Financeiro: a conta não fecha.',
      statusAnterior: 'Pendente',
    });
    expect(t).toMatch(/18,16/);
    expect(t).toMatch(/O que os especialistas apontaram/);
    expect(t).not.toMatch(/devolvido pela triagem/);
  });

  it('respeita o teto da coluna', () => {
    const t = justificativaDaReprovacao({ porques: ['x'.repeat(9000)], statusAnterior: 'Pendente' });
    expect(t.length).toBeLessThanOrEqual(MOTIVO_REPROVADO_MAX);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('fecharPendente — o funil sem limbo (opt-in)', () => {
  it('desligado: nada muda', async () => {
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    expect(juntarAnalises({ impacto: { veredito: 'em_validacao' }, estrela: { saida: 'ajuste' } }).status).toBe('Pendente');
  });

  it('ligado: reenvio que NUNCA CHEGOU → Reprovado, com tom EXORTATIVO', async () => {
    // ⚠️ **REESCRITO em 10/09/2026.** Este teste afirmava que `em_validacao + ajuste` reprovava
    // por si só ("o time não conseguiu validar com o material que existe"). Foi ao ar e produziu o
    // caso que o dono do produto chamou de inadmissível: «Smartonline - Pagamento de DIFAL»,
    // R$ 117.475/mês, reprovado por *"não há memória de cálculo"*. Falta de memória de cálculo é
    // PERGUNTA AO AUTOR, não veredito — hoje esse cenário vai para Pendente (teste abaixo).
    // A única reprovação por material que sobrou é o FATO do fluxo: a triagem devolveu e o autor
    // não voltou.
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'ajuste' },
      fecharPendente: true,
      reenvioNaoChegou: true,
    });
    expect(j.status).toBe('Reprovado');
    expect(j.semMaterial).toBe(true);
    const t = justificativaDaReprovacao({
      porques: j.porques,
      parecerDaMesa: 'Financeiro: o memorial diz R$ 80,85 e a conta dá R$ 40,43.',
      semMaterial: true,
    });
    // ⚠️ CONCISA (pedido do dono do produto): o ponto do projeto, a régua em uma linha, a saída.
    // ⚠️ **REESCRITO em 10/09/2026.** Este teste exigia que o texto ABRISSE por
    // *"Reprovado por faltar informação que sustente o ganho declarado. Não é um juízo sobre o
    // valor do trabalho."* e trouxesse o prefixo `Falta: `. Foi ao ar assim e o dono do produto
    // leu nove reprovações seguidas com a MESMA primeira frase: *"parece padornizado o motivo de
    // reprovação, pelo amor de Deus, nao faz sentido isso"*. O carimbo na frente empurrava o ponto
    // concreto do projeto para a segunda linha — e em projeto de ganho imensurável ele afirmava um
    // "ganho declarado" que não existia. Hoje o texto começa pelo que ficou sem resposta NESTE
    // projeto; a ressalva de que não é juízo de valor continua, uma linha depois.
    expect(t).toMatch(/O que ficou sem resposta neste projeto: /);
    expect(t.indexOf('O que ficou sem resposta')).toBeLessThan(t.indexOf('não é um juízo'));
    expect(t).toMatch(/não é um juízo sobre o valor do trabalho/i);
    expect(t).not.toMatch(/^Reprovado por faltar informação/);
    // ⚠️ NÃO nomeia o agente: atribuição por agente é organização interna do time e o autor não
    // precisa dela (quem quiser tem o painel da ficha, com os quatro pareceres).
    expect(t).not.toMatch(/Financeiro:|Cético:/);
    expect(t).toMatch(/reenvie/);
    expect(t).toMatch(/R\$ 80,85/);
    expect(t.length).toBeLessThan(560);
  });

  it('⚠️ ligado, a faixa 6-10 SEGUE Pendente: reprovar diria o oposto do que o time concluiu', async () => {
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'humano', escape: true },
      fecharPendente: true,
    });
    expect(j.status).toBe('Pendente');
    expect(j.flag6a10).toBe(true);
  });

  it('⚠️ ligado, mesa APROVANDO nunca vira reprovação', async () => {
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    expect(
      juntarAnalises({ impacto: { veredito: 'aprovar' }, estrela: { saida: 'ajuste' }, fecharPendente: true }).status,
    ).toBe('Aprovado');
  });
});

describe('resumirPontos — recorta o parecer, não reescreve', () => {
  it('uma linha por especialista, primeira frase, rótulo preservado', () => {
    const p = resumirPontos(
      'Financeiro: O memorial diz R$ 80,85 e a conta dá R$ 40,43. Também falta confirmar o custo do proxy.\nCético: Faltam os logs do agendador. O código não agenda sozinho.',
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toBe('Financeiro: O memorial diz R$ 80,85 e a conta dá R$ 40,43.');
    expect(p[1]).toBe('Cético: Faltam os logs do agendador.');
  });

  it('⚠️ descarta a linha que fala do PROCESSO, não do que o autor faz', () => {
    const p = resumirPontos('Financeiro: falta a nota fiscal.\nOs especialistas divergiram, então vai para a triagem.');
    expect(p).toHaveLength(1);
    expect(p.join(' ')).not.toMatch(/divergiram/);
  });

  it(`no máximo ${PONTOS_MAX} pontos e cada um até ${PONTO_MAX} chars`, () => {
    const p = resumirPontos(['a: ' + 'x'.repeat(400), 'b: dois.', 'c: três.', 'd: quatro.'].join('\n'));
    expect(p).toHaveLength(PONTOS_MAX);
    expect(p[0].length).toBeLessThanOrEqual(PONTO_MAX);
    expect(p[0].endsWith('…')).toBe(true);
  });

  it('vazio devolve lista vazia', () => {
    expect(resumirPontos(null)).toEqual([]);
    expect(resumirPontos('   ')).toEqual([]);
  });
});

describe('resumirEmUmaFrase — o autor não vê agente por agente', () => {
  it('emenda os pontos numa frase, sem rótulo de agente', () => {
    const f = resumirEmUmaFrase(
      'Financeiro: O memorial diz R$ 80,85 e a conta dá R$ 40,43.\nCético: Faltam os logs do agendador.',
    );
    expect(f).not.toMatch(/Financeiro|Cético/);
    expect(f).toBe('o memorial diz R$ 80,85 e a conta dá R$ 40,43; faltam os logs do agendador.');
  });

  it(`corta em ${RESUMO_FALTA_MAX} chars`, () => {
    const f = resumirEmUmaFrase(['a: ' + 'x'.repeat(300), 'b: ' + 'y'.repeat(300)].join('\n'));
    expect(f.length).toBeLessThanOrEqual(RESUMO_FALTA_MAX);
  });

  it('sem parecer devolve vazio', () => {
    expect(resumirEmUmaFrase(null)).toBe('');
  });
});
