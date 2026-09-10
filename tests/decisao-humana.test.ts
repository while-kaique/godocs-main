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
    expect(porqueNaoEncostou('decisao_humana', 'Aprovado')).toMatch(/decidido por uma pessoa/);
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
