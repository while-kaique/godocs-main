// Reconciliação financeira PLANILHA → SQLITE.
//
// Origem (Sucesso.AI / Maria Ponciano): dois componentes de RECEITA foram declarados
// como itens de CUSTO EVITADO no saving e, no reenvio seguinte, DE NOVO como receita
// incremental — o mesmo dinheiro dos dois lados. A planilha foi corrigida à mão em
// 31/07; o SQLite não, e como o formulário de edição seeda dele, o próximo reenvio
// reverteria a correção sozinho.
import { describe, it, expect } from 'vitest';
import {
  parseItensDaJustificativa,
  parseValorBR,
  somarItens,
  ganhoTotalMensal,
} from '@/lib/reconciliar-financeiro';

describe('parseValorBR', () => {
  it('lê pt-BR com milhar e decimal', () => {
    expect(parseValorBR('174.238,10')).toBeCloseTo(174238.1, 2);
    expect(parseValorBR('9474,32')).toBeCloseTo(9474.32, 2);
  });

  it('sem vírgula, o ponto é milhar (não decimal)', () => {
    // "2.850" é dois mil e oitocentos e cinquenta, não 2,85.
    expect(parseValorBR('2.850')).toBe(2850);
  });
});

describe('parseItensDaJustificativa — formato gerado pelo app', () => {
  // Exatamente o texto que está hoje na planilha do Sucesso.AI (2 itens, já corrigido).
  const JUST_CORRIGIDA =
    '• Disparos Proativos - Agente Scooto — R$ 9474,32 (mensal). Substituído pelo fluxo no n8n\n' +
    '• Disparo 2 cadência — R$ 2850,00 (mensal). Substituído pelo fluxo no n8n';

  it('reconstrói nome, valor, recorrência e justificativa', () => {
    const itens = parseItensDaJustificativa(JUST_CORRIGIDA);
    expect(itens).toHaveLength(2);
    expect(itens![0]).toEqual({
      nome: 'Disparos Proativos - Agente Scooto',
      valor: 9474.32,
      recorrencia: 'mensal',
      justificativa: 'Substituído pelo fluxo no n8n',
    });
    expect(somarItens(itens!)).toBeCloseTo(12324.32, 2);
  });

  it('nome com hífen não é confundido com o travessão separador', () => {
    // "Disparos Proativos - Agente Scooto" tem hífen NO NOME; o separador é " — ".
    const itens = parseItensDaJustificativa(JUST_CORRIGIDA);
    expect(itens![0].nome).toBe('Disparos Proativos - Agente Scooto');
  });

  it('vazio e "—" são lista vazia (não erro)', () => {
    expect(parseItensDaJustificativa('')).toEqual([]);
    expect(parseItensDaJustificativa('—')).toEqual([]);
    expect(parseItensDaJustificativa(null)).toEqual([]);
  });

  it('FAIL-CLOSED: texto fora do formato devolve null, nunca um palpite', () => {
    // Um admin que reescreve a célula à mão não pode virar item por adivinhação:
    // gravar palpite aqui contamina o banco de gestão.
    expect(parseItensDaJustificativa('removi os 2 itens de receita daqui')).toBeNull();
    expect(parseItensDaJustificativa('• Item sem valor (mensal).')).toBeNull();
  });

  it('item pontual é reconhecido e entra pelo valor CHEIO (sem ÷12)', () => {
    const itens = parseItensDaJustificativa('• Licença X — R$ 1.200,00 (pontual). compra única');
    expect(itens![0].recorrencia).toBe('pontual');
    expect(somarItens(itens!)).toBe(1200);
  });
});

describe('ganhoTotalMensal — receita entra com ÷10', () => {
  it('reproduz o Ganho Total do Sucesso.AI já corrigido', () => {
    // saving 12.324,32 + receita 161.913,78÷10 = 28.515,70 (valor hoje na planilha).
    expect(ganhoTotalMensal(12324.32, 161913.78)).toBeCloseTo(28515.7, 2);
  });

  it('⚠️ NÃO é a soma simples — o ÷10 é regra de negócio, não bug', () => {
    expect(ganhoTotalMensal(12324.32, 161913.78)).not.toBeCloseTo(174238.1, 2);
  });

  it('sem receita, o ganho é o saving cheio', () => {
    expect(ganhoTotalMensal(12324.32, 0)).toBeCloseTo(12324.32, 2);
  });

  it('nunca devolve negativo', () => {
    expect(ganhoTotalMensal(0, 0)).toBe(0);
  });
});
