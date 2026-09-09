/**
 * O gatilho do alerta do grupo passa a ser o PARECER DO AGENTE (09/09/2026), substituindo a D30
 * (pré-aprovação do líder).
 *
 * Decisão do Luis: *"ao inves de ter disparo a cada pre-aprovação de lider, faz sentido ter disparo
 * a cada aprovação do agente, com sua justificativa"* · *"o fluxo vai seguir so com aprovar e
 * reprovar, é 0 ou 1, 1 ou 0"* · com UMA exceção: *"o agente fala 6-10 e o projeto recebe flag de
 * 6-10, mas humano vai la e bota 6 a 10 estrelas"*.
 */
import { describe, it, expect } from 'vitest';
import {
  NOTA_LIDER_PENDENTE,
  RESUMO_CONSENSO_LINHAS,
  RESUMO_CONSENSO_MAX,
  deveAvisarDoAgente,
  deveAvisarPorAgente,
  resumirConsenso,
  rotuloDesfechoAgente,
  subtituloDoAgente,
} from '@/lib/notificacao-agente';

describe('deveAvisarPorAgente — binário, com a exceção nomeada', () => {
  it('aprovar e reprovar SEMPRE avisam', () => {
    expect(deveAvisarPorAgente({ veredito: 'aprovar' })).toBe(true);
    expect(deveAvisarPorAgente({ veredito: 'reprovar' })).toBe(true);
    // O escape não muda nada nesses dois.
    expect(deveAvisarPorAgente({ veredito: 'aprovar', escape: true })).toBe(true);
    expect(deveAvisarPorAgente({ veredito: 'reprovar', escape: false })).toBe(true);
  });

  it('⚠️ `em_validacao` avisa SÓ na faixa 6-10', () => {
    // É a única forma de `em_validacao` que carrega informação acionável: o grupo precisa saber
    // quais projetos exigem estrela humana de verdade.
    expect(deveAvisarPorAgente({ veredito: 'em_validacao', escape: true })).toBe(true);
    expect(deveAvisarPorAgente({ veredito: 'em_validacao', escape: false })).toBe(false);
    expect(deveAvisarPorAgente({ veredito: 'em_validacao' })).toBe(false);
    expect(deveAvisarPorAgente({ veredito: 'em_validacao', escape: null })).toBe(false);
  });

  it('⚠️ o `em_validacao` comum CALA, e isso é o que protege o grupo', () => {
    // Medido em prod (09/09/2026): 311 baixa · 224 média · 106 alta em 641 avaliados. O desfecho
    // "manda para conferência humana" é o dominante; se ele disparasse, o card deixaria de ser
    // sinal — a mesma razão pela qual o `buildUpdateMessage` foi removido deste repo.
    expect(deveAvisarPorAgente({ veredito: 'em_validacao', escape: false })).toBe(false);
  });

  it('⚠️ veredito DESCONHECIDO não avisa — default oposto ao da D30, de propósito', () => {
    // Na D30 o desconhecido notificava (o risco era projeto invisível esperando parecer que nunca
    // chega). Aqui o risco é o inverso, inundar o grupo, e quem não é anunciado continua na fila
    // do /dashboard.
    expect(deveAvisarPorAgente({ veredito: 'isento' })).toBe(false);
    expect(deveAvisarPorAgente({ veredito: 'ajuste' })).toBe(false);
    expect(deveAvisarPorAgente({ veredito: '' })).toBe(false);
  });
});

describe('os textos do card', () => {
  it('o subtítulo distingue os três casos que disparam', () => {
    const s = [
      subtituloDoAgente({ veredito: 'aprovar' }),
      subtituloDoAgente({ veredito: 'reprovar' }),
      subtituloDoAgente({ veredito: 'em_validacao', escape: true }),
    ];
    expect(new Set(s).size).toBe(3);
    expect(s[0]).toMatch(/Aprovado/);
    expect(s[1]).toMatch(/Reprovado/);
    expect(s[2]).toMatch(/6-10/);
  });

  it('o rótulo da linha visível também distingue os três', () => {
    expect(rotuloDesfechoAgente({ veredito: 'aprovar' })).toBe('Aprovado');
    expect(rotuloDesfechoAgente({ veredito: 'reprovar' })).toBe('Reprovado');
    expect(rotuloDesfechoAgente({ veredito: 'em_validacao', escape: true })).toMatch(/6-10/);
  });

  it('⚠️ sem parecer de líder o card DIZ que ele ainda não opinou', () => {
    // A linha do parecer é a primeira coisa visível, e agora ela está vazia quase sempre (o
    // gatilho passou a ser mais cedo). "—" ali sugere que ninguém vai opinar.
    expect(NOTA_LIDER_PENDENTE).toMatch(/ainda não opinou/);
  });
});

describe('resumirConsenso — recorta, não reescreve', () => {
  it('⚠️ sem traço nenhum como conector', () => {
    // Regra do repo e pedido explícito: o card é lido no celular e traço ali vira ruído.
    const r = resumirConsenso('Financeiro — o valor não fecha\nCético – falta memória');
    expect(r).not.toMatch(/—|–/);
    expect(r).toContain('Financeiro, o valor não fecha');
  });

  it('o hífen de palavra composta FICA', () => {
    expect(resumirConsenso('Custo-benefício conferido')).toContain('Custo-benefício');
  });

  it('tira linha vazia e frase repetida', () => {
    // Dois especialistas concordando repetem a mesma dúvida, e o consenso vem uma frase por voz.
    const r = resumirConsenso(['A conta não fecha.', '', 'A conta não fecha.', 'Falta o memorial.']);
    expect(r.split('\n')).toEqual(['A conta não fecha.', 'Falta o memorial.']);
  });

  it(`entra no máximo ${RESUMO_CONSENSO_LINHAS} frases`, () => {
    const r = resumirConsenso(['um', 'dois', 'três', 'quatro', 'cinco', 'seis']);
    expect(r.split('\n')).toHaveLength(RESUMO_CONSENSO_LINHAS);
  });

  it('corta no teto de caracteres, com reticência', () => {
    const r = resumirConsenso('x'.repeat(RESUMO_CONSENSO_MAX + 200));
    expect(r.length).toBeLessThanOrEqual(RESUMO_CONSENSO_MAX);
    expect(r.endsWith('…')).toBe(true);
  });

  it('vazio devolve vazio, sem lançar', () => {
    expect(resumirConsenso(null)).toBe('');
    expect(resumirConsenso(undefined)).toBe('');
    expect(resumirConsenso([])).toBe('');
    expect(resumirConsenso('   \n  ')).toBe('');
  });
});

describe('deveAvisarDoAgente — um aviso por PROJETO', () => {
  it('ganhou a corrida (linhas > 0) → avisa; já avisado (0) → cala', () => {
    expect(deveAvisarDoAgente(1)).toBe(true);
    expect(deveAvisarDoAgente(0)).toBe(false);
  });

  it('⚠️ `null` (adaptador silencioso) AVISA — os dois erros não são simétricos', () => {
    // Tratar o desconhecido como "já avisado" deixaria o grupo em silêncio para sempre, com cara
    // de funcionando. Avisar custa, no pior caso, um card repetido numa rerodada. É o mesmo
    // default invertido do `deveNotificarDecisao`.
    expect(deveAvisarDoAgente(null)).toBe(true);
    expect(deveAvisarDoAgente(undefined)).toBe(true);
  });
});
