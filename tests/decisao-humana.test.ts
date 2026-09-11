/**
 * A DECISÃO DE GENTE VENCE O AGENTE (10/09/2026).
 *
 * ⚠️ Os três casos abaixo são REAIS, tirados do `admin_activity_log` de produção — não são
 * hipóteses. O dono do produto viu o efeito antes de qualquer teste pegar:
 *   • «SendApp» — Bruno confirmou Aprovado às 19:57:15, o agente gravou Pendente às 20:00:44;
 *   • «GoDocs» — o dono reprovou em 26/08, o agente aprovou em 10/09;
 *   • «SmartOnline - Captura de XMLs» — o dono marcou Descontinuado em 08/09, o agente reprovou.
 * E a nota: o «SendApp» tinha 7★ do Bruno e voltou a 2★ porque a âncora vivia atrás de `forcar`.
 */
import { describe, it, expect } from 'vitest';
import {
  ATOR_AGENTE,
  STATUS_INTOCAVEIS_PELO_AGENTE,
  ehAtorHumano,
  podeAgenteGravarStatus,
  podeAgenteEscreverNota,
  porqueNaoEncostou,
} from '@/lib/decisao-humana';

describe('ehAtorHumano — o default é INVERTIDO de propósito', () => {
  it('o ator do agente é o único não-humano', () => {
    expect(ehAtorHumano(ATOR_AGENTE)).toBe(false);
    expect(ehAtorHumano('bruno.bezerra@gocase.com')).toBe(true);
  });

  it('⚠️ origem DESCONHECIDA conta como gente', () => {
    // Tratar o desconhecido como agente autorizaria sobrescrever justamente as linhas antigas,
    // cuja autoria ninguém sabe. Os dois erros não são simétricos.
    expect(ehAtorHumano(null)).toBe(true);
    expect(ehAtorHumano(undefined)).toBe(true);
    expect(ehAtorHumano('  ')).toBe(true);
  });
});

describe('podeAgenteGravarStatus — os três casos medidos', () => {
  it('⚠️ NÃO rebaixa Aprovado (o caso SendApp)', () => {
    for (const alvo of ['Pendente', 'Reprovado']) {
      const r = podeAgenteGravarStatus({ statusAtual: 'Aprovado', alvo });
      expect(r.pode).toBe(false);
      expect(r.motivo).toBe('aprovado');
    }
  });

  it('⚠️ NÃO encosta em Descontinuado (o caso SmartOnline XMLs)', () => {
    // `Descontinuado` é flag do DONO do projeto ("a automação não roda mais"), não veredito de
    // mérito — reprová-la responde outra pergunta.
    const r = podeAgenteGravarStatus({ statusAtual: 'Descontinuado', alvo: 'Reprovado' });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe('descontinuado');
    expect(STATUS_INTOCAVEIS_PELO_AGENTE).toContain('Descontinuado');
  });

  it('⚠️ NÃO escreve por cima de status que uma PESSOA gravou (o caso GoDocs)', () => {
    const r = podeAgenteGravarStatus({
      statusAtual: 'Reprovado',
      alvo: 'Aprovado',
      atorDoStatusAtual: 'luis.albuquerque@gocase.com',
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe('decisao_humana');
  });

  it('escreve quando o status atual é do PRÓPRIO agente', () => {
    const r = podeAgenteGravarStatus({ statusAtual: 'Pendente', alvo: 'Reprovado', atorDoStatusAtual: ATOR_AGENTE });
    expect(r.pode).toBe(true);
  });

  it('escreve quando ninguém decidiu ainda (sem histórico, ou célula vazia)', () => {
    expect(podeAgenteGravarStatus({ statusAtual: 'Pendente', alvo: 'Aprovado', atorDoStatusAtual: null }).pode).toBe(true);
    expect(podeAgenteGravarStatus({ statusAtual: '', alvo: 'Aprovado' }).pode).toBe(true);
    expect(podeAgenteGravarStatus({ statusAtual: null, alvo: 'Reprovado' }).pode).toBe(true);
  });

  it('⚠️ manter o MESMO status é sempre permitido — idempotência não é sobrescrita', () => {
    expect(podeAgenteGravarStatus({ statusAtual: 'Aprovado', alvo: 'Aprovado' }).pode).toBe(true);
    expect(podeAgenteGravarStatus({ statusAtual: 'aprovado', alvo: 'Aprovado' }).pode).toBe(true);
  });

  it('⚠️ log indisponível (undefined) NÃO libera as travas duras', () => {
    // É o cenário de falha de leitura da auditoria: as duas travas de status seguem valendo.
    expect(podeAgenteGravarStatus({ statusAtual: 'Aprovado', alvo: 'Reprovado', atorDoStatusAtual: undefined }).pode).toBe(false);
    // E num status comum, sem saber quem escreveu, o agente segue podendo agir (senão o funil
    // pararia inteiro sempre que a auditoria falhasse).
    expect(podeAgenteGravarStatus({ statusAtual: 'Pendente', alvo: 'Reprovado', atorDoStatusAtual: undefined }).pode).toBe(true);
  });

  it('a frase do log nomeia a causa e não culpa ninguém', () => {
    expect(porqueNaoEncostou('aprovado', 'Reprovado')).toMatch(/já está Aprovado/);
    expect(porqueNaoEncostou('descontinuado', 'Reprovado')).toMatch(/Descontinuado/);
    // ⚠️ a frase mudou junto com a trava reforçada: ela agora diz também COMO destravar (só o
    // reenvio do autor reabre), porque quem lê o log precisa saber o que fazer com o projeto.
    expect(porqueNaoEncostou('decisao_humana', 'Aprovado')).toMatch(/A triagem já decidiu/);
    expect(porqueNaoEncostou('decisao_humana', 'Aprovado')).toMatch(/quando o autor reenviar/);
  });
});

describe('podeAgenteEscreverNota — a âncora que `forcar` não fura', () => {
  it('⚠️ nota de gente NÃO é reescrita, e 7★ é o caso do Bruno no SendApp', () => {
    const r = podeAgenteEscreverNota({ naCelula: 7, recomendadaPeloAgente: '2' });
    expect(r.pode).toBe(false);
    expect(r.ancora).toBe(7);
  });

  it('⚠️ ZERO de gente também é nota — a caixa «Experimenta» é veredito', () => {
    // A régua antiga exigia `>= 1` e deixava o agente reescrever justamente o zero cravado.
    const r = podeAgenteEscreverNota({ naCelula: 0, recomendadaPeloAgente: '3' });
    expect(r.pode).toBe(false);
    expect(r.ancora).toBe(0);
  });

  it('o agente reescreve a nota que ELE mesmo pôs (senão congelaria para sempre)', () => {
    expect(podeAgenteEscreverNota({ naCelula: 2, recomendadaPeloAgente: '2' }).pode).toBe(true);
  });

  it('célula vazia: escreve', () => {
    expect(podeAgenteEscreverNota({ naCelula: null, recomendadaPeloAgente: '2' }).pode).toBe(true);
  });

  it('⚠️ registro HUMANO na auditoria vence a régua da célula', () => {
    // O caso do humano que digita o MESMO número que o agente recomendou: pela célula pareceria
    // do agente, mas o log sabe.
    const r = podeAgenteEscreverNota({ naCelula: 2, recomendadaPeloAgente: '2', humanoMexeu: true });
    expect(r.pode).toBe(false);
    expect(r.ancora).toBe(2);
  });

  it('⚠️ recomendação na faixa 6-10 nunca casa com número de gente', () => {
    // `Estrela Agente = "6-10"` não é comparável a um 7 digitado: a régua se recusa a afirmar a
    // posição, então quem pôs 7 foi o comitê.
    expect(podeAgenteEscreverNota({ naCelula: 7, recomendadaPeloAgente: '6-10' }).pode).toBe(false);
  });
});

describe('⚠️ decisaoDeAdminBloqueia — o buraco que a 1ª trava deixou', () => {
  it('o atropelo de ontem NÃO autoriza o de hoje (o caso SendApp, 3 escritas)', async () => {
    // Olhar só quem escreveu o status ATUAL protege contra o primeiro atropelo e libera todos os
    // seguintes: no «SendApp» o agente gravou Pendente às 20:00, 20:09 e 20:54 depois de o Bruno
    // ter aprovado às 19:57 — e da segunda vez em diante o status atual já era dele.
    const { decisaoDeAdminBloqueia, podeAgenteGravarStatus, ATOR_AGENTE } = await import('@/lib/decisao-humana');
    const historico = [
      { ator: ATOR_AGENTE, quando: '2026-09-10 20:00:44' },
      { ator: 'bruno.bezerra@gocase.com', quando: '2026-09-10 19:57:15' },
    ];
    expect(decisaoDeAdminBloqueia({ historico })).toBe(true);
    // o status atual é do PRÓPRIO agente e ele ainda assim não pode escrever
    const r = podeAgenteGravarStatus({
      statusAtual: 'Pendente',
      alvo: 'Reprovado',
      atorDoStatusAtual: ATOR_AGENTE,
      historico,
    });
    expect(r.pode).toBe(false);
    expect(r.motivo).toBe('decisao_humana');
  });

  it('⚠️ o REENVIO do autor reabre — é o único fato que destrava', async () => {
    // Sem esta saída, projeto que a triagem devolveu e o autor corrigiu ficaria travado para
    // sempre. O reenvio reabrir a avaliação é o desenho já aprovado do funil.
    const { decisaoDeAdminBloqueia } = await import('@/lib/decisao-humana');
    const historico = [{ ator: 'bruno.bezerra@gocase.com', quando: '2026-08-26 22:13:08' }];
    expect(decisaoDeAdminBloqueia({ historico, ultimoReenvioEm: '2026-09-01 10:00:00' })).toBe(false);
    // reenvio ANTERIOR à decisão não destrava (a triagem decidiu vendo o reenvio)
    expect(decisaoDeAdminBloqueia({ historico, ultimoReenvioEm: '2026-08-20 10:00:00' })).toBe(true);
    // ⚠️ empate protege a decisão humana
    expect(decisaoDeAdminBloqueia({ historico, ultimoReenvioEm: '2026-08-26 22:13:08' })).toBe(true);
  });

  it('histórico só do agente não bloqueia (senão o funil pararia sozinho)', async () => {
    const { decisaoDeAdminBloqueia, ATOR_AGENTE } = await import('@/lib/decisao-humana');
    expect(
      decisaoDeAdminBloqueia({ historico: [{ ator: ATOR_AGENTE, quando: '2026-09-10 20:00:44' }] }),
    ).toBe(false);
  });

  it('sem histórico não bloqueia', async () => {
    const { decisaoDeAdminBloqueia } = await import('@/lib/decisao-humana');
    expect(decisaoDeAdminBloqueia({})).toBe(false);
    expect(decisaoDeAdminBloqueia({ historico: [] })).toBe(false);
    expect(decisaoDeAdminBloqueia({ historico: null })).toBe(false);
  });

  it('⚠️ REENVIO do autor depois da decisão humana REABRE a avaliação (caso Íris, 11/09/2026)', () => {
    // Luis aprovou a v1 em 21/08; a autora reenviou em 11/09 (Status → Pendente); o time concluiu Aprovado.
    const historico = [
      { ator: 'luis.albuquerque@gocase.com', quando: '2026-08-21 18:24:05' },
      { ator: 'luis.albuquerque@gocase.com', quando: '2026-08-21 18:24:10' },
    ];
    expect(
      podeAgenteGravarStatus({ statusAtual: 'Pendente', alvo: 'Aprovado', atorDoStatusAtual: 'luis.albuquerque@gocase.com', historico, ultimoReenvioEm: '2026-09-11 19:22:56' }),
    ).toEqual({ pode: true, motivo: null });
    // sem reenvio depois, a decisão humana continua valendo
    expect(
      podeAgenteGravarStatus({ statusAtual: 'Pendente', alvo: 'Aprovado', atorDoStatusAtual: 'luis.albuquerque@gocase.com', historico, ultimoReenvioEm: '2026-08-01 10:00:00' }).pode,
    ).toBe(false);
    expect(
      podeAgenteGravarStatus({ statusAtual: 'Pendente', alvo: 'Aprovado', atorDoStatusAtual: 'luis.albuquerque@gocase.com', historico, ultimoReenvioEm: null }).pode,
    ).toBe(false);
  });
});
