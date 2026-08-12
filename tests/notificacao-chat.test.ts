// Quando o grupo do Google Chat é avisado (módulo PURO `src/lib/notificacao-chat.ts`).
//
// A regra: a notificação do grupo deixa de sair a cada submissão e passa a sair quando o
// projeto está LIBERADO do lado do líder. Só que "liberado" tem dois caminhos:
//  - a fila REALMENTE abriu (`isento: false`) → o aviso espera a pré-aprovação;
//  - não há ninguém para aprovar (isenção) → o aviso sai JÁ, na submissão, e a mensagem
//    diz por quê (senão o projeto ficaria invisível para a triagem, esperando um parecer
//    que nunca vem).
//
// ⚠️ O default é o ponto mais importante do módulo e é INVERTIDO em relação ao intuitivo:
// diante de um estado que não sabe interpretar (motivo `null`, motivo NOVO que ninguém
// mapeou aqui), o módulo avisa na SUBMISSÃO. Perder um aviso é pior que avisar cedo.
import { describe, it, expect } from 'vitest';
import { decidirMomentoNotificacao } from '@/lib/notificacao-chat';
import type { MotivoIsencaoNotificacao } from '@/lib/notificacao-chat';

describe('decidirMomentoNotificacao — quando o grupo é avisado', () => {
  it('fila REALMENTE aberta (não isento): o aviso espera a pré-aprovação, sem nota', () => {
    expect(decidirMomentoNotificacao({ isento: false, motivo: null })).toEqual({
      quando: 'pre_aprovacao',
      nota: null,
    });
  });

  it('projeto ESPECIAL: avisa na submissão e SEM nota (a mensagem do especial já se explica)', () => {
    expect(decidirMomentoNotificacao({ isento: true, motivo: 'especial' })).toEqual({
      quando: 'submissao',
      nota: null,
    });
  });

  // Os 3 casos "não há parecer de líder": avisam na submissão COM uma linha explicando.
  const comNota: MotivoIsencaoNotificacao[] = ['lideranca', 'sem_lider', 'teamguide_indisponivel'];
  for (const motivo of comNota) {
    it(`isenção por "${motivo}": avisa na submissão com uma nota não vazia`, () => {
      const r = decidirMomentoNotificacao({ isento: true, motivo });
      expect(r.quando).toBe('submissao');
      expect(typeof r.nota).toBe('string');
      expect((r.nota ?? '').trim().length).toBeGreaterThan(0);
    });
  }

  it('as 3 notas são DISTINTAS entre si (quem lê o grupo precisa saber qual dos 3 casos é)', () => {
    const notas = comNota.map((motivo) => decidirMomentoNotificacao({ isento: true, motivo }).nota);
    expect(new Set(notas).size).toBe(3);
  });

  // ⚠️ Default seguro INVERTIDO. Projeto sem ninguém para aprová-lo não pode ficar
  // invisível esperando um parecer que nunca chega.
  it('isento com motivo NULL: cai na submissão com nota, nunca em pre_aprovacao', () => {
    const r = decidirMomentoNotificacao({ isento: true, motivo: null });
    expect(r.quando).toBe('submissao');
    expect((r.nota ?? '').trim().length).toBeGreaterThan(0);
  });

  it('isento com motivo FUTURO/desconhecido: idem — submissão com nota', () => {
    // Um motivo novo entra no enum um dia; enquanto ninguém o mapear aqui, o
    // comportamento seguro é avisar na submissão, não engolir o projeto.
    const r = decidirMomentoNotificacao({
      isento: true,
      motivo: 'motivo_que_ainda_nao_existe' as never,
    });
    expect(r.quando).toBe('submissao');
    expect((r.nota ?? '').trim().length).toBeGreaterThan(0);
  });
});
