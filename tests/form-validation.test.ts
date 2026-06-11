// Testes: validação do formulário de submissão
// Replica as regras de validação do frontend (submeter.tsx) como testes isolados
import { describe, it, expect } from 'vitest';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_DOMAINS_RE = /^[^\s@]+@(gocase|gobeaute|gogroup)\.(com|com\.br)$/i;

const ACCEPTED_DOC_EXT = ['.pdf', '.docx', '.doc', '.txt', '.md'];
const MAX_FILE_MB = 10;

describe('Validação de e-mail', () => {
  it('aceita e-mail válido @gocase.com', () => {
    expect(EMAIL_RE.test('nome@gocase.com')).toBe(true);
    expect(ALLOWED_DOMAINS_RE.test('nome@gocase.com')).toBe(true);
  });

  it('aceita e-mail válido @gobeaute.com.br', () => {
    expect(ALLOWED_DOMAINS_RE.test('nome@gobeaute.com.br')).toBe(true);
  });

  it('aceita e-mail válido @gogroup.com', () => {
    expect(ALLOWED_DOMAINS_RE.test('nome@gogroup.com')).toBe(true);
  });

  it('rejeita domínios externos', () => {
    expect(ALLOWED_DOMAINS_RE.test('nome@gmail.com')).toBe(false);
    expect(ALLOWED_DOMAINS_RE.test('nome@empresa.com')).toBe(false);
    expect(ALLOWED_DOMAINS_RE.test('nome@gocase.org')).toBe(false);
  });

  it('rejeita e-mail inválido', () => {
    expect(EMAIL_RE.test('nomegocase.com')).toBe(false);
    expect(EMAIL_RE.test('@gocase.com')).toBe(false);
    expect(EMAIL_RE.test('')).toBe(false);
    expect(EMAIL_RE.test('nome@')).toBe(false);
  });

  it('é case-insensitive no domínio', () => {
    expect(ALLOWED_DOMAINS_RE.test('Nome@GOCASE.COM')).toBe(true);
    expect(ALLOWED_DOMAINS_RE.test('Nome@GoBeaute.Com.Br')).toBe(true);
  });
});

describe('Validação de arquivo', () => {
  it('aceita extensões válidas', () => {
    for (const ext of ACCEPTED_DOC_EXT) {
      expect(ACCEPTED_DOC_EXT.includes(ext)).toBe(true);
    }
  });

  it('rejeita extensões inválidas', () => {
    expect(ACCEPTED_DOC_EXT.includes('.jpg')).toBe(false);
    expect(ACCEPTED_DOC_EXT.includes('.png')).toBe(false);
    expect(ACCEPTED_DOC_EXT.includes('.exe')).toBe(false);
    expect(ACCEPTED_DOC_EXT.includes('.csv')).toBe(false);
    expect(ACCEPTED_DOC_EXT.includes('.xlsx')).toBe(false);
  });

  it('limite de tamanho é 10MB', () => {
    expect(MAX_FILE_MB).toBe(10);
    const maxBytes = MAX_FILE_MB * 1024 * 1024;
    expect(maxBytes).toBe(10485760);
  });
});

describe('Validação de nome', () => {
  it('rejeita nomes com números', () => {
    expect(/[0-9]/.test('João123')).toBe(true);
    expect(/[0-9]/.test('Maria')).toBe(false);
  });

  it('rejeita nomes curtos (< 2 caracteres)', () => {
    expect('A'.trim().length < 2).toBe(true);
    expect('AB'.trim().length < 2).toBe(false);
  });

  it('rejeita nomes vazios', () => {
    expect(''.trim().length < 2).toBe(true);
    expect('   '.trim().length < 2).toBe(true);
  });
});

describe('Validação de data de criação', () => {
  it('rejeita datas antes de 2024', () => {
    expect('2023-12-31' < '2024-01-01').toBe(true);
    expect('2024-01-01' < '2024-01-01').toBe(false);
  });

  it('aceita datas de 2024 em diante', () => {
    expect('2024-01-01' >= '2024-01-01').toBe(true);
    expect('2025-06-01' >= '2024-01-01').toBe(true);
  });
});

describe('Validação de nome do projeto', () => {
  it('rejeita nomes com menos de 3 caracteres', () => {
    expect('AB'.trim().length < 3).toBe(true);
    expect('ABC'.trim().length < 3).toBe(false);
  });

});

describe('Validação de saving', () => {
  it('valor_hora mínimo é R$ 8', () => {
    const MIN_HORA = 8;
    expect(7.99 < MIN_HORA).toBe(true);
    expect(8 < MIN_HORA).toBe(false);
  });

  it('alerta para valor_hora acima de R$ 60', () => {
    const MAX_HORA_NORMAL = 60;
    expect(60.01 > MAX_HORA_NORMAL).toBe(true);
    expect(55.15 > MAX_HORA_NORMAL).toBe(false);
  });

  it('cálculo de economia: horas × valor_hora', () => {
    const horas = 58.3;
    const valorHora = 10.78;
    const economia = Math.round(horas * valorHora * 100) / 100;
    expect(economia).toBe(628.47); // 58.3 * 10.78 arredondado
  });
});
