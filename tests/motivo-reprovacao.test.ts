// O motivo de reprovação que o AUTOR lê (`src/lib/motivo-reprovacao.ts`, PURO).
//
// ⚠️ O texto é renderizado como TEXTO PURO no `AvisoPendencia` (sem
// `dangerouslySetInnerHTML`), e é lido por 137 pessoas de uma vez. Estes testes trancam as
// decisões de copy, não a redação: markdown sairia literal, travessão é proibido no repo,
// e citar valor convida a discutir o valor em vez de entender a classificação.
import { describe, it, expect } from 'vitest';
import {
  MOTIVO_EXPERIMENTACAO,
  ASSINATURA_MOTIVO_RODADA_04_09,
  ehMotivoDaRodada0409,
} from '@/lib/motivo-reprovacao';

describe('MOTIVO_EXPERIMENTACAO — o que o texto tem de dizer', () => {
  it('nomeia a CAIXA (experimentação) e quem decidiu', () => {
    expect(MOTIVO_EXPERIMENTACAO).toMatch(/experimenta[çc]/i);
    expect(MOTIVO_EXPERIMENTACAO).toMatch(/time de valida[çc][ãa]o/i);
  });

  it('encoraja e dá o caminho de volta (medir e reenviar)', () => {
    expect(MOTIVO_EXPERIMENTACAO).toMatch(/reenviar/i);
    expect(MOTIVO_EXPERIMENTACAO).toMatch(/investindo|continue|siga/i);
  });
});

describe('MOTIVO_EXPERIMENTACAO — o que o texto NÃO pode ter', () => {
  it('não cita valor nenhum (nem o piso, nem o impacto apurado)', () => {
    // Número no texto faz a pessoa discutir o número. O que mudou foi a classificação.
    expect(MOTIVO_EXPERIMENTACAO).not.toMatch(/R\$/);
    expect(MOTIVO_EXPERIMENTACAO).not.toMatch(/\d/);
  });

  it('não expõe a régua interna (piso, estrela, revisão retroativa)', () => {
    expect(MOTIVO_EXPERIMENTACAO).not.toMatch(/estrela|retroativ|piso|abaixo de/i);
  });

  it('não manda procurar o time de RPA (abriria a porta para 137 pessoas)', () => {
    expect(MOTIVO_EXPERIMENTACAO).not.toMatch(/time de RPA|fale com|procure/i);
  });

  it('sem travessão nem markdown (o texto é renderizado CRU)', () => {
    expect(MOTIVO_EXPERIMENTACAO).not.toMatch(/[—–]/);
    expect(MOTIVO_EXPERIMENTACAO).not.toContain('**');
    expect(MOTIVO_EXPERIMENTACAO).not.toMatch(/<[a-z]/i);
  });

  it('é CURTO: cabe em um aviso, não em um parágrafo de política', () => {
    // A tira do `AvisoPendencia` abre o motivo numa placa de 13px travada em 72ch.
    expect(MOTIVO_EXPERIMENTACAO.length).toBeLessThan(420);
  });
});

describe('ehMotivoDaRodada0409 — protege a reprovação MANUAL da triagem', () => {
  it('reconhece a célula que a rodada gravou', () => {
    expect(
      ehMotivoDaRodada0409(
        `Reprovado em ${ASSINATURA_MOTIVO_RODADA_04_09}: impacto financeiro mensal abaixo de R$ 100.`,
      ),
    ).toBe(true);
  });

  it('NÃO reconhece motivo escrito à mão (não pode ser sobrescrito)', () => {
    // Caso real na base: "Godocs não pode ser submetido." — julgamento de uma pessoa.
    expect(ehMotivoDaRodada0409('Godocs não pode ser submetido.')).toBe(false);
    expect(ehMotivoDaRodada0409('—')).toBe(false);
    expect(ehMotivoDaRodada0409('')).toBe(false);
    expect(ehMotivoDaRodada0409(null)).toBe(false);
  });

  it('não reconhece o texto NOVO (a reescrita é idempotente, não reaplica)', () => {
    expect(ehMotivoDaRodada0409(MOTIVO_EXPERIMENTACAO)).toBe(false);
  });
});
