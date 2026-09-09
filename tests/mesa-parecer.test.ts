import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  partirParecerMesa,
  ROTULO_CURTO_DIMENSAO,
  semTravessao,
  partirJustificativaDoTime,
  BLOCOS_JUSTIFICATIVA,
  BLOCOS_ABERTOS,
} from '@/lib/mesa-parecer';

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

// ─── A justificativa do time em BLOCOS (09/09/2026) ──────────────────────────────────────────
describe('partirJustificativaDoTime — o muro de texto vira blocos', () => {
  // Recorte REAL do caso «Plataforma Smartonline / DIFAL», que o Luis chamou de "praticamente
  // ilegivel". O texto sempre teve `\n`; a ficha é que os colapsava.
  const real = [
    'Justificativa interna: Plataforma Smartonline (id 589938ae)',
    'Saída do time: Pedir ajuste. Mérito: ajuste. Estrela: 5 estrelas. Confiança alta.',
    'Critério aplicado: assume.',
    'Evidências da estrela:',
    '- A guia é emitida e paga automaticamente em até 1h após o faturamento.',
    '- Em agosto/2026 foram recolhidos R$ 1.689.582,89 em 6 empresas.',
    'Racional da estrela: Fica em 5 porque entrega ao fisco sem uma pessoa entre a execução e a multa.',
    'Julgamentos do mérito:',
    '- financeiro (preocupa): R$117.475,25 não é reconciliável.',
    'Auditoria de valor: valor declarado ABSURDO.',
    'Perguntas ao autor:',
    '- Qual memória reconcilia o ganho declarado?',
  ].join('\n');

  it('reconhece cada rótulo e agrupa as linhas dele', () => {
    const b = partirJustificativaDoTime(real);
    const titulos = b.map((x) => x.titulo);
    expect(titulos).toContain('Saída do time');
    expect(titulos).toContain('Evidências da estrela');
    expect(titulos).toContain('Perguntas ao autor');
    const ev = b.find((x) => x.titulo === 'Evidências da estrela');
    expect(ev?.linhas).toHaveLength(2);
    // O bullet sai: quem desenha a lista é a tela.
    expect(ev?.linhas[0].startsWith('-')).toBe(false);
  });

  it('o rótulo com texto na MESMA linha não perde o conteúdo', () => {
    const b = partirJustificativaDoTime(real);
    expect(b.find((x) => x.titulo === 'Saída do time')?.linhas[0]).toMatch(/Pedir ajuste/);
  });

  it('não reescreve nada — o rastro de auditoria fica íntegro', () => {
    const b = partirJustificativaDoTime(real);
    const junto = b.flatMap((x) => x.linhas).join(' ');
    expect(junto).toContain('1.689.582,89');
    expect(junto).toContain('não é reconciliável');
  });

  it('vazio e nulo não lançam', () => {
    expect(partirJustificativaDoTime(null)).toEqual([]);
    expect(partirJustificativaDoTime('   ')).toEqual([]);
  });

  it('⚠️ os rótulos do parser são os MESMOS que o time escreve', () => {
    // Rótulo novo no `textos.ts` sem entrar em `BLOCOS_JUSTIFICATIVA` cai no bloco anterior, sem
    // erro nenhum — é a armadilha do parser por prefixo.
    const fonte = readFileSync('src/lib/avaliacao/textos.ts', 'utf8');
    for (const t of BLOCOS_JUSTIFICATIVA) {
      expect(fonte, `"${t}" não aparece em textos.ts`).toContain(`${t}:`);
    }
  });

  it('os blocos abertos são os que respondem "por que este desfecho?"', () => {
    for (const t of BLOCOS_ABERTOS) expect(BLOCOS_JUSTIFICATIVA).toContain(t as never);
    // As evidências e os 5 julgamentos são rastro, não leitura primeira.
    expect(BLOCOS_ABERTOS).not.toContain('Julgamentos do mérito');
    expect(BLOCOS_ABERTOS).not.toContain('Evidências da estrela');
  });
});
