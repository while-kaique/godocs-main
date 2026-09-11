// Travas e réguas nascidas dos CANÁRIOS da rodada de calibragem de 11/09/2026 (staging, aba de cópia).
// Cada caso cita o projeto real que expôs o defeito. Ver docs/baselines/rodadas/noite-2026-09-11/README.md.
import { describe, it, expect } from 'vitest';
import { aplicarTravaMaterialMesa } from '@/lib/agents/mesa-especialistas';
import { linhaImpactoBrutoLiquido } from '@/lib/avaliacao/dossie';
import { rotuloNotaAgente, ESCAPE_MUDA_O_JOGO, CRITERIOS_ESTRELA, descreverEscape } from '@/lib/estrelas-regua';
import { buildPromptEstrela } from '@/lib/avaliacao/cerebro-estrela';
import { textoParaEmbedding } from '@/lib/especial-corpus';

const base = { dimensao: 'fte' as const, confianca: 0.8, sinais: [] as string[], origem: 'llm' as const };

describe('mesa — preocupação só por FALTA DE MATERIAL vira ressalva (SendApp, CX Hub)', () => {
  it('rebaixa o parecer que só pede memória de cálculo / equipe / registro', () => {
    const j = aplicarTravaMaterialMesa({ ...base, preocupa: true, argumento: 'O volume de 793 grupos torna crível um saving relevante, mas faltam a equipe envolvida e as horas economizadas por rotina. Para fechar, é preciso conferir essa memória de cálculo.' });
    expect(j.preocupa).toBe(false);
    expect(j.argumento).toMatch(/ressalva/);
    expect(j.sinais.join(' ')).toMatch(/falta de material/);
  });
  it('MANTÉM a preocupação quando há sinal concreto (número implausível, dupla contagem, projeção)', () => {
    const j1 = aplicarTravaMaterialMesa({ ...base, preocupa: true, argumento: 'O saving de 8.352 horas por mês equivale a cerca de 38 pessoas em tempo integral, implausível para o processo descrito. Falta o registro de quantas pessoas faziam o trabalho.' });
    expect(j1.preocupa).toBe(true);
    const j2 = aplicarTravaMaterialMesa({ ...base, preocupa: true, argumento: 'Possível dupla contagem: o mesmo dinheiro aparece como receita e como saving. Falta comprovante da fonte.' });
    expect(j2.preocupa).toBe(true);
  });
  it('não toca em quem não preocupa', () => {
    const j = aplicarTravaMaterialMesa({ ...base, preocupa: false, argumento: 'Sem sinal de preocupação.' });
    expect(j).toEqual({ ...base, preocupa: false, argumento: 'Sem sinal de preocupação.' });
  });
});

describe('dossiê — o impacto leva "R$" e diz que não é hora (AVD Central v2 lido como "8.352 horas")', () => {
  it('imprime R$ nos dois números e a ressalva de unidade', () => {
    const l = linhaImpactoBrutoLiquido(16704.48, 8352.24)!;
    expect(l).toContain('R$ 16704.48');
    expect(l).toContain('R$ 8352.24');
    expect(l).toMatch(/REAIS/);
    expect(l).toMatch(/NÃO são horas/);
  });
});

describe('estrela — rótulo e âncoras da faixa 6-10 (PIAPP, Robô orçamento, GoBrands)', () => {
  it('rotuloNotaAgente diz "6-10" quando o consenso tem escape, mesmo com nota 5 (o cérebro é travado em 5)', () => {
    expect(rotuloNotaAgente(5, true).rotulo).toBe('6-10');
    expect(rotuloNotaAgente(5, false).rotulo).toBe('5');
    expect(rotuloNotaAgente(5).rotulo).toBe('5');
  });
  it('Robô orçamento (8★ humano) e GoBrands (7★) NÃO são mais exemplos de 5★; são âncoras do escape', () => {
    const cinco = CRITERIOS_ESTRELA.find((n) => n.nota === 5)!;
    expect(cinco.exemplos.join(' ')).not.toMatch(/Robo orçamento|GoBrands|CTR Machine/);
    expect(ESCAPE_MUDA_O_JOGO.exemplos).toEqual(expect.arrayContaining(['PIAPP', 'Robo orçamento', 'GoBrands']));
    expect(descreverEscape()).toMatch(/comitê humano JÁ colocou nesta faixa/);
  });
  it('o prompt do cérebro traz as âncoras 6-10 vivas quando informadas', () => {
    const [, user] = buildPromptEstrela({
      dossieTexto: 'DOSSIÊ',
      vizinhos: [],
      ancorasComite: [{ nome: 'PIAPP', nota: 10, resumo: 'plataforma sobre a qual 10 times constroem' }],
    });
    expect(user.content).toMatch(/JÁ COLOCOU NA FAIXA 6–10/);
    expect(user.content).toMatch(/PIAPP \(comitê: 10★\)/);
  });
});

describe('embedding — memorial v1 fora do vetor', () => {
  it('o texto não carrega o memorial nem com doc ausente', () => {
    expect(textoParaEmbedding({ nome: 'X', descricao: 'faz Y', memorial: 'R$ 1.000 de saving' })).not.toMatch(/R\$|Memorial/);
  });
});
