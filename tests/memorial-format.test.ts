import { describe, it, expect } from 'vitest';
import {
  normalizarMarcadoresMemorial,
  extrairAlocacaoGanhos,
  extrairJustificativaCargaEscala,
  TITULOS_MEMORIAL,
} from '@/lib/agents/memorial-format';

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

describe('extrairAlocacaoGanhos', () => {
  it('extrai a seção quando escrita como cabeçalho markdown (###), até o próximo cabeçalho', () => {
    const memorial = [
      '### Total de horas',
      'Total: 90h/mês.',
      '',
      '### O que mudou após a automação',
      'A analista foi realocada para o time de qualidade.',
      'O setor passou a atender 2x mais volume com a mesma equipe.',
      '',
      '### Tipo de saving',
      'Mensal.',
    ].join('\n');
    expect(extrairAlocacaoGanhos(memorial)).toBe(
      'A analista foi realocada para o time de qualidade.\nO setor passou a atender 2x mais volume com a mesma equipe.',
    );
  });

  it('extrai quando escrita como rótulo inline (**Título:** conteúdo) — caso legado', () => {
    const memorial =
      '**Total de horas:** 90h\n**O que mudou após a automação:** O serviço terceirizado foi cancelado.\n**Tipo de saving:** mensal';
    expect(extrairAlocacaoGanhos(memorial)).toBe('O serviço terceirizado foi cancelado.');
  });

  it('para no separador --- (antes do bloco financeiro injetado)', () => {
    const memorial =
      '### O que mudou após a automação\nVaga não reposta após o desligamento.\n\n---\n### Detalhamento Financeiro (interno)\n- R$ ...';
    expect(extrairAlocacaoGanhos(memorial)).toBe('Vaga não reposta após o desligamento.');
  });

  it('combina com normalizarMarcadoresMemorial (código [2.4] vira o rótulo e é extraído)', () => {
    const bruto = '[2.3] 90h\n[2.4] A equipe assumiu novas frentes de análise.\n[5.2] mensal';
    expect(extrairAlocacaoGanhos(normalizarMarcadoresMemorial(bruto))).toBe(
      'A equipe assumiu novas frentes de análise.',
    );
  });

  it('devolve null quando a seção não existe (projeto sem gate de economia alta)', () => {
    expect(extrairAlocacaoGanhos('### Total de horas\n10h/mês.\n### Tipo de saving\nmensal')).toBeNull();
  });

  it('devolve null para memorial vazio/ausente', () => {
    expect(extrairAlocacaoGanhos(null)).toBeNull();
    expect(extrairAlocacaoGanhos('')).toBeNull();
    expect(extrairAlocacaoGanhos('### O que mudou após a automação\n\n')).toBeNull();
  });

  it('NÃO confunde "Carga real e ganho por escala" (ponto [2.5]) com a Alocação Ganhos', () => {
    const memorial =
      '### O que mudou após a automação\nA analista foi realocada.\n### Carga real e ganho por escala\nCarga real: 24h; escala: 108h.';
    expect(extrairAlocacaoGanhos(memorial)).toBe('A analista foi realocada.');
  });
});

describe('extrairJustificativaCargaEscala', () => {
  it('extrai a subseção (###) com cálculo e gatilhos, até o próximo cabeçalho', () => {
    const memorial = [
      '### Total de horas',
      'Total: 132h/mês.',
      '',
      '### Carga real e ganho por escala',
      'Carga real (trabalho humano de fato): 24h; ganho por escala: 108h.',
      'Cálculo: rodava 4×/mês × 6h = 24h; automação passou a 22×/mês = +108h.',
      '',
      '### Tipo de saving',
      'Mensal.',
    ].join('\n');
    expect(extrairJustificativaCargaEscala(memorial)).toBe(
      'Carga real (trabalho humano de fato): 24h; ganho por escala: 108h.\nCálculo: rodava 4×/mês × 6h = 24h; automação passou a 22×/mês = +108h.',
    );
  });

  it('extrai quando escrita como rótulo inline (**Título:** conteúdo)', () => {
    const memorial =
      '**Total de horas:** 24h\n**Carga real e ganho por escala:** A pessoa já fazia o volume todo à mão (24h), então o ganho por escala é 0.\n**Tipo de saving:** mensal';
    expect(extrairJustificativaCargaEscala(memorial)).toBe(
      'A pessoa já fazia o volume todo à mão (24h), então o ganho por escala é 0.',
    );
  });

  it('combina com normalizarMarcadoresMemorial (código [2.5] vira o rótulo e é extraído)', () => {
    const bruto = '[2.3] 132h\n[2.5] Carga real 24h, escala 108h: volume incremental da automação.\n[5.2] mensal';
    expect(extrairJustificativaCargaEscala(normalizarMarcadoresMemorial(bruto))).toBe(
      'Carga real 24h, escala 108h: volume incremental da automação.',
    );
  });

  it('devolve null quando a subseção não existe (split não se aplica)', () => {
    expect(extrairJustificativaCargaEscala('### Total de horas\n10h/mês.\n### Tipo de saving\nmensal')).toBeNull();
    expect(extrairJustificativaCargaEscala(null)).toBeNull();
    expect(extrairJustificativaCargaEscala('')).toBeNull();
  });
});
