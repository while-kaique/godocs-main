// Testes: descarte de docs vazios antes da submissão.
// Regressão real (prod, jun/2026 — caso Mário Gonzaga): a pessoa reenviava a pasta
// do projeto especial incluindo um arquivo de 0 bytes (ex.: __init__.py/.gitkeep).
// readFileAsBase64 produz base64 "" para arquivo vazio e o backend rejeita o payload
// inteiro com ZodError ("docs[].base64" exige ≥1 caractere), travando a submissão.
// O fix barra o arquivo vazio na seleção (step2) e, como rede de segurança, filtra
// qualquer base64 "" remanescente aqui antes de montar o payload.
import { describe, it, expect } from 'vitest';
import { descartarDocsVazios } from '@/lib/submeter/constants';

describe('descartarDocsVazios', () => {
  it('remove docs com base64 vazio, preservando os com conteúdo (e a ordem)', () => {
    const docs = [
      { base64: 'QUJD', filename: 'a.ts' },
      { base64: '', filename: 'vazio.txt' },
      { base64: 'REVG', filename: 'b.ts' },
    ];
    expect(descartarDocsVazios(docs)).toEqual([
      { base64: 'QUJD', filename: 'a.ts' },
      { base64: 'REVG', filename: 'b.ts' },
    ]);
  });

  it('retorna [] quando todos os docs estão vazios', () => {
    expect(
      descartarDocsVazios([
        { base64: '', filename: 'x.txt' },
        { base64: '', filename: 'y.txt' },
      ])
    ).toEqual([]);
  });

  it('não altera a lista quando nenhum doc está vazio', () => {
    const docs = [
      { base64: 'QQ==', filename: 'a.txt' },
      { base64: 'Qg==', filename: 'b.txt' },
    ];
    expect(descartarDocsVazios(docs)).toEqual(docs);
  });

  it('lida com lista vazia', () => {
    expect(descartarDocsVazios([])).toEqual([]);
  });
});
