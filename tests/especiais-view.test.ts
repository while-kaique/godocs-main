/**
 * Comparador de especiais — o agrupamento por nível e as âncoras da régua.
 *
 * O que estes testes prendem: a coluna que um cartão ocupa é a NOTA GRAVADA (nunca a `nota`
 * declarada na referência), níveis 0–5 existem mesmo vazios, a escala aberta ganha coluna
 * quando há projeto/âncora, e a comparação sempre traz a âncora do nível junto.
 */
import { describe, it, expect } from 'vitest';
import {
  NOTAS_BASE,
  SEM_NOTA,
  MAX_COMPARAR,
  agruparEspeciais,
  alvosDaComparacao,
  ancoraForaDoNivel,
  apenasEspeciais,
  rotuloNota,
  type ReferenciaEspecial,
} from '@/lib/especiais-view';
import type { ProjetoDashboardResumo } from '@/lib/dashboard-resumo';

function projeto(over: Partial<ProjetoDashboardResumo> & { id: string }): ProjetoDashboardResumo {
  return {
    nome: over.nome ?? over.id,
    autor: null,
    email: null,
    area: null,
    status: null,
    statusChave: null,
    dataSubmissao: null,
    dataOrdenacao: over.dataOrdenacao ?? null,
    ganhoTotal: null,
    savingReais: null,
    receitaMensal: null,
    complexidade: null,
    tipos: null,
    especial: over.especial ?? true,
    aprovacaoLider: null,
    estrelas: over.estrelas ?? null,
    busca: '',
    ...over,
  } as ProjetoDashboardResumo;
}

function ref(projeto_id: string, nota: number, motivo: string | null = null): ReferenciaEspecial {
  return { projeto_id, nota, motivo, definido_por: null, definido_em: null };
}

describe('apenasEspeciais', () => {
  it('deixa de fora os projetos financeiros (lá o R$ é a régua)', () => {
    const lista = [projeto({ id: 'a' }), projeto({ id: 'b', especial: false })];
    expect(apenasEspeciais(lista).map((p) => p.id)).toEqual(['a']);
  });
});

describe('agruparEspeciais', () => {
  it('mostra os níveis 0–5 mesmo vazios (a régua tem de ser visível inteira)', () => {
    const colunas = agruparEspeciais([], []);
    expect(colunas[0].chave).toBe(SEM_NOTA);
    expect(colunas.map((c) => c.nota).slice(1)).toEqual([...NOTAS_BASE]);
  });

  it('abre coluna para nota acima de 5 quando existe projeto nela (escala aberta)', () => {
    const colunas = agruparEspeciais([projeto({ id: 'piapp', estrelas: 8 })], []);
    expect(colunas.at(-1)?.nota).toBe(8);
    expect(colunas.at(-1)?.projetos.map((p) => p.id)).toEqual(['piapp']);
  });

  it('separa "sem nota" (null) de "zero" — são coisas diferentes', () => {
    const colunas = agruparEspeciais(
      [projeto({ id: 'novo' }), projeto({ id: 'olhado', estrelas: 0 })],
      [],
    );
    expect(colunas.find((c) => c.chave === SEM_NOTA)?.projetos.map((p) => p.id)).toEqual(['novo']);
    expect(colunas.find((c) => c.nota === 0)?.projetos.map((p) => p.id)).toEqual(['olhado']);
  });

  it('põe a âncora no topo do nível e herda a frase da régua', () => {
    const colunas = agruparEspeciais(
      [projeto({ id: 'comum', estrelas: 3 }), projeto({ id: 'piapp', estrelas: 3 })],
      [ref('piapp', 3, 'atende várias áreas e move um KPI conferível')],
    );
    const nivel3 = colunas.find((c) => c.nota === 3)!;
    expect(nivel3.ancoras.map((p) => p.id)).toEqual(['piapp']);
    expect(nivel3.projetos.map((p) => p.id)).toEqual(['comum']);
    expect(nivel3.regua).toBe('atende várias áreas e move um KPI conferível');
    expect(nivel3.total).toBe(2);
  });

  it('a âncora segue a NOTA GRAVADA, não a nota declarada na referência', () => {
    // Regravar a estrela do projeto-âncora na ficha do /dashboard não pode deixar o cartão
    // numa coluna e a régua em outra.
    const colunas = agruparEspeciais([projeto({ id: 'piapp', estrelas: 2 })], [ref('piapp', 3, 'x')]);
    expect(colunas.find((c) => c.nota === 3)?.ancoras).toEqual([]);
    expect(colunas.find((c) => c.nota === 2)?.ancoras.map((p) => p.id)).toEqual(['piapp']);
  });

  it('âncora sem frase não apaga a régua escrita por outra do mesmo nível', () => {
    const colunas = agruparEspeciais(
      [
        projeto({ id: 'sem-frase', estrelas: 5, dataOrdenacao: 2 }),
        projeto({ id: 'com-frase', estrelas: 5, dataOrdenacao: 1 }),
      ],
      [ref('sem-frase', 5, null), ref('com-frase', 5, 'o teto da base')],
    );
    expect(colunas.find((c) => c.nota === 5)?.regua).toBe('o teto da base');
  });

  it('ordena os candidatos do mais recente para o mais antigo', () => {
    const colunas = agruparEspeciais(
      [
        projeto({ id: 'velho', estrelas: 1, dataOrdenacao: 10 }),
        projeto({ id: 'novo', estrelas: 1, dataOrdenacao: 99 }),
      ],
      [],
    );
    expect(colunas.find((c) => c.nota === 1)?.projetos.map((p) => p.id)).toEqual(['novo', 'velho']);
  });
});

describe('ancoraForaDoNivel', () => {
  it('acusa a divergência entre a nota gravada e o nível que a âncora dizia definir', () => {
    expect(ancoraForaDoNivel(projeto({ id: 'p', estrelas: 2 }), ref('p', 3))).toBe(true);
    expect(ancoraForaDoNivel(projeto({ id: 'p', estrelas: 3 }), ref('p', 3))).toBe(false);
    expect(ancoraForaDoNivel(projeto({ id: 'p', estrelas: 3 }), undefined)).toBe(false);
  });
});

describe('alvosDaComparacao', () => {
  const colunas = () =>
    agruparEspeciais(
      [
        projeto({ id: 'candidato', estrelas: 3 }),
        projeto({ id: 'piapp', estrelas: 3 }),
        projeto({ id: 'outro', estrelas: 1 }),
      ],
      [ref('piapp', 3, 'régua do 3')],
    );

  it('traz a âncora do nível junto de cada selecionado', () => {
    expect(alvosDaComparacao(['candidato'], colunas())).toEqual(['candidato', 'piapp']);
  });

  it('não duplica quando o próprio selecionado é a âncora', () => {
    expect(alvosDaComparacao(['piapp'], colunas())).toEqual(['piapp']);
  });

  it('nível sem âncora compara só o que foi escolhido', () => {
    expect(alvosDaComparacao(['outro'], colunas())).toEqual(['outro']);
  });

  it('respeita o teto de selecionados', () => {
    const muitos = Array.from({ length: 6 }, (_, i) => `p${i}`);
    expect(alvosDaComparacao(muitos, colunas()).length).toBeLessThanOrEqual(MAX_COMPARAR * 2);
    expect(alvosDaComparacao(muitos, colunas()).slice(0, MAX_COMPARAR)).toEqual(
      muitos.slice(0, MAX_COMPARAR),
    );
  });
});

describe('rotuloNota', () => {
  it('distingue sem nota, zero e o singular', () => {
    expect(rotuloNota(null)).toBe('Sem nota');
    expect(rotuloNota(0)).toBe('Zero');
    expect(rotuloNota(1)).toBe('1 estrela');
    expect(rotuloNota(8)).toBe('8 estrelas');
  });
});
