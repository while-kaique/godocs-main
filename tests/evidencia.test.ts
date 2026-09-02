import { describe, it, expect } from 'vitest';
import {
  EVIDENCIA_MIN,
  anexosUteis,
  erroEvidencia,
  evidenciaValida,
  type AnexoEvidencia,
} from '@/lib/submeter/evidencia';

const ACENTO = /[áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÉÊÍÓÔÕÚÇ]/;

/** Texto com exatamente `n` caracteres úteis (a régua sai da constante, não de "20"). */
function texto(n: number): string {
  return 'a'.repeat(n);
}

const TEXTO_OK = `Contrato da terceirizada encerrado em maio — ${texto(EVIDENCIA_MIN)}`;

function anexo(patch: Partial<AnexoEvidencia> = {}): AnexoEvidencia {
  return { base64: 'ZGFkb3M=', filename: 'print.png', ...patch };
}

// ─── erroEvidencia ───────────────────────────────────────────────────────────

describe('erroEvidencia — texto é OBRIGATÓRIO, anexo é opcional', () => {
  it('texto com o mínimo de caracteres e NENHUM anexo → válido (null)', () => {
    expect(erroEvidencia(texto(EVIDENCIA_MIN), [])).toBeNull();
  });

  it('texto longo e nenhum anexo → válido', () => {
    expect(erroEvidencia(TEXTO_OK, [])).toBeNull();
  });

  it('texto no mínimo COM anexo → válido (o anexo reforça, não substitui)', () => {
    expect(erroEvidencia(TEXTO_OK, [anexo()])).toBeNull();
  });

  it('texto com um caractere MENOS que o mínimo → inválido', () => {
    expect(erroEvidencia(texto(EVIDENCIA_MIN - 1), [])).not.toBeNull();
  });

  it('texto vazio e nenhum anexo → inválido, com mensagem sobre o TEXTO que falta', () => {
    const erro = erroEvidencia('', []);
    expect(erro).not.toBeNull();
    expect(typeof erro).toBe('string');
    expect((erro as string).trim().length).toBeGreaterThan(0);
  });

  it('texto só com espaço em branco conta como VAZIO', () => {
    expect(erroEvidencia('   ', [])).not.toBeNull();
    expect(erroEvidencia('\n\t  \n', [])).not.toBeNull();
  });

  it('espaço em branco não conta como caractere útil para alcançar o mínimo', () => {
    const curtoComEspacos = `  ${texto(EVIDENCIA_MIN - 5)}  `;
    expect(erroEvidencia(curtoComEspacos, [])).not.toBeNull();
  });

  it('RF-208: ANEXO presente + texto VAZIO → RECUSADO', () => {
    expect(erroEvidencia('', [anexo()])).not.toBeNull();
  });

  it('RF-208: ANEXO presente + texto CURTO → RECUSADO', () => {
    expect(erroEvidencia(texto(EVIDENCIA_MIN - 1), [anexo()])).not.toBeNull();
  });

  it('a mensagem do anexo-sem-texto é DIFERENTE da de texto-ausente-sem-anexo', () => {
    const semNada = erroEvidencia('', []);
    const comAnexo = erroEvidencia('', [anexo()]);
    expect(semNada).not.toBeNull();
    expect(comAnexo).not.toBeNull();
    expect(comAnexo).not.toBe(semNada);
  });

  it('a mensagem do anexo-sem-texto FALA do anexo (quem anexou o print acha que já provou)', () => {
    const comAnexo = erroEvidencia('', [anexo()]) as string;
    expect(comAnexo).toMatch(/anexo|arquivo|imagem|print/i);
  });

  it('anexo de 0 byte não vale como anexo — cai na mensagem de texto ausente', () => {
    const so0Byte = erroEvidencia('', [anexo({ base64: '' })]);
    expect(so0Byte).toBe(erroEvidencia('', []));
  });

  it('todas as mensagens estão em PORTUGUÊS COM ACENTUAÇÃO', () => {
    const mensagens = [
      erroEvidencia('', []),
      erroEvidencia('   ', []),
      erroEvidencia(texto(EVIDENCIA_MIN - 1), []),
      erroEvidencia('', [anexo()]),
      erroEvidencia(texto(EVIDENCIA_MIN - 1), [anexo()]),
    ];
    for (const msg of mensagens) {
      expect(msg).not.toBeNull();
      expect(msg as string).toMatch(ACENTO);
    }
  });
});

// ─── evidenciaValida ─────────────────────────────────────────────────────────

describe('evidenciaValida — é exatamente "erroEvidencia === null"', () => {
  const casos: Array<[string, string, AnexoEvidencia[]]> = [
    ['texto ok, sem anexo', TEXTO_OK, []],
    ['texto ok, com anexo', TEXTO_OK, [anexo()]],
    ['texto vazio, sem anexo', '', []],
    ['texto vazio, com anexo', '', [anexo()]],
    ['texto curto, sem anexo', texto(EVIDENCIA_MIN - 1), []],
    ['texto curto, com anexo', texto(EVIDENCIA_MIN - 1), [anexo()]],
    ['só espaço, com anexo', '    ', [anexo()]],
    ['texto no limite exato', texto(EVIDENCIA_MIN), []],
  ];

  for (const [nome, txt, anexos] of casos) {
    it(`espelha o veredito de erroEvidencia — ${nome}`, () => {
      expect(evidenciaValida(txt, anexos)).toBe(erroEvidencia(txt, anexos) === null);
    });
  }

  it('é true no caso válido e false no anexo-sem-texto', () => {
    expect(evidenciaValida(TEXTO_OK, [])).toBe(true);
    expect(evidenciaValida('', [anexo()])).toBe(false);
  });
});

// ─── anexosUteis ─────────────────────────────────────────────────────────────

describe('anexosUteis — descarta o que derruba o zod do backend', () => {
  it('lista vazia → lista vazia', () => {
    expect(anexosUteis([])).toEqual([]);
  });

  it('descarta anexo com base64 vazio (arquivo de 0 byte)', () => {
    expect(anexosUteis([anexo({ base64: '', filename: 'vazio.png' })])).toEqual([]);
  });

  it('preserva os úteis na ORDEM, tirando só o de 0 byte do meio', () => {
    const entrada = [
      anexo({ filename: 'a.png' }),
      anexo({ base64: '', filename: 'vazio.png' }),
      anexo({ filename: 'b.png' }),
    ];
    expect(anexosUteis(entrada)).toEqual([anexo({ filename: 'a.png' }), anexo({ filename: 'b.png' })]);
  });

  it('mantém todos quando todos têm conteúdo', () => {
    const entrada = [anexo({ filename: 'a.png' }), anexo({ filename: 'b.png' })];
    expect(anexosUteis(entrada)).toEqual(entrada);
  });

  it('não muta a entrada', () => {
    const entrada = [anexo({ filename: 'a.png' }), anexo({ base64: '', filename: 'vazio.png' })];
    const antes = JSON.parse(JSON.stringify(entrada));
    anexosUteis(entrada);
    expect(entrada).toEqual(antes);
  });
});
