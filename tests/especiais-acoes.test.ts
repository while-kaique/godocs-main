/**
 * Ações de triagem no cartão de /especiais — o vocabulário e a regra do motivo.
 *
 * O que estes testes prendem: decisão negativa nunca é muda (motivo obrigatório) e cada uma
 * escreve na SUA coluna — "Motivo Reenvio" alimenta o e-mail ao autor, "Motivo Reprovado"
 * divide espaço com o parecer do analisador.
 */
import { describe, it, expect } from 'vitest';
import {
  STATUS_GRAVAVEIS_ESPECIAIS,
  PERGUNTA_MOTIVO,
  campoDoMotivo,
  precisaMotivo,
  rotuloAcao,
  type AcaoTriagem,
} from '@/lib/especiais-acoes';
import { STATUS_GRAVAVEIS } from '@/lib/dashboard-admin.functions';

const ACOES: AcaoTriagem[] = ['aprovar', 'reenviar', 'reprovar'];

describe('ações de triagem', () => {
  it('só aprovar dispensa motivo — "não" mudo não chega ao autor', () => {
    expect(precisaMotivo('aprovar')).toBe(false);
    expect(precisaMotivo('reenviar')).toBe(true);
    expect(precisaMotivo('reprovar')).toBe(true);
  });

  it('cada ação grava um status que o dropdown da planilha aceita', () => {
    for (const acao of ACOES) {
      expect(STATUS_GRAVAVEIS).toContain(STATUS_GRAVAVEIS_ESPECIAIS[acao]);
    }
  });

  it('o motivo vai para a coluna própria de cada ação', () => {
    expect(campoDoMotivo('reenviar')).toBe('motivo_reenvio');
    expect(campoDoMotivo('reprovar')).toBe('motivo_reprovado');
    expect(campoDoMotivo('aprovar')).toBeNull();
  });

  it('toda ação tem rótulo e toda ação que exige motivo tem a pergunta', () => {
    for (const acao of ACOES) expect(rotuloAcao(acao)).toBeTruthy();
    expect(PERGUNTA_MOTIVO.reenviar).toBeTruthy();
    expect(PERGUNTA_MOTIVO.reprovar).toBeTruthy();
  });
});
