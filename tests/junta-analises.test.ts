/**
 * A JUNTA — a peça que faltava para o time ser UM (decisão do dono do produto, 09/09/2026).
 * Antes o código rodava duas avaliações independentes do mesmo projeto e ninguém as fundia.
 */
import { describe, it, expect } from 'vitest';
import { juntarAnalises } from '@/lib/avaliacao/junta';

const imp = (veredito: string) => ({ veredito });
const est = (saida: string, over: Record<string, unknown> = {}) => ({ saida, confianca: 'alta' as const, ...over });

describe('juntarAnalises', () => {
  it('as duas concordam em aprovar → Aprovado, com a confiança do time', () => {
    const j = juntarAnalises({ impacto: imp('aprovar'), estrela: est('aprovar') });
    expect(j.status).toBe('Aprovado');
    expect(j.concordam).toBe(true);
    expect(j.confianca).toBe('alta');
  });

  it('as duas concordam em reprovar → Reprovado', () => {
    const j = juntarAnalises({ impacto: imp('reprovar'), estrela: est('reprovar') });
    expect(j.status).toBe('Reprovado');
    expect(j.concordam).toBe(true);
  });

  it('⚠️ DISCORDAM → Pendente, com as duas posições nomeadas e confiança baixa', () => {
    // Nunca a média, nunca "a que gritou mais alto": aprovar por engano custa uma correção,
    // reprovar por engano apaga o trabalho de alguém.
    const j = juntarAnalises({ impacto: imp('aprovar'), estrela: est('reprovar') });
    expect(j.status).toBe('Pendente');
    expect(j.concordam).toBe(false);
    expect(j.confianca).toBe('baixa');
    expect(j.porques.join(' ')).toMatch(/divergiram/);
    expect(j.porques.join(' ')).toMatch(/impacto aponta Aprovado/);
    expect(j.porques.join(' ')).toMatch(/estrela aponta Reprovado/);
  });

  it('⚠️ a faixa 6-10 vence tudo: Pendente com flag, mesmo com as duas aprovando', () => {
    const j = juntarAnalises({ impacto: imp('aprovar'), estrela: est('aprovar', { escape: true }) });
    expect(j.status).toBe('Pendente');
    expect(j.flag6a10).toBe(true);
    expect(j.porque).toMatch(/6 a 10/);
  });

  it('⚠️ falta uma metade → Pendente: decisão de funil precisa das duas', () => {
    expect(juntarAnalises({ impacto: null, estrela: est('aprovar') }).status).toBe('Pendente');
    expect(juntarAnalises({ impacto: imp('aprovar'), estrela: null }).status).toBe('Pendente');
    expect(juntarAnalises({ impacto: null, estrela: null }).status).toBe('Pendente');
  });

  it('⚠️ ESPECIAL é a exceção declarada: a mesa é NO-OP nele, e o time decide sozinho', () => {
    // Sem esta exceção todo especial ficaria pendente para sempre, porque a mesa nunca julga
    // especial (não há memorial financeiro para ela auditar).
    const j = juntarAnalises({ impacto: null, estrela: est('aprovar'), especial: true });
    expect(j.status).toBe('Aprovado');
    expect(j.porques.join(' ')).toMatch(/especial/i);
  });

  it('⚠️ reprovação MECÂNICA com a mesa em em_validacao → Reprovado, não divergência', () => {
    // O time só reprova por régua declarada, e a régua do piso precisa da NOTA. A mesa lê a nota
    // da coluna `Estrela Agente`, vazia em todo projeto que o time nunca avaliou: na primeira
    // passada ela não tem como chegar ao mesmo lugar. Chamar isso de divergência exigiria uma
    // segunda rodada inteira só para a mesa enxergar o que o time acabou de escrever.
    const j = juntarAnalises({ impacto: imp('em_validacao'), estrela: est('reprovar') });
    expect(j.status).toBe('Reprovado');
    expect(j.porques.join(' ')).toMatch(/não contradiz a reprovação/);
  });

  it('⚠️ mas mesa APROVANDO contra time reprovando segue sendo divergência → Pendente', () => {
    const j = juntarAnalises({ impacto: imp('aprovar'), estrela: est('reprovar') });
    expect(j.status).toBe('Pendente');
    expect(j.confianca).toBe('baixa');
  });

  it('⚠️ mesa APROVA + time em ajuste → Aprovado: o mérito tem um dono só', () => {
    // Medido em prod: a mesa aprovou 8 de 9 e a junta mandava 7 para Pendente porque o time
    // devolvia `ajuste`. São duas implementações do MESMO julgamento de mérito, e tratar isso
    // como dúvida paralisava o funil. A mesa é a calibrada; o time entra com a NOTA.
    const j = juntarAnalises({ impacto: imp('aprovar'), estrela: est('ajuste') });
    expect(j.status).toBe('Aprovado');
    expect(j.porques.join(' ')).toMatch(/aprovou o projeto/);
    expect(j.porques.join(' ')).toMatch(/não impedem a aprovação/);
  });

  it('⚠️ mas o time ainda VETA: reprovar mecânico e faixa 6-10 vencem a aprovação da mesa', () => {
    expect(juntarAnalises({ impacto: imp('aprovar'), estrela: est('reprovar') }).status).toBe('Pendente');
    expect(juntarAnalises({ impacto: imp('aprovar'), estrela: est('aprovar', { escape: true }) }).flag6a10).toBe(true);
  });

  it('em_validacao e isento da mesa contam como Pendente (vocabulário dela)', () => {
    expect(juntarAnalises({ impacto: imp('em_validacao'), estrela: est('humano') }).status).toBe('Pendente');
    expect(juntarAnalises({ impacto: imp('isento'), estrela: est('humano') }).concordam).toBe(true);
  });

  it('nenhum caminho devolve status fora dos três do funil', () => {
    const casos = ['aprovar', 'reprovar', 'em_validacao', 'isento', 'coisa_nova', ''];
    for (const a of casos)
      for (const b of ['aprovar', 'reprovar', 'humano', 'ajuste', 'xpto']) {
        const j = juntarAnalises({ impacto: imp(a), estrela: est(b) });
        expect(['Aprovado', 'Pendente', 'Reprovado']).toContain(j.status);
        expect(j.porques.length).toBeGreaterThan(0);
      }
  });
});

describe('teto do debate do mérito — é infraestrutura, não opinião', () => {
  it('o default segue 2 rodadas e o campo é OPCIONAL', async () => {
    // ⚠️ O edge corta a requisição em 300s EXATOS (medido: 6 falhas entre 300358 e 300833 ms) e a
    // passada completa encosta nisso. `maxRodadasDebate: 1` desliga a réplica, que custa uma
    // rodada inteira dos 5 especialistas + o cético — e ela é dispensável no caminho do funil,
    // porque o MÉRITO passou a ser da mesa.
    const { MAX_RODADAS_DEBATE } = await import('@/lib/avaliacao/time');
    expect(MAX_RODADAS_DEBATE).toBe(2);
  });

  it('a env do corte é OPT-IN: sem ela, nada muda', async () => {
    const { debateDoTimeDesligado } = await import('@/lib/avaliacao/time.functions');
    delete process.env.TIME_SEM_REPLICA;
    expect(debateDoTimeDesligado()).toBe(false);
    process.env.TIME_SEM_REPLICA = '1';
    expect(debateDoTimeDesligado()).toBe(true);
    delete process.env.TIME_SEM_REPLICA;
  });
});

describe('⚠️ a reprovação MECÂNICA da mesa também não é divergência', () => {
  it('mesa reprova + time em ajuste → Reprovado', () => {
    // Caso real (GoCaixa, prod 10/09/2026): a mesa reprovou por régua — "impacto de R$ 16,55/mês,
    // abaixo do piso de R$ 100, e a nota é 0" — o time não reprovou junto, e a junta gravava
    // PENDENTE, jogando fora uma decisão que é aritmética. A regra 3b existia só para o lado do
    // time; faltava o espelho.
    const j = juntarAnalises({ impacto: imp('reprovar'), estrela: est('ajuste') });
    expect(j.status).toBe('Reprovado');
    expect(j.porques.join(' ')).toMatch(/régua declarada/);
  });

  it('⚠️ mas time APROVANDO contra mesa reprovando segue divergência → Pendente', () => {
    const j = juntarAnalises({ impacto: imp('reprovar'), estrela: est('aprovar') });
    expect(j.status).toBe('Pendente');
    expect(j.confianca).toBe('baixa');
  });

  it('a faixa 6-10 vence até a reprovação da mesa', () => {
    const j = juntarAnalises({ impacto: imp('reprovar'), estrela: est('humano', { escape: true }) });
    expect(j.status).toBe('Pendente');
    expect(j.flag6a10).toBe(true);
  });
});

describe('fecharPendente: a condição é só sobre a MESA (o mérito tem um dono)', () => {
  it('⚠️ mesa em_validacao + time APROVANDO: a mesa manda, e o desfecho é a TRIAGEM', () => {
    // A condição continua sendo só sobre a MESA (o mérito tem um dono): a aprovação do time não
    // estabelece um mérito que a mesa não deu, então isto NÃO vira Aprovado.
    // ⚠️ **Mas também não vira mais Reprovado** (TRAVA 3, 10/09/2026): o que falta aqui é
    // confirmar o número, e isso é pergunta ao autor. Este teste exigia `Reprovado` e era, junto
    // com o irmão dele em `funil-status`, o que produziu a reprovação do «Smartonline DIFAL»
    // (R$ 117.475/mês) por *"não há memória de cálculo"* — chamada de inadmissível pelo dono do
    // produto, com razão. Sem reenvio pendente, o desfecho é Pendente.
    const j = juntarAnalises({ impacto: imp('em_validacao'), estrela: est('aprovar'), fecharPendente: true });
    expect(j.status).toBe('Pendente');
    expect(j.semMaterial).toBeUndefined();
    // e com o reenvio que a triagem pediu e nunca voltou, aí sim reprova — é fato do fluxo
    const r = juntarAnalises({
      impacto: imp('em_validacao'),
      estrela: est('aprovar'),
      fecharPendente: true,
      reenvioNaoChegou: true,
    });
    expect(r.status).toBe('Reprovado');
    expect(r.semMaterial).toBe(true);
  });

  it('e a mesa aprovando segue mandando: Aprovado, com o funil fechando ou não', () => {
    expect(juntarAnalises({ impacto: imp('aprovar'), estrela: est('ajuste'), fecharPendente: true }).status).toBe('Aprovado');
  });
});

describe('⚠️ as DUAS travas do fecharPendente (10/09/2026) — medidas em prod', () => {
  it('nota ≥ 1 SUSTENTA o projeto: o funil aprova em vez de contradizer a própria nota', async () => {
    // ⚠️ **O defeito era este e foi para produção.** A regra 3c olhava só a mesa e reprovava tudo
    // que ela não aprovava, sem NUNCA olhar a nota — 9 projetos reprovados com estrela de 1★ a 5★,
    // inclusive a «Plataforma Smartonline - Pagamento de DIFAL» (5★, R$ 117 mil/mês) e o «Painel
    // de descritivos de cargo» (2★). Dono do produto: *"Como pode um projeto valer estrelas e ser
    // reprovado? É contraditorio demais"*.
    const { juntarAnalises, NOTA_SUSTENTA_APROVACAO } = await import('@/lib/avaliacao/junta');
    expect(NOTA_SUSTENTA_APROVACAO).toBe(1);
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'ajuste', estrela: 2, confianca: 'media' },
      fecharPendente: true,
    });
    expect(j.status).toBe('Aprovado');
    expect(j.semMaterial).toBeUndefined();
    expect(j.porques.join(' ')).toMatch(/2★/);
    // 5★ idem — é o caso do DIFAL.
    expect(
      juntarAnalises({ impacto: { veredito: 'em_validacao' }, estrela: { saida: 'ajuste', estrela: 5 }, fecharPendente: true }).status,
    ).toBe('Aprovado');
  });

  it('⚠️ nota 0 AVALIADA já NÃO reprova por material — vai para a triagem (TRAVA 3)', async () => {
    // ⚠️ **REESCRITO no mesmo dia em que nasceu.** Eu tinha fechado só dois vãos (nota ≥ 1★ e
    // ganho sem número) e este teste guardava o terceiro aberto: projeto com nota 0, impacto
    // alto, reprovado por "não consegui confirmar o número". Medido na staging logo depois: o
    // «SendApp» (R$ 97 mil/mês, nota 0 lá) voltou a ser gravado **Reprovado**. É a classe do caso
    // que o dono do produto chamou de inadmissível — e ele está certo: quem duvida do número pede
    // a conta, quem reprova afirma que o trabalho não vale.
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'ajuste', estrela: 0, avaliada: true },
      fecharPendente: true,
    });
    expect(j.status).toBe('Pendente');
    expect(j.semMaterial).toBeUndefined();
    expect(j.porques.join(' ')).toMatch(/pergunta ao autor/);
  });

  it('⚠️ e nem impacto ALTO com nota 0 reprova — é o caso do DIFAL, textualmente', async () => {
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    for (const nota of [0, null]) {
      const j = juntarAnalises({
        impacto: { veredito: 'em_validacao' },
        estrela: { saida: 'ajuste', estrela: nota, avaliada: true },
        fecharPendente: true,
      });
      expect(j.status).toBe('Pendente');
    }
  });

  it('a ÚNICA reprovação por material que sobrou é o reenvio que não chegou', async () => {
    // Fato do fluxo, não juízo de mérito: um reenvio reescreveria o Status, então o Status parado
    // em `Reenvio Pendente` significa literalmente "o autor não voltou". Foi o pedido do dono do
    // produto: "O novo 'reenvio pendente' vai ser reprovado com justificativa".
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'ajuste', estrela: 0, avaliada: true },
      fecharPendente: true,
      reenvioNaoChegou: true,
    });
    expect(j.status).toBe('Reprovado');
    expect(j.semMaterial).toBe(true);
    expect(j.porques.join(' ')).toMatch(/reenvio não chegou/);
  });

  it('⚠️ FALLBACK do cérebro (nota 0 não avaliada) não sustenta e também não reprova', async () => {
    // `avaliada: false` é ausência de julgamento. Ela não sustenta (não aprova) e o desfecho segue
    // a régua do material, como antes — o que ela não pode é ser lida como "o time disse 0".
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'ajuste', estrela: 0, avaliada: false },
      fecharPendente: true,
    });
    // ⚠️ Pendente desde a TRAVA 3: o fallback não sustenta a aprovação e também não autoriza a
    // reprovação — ausência de julgamento nunca é decisão, em nenhuma das duas direções.
    expect(j.status).toBe('Pendente');
    // e nota 3 de um fallback (impossível hoje, mas o contrato é explícito) também não sustenta
    expect(
      juntarAnalises({ impacto: { veredito: 'em_validacao' }, estrela: { saida: 'ajuste', estrela: 3, avaliada: false }, fecharPendente: true })
        .status,
    ).toBe('Pendente');
  });

  it('⚠️ GANHO SEM NÚMERO não é "número não comprovado" — vai para conferência humana', async () => {
    // Medido: «Acompanhamento de Despesa com Frete Real» (Ganho imensurável, 2★) reprovado por
    // *"faltar informação que sustente o ganho declarado"* — não havia número nenhum declarado.
    // Dono do produto: *"Tem que haver calibre devido para os que sao subidos como ganho
    // imensuravel"*.
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'ajuste', estrela: 0, avaliada: true },
      fecharPendente: true,
      semNumeroDeGanho: true,
    });
    expect(j.status).toBe('Pendente');
    expect(j.semMaterial).toBeUndefined();
    expect(j.porques.join(' ')).toMatch(/sem valor financeiro/);
  });

  it('⚠️ a régua MECÂNICA continua acima das duas travas: mesa Reprovado vence a nota', async () => {
    // A reprovação da mesa é aritmética (piso composto) ou invalidez nomeada e citada. Nota alta
    // não a desmente — se desmentisse, a régua do piso deixaria de existir.
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'reprovar' },
      estrela: { saida: 'ajuste', estrela: 4 },
      fecharPendente: true,
    });
    expect(j.status).toBe('Reprovado');
  });

  it('⚠️ e a faixa 6-10 segue vencendo tudo, com ou sem nota', async () => {
    const { juntarAnalises } = await import('@/lib/avaliacao/junta');
    const j = juntarAnalises({
      impacto: { veredito: 'em_validacao' },
      estrela: { saida: 'humano', escape: true, estrela: 6 },
      fecharPendente: true,
    });
    expect(j.status).toBe('Pendente');
    expect(j.flag6a10).toBe(true);
  });
});
