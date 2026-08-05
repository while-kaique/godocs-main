/**
 * Parecer do líder na ficha de triagem (`/dashboard`).
 *
 * O teste central é de IDA-E-VOLTA: o texto é gerado por `justificativaAprovacaoSheet`
 * (o que realmente vai para a planilha) e lido por `interpretarParecerLider`. Se alguém
 * mudar o formato de escrita sem mexer no leitor, cai aqui — sem isso a tela voltaria a
 * mostrar um bloco corrido, que é justamente o que esta feature veio resolver.
 */
import { describe, it, expect } from 'vitest';
import {
  interpretarParecerLider,
  chaveDoEstado,
  COLUNA_ESTADO_LIDER,
  COLUNA_JUSTIFICATIVA_LIDER,
} from '@/lib/aprovacoes-parecer';
import {
  justificativaAprovacaoSheet,
  rotuloAprovacaoSheet,
  justificativaIsencaoSheet,
  rotuloIsencaoSheet,
} from '@/lib/aprovacoes.functions';
import { CHECKLIST_APROVACAO } from '@/lib/aprovacoes-checklist';
import { chaveColuna, valorDaColuna } from '@/lib/coluna-chave';

type LinhaParecer = Parameters<typeof justificativaAprovacaoSheet>[0][number];

function linha(over: Partial<LinhaParecer> = {}): LinhaParecer {
  return {
    veredito: 'aprovado',
    aprovador_nome: 'Ana Lima',
    aprovador_email: 'ana@gocase.com',
    comentario: null,
    decidido_por: 'ana@gocase.com',
    decidido_em: '2026-08-05T12:00:00.000Z',
    resp_move_kpi: 'sim',
    resp_sente_falta: 'sim',
    resp_saving_coerente: 'sim',
    ...over,
  } as LinhaParecer;
}

/** Monta a linha da planilha como o dashboard a entrega: chaveada pelo cabeçalho REAL. */
function comoNaPlanilha(linhas: LinhaParecer[], nomeColunaJustificativa = COLUNA_JUSTIFICATIVA_LIDER) {
  return {
    [COLUNA_ESTADO_LIDER]: rotuloAprovacaoSheet(linhas),
    [nomeColunaJustificativa]: justificativaAprovacaoSheet(linhas),
  };
}

describe('interpretarParecerLider — ida e volta com o que vai para a planilha', () => {
  it('desmonta um parecer pré-aprovado com as 3 respostas', () => {
    const p = interpretarParecerLider(comoNaPlanilha([linha()]));

    expect(p.vazio).toBe(false);
    expect(p.estadoChave).toBe('aprovado');
    expect(p.assinatura).toBe('Ana Lima (ana@gocase.com)');
    expect(p.decididoEm).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(p.checklist).toHaveLength(3);
    expect(p.checklist.map((c) => c.resposta)).toEqual(['sim', 'sim', 'sim']);
    // As perguntas exibidas são as da FONTE ÚNICA, não uma redação paralela.
    expect(p.checklist.map((c) => c.pergunta)).toEqual(CHECKLIST_APROVACAO.map((q) => q.pergunta));
    expect(p.temNao).toBe(false);
    expect(p.comentario).toBeNull();
    expect(p.outras).toEqual([]);
  });

  it('marca o "não" e separa a justificativa com o rótulo do que ela é (D16/D18)', () => {
    const p = interpretarParecerLider(
      comoNaPlanilha([
        linha({
          resp_move_kpi: 'nao',
          comentario: 'O ganho aqui é risco fiscal, não KPI da área.',
        }),
      ]),
    );

    expect(p.temNao).toBe(true);
    expect(p.checklist.find((c) => c.resposta === 'nao')?.pergunta).toBe(
      CHECKLIST_APROVACAO[0].pergunta,
    );
    expect(p.comentarioRotulo).toContain('Move KPI');
    expect(p.comentario).toBe('O ganho aqui é risco fiscal, não KPI da área.');
    // A justificativa NÃO pode sobrar em `outras` (seria exibida duas vezes).
    expect(p.outras).toEqual([]);
  });

  it('rotula o texto conforme o veredito: ajuste e reprovação', () => {
    const ajuste = interpretarParecerLider(
      comoNaPlanilha([linha({ veredito: 'ajuste', comentario: 'Refazer a conta de horas.' })]),
    );
    expect(ajuste.estadoChave).toBe('ajuste');
    expect(ajuste.comentarioRotulo).toBe('O que precisa ser ajustado');
    expect(ajuste.comentario).toBe('Refazer a conta de horas.');

    const reprovado = interpretarParecerLider(
      comoNaPlanilha([linha({ veredito: 'reprovado', comentario: 'Não é projeto.' })]),
    );
    expect(reprovado.estadoChave).toBe('reprovado');
    expect(reprovado.comentarioRotulo).toBe('Motivo da reprovação');
  });

  it('preserva comentário de VÁRIAS linhas (o líder aperta Enter na caixa)', () => {
    const texto = 'Primeiro ponto.\nSegundo ponto: ainda o mesmo texto.\nTerceiro.';
    const p = interpretarParecerLider(
      comoNaPlanilha([linha({ veredito: 'ajuste', comentario: texto })]),
    );
    expect(p.comentario).toBe(texto);
    expect(p.outras).toEqual([]);
  });

  it('fila ainda aberta: estado pendente e quem está sendo aguardado', () => {
    const pendentes = [
      linha({ veredito: 'pendente', decidido_por: null, decidido_em: null, resp_move_kpi: null, resp_sente_falta: null, resp_saving_coerente: null }),
      linha({
        veredito: 'pendente',
        aprovador_nome: 'Bruno Souza',
        aprovador_email: 'bruno@gocase.com',
        decidido_por: null,
        decidido_em: null,
        resp_move_kpi: null,
        resp_sente_falta: null,
        resp_saving_coerente: null,
      }),
    ];
    const p = interpretarParecerLider(comoNaPlanilha(pendentes));

    expect(p.estadoChave).toBe('pendente');
    expect(p.cabecalho).toBe('Aguardando Ana Lima, Bruno Souza');
    expect(p.checklist).toEqual([]);
  });

  it('isenções (D12) chegam distinguíveis na ficha, não como falha', () => {
    for (const motivo of ['lideranca', 'sem_lider', 'teamguide_indisponivel'] as const) {
      const p = interpretarParecerLider({
        [COLUNA_ESTADO_LIDER]: rotuloIsencaoSheet(motivo),
        [COLUNA_JUSTIFICATIVA_LIDER]: justificativaIsencaoSheet(motivo),
      });
      expect(p.vazio).toBe(false);
      expect(p.cabecalho).toBe(justificativaIsencaoSheet(motivo));
      // Liderança é o único caso sem fila COM estado (o projeto está liberado).
      expect(p.estadoChave).toBe(motivo === 'lideranca' ? 'aprovado' : 'sem_parecer');
    }
  });

  it('acha a coluna mesmo com o cabeçalho SEM acento de prod/staging', () => {
    // Era o bug de 05/08/2026, do outro lado: o cabeçalho real é "…do Lider".
    const p = interpretarParecerLider(
      comoNaPlanilha([linha({ resp_sente_falta: 'nao', comentario: 'Processo redundante.' })], 'Justificativa Aprovação do Lider'),
    );
    expect(p.checklist).toHaveLength(3);
    expect(p.temNao).toBe(true);
    expect(p.comentario).toBe('Processo redundante.');
  });

  it('linha sem parecer nenhum não vira seção na tela', () => {
    expect(interpretarParecerLider({}).vazio).toBe(true);
    expect(
      interpretarParecerLider({ [COLUNA_ESTADO_LIDER]: '—', [COLUNA_JUSTIFICATIVA_LIDER]: '—' })
        .vazio,
    ).toBe(true);
  });

  it('nunca engole conteúdo: linha desconhecida aparece em `outras`', () => {
    const p = interpretarParecerLider({
      [COLUNA_ESTADO_LIDER]: 'Pré-aprovado',
      [COLUNA_JUSTIFICATIVA_LIDER]:
        'Pré-aprovado por Ana Lima (ana@gocase.com) em 05/08/2026\nAnotação solta escrita à mão na planilha',
    });
    expect(p.outras).toEqual(['Anotação solta escrita à mão na planilha']);
  });

  it('estado desconhecido é exibido como está, sem virar "Pré-aprovado"', () => {
    const p = interpretarParecerLider({ [COLUNA_ESTADO_LIDER]: 'Em conversa com o gestor' });
    expect(p.estadoChave).toBe('sem_parecer');
    expect(p.estado).toBe('Em conversa com o gestor');
  });
});

describe('valorDaColuna — casamento tolerante (fonte única com a escrita)', () => {
  it('casa exato primeiro e normalizado como rede', () => {
    expect(valorDaColuna({ 'Aprovação do Líder': 'x' }, 'Aprovação do Líder')).toBe('x');
    expect(valorDaColuna({ 'aprovacao do lider': 'x' }, 'Aprovação do Líder')).toBe('x');
    expect(valorDaColuna({ 'Aprovação  do  Líder ': 'x' }, 'Aprovação do Líder')).toBe('x');
  });

  it('chave AMBÍGUA não casa pelo índice tolerante (fail-safe da escrita)', () => {
    const campos = { 'Aprovação do Lider': 'a', 'aprovacao do lider': 'b' };
    expect(valorDaColuna(campos, 'Aprovação do Líder')).toBeUndefined();
    // Com o nome EXATO presente, resolve normalmente.
    expect(valorDaColuna({ ...campos, 'Aprovação do Líder': 'c' }, 'Aprovação do Líder')).toBe('c');
  });

  it('chaveColuna é a MESMA regra usada pela escrita no Sheets', async () => {
    const sheets = await import('@/lib/google/sheets');
    expect(sheets.chaveColuna('Justificativa Aprovação do Líder')).toBe(
      chaveColuna('justificativa aprovacao do lider'),
    );
  });
});

describe('coluna "Pré-status" da tabela (mapResumo)', () => {
  it('lê o estado do líder mesmo com o cabeçalho SEM acento de prod/staging', async () => {
    const { mapResumo } = await import('@/lib/dashboard-admin.functions');

    const comAcento = mapResumo({
      'ID Projeto': 'abc123',
      Projeto: 'Teste',
      'Aprovação do Líder': 'Pré-aprovado',
    } as never);
    expect(comAcento?.aprovacaoLider).toBe('Pré-aprovado');

    // Era o bug de origem: `row['Aprovação do Líder']` daria undefined e a coluna
    // nasceria vazia em TODO projeto.
    const semAcento = mapResumo({
      'ID Projeto': 'abc124',
      Projeto: 'Teste',
      'Aprovacao do Lider': 'Ajuste pedido',
    } as never);
    expect(semAcento?.aprovacaoLider).toBe('Ajuste pedido');
  });

  it('projeto sem fila fica null (a tabela mostra "—", não um chip)', async () => {
    const { mapResumo } = await import('@/lib/dashboard-admin.functions');
    expect(mapResumo({ 'ID Projeto': 'x', 'Aprovação do Líder': '—' } as never)?.aprovacaoLider).toBeNull();
    expect(mapResumo({ 'ID Projeto': 'x' } as never)?.aprovacaoLider).toBeNull();
  });

  it('o chip da tabela usa a MESMA régua de estado do painel da ficha', () => {
    expect(chaveDoEstado('Pré-aprovado')).toBe('aprovado');
    expect(chaveDoEstado('Pre-aprovado')).toBe('aprovado'); // digitado sem acento na planilha
    expect(chaveDoEstado('Ajuste pedido')).toBe('ajuste');
    expect(chaveDoEstado('Pré-pendente')).toBe('pendente');
    expect(chaveDoEstado('Pré-reprovado')).toBe('reprovado');
    expect(chaveDoEstado('Em conversa com o gestor')).toBe('sem_parecer');
    expect(chaveDoEstado(null)).toBe('sem_parecer');
  });
});
