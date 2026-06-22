import { describe, it, expect } from 'vitest';
import { normalizarMarcadoresMemorial, TITULOS_MEMORIAL } from '@/lib/agents/memorial-format';

describe('normalizarMarcadoresMemorial', () => {
  it('troca um código no início da linha pelo título em negrito', () => {
    expect(normalizarMarcadoresMemorial('[2.2] fazia a conciliação manual'))
      .toBe('**Detalhe por pessoa:** fazia a conciliação manual');
  });

  it('troca múltiplos códigos na mesma linha', () => {
    expect(normalizarMarcadoresMemorial('[1.1] Projeto X. [1.2] Resumo do que faz.'))
      .toBe('**Projeto:** Projeto X. **Resumo:** Resumo do que faz.');
  });

  it('trata intervalos [x.y-x.z] usando o título do primeiro código', () => {
    expect(normalizarMarcadoresMemorial('[3.1-3.3] N/A'))
      .toBe('**Serviço evitado:** N/A');
  });

  it('cobre todos os códigos da seção de receita', () => {
    expect(normalizarMarcadoresMemorial('[6.1] gera mais SKUs'))
      .toBe('**O que gera a receita:** gera mais SKUs');
    expect(normalizarMarcadoresMemorial('[6.5] valor estimado'))
      .toBe('**Valor da receita:** valor estimado');
  });

  it('remove código desconhecido sem deixar lacuna', () => {
    expect(normalizarMarcadoresMemorial('[9.9] conteúdo solto'))
      .toBe('conteúdo solto');
  });

  it('preserva markdown e indentação de listas (não toca em espaços fora dos marcadores)', () => {
    const entrada = '### Saving de Pessoas\n- **O que fazia:** algo\n  - subitem indentado';
    expect(normalizarMarcadoresMemorial(entrada)).toBe(entrada);
  });

  it('é idempotente — texto já sem códigos volta inalterado', () => {
    const limpo = '## Memorial\n\n### Contexto\n**Resumo:** projeto faz X.';
    expect(normalizarMarcadoresMemorial(limpo)).toBe(limpo);
    expect(normalizarMarcadoresMemorial(normalizarMarcadoresMemorial(limpo))).toBe(limpo);
  });

  it('trata null/undefined/vazio com segurança', () => {
    expect(normalizarMarcadoresMemorial(null)).toBe('');
    expect(normalizarMarcadoresMemorial(undefined)).toBe('');
    expect(normalizarMarcadoresMemorial('')).toBe('');
  });

  it('toda chave do mapa de títulos é coberta pela substituição', () => {
    for (const codigo of Object.keys(TITULOS_MEMORIAL)) {
      const out = normalizarMarcadoresMemorial(`[${codigo}] x`);
      expect(out).toBe(`**${TITULOS_MEMORIAL[codigo]}:** x`);
    }
  });
});
