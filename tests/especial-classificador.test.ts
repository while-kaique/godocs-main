import { describe, it, expect } from 'vitest';
import {
  cosseno,
  vetorParaBase64,
  base64ParaVetor,
  recortarTexto,
  TETO_TEXTO_EMBEDDING,
} from '@/lib/embeddings';
import {
  rotuloExemplar,
  selecionarVizinhos,
  textoParaEmbedding,
  hashTexto,
  montarBlocoFewShot,
  PISO_SIMILARIDADE,
  type ExemplarEspecial,
} from '@/lib/especial-corpus';
import {
  extrairJson,
  normalizarRecomendacao,
  buildSystemPromptEspecial,
} from '@/lib/agents/especial-classificador';

// ─── embeddings.ts ───────────────────────────────────────────────────────────

describe('embeddings — cosseno', () => {
  it('vetores idênticos → 1', () => {
    expect(cosseno([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('vetores ortogonais → 0', () => {
    expect(cosseno([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('dimensões diferentes → 0 (modelos diferentes não se comparam)', () => {
    expect(cosseno([1, 2, 3], [1, 2])).toBe(0);
  });
  it('vetor nulo → 0, sem NaN', () => {
    expect(cosseno([0, 0], [1, 1])).toBe(0);
  });
});

describe('embeddings — round-trip base64 de Float32', () => {
  it('preserva os valores dentro da precisão de float32', () => {
    const original = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.5);
    const b64 = vetorParaBase64(original);
    const volta = base64ParaVetor(b64);
    expect(volta.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(volta[i]).toBeCloseTo(original[i], 5);
    }
  });
  it('base64 é bem menor que o JSON de um vetor real', () => {
    // Embeddings reais têm decimais longos (~18 chars por número); base64 é fixo (~8 KB).
    const v = Array.from({ length: 1536 }, (_, i) => Math.sin(i) * 0.4917283746);
    const b64 = vetorParaBase64(v);
    expect(b64.length).toBeLessThan(JSON.stringify(v).length / 2);
  });
});

describe('embeddings — recortarTexto', () => {
  it('corta acima do teto', () => {
    const longo = 'x'.repeat(TETO_TEXTO_EMBEDDING + 500);
    expect(recortarTexto(longo).length).toBe(TETO_TEXTO_EMBEDDING);
  });
  it('preserva texto curto e trima', () => {
    expect(recortarTexto('  oi  ')).toBe('oi');
  });
});

// ─── especial-corpus.ts ──────────────────────────────────────────────────────

function ex(over: Partial<ExemplarEspecial>): ExemplarEspecial {
  return {
    projeto_id: 'p',
    nome: 'Projeto',
    area: 'CX',
    estrela_humana: null,
    estrela_recomendada: null,
    leitura: null,
    vetor: [1, 0, 0],
    ...over,
  };
}

describe('corpus — rotuloExemplar (nota humana vence a recomendada)', () => {
  it('usa a nota humana quando existe', () => {
    expect(rotuloExemplar(ex({ estrela_humana: 2, estrela_recomendada: 4 }))).toEqual({
      estrela: 2,
      fonte: 'humana',
    });
  });
  it('cai na recomendada só sem nota humana', () => {
    expect(rotuloExemplar(ex({ estrela_humana: null, estrela_recomendada: 3 }))).toEqual({
      estrela: 3,
      fonte: 'recomendada',
    });
  });
  it('sem rótulo nenhum → null (não serve de exemplo)', () => {
    expect(rotuloExemplar(ex({ estrela_humana: null, estrela_recomendada: null }))).toBeNull();
  });
  it('estrela humana 0 é rótulo válido (≠ ausência)', () => {
    expect(rotuloExemplar(ex({ estrela_humana: 0 }))?.estrela).toBe(0);
  });
});

describe('corpus — selecionarVizinhos', () => {
  const corpus: ExemplarEspecial[] = [
    ex({ projeto_id: 'igual', vetor: [1, 0, 0], estrela_humana: 2 }),
    ex({ projeto_id: 'meio', vetor: [0.7, 0.7, 0], estrela_humana: 1 }),
    ex({ projeto_id: 'ortog', vetor: [0, 1, 0], estrela_humana: 3 }),
    ex({ projeto_id: 'semrotulo', vetor: [1, 0, 0], estrela_humana: null }),
  ];

  it('ordena por similaridade desc e respeita o K', () => {
    const v = selecionarVizinhos([1, 0, 0], corpus, { k: 2 });
    expect(v.map((x) => x.projeto_id)).toEqual(['igual', 'meio']);
    expect(v[0].similaridade).toBeGreaterThan(v[1].similaridade);
  });
  it('exclui o próprio projeto', () => {
    const v = selecionarVizinhos([1, 0, 0], corpus, { k: 5, excluirId: 'igual' });
    expect(v.map((x) => x.projeto_id)).not.toContain('igual');
  });
  it('descarta exemplar sem rótulo', () => {
    const v = selecionarVizinhos([1, 0, 0], corpus, { k: 5 });
    expect(v.map((x) => x.projeto_id)).not.toContain('semrotulo');
  });
  it('aplica o piso de similaridade', () => {
    const v = selecionarVizinhos([0, 1, 0], corpus, { k: 5, piso: 0.9 });
    // Só 'ortog' (=1.0) passa; 'igual'/'meio' ficam abaixo de 0.9.
    expect(v.map((x) => x.projeto_id)).toEqual(['ortog']);
  });
  it('PISO_SIMILARIDADE padrão corta o irrelevante', () => {
    const quaseOrtogonal = ex({ projeto_id: 'quase', vetor: [0.1, 0.99, 0], estrela_humana: 1 });
    const v = selecionarVizinhos([1, 0, 0], [quaseOrtogonal]);
    expect(cosseno([1, 0, 0], quaseOrtogonal.vetor)).toBeLessThan(PISO_SIMILARIDADE);
    expect(v).toHaveLength(0);
  });
});

describe('corpus — textoParaEmbedding e hashTexto', () => {
  it('coloca área/escopo antes do memorial (o fim é o que o teto corta)', () => {
    const t = textoParaEmbedding({
      nome: 'Bot X',
      area: 'Fiscal',
      contexto_especial: 'controla risco',
      memorial: 'memorial longo',
    });
    expect(t.indexOf('Área: Fiscal')).toBeLessThan(t.indexOf('Memorial:'));
    expect(t.indexOf('Projeto: Bot X')).toBeLessThan(t.indexOf('Área: Fiscal'));
  });
  it('usa memorial OU doc, não os dois', () => {
    const t = textoParaEmbedding({ memorial: 'MEM', doc: 'DOC' });
    expect(t).toContain('MEM');
    expect(t).not.toContain('DOC');
  });
  it('hash muda quando o texto muda e é estável quando não muda', () => {
    const a = hashTexto('texto');
    expect(hashTexto('texto')).toBe(a);
    expect(hashTexto('texto ')).not.toBe(a);
  });
});

describe('corpus — montarBlocoFewShot', () => {
  it('sem vizinhos, orienta a usar só a régua', () => {
    expect(montarBlocoFewShot([])).toContain('Nenhum projeto especial parecido');
  });
  it('rende nota, nome e leitura por vizinho', () => {
    const bloco = montarBlocoFewShot([
      {
        ...ex({ projeto_id: 'p1', nome: 'Godash', area: 'BI', estrela_humana: 2, leitura: 'painel' }),
        similaridade: 0.8,
        estrela_efetiva: 2,
        fonte_rotulo: 'humana',
      },
    ]);
    expect(bloco).toContain('Godash');
    expect(bloco).toContain('2 estrelas');
    expect(bloco).toContain('nota da triagem');
    expect(bloco).toContain('painel');
  });
});

// ─── agents/especial-classificador.ts ────────────────────────────────────────

describe('agente — extrairJson', () => {
  it('JSON puro', () => {
    expect(extrairJson('{"estrelas_recomendada":2}')).toEqual({ estrelas_recomendada: 2 });
  });
  it('JSON em cerca ```json', () => {
    expect(extrairJson('bla\n```json\n{"a":1}\n```\nfim')).toEqual({ a: 1 });
  });
  it('JSON embutido em prosa', () => {
    expect(extrairJson('Resposta: {"a":1} pronto')).toEqual({ a: 1 });
  });
  it('lixo → null', () => {
    expect(extrairJson('sem json aqui')).toBeNull();
  });
});

describe('agente — normalizarRecomendacao (guard)', () => {
  it('clampa e arredonda a nota', () => {
    expect(normalizarRecomendacao({ estrelas_recomendada: 12 })?.estrelas_recomendada).toBe(10);
    expect(normalizarRecomendacao({ estrelas_recomendada: -3 })?.estrelas_recomendada).toBe(0);
    expect(normalizarRecomendacao({ estrelas_recomendada: 1.7 })?.estrelas_recomendada).toBe(2);
  });
  it('nota ≥3 força confiança ≤ média e marca contestada', () => {
    const r = normalizarRecomendacao({ estrelas_recomendada: 4, confianca: 'alta' });
    expect(r?.confianca).toBe('media');
    expect(r?.contestada).toBe(true);
  });
  it('nota <3 preserva confiança alta e não contesta', () => {
    const r = normalizarRecomendacao({ estrelas_recomendada: 2, confianca: 'alta' });
    expect(r?.confianca).toBe('alta');
    expect(r?.contestada).toBe(false);
  });
  it('confiança inválida → baixa (conservador)', () => {
    expect(normalizarRecomendacao({ estrelas_recomendada: 1, confianca: 'xpto' })?.confianca).toBe(
      'baixa',
    );
  });
  it('sem nota numérica → null', () => {
    expect(normalizarRecomendacao({ confianca: 'alta' })).toBeNull();
    expect(normalizarRecomendacao(null)).toBeNull();
    expect(normalizarRecomendacao({ estrelas_recomendada: 'abc' })).toBeNull();
  });
  it('leitura ausente ganha texto de fallback', () => {
    expect(normalizarRecomendacao({ estrelas_recomendada: 1 })?.leitura).toMatch(/não justificou/);
  });
});

describe('agente — prompt de sistema (fonte única da régua)', () => {
  it('carrega a régua e a curva no system prompt', () => {
    const p = buildSystemPromptEspecial();
    expect(p).toContain('top 4%'); // curva
    expect(p).toContain('Recorrência real'); // critério da régua
    expect(p).toContain('JSON'); // formato forçado
    expect(p).toMatch(/0 a 10/); // escala
  });
});
