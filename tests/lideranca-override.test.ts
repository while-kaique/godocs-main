// Remendo declarado para cadastro torto na TeamGuide (26/08/2026).
//
// O caso é REAL: a TeamGuide devolve DOIS líderes para o Lucas Braide (Product Manager
// SR) — o Wellington (Tech Lead, porque o Lucas está alocado no "[TECNOLOGIA] TIME
// WELLINGTON") e o Eughenio (líder do nó "TECNOLOGIA", alcançado pelo time
// "PM (Gocase)", onde o próprio Lucas é o líder). O certo é só o Eughenio, e enquanto
// ninguém arruma o cadastro lá, quem corrige é a lista de overrides.
import { describe, it, expect } from 'vitest';
import { filtrarLideresOverride, OVERRIDES_LIDERANCA } from '@/lib/lideranca-override';

const WELLINGTON = { nome: 'Wellington Brandao de Brito', email: 'wellington.brito@gobeaute.com.br' };
const EUGHENIO = { nome: 'Eughenio Luiz Constantino', email: 'eughenio.constantino@gocase.com' };

describe('filtrarLideresOverride — o caso do Lucas Braide', () => {
  it('tira o Wellington e deixa o Eughenio', () => {
    const fila = filtrarLideresOverride('lucas.braide@gocase.com', [WELLINGTON, EUGHENIO]);
    expect(fila.map((l) => l.email)).toEqual([EUGHENIO.email]);
  });

  it('e-mail do liderado com caixa/espaço diferentes casa igual', () => {
    const fila = filtrarLideresOverride('  Lucas.Braide@Gocase.com ', [WELLINGTON, EUGHENIO]);
    expect(fila.map((l) => l.email)).toEqual([EUGHENIO.email]);
  });

  it('não mexe em quem não está na lista', () => {
    const fila = filtrarLideresOverride('outra.pessoa@gocase.com', [WELLINGTON, EUGHENIO]);
    expect(fila.map((l) => l.email)).toEqual([WELLINGTON.email, EUGHENIO.email]);
  });
});

describe('filtrarLideresOverride — invariantes que não podem regredir', () => {
  it('FAIL-SAFE: não deixa a pessoa SEM líder (isso isentaria o projeto em silêncio)', () => {
    // Se o time "PM (Gocase)" desaparecer da TeamGuide, o Wellington volta a ser o único
    // líder devolvido pela árvore. Aí é melhor a fila ir para ele do que o projeto sair
    // como `sem_lider` e nunca passar por ninguém.
    const fila = filtrarLideresOverride('lucas.braide@gocase.com', [WELLINGTON]);
    expect(fila.map((l) => l.email)).toEqual([WELLINGTON.email]);
  });

  it('lista vazia entra, lista vazia sai — sem estourar', () => {
    expect(filtrarLideresOverride('lucas.braide@gocase.com', [])).toEqual([]);
    expect(filtrarLideresOverride('', [WELLINGTON])).toEqual([WELLINGTON]);
  });

  it('líder sem e-mail cadastrado (email null) sobrevive ao filtro', () => {
    const semEmail = { nome: 'Alguem sem cadastro', email: null };
    const fila = filtrarLideresOverride('lucas.braide@gocase.com', [semEmail, EUGHENIO]);
    expect(fila).toEqual([semEmail, EUGHENIO]);
  });

  it('não muta a lista recebida', () => {
    const entrada = [WELLINGTON, EUGHENIO];
    filtrarLideresOverride('lucas.braide@gocase.com', entrada);
    expect(entrada).toHaveLength(2);
  });

  it('toda entrada da lista é minúscula, tem motivo e tem alguém para ignorar', () => {
    for (const o of OVERRIDES_LIDERANCA) {
      expect(o.liderado).toBe(o.liderado.toLowerCase());
      expect(o.ignorar.length).toBeGreaterThan(0);
      for (const e of o.ignorar) expect(e).toBe(e.toLowerCase());
      // O motivo é o que diz ao próximo leitor quando dá para apagar a entrada.
      expect(o.motivo.length).toBeGreaterThan(30);
    }
  });
});
