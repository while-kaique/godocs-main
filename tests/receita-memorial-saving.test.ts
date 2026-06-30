// Testes do predicado receitaMemorialEhSaving (orchestrator.ts): detecta um memorial salvo
// no slot de RECEITA que na verdade é saving / "não aplicável", usado pelos gates do item 3
// (backstop no chat) e item 2 (gate de completude no submit). Caso de origem: legado-260.
import { describe, it, expect } from 'vitest';
import { receitaMemorialEhSaving } from '@/lib/agents/orchestrator';

describe('receitaMemorialEhSaving', () => {
  it('vazio/null/undefined → false (não bloqueia turno de coleta sem memorial)', () => {
    expect(receitaMemorialEhSaving(null)).toBe(false);
    expect(receitaMemorialEhSaving(undefined)).toBe(false);
    expect(receitaMemorialEhSaving('')).toBe(false);
    expect(receitaMemorialEhSaving('   ')).toBe(false);
  });

  it('memorial real do legado-260 (## Memorial de Saving no slot de receita) → true', () => {
    const memo = `## Memorial de Saving

### O que gera a economia
A automação do monitoramento diário realizado por um analista sênior.

### Base de cálculo
1h30 por dia = 1,5 hora/dia. 30 dias/mês = 45 horas/mês × R$ 33,10 = R$ 1.489,50.

### Resumo
- Saving: R$ 1.489,50/mês
- Tipo: mensal`;
    expect(receitaMemorialEhSaving(memo)).toBe(true);
  });

  it('"Não aplicável para receita incremental..." → true', () => {
    expect(receitaMemorialEhSaving('Não aplicável para receita incremental. O caso foi identificado como potencial.')).toBe(true);
  });

  it('"reclassificado como saving" / "reclassificada para saving" → true', () => {
    expect(receitaMemorialEhSaving('O caso foi reclassificado como saving/potencial, sem receita nova.')).toBe(true);
    expect(receitaMemorialEhSaving('Receita reclassificada para saving operacional.')).toBe(true);
  });

  it('memorial de RECEITA legítimo → false (não bloqueia receita de verdade)', () => {
    const memo = `## Memorial de Receita Incremental

### O que gera a receita
A nova funcionalidade de personalização abriu um canal de venda de capas premium.

### Como aumenta
Cada pedido passou a oferecer um upsell de capa exclusiva.

### Antes vs. depois
Antes não havia esse SKU; depois, 200 unidades/mês × R$ 50 = R$ 10.000/mês.

### Base de cálculo
200 × R$ 50 = R$ 10.000/mês de receita nova.`;
    expect(receitaMemorialEhSaving(memo)).toBe(false);
  });

  it('menção genérica a "saving" no texto de receita NÃO casa (só sinais explícitos)', () => {
    // não contém "memorial de saving", nem "não aplicável para receita", nem "reclassificado como saving"
    expect(receitaMemorialEhSaving('A receita nova é diferente do saving operacional do projeto.')).toBe(false);
  });
});
