// Testes: stripMarkdown — limpeza de markdown na fronteira de persistência
// (memorial de cálculo / observações → SQLite + Sheets via n8n).
import { describe, it, expect } from 'vitest';
import { stripMarkdown } from '@/lib/strip-markdown';

describe('stripMarkdown', () => {
  it('retorna null para null/undefined', () => {
    expect(stripMarkdown(null)).toBeNull();
    expect(stripMarkdown(undefined)).toBeNull();
  });

  it('remove negrito ** e itálico * mantendo o texto', () => {
    expect(stripMarkdown('Economia de **40 horas** por *mês*')).toBe(
      'Economia de 40 horas por mês',
    );
  });

  it('remove headings # mantendo o título', () => {
    expect(stripMarkdown('# Memorial\n## Cálculo')).toBe('Memorial\nCálculo');
  });

  it('preserva as quebras de linha', () => {
    const out = stripMarkdown('Linha 1\nLinha 2\nLinha 3');
    expect(out).toBe('Linha 1\nLinha 2\nLinha 3');
  });

  it('converte bullets *, +, - para "- "', () => {
    const out = stripMarkdown('* item A\n+ item B\n- item C');
    expect(out).toBe('- item A\n- item B\n- item C');
  });

  it('remove backticks de código inline', () => {
    expect(stripMarkdown('Rodar `npm run dev` antes')).toBe('Rodar npm run dev antes');
  });

  it('remove cercas de bloco de código ```', () => {
    expect(stripMarkdown('```js\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('converte links [txt](url) para o texto', () => {
    expect(stripMarkdown('Veja a [planilha](https://exemplo.com)')).toBe('Veja a planilha');
  });

  it('NÃO mexe em snake_case (underscore simples)', () => {
    expect(stripMarkdown('coluna valor_hora_mes preenchida')).toBe(
      'coluna valor_hora_mes preenchida',
    );
  });

  it('remove negrito com underscore duplo __x__', () => {
    expect(stripMarkdown('texto __importante__ aqui')).toBe('texto importante aqui');
  });

  it('memorial completo: limpa markdown, preserva estrutura em linhas', () => {
    const memorial = [
      '## Memorial de Cálculo',
      '',
      '- **Analista Pleno**: 40h → 8h',
      '- Economia: `32 horas/mês`',
    ].join('\n');
    expect(stripMarkdown(memorial)).toBe(
      ['Memorial de Cálculo', '', '- Analista Pleno: 40h → 8h', '- Economia: 32 horas/mês'].join('\n'),
    );
  });
});
