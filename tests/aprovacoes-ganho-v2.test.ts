/**
 * A fila do LÍDER lê o ganho da PLANILHA, não dos campos v1 do SQLite (10/09/2026).
 *
 * ⚠️ **Medido em produção, nos 23 cards que os líderes tinham na tela naquele momento:**
 *   • «Vision Operação (VOP)» mostrava **63 h e nenhum R$** — a planilha diz R$ 1.406,63;
 *   • «Control Tower - PCP» 168 h sem valor (R$ 1.170,96);
 *   • «Radar de Mercado AZ» 36 h sem valor (R$ 519,57);
 *   • **7 cards sem número nenhum** — esses são ganho imensurável, e ali o defeito não é o valor
 *     e sim o SILÊNCIO: a 3ª pergunta do checklist é "o saving está coerente?" e o líder decidia
 *     olhando campo vazio.
 *
 * É o mesmo bug do card do Google Chat (08/09), e a correção reusa a MESMA função — nada de
 * segunda régua para o mesmo número.
 */
import { describe, it, expect } from 'vitest';
import { resumirGanhoDaPlanilha, rotularCategoriasGanho } from '@/lib/notificacao-ganho';

describe('o card do líder mostra o número que a planilha tem', () => {
  it('⚠️ projeto com horas liberadas mostra R$ — era o caso «Control Tower - PCP»', () => {
    const r = resumirGanhoDaPlanilha({
      'ID Projeto': 'p1',
      'Impacto Líquido Mensal': '1170,96',
      'Custo Evitado Horas': '168,00',
      'Tipos de Ganho': 'Custo evitado',
    })!;
    expect(r).not.toBeNull();
    expect(r.semNumero).toBe(false);
    // o destaque é o número que o líder olha primeiro, e ele EXISTE
    expect(r.destaque?.valor).toMatch(/1\.170,96|1170,96/);
  });

  it('⚠️ sem número NENHUM a função devolve null — e é o chamador que decide', () => {
    // Está escrito na própria função: "o chamador decide". A fila do líder decide NÃO ficar
    // muda (ver `ganhoDoCard`), porque 7 dos 23 cards são ganho imensurável e o líder precisa
    // ler isso em palavras para responder a 3ª pergunta do checklist.
    expect(
      resumirGanhoDaPlanilha({
        'ID Projeto': 'p2',
        'Impacto Líquido Mensal': '0',
        'Tipos de Ganho': 'Ganho imensurável',
      }),
    ).toBeNull();
    // e a categoria continua legível a partir da célula crua, que é o que o chamador usa
    expect((rotularCategoriasGanho('Ganho imensurável') ?? '').toLowerCase()).toContain('imensur');
  });

  it('sem linha na planilha devolve null — a tela cai na rede v1, não inventa', () => {
    expect(resumirGanhoDaPlanilha(null)).toBeNull();
    expect(resumirGanhoDaPlanilha(undefined)).toBeNull();
  });

  it('⚠️ "—" não vira número nem categoria (o traço do `padronizarLinha`)', () => {
    expect(
      resumirGanhoDaPlanilha({
        'ID Projeto': 'p3',
        'Impacto Líquido Mensal': '—',
        'Receita Mensal': '—',
        'Tipos de Ganho': '—',
      }),
    ).toBeNull();
    expect(rotularCategoriasGanho('—')).toBeNull();
  });
});
