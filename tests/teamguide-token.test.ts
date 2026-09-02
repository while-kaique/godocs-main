// RED: pura que lê a validade do token JWT da TeamGuide (só o payload, sem verificar
// assinatura) e devolve os dias inteiros restantes até `exp`. Módulo ainda não existe.
import { describe, it, expect } from 'vitest';
import { diasParaExpirarTokenTG } from '@/lib/teamguide-token';

const DIA_MS = 86_400_000;

/** Monta um JWT `header.payload.assinatura` com o payload informado (base64url). */
function jwt(payload: Record<string, unknown>, assinatura = 'assinatura-qualquer'): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${assinatura}`;
}

describe('diasParaExpirarTokenTG', () => {
  it('devolve os dias inteiros até a expiração (Math.floor)', () => {
    const exp = Math.floor(Date.now() / 1000) + 10 * 86_400; // ~10 dias à frente
    const dias = diasParaExpirarTokenTG(jwt({ exp }));
    expect(dias).not.toBeNull();
    // Math.floor sobre a fração de segundo do "agora" → 9 ou 10.
    expect(dias as number).toBeGreaterThanOrEqual(9);
    expect(dias as number).toBeLessThanOrEqual(10);
  });

  it('devolve número NEGATIVO para token já expirado', () => {
    const exp = Math.floor(Date.now() / 1000) - 5 * 86_400; // 5 dias no passado
    const dias = diasParaExpirarTokenTG(jwt({ exp }));
    expect(dias).not.toBeNull();
    expect(dias as number).toBeLessThan(0);
  });

  it('respeita o exp exato (janela conhecida ⇒ dias conhecidos)', () => {
    const exp = Math.floor(Date.now() / 1000) + 3 * 86_400 + 3600; // 3 dias e 1h
    const esperado = Math.floor((exp * 1000 - Date.now()) / DIA_MS);
    expect(diasParaExpirarTokenTG(jwt({ exp }))).toBe(esperado);
  });

  it('null para token sem `exp`', () => {
    expect(diasParaExpirarTokenTG(jwt({ sub: '123' }))).toBeNull();
  });

  it('null para string lixo (não é JWT)', () => {
    expect(diasParaExpirarTokenTG('isto-nao-e-um-jwt')).toBeNull();
  });

  it('null quando o payload não é base64/JSON válido', () => {
    expect(diasParaExpirarTokenTG('aaa.@@@nao-base64@@@.zzz')).toBeNull();
  });

  it('null para ausente (undefined/null/vazio)', () => {
    expect(diasParaExpirarTokenTG(undefined)).toBeNull();
    expect(diasParaExpirarTokenTG(null)).toBeNull();
    expect(diasParaExpirarTokenTG('')).toBeNull();
  });
});
