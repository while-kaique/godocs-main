// Testes: helpers puros do extractor (normalização e divisão em lotes)
import { describe, it, expect } from 'vitest';
import { norm, dividirEmLotes, parseFlexivel, detectarAiProxy } from '@/lib/agents/extractor';

describe('detectarAiProxy — auto-detecção do gateway interno de IA', () => {
  it('detecta o host ai-proxy.gogroupbr.com no material enviado', () => {
    expect(detectarAiProxy('const url = "https://ai-proxy.gogroupbr.com/v1/chat/completions"')).toBe(true);
    expect(detectarAiProxy('faça um POST para AI-PROXY.GOGROUPBR.COM')).toBe(true); // case-insensitive
    expect(
      detectarAiProxy('await fetch("https://ai-proxy.gogroupbr.com/v1/chat/completions", { method: "POST" })'),
    ).toBe(true);
  });

  it('NÃO detecta quando o proxy não aparece', () => {
    expect(detectarAiProxy('chamada direta para api.openai.com')).toBe(false);
    expect(detectarAiProxy('usa o gateway da empresa, mas sem URL')).toBe(false);
    expect(detectarAiProxy('')).toBe(false);
    expect(detectarAiProxy(null)).toBe(false);
    expect(detectarAiProxy(undefined)).toBe(false);
  });
});

describe('norm — normalização de valores do LLM', () => {
  it('converte a STRING "null" (e variações) para null real', () => {
    expect(norm('null')).toBeNull();
    expect(norm('NULL')).toBeNull();
    expect(norm('  null  ')).toBeNull();
    expect(norm('undefined')).toBeNull();
    expect(norm('N/A')).toBeNull();
    expect(norm('none')).toBeNull();
  });

  it('trata null/undefined/vazio como null', () => {
    expect(norm(null)).toBeNull();
    expect(norm(undefined)).toBeNull();
    expect(norm('')).toBeNull();
    expect(norm('   ')).toBeNull();
  });

  it('mantém strings válidas (com trim)', () => {
    expect(norm('Automação de NPS')).toBe('Automação de NPS');
    expect(norm('  texto  ')).toBe('texto');
    // não confunde conteúdo que apenas contém "null"
    expect(norm('roda quando o campo é nulo')).toBe('roda quando o campo é nulo');
  });

  it('serializa arrays/objetos e converte números', () => {
    expect(norm(['a', 'b'])).toBe('["a","b"]');
    expect(norm({ x: 1 })).toBe('{"x":1}');
    expect(norm(42)).toBe('42');
  });
});

describe('parseFlexivel — recuperação de JSON truncado', () => {
  it('parseia JSON válido normalmente', () => {
    const r = parseFlexivel('{"nome_projeto":"X","o_que_faz":"faz Y","execucao":null}');
    expect(r.nome_projeto).toBe('X');
    expect(r.o_que_faz).toBe('faz Y');
    expect(r.execucao).toBeNull();
  });

  it('recupera campos de JSON truncado (estouro de tokens)', () => {
    // JSON cortado no meio do campo "fluxo" (sem fechar aspas/chave)
    const truncado = '{"nome_projeto":"App","o_que_faz":"Resolve X.","fluxo":"1. Passo um.\\n2. Passo doi';
    const r = parseFlexivel(truncado);
    expect(r.nome_projeto).toBe('App');
    expect(r.o_que_faz).toBe('Resolve X.');
    expect(r.fluxo).toContain('Passo um');
    expect(r.fluxo).toContain('\n'); // \\n desescapado
  });

  it('preserva aspas escapadas no valor recuperado', () => {
    const truncado = '{"o_que_faz":"chama a API \\"foo\\" e retorna';
    const r = parseFlexivel(truncado);
    expect(r.o_que_faz).toContain('"foo"');
  });
});

describe('dividirEmLotes — chunking por arquivo', () => {
  const SEP = '\n\n---\n\n';

  it('mantém conteúdo pequeno em um único lote', () => {
    const texto = ['a', 'b', 'c'].join(SEP);
    expect(dividirEmLotes(texto, 1000)).toEqual([texto]);
  });

  it('divide respeitando o limite de chars', () => {
    const arquivos = Array.from({ length: 6 }, (_, i) => 'x'.repeat(40) + i);
    const texto = arquivos.join(SEP);
    const lotes = dividirEmLotes(texto, 100);
    expect(lotes.length).toBeGreaterThan(1);
    // nenhum lote (sem contar arquivos gigantes) deve estourar muito o limite
    for (const lote of lotes) expect(lote.length).toBeLessThanOrEqual(120);
  });

  it('fatia um arquivo maior que o limite', () => {
    const gigante = 'y'.repeat(250);
    const lotes = dividirEmLotes(gigante, 100);
    expect(lotes.length).toBe(3);
    expect(lotes.join('')).toBe(gigante);
  });

  it('não perde conteúdo ao dividir', () => {
    const arquivos = ['alpha', 'beta', 'gamma', 'delta'];
    const texto = arquivos.join(SEP);
    const lotes = dividirEmLotes(texto, 12);
    const reconstruido = lotes.join('');
    for (const arq of arquivos) expect(reconstruido).toContain(arq);
  });
});
