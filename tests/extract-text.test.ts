// Testes: extração de texto a partir de base64.
// Regressão crítica: o runtime do Godeploy (Cloudflare workerd) não expõe o
// global `Buffer` do Node. A extração precisa usar atob/Uint8Array/TextDecoder,
// senão estoura "Buffer is not defined" e todo arquivo enviado vem com 0 chars.
import { describe, it, expect } from 'vitest';
import { extractTextFromBase64, extractTextFromMultipleFiles } from '@/lib/extract-text.server';

// Codifica string UTF-8 em base64 sem usar Buffer (mesmo cenário do browser/worker)
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

describe('extractTextFromBase64', () => {
  it('decodifica arquivo de texto utf-8 (caminho que quebrava com Buffer)', async () => {
    const conteudo = 'const x = 1;\nconsole.log("olá, açúcar e ção");';
    const text = await extractTextFromBase64(toBase64(conteudo), 'api.js');
    expect(text).toContain('const x = 1;');
    expect(text).toContain('açúcar e ção'); // acentuação preservada (utf-8 correto)
  });

  it('preserva conteúdo de extensões de texto conhecidas', async () => {
    const md = '# Título\n\nLinha com acento: ração.';
    const text = await extractTextFromBase64(toBase64(md), 'README.md');
    expect(text).toContain('# Título');
    expect(text).toContain('ração');
  });

  it('combina múltiplos arquivos com separadores e sem perder conteúdo', async () => {
    const combined = await extractTextFromMultipleFiles([
      { base64: toBase64('alpha();'), filename: 'a.js' },
      { base64: toBase64('beta();'), filename: 'b.ts' },
    ]);
    expect(combined).toContain('=== a.js ===');
    expect(combined).toContain('alpha();');
    expect(combined).toContain('=== b.ts ===');
    expect(combined).toContain('beta();');
  });
});
