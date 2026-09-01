import { describe, it, expect } from 'vitest';
import { partirParecerMesa, ROTULO_CURTO_DIMENSAO, semTravessao } from '@/lib/mesa-parecer';

describe('partirParecerMesa — parecer da mesa em linhas atribuídas', () => {
  it('parte uma linha por especialista, com o autor separado do texto', () => {
    const motivo = [
      'Financeiro: O ganho de R$ 51 mil/mês é alto e a comparação com o que teria acontecido sem a automação não fecha.',
      'Cético: O ganho é apresentado como já medido, mas vem de um cálculo, sem grupo de comparação.',
      'Os especialistas divergiram — vai para a triagem.',
    ].join('\n');
    const r = partirParecerMesa(motivo);
    expect(r).toHaveLength(3);
    expect(r[0].autor).toBe('Financeiro');
    expect(r[0].texto).toMatch(/^O ganho de R\$ 51 mil/);
    expect(r[1].autor).toBe('Cético');
    // a nota de fechamento da mesa NÃO tem autor
    expect(r[2].autor).toBeNull();
    expect(r[2].texto).toBe('Os especialistas divergiram — vai para a triagem.');
  });

  it('reconhece os 4 rótulos curtos como autor', () => {
    for (const rotulo of Object.values(ROTULO_CURTO_DIMENSAO)) {
      const r = partirParecerMesa(`${rotulo}: algo preocupa aqui.`);
      expect(r[0].autor).toBe(rotulo);
      expect(r[0].texto).toBe('algo preocupa aqui.');
    }
  });

  it('NÃO lê dois-pontos no meio da frase como autor', () => {
    const r = partirParecerMesa('Resultado: 40% do ganho vem da automação.');
    expect(r).toHaveLength(1);
    expect(r[0].autor).toBeNull();
    expect(r[0].texto).toBe('Resultado: 40% do ganho vem da automação.');
  });

  it('parecer LEGADO (parágrafo corrido, sem prefixo e sem \\n) volta como UMA linha sem autor', () => {
    const legado =
      'O ganho de R$ 51 mil/mês é material e depende de um contrafactual cuja base não está alinhada. Sinais divergentes entre os especialistas — enviado à triagem humana.';
    const r = partirParecerMesa(legado);
    expect(r).toHaveLength(1);
    expect(r[0].autor).toBeNull();
    expect(r[0].texto).toBe(legado);
  });

  it('vazio, nulo e só espaços → lista vazia (a ficha não desenha bloco nenhum)', () => {
    expect(partirParecerMesa(null)).toEqual([]);
    expect(partirParecerMesa(undefined)).toEqual([]);
    expect(partirParecerMesa('   \n  \n ')).toEqual([]);
  });

  it('ignora linhas em branco no meio e apara espaços', () => {
    const r = partirParecerMesa('  Horas: falta o registro das 51h.  \n\n\n  Precedente: fora da vizinhança.  ');
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ autor: 'Horas', texto: 'falta o registro das 51h.' });
    expect(r[1]).toEqual({ autor: 'Precedente', texto: 'fora da vizinhança.' });
  });

  it('autor sem texto depois do prefixo é descartado (não vira bullet vazio)', () => {
    expect(partirParecerMesa('Financeiro: ')).toEqual([]);
  });
});

describe('semTravessao — o parecer do agente não usa traços', () => {
  it('travessão entre frases vira vírgula', () => {
    expect(semTravessao('Só um especialista objetou — a ressalva fica registrada.')).toBe(
      'Só um especialista objetou, a ressalva fica registrada.',
    );
  });

  it('travessão depois de pontuação não duplica a vírgula', () => {
    expect(semTravessao('Falta registro, — precisa conferir.')).toBe('Falta registro, precisa conferir.');
  });

  it('en dash e hífen SOLTO também caem', () => {
    expect(semTravessao('A vale 10 – B vale 20.')).toBe('A vale 10, B vale 20.');
    expect(semTravessao('A vale 10 - B vale 20.')).toBe('A vale 10, B vale 20.');
  });

  it('traço no começo do texto é removido', () => {
    expect(semTravessao('— O ganho é alto.')).toBe('O ganho é alto.');
    expect(semTravessao('- O ganho é alto.')).toBe('O ganho é alto.');
  });

  it('⚠️ MANTÉM o hífen DENTRO da palavra (é ortografia, não pontuação)', () => {
    const t = 'Confira o e-mail da pré-aprovação e o custo-benefício.';
    expect(semTravessao(t)).toBe(t);
    expect(semTravessao('Rodou no n8n e no back-end.')).toBe('Rodou no n8n e no back-end.');
  });

  it('texto sem traço nenhum passa intacto', () => {
    const t = 'A economia usa 486 XMLs por mês, mas não há registro que comprove o volume.';
    expect(semTravessao(t)).toBe(t);
  });

  it('vazio/nulo → string vazia (o normalizador cai no fallback)', () => {
    expect(semTravessao(null)).toBe('');
    expect(semTravessao('   —   ')).toBe('');
  });
});
