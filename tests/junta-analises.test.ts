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
