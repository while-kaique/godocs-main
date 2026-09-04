// Índice vetorial dos especiais no Pinecone (plataforma oficial) + re-auditoria das estrelas.
//
// O que estes testes seguram, em ordem de importância:
//  1. **O FALLBACK é caminho vivo.** Pinecone fora do ar → a recuperação cai no cosseno-em-JS do
//     SQLite e a classificação continua. Fallback que nunca roda apodrece calado (decisão 6).
//  2. **`null` (indisponível) ≠ `[]` (índice vazio).** Só `null` cai no SQLite. Confundir os dois
//     mascara um índice vazio — exatamente o que o backfill existe para consertar.
//  3. **Trocar a ORIGEM dos vizinhos não muda QUAIS vizinhos entram no prompt** — piso, `k`,
//     exclusão do próprio projeto e "nota humana vence a recomendada" valem nos dois caminhos.
//     Sem isso, a migração de infraestrutura viraria mudança de nota disfarçada.
//  4. **A re-auditoria não escreve NADA.** A coluna "Estrelas" é da triagem, só clique humano a
//     escreve — e o relatório exige vizinhos de rótulo HUMANO (senão é o agente confirmando o
//     agente).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  vizinhosDeMatches,
  type ExemplarSemVetor,
  type Vizinho,
  PISO_SIMILARIDADE,
} from '@/lib/especial-corpus';
import {
  avaliarDesvio,
  filtrarComparaveis,
  medianaPonderada,
  ordenarPorGravidade,
  resumirReauditoria,
  LIMIAR_DELTA,
  MIN_VIZINHOS_COMPARAVEIS,
  type LinhaReauditoria,
} from '@/lib/especiais-reauditoria';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function exemplar(id: string, over: Partial<ExemplarSemVetor> = {}): ExemplarSemVetor {
  return {
    projeto_id: id,
    nome: `Projeto ${id}`,
    area: 'Fiscal',
    estrela_humana: 1,
    estrela_recomendada: null,
    leitura: null,
    ...over,
  };
}

function vizinho(estrela: number, similaridade: number, fonte: 'humana' | 'recomendada'): Vizinho {
  return {
    projeto_id: `v${estrela}-${similaridade}`,
    nome: 'Vizinho',
    area: null,
    estrela_humana: fonte === 'humana' ? estrela : null,
    estrela_recomendada: fonte === 'recomendada' ? estrela : null,
    leitura: null,
    vetor: [],
    similaridade,
    estrela_efetiva: estrela,
    fonte_rotulo: fonte,
  };
}

// ─── especial-corpus: vizinhosDeMatches (recuperação por índice externo) ──────

describe('vizinhosDeMatches — as regras do índice externo são as MESMAS do cosseno local', () => {
  const mapa = new Map<string, ExemplarSemVetor>([
    ['A', exemplar('A', { estrela_humana: 3 })],
    ['B', exemplar('B', { estrela_humana: null, estrela_recomendada: 2 })],
    ['C', exemplar('C', { estrela_humana: null, estrela_recomendada: null })], // sem rótulo
  ]);

  it('hidrata nome/área/nota do corpus local e ordena por similaridade', () => {
    const v = vizinhosDeMatches(
      [
        { id: 'B', score: 0.5 },
        { id: 'A', score: 0.9 },
      ],
      mapa,
    );
    expect(v.map((x) => x.projeto_id)).toEqual(['A', 'B']);
    expect(v[0].nome).toBe('Projeto A');
    expect(v[0].estrela_efetiva).toBe(3);
    expect(v[0].fonte_rotulo).toBe('humana');
    expect(v[1].fonte_rotulo).toBe('recomendada');
  });

  it('derruba quem está abaixo do piso de similaridade', () => {
    const v = vizinhosDeMatches([{ id: 'A', score: PISO_SIMILARIDADE - 0.01 }], mapa);
    expect(v).toEqual([]);
  });

  it('derruba exemplar SEM rótulo — não serve de exemplo', () => {
    const v = vizinhosDeMatches([{ id: 'C', score: 0.99 }], mapa);
    expect(v).toEqual([]);
  });

  it('nunca devolve o próprio projeto', () => {
    const v = vizinhosDeMatches([{ id: 'A', score: 1 }], mapa, { excluirId: 'A' });
    expect(v).toEqual([]);
  });

  it('descarta match órfão (vetor de projeto que não está mais no corpus)', () => {
    const v = vizinhosDeMatches([{ id: 'FANTASMA', score: 0.99 }], mapa);
    expect(v).toEqual([]);
  });

  it('respeita o k', () => {
    expect(
      vizinhosDeMatches(
        [
          { id: 'A', score: 0.9 },
          { id: 'B', score: 0.8 },
        ],
        mapa,
        { k: 1 },
      ),
    ).toHaveLength(1);
  });

  it('não duplica o mesmo id vindo duas vezes do índice', () => {
    const v = vizinhosDeMatches(
      [
        { id: 'A', score: 0.9 },
        { id: 'A', score: 0.7 },
      ],
      mapa,
    );
    expect(v).toHaveLength(1);
  });
});

// ─── especiais-reauditoria (módulo puro) ─────────────────────────────────────

describe('medianaPonderada — o vizinho mais parecido pesa mais, e o outlier não manda', () => {
  it('lista vazia → null', () => {
    expect(medianaPonderada([])).toBeNull();
  });

  it('pesos ≤ 0 não contam', () => {
    expect(medianaPonderada([{ valor: 5, peso: 0 }])).toBeNull();
  });

  it('uma âncora extrema não puxa a referência como a média puxaria', () => {
    const pontos = [
      { valor: 1, peso: 0.9 },
      { valor: 1, peso: 0.8 },
      { valor: 1, peso: 0.7 },
      { valor: 10, peso: 0.6 }, // outlier
    ];
    expect(medianaPonderada(pontos)).toBe(1);
  });

  it('o peso desempata a favor do vizinho mais próximo', () => {
    expect(
      medianaPonderada([
        { valor: 1, peso: 0.95 },
        { valor: 4, peso: 0.21 },
      ]),
    ).toBe(1);
  });
});

describe('filtrarComparaveis — só rótulo HUMANO (anti-feedback-loop)', () => {
  it('derruba vizinho rotulado pela recomendação do próprio agente', () => {
    const lista = [vizinho(1, 0.9, 'humana'), vizinho(4, 0.9, 'recomendada')];
    expect(filtrarComparaveis(lista)).toHaveLength(1);
    expect(filtrarComparaveis(lista)[0].fonte_rotulo).toBe('humana');
  });
});

describe('avaliarDesvio', () => {
  const tresHumanos = (n: number) => [
    vizinho(n, 0.9, 'humana'),
    vizinho(n, 0.8, 'humana'),
    vizinho(n, 0.7, 'humana'),
  ];

  it('nota igual à dos pares → coerente', () => {
    const d = avaliarDesvio(1, tresHumanos(1));
    expect(d.veredito).toBe('coerente');
    expect(d.referencia).toBe(1);
    expect(d.delta).toBe(0);
    expect(d.base).toBe(3);
  });

  it(`nota ${LIMIAR_DELTA} acima dos pares → inflada`, () => {
    const d = avaliarDesvio(1 + LIMIAR_DELTA, tresHumanos(1));
    expect(d.veredito).toBe('inflada');
    expect(d.delta).toBe(LIMIAR_DELTA);
  });

  it(`nota ${LIMIAR_DELTA} abaixo dos pares → deflada`, () => {
    const d = avaliarDesvio(1, tresHumanos(1 + LIMIAR_DELTA));
    expect(d.veredito).toBe('deflada');
    expect(d.delta).toBe(-LIMIAR_DELTA);
  });

  it('logo abaixo do limiar ainda é coerente — o relatório não pode virar lista de tudo', () => {
    expect(avaliarDesvio(1 + LIMIAR_DELTA - 0.5, tresHumanos(1)).veredito).toBe('coerente');
  });

  it(`menos de ${MIN_VIZINHOS_COMPARAVEIS} vizinhos → sem_base, nunca "coerente" por omissão`, () => {
    const d = avaliarDesvio(4, [vizinho(1, 0.9, 'humana'), vizinho(1, 0.8, 'humana')]);
    expect(d.veredito).toBe('sem_base');
    expect(d.referencia).toBeNull();
    expect(d.delta).toBeNull();
  });

  it('vizinhos só com rótulo do agente → sem_base (não é comparação, é o agente se citando)', () => {
    const d = avaliarDesvio(4, [
      vizinho(1, 0.9, 'recomendada'),
      vizinho(1, 0.8, 'recomendada'),
      vizinho(1, 0.7, 'recomendada'),
    ]);
    expect(d.veredito).toBe('sem_base');
  });

  it('projeto sem nota humana → sem_base', () => {
    expect(avaliarDesvio(null, tresHumanos(1)).veredito).toBe('sem_base');
  });
});

describe('relatório — resumo e ordenação', () => {
  const linha = (id: string, delta: number | null, veredito: LinhaReauditoria['desvio']['veredito']) =>
    ({
      projeto_id: id,
      nome: id,
      area: null,
      estrela_humana: 1,
      desvio: { veredito, referencia: 1, delta, base: 3 },
      vizinhos: [],
    }) as LinhaReauditoria;

  it('conta os vereditos', () => {
    const r = resumirReauditoria([
      linha('a', 3, 'inflada'),
      linha('b', -2, 'deflada'),
      linha('c', 0, 'coerente'),
      linha('d', null, 'sem_base'),
    ]);
    expect(r).toEqual({ analisados: 4, inflada: 1, deflada: 1, coerente: 1, sem_base: 1 });
  });

  it('maior desvio ABSOLUTO no topo e sem_base no fim', () => {
    const ordenadas = ordenarPorGravidade([
      linha('coerente', 0, 'coerente'),
      linha('sem-base', null, 'sem_base'),
      linha('deflada', -4, 'deflada'),
      linha('inflada', 3, 'inflada'),
    ]);
    expect(ordenadas.map((l) => l.projeto_id)).toEqual([
      'deflada',
      'inflada',
      'coerente',
      'sem-base',
    ]);
  });
});

// ─── Orquestração: Pinecone primeiro, SQLite como fallback ───────────────────

const db = {
  getProjetoContextoData: vi.fn(),
  getProjetoById: vi.fn(),
  getDocumentacaoConteudo: vi.fn(),
  getAvaliacoesEspeciais: vi.fn(),
  upsertAvaliacaoEspecial: vi.fn(),
  getEmbeddingsEspeciais: vi.fn(),
  getEmbeddingEspecial: vi.fn(),
  getEmbeddingsEspeciaisPagina: vi.fn(),
  upsertEmbeddingEspecial: vi.fn(),
};
const pinecone = {
  consultarVizinhos: vi.fn(),
  upsertVetores: vi.fn(),
  descreverIndice: vi.fn(),
  garantirIndice: vi.fn(),
  namespacePinecone: vi.fn(() => 'prod'),
};
const lerResumosEspelho = vi.fn();
const lerLinhaEspelho = vi.fn();
const classificarEspecial = vi.fn();
const gerarEmbeddingsLote = vi.fn();

vi.mock('@/integrations/db/client.server', () => ({
  getProjetoContextoData: (...a: unknown[]) => db.getProjetoContextoData(...a),
  getProjetoById: (...a: unknown[]) => db.getProjetoById(...a),
  getDocumentacaoConteudo: (...a: unknown[]) => db.getDocumentacaoConteudo(...a),
  getAvaliacoesEspeciais: (...a: unknown[]) => db.getAvaliacoesEspeciais(...a),
  upsertAvaliacaoEspecial: (...a: unknown[]) => db.upsertAvaliacaoEspecial(...a),
  getEmbeddingsEspeciais: (...a: unknown[]) => db.getEmbeddingsEspeciais(...a),
  getEmbeddingEspecial: (...a: unknown[]) => db.getEmbeddingEspecial(...a),
  getEmbeddingsEspeciaisPagina: (...a: unknown[]) => db.getEmbeddingsEspeciaisPagina(...a),
  upsertEmbeddingEspecial: (...a: unknown[]) => db.upsertEmbeddingEspecial(...a),
  parseJson: (s: string | null) => {
    try {
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },
}));
vi.mock('@/lib/pinecone', () => ({
  consultarVizinhos: (...a: unknown[]) => pinecone.consultarVizinhos(...a),
  upsertVetores: (...a: unknown[]) => pinecone.upsertVetores(...a),
  descreverIndice: (...a: unknown[]) => pinecone.descreverIndice(...a),
  garantirIndice: (...a: unknown[]) => pinecone.garantirIndice(...a),
  namespacePinecone: () => pinecone.namespacePinecone(),
}));
vi.mock('@/lib/sheet-espelho', () => ({
  lerResumosEspelho: () => lerResumosEspelho(),
  lerLinhaEspelho: (id: string) => lerLinhaEspelho(id),
}));
vi.mock('@/lib/especiais-view', () => ({
  apenasEspeciais: (l: { especial: boolean }[]) => l.filter((p) => p.especial),
}));
vi.mock('@/lib/dashboard-resumo', () => ({ mapResumo: (l: unknown) => l }));
vi.mock('@/lib/agents/especial-classificador', () => ({
  classificarEspecial: (...a: unknown[]) => classificarEspecial(...a),
}));
vi.mock('@/lib/embeddings', async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    // O vetor viaja como JSON no lugar do base64 — o que se testa aqui é a ORIGEM dos
    // vizinhos, não a (de)serialização (essa já tem teste em especial-classificador.test.ts).
    base64ParaVetor: (s: string) => JSON.parse(s) as number[],
    vetorParaBase64: (v: number[]) => JSON.stringify(v),
    embeddingConfig: () => ({ apiKey: 'k', modelo: 'text-embedding-3-large' }),
    gerarEmbeddingsLote: (...a: unknown[]) => gerarEmbeddingsLote(...a),
  };
});

import {
  classificarEspecialProjeto,
  reauditarEspeciais,
  sincronizarPineconeEspeciais,
} from '@/lib/especial-classificador.functions';

function resumo(id: string, estrelas: number | null) {
  return {
    id,
    nome: `Projeto ${id}`,
    area: 'Fiscal',
    estrelas,
    especial: true,
    tipos: 'especial',
    dataSubmissao: null,
  };
}

function linhaEmbedding(id: string, vetor: number[]) {
  return {
    projeto_id: id,
    modelo: 'text-embedding-3-large',
    dim: vetor.length,
    vetor: JSON.stringify(vetor),
    texto_hash: 'hash-antigo',
    criado_em: null,
  };
}

describe('recuperação de vizinhos — Pinecone primeiro, SQLite como fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lerResumosEspelho.mockResolvedValue({
      linhas: [resumo('P0', null), resumo('P1', 3), resumo('P2', 1)],
    });
    db.getProjetoContextoData.mockResolvedValue({
      nome: 'Alvo',
      area: 'Fiscal',
      contexto_especial: 'roda sozinho',
      descricao_breve: 'faz coisa',
      memorial_calculo: null,
      submitted_at: null,
    });
    db.getDocumentacaoConteudo.mockResolvedValue({
      conteudo: JSON.stringify({ o_que_faz: 'classifica notas' }),
    });
    lerLinhaEspelho.mockResolvedValue(null);
    db.getAvaliacoesEspeciais.mockResolvedValue([]);
    db.getEmbeddingEspecial.mockResolvedValue(null);
    db.getEmbeddingsEspeciais.mockResolvedValue([
      linhaEmbedding('P1', [1, 0]),
      linhaEmbedding('P2', [0.9, 0.1]),
    ]);
    db.upsertEmbeddingEspecial.mockResolvedValue(undefined);
    gerarEmbeddingsLote.mockResolvedValue([
      { vetor: [1, 0], modelo: 'text-embedding-3-large', dim: 2 },
    ]);
    pinecone.upsertVetores.mockResolvedValue({ ok: true, enviados: 1, namespace: 'prod' });
    classificarEspecial.mockResolvedValue({
      estrelas_recomendada: 1,
      confianca: 'media',
      leitura: 'parecido com P2',
      contestada: false,
    });
  });

  it('com o índice no ar usa o Pinecone e NÃO lê a tabela de vetores inteira', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([
      { id: 'P1', score: 0.91 },
      { id: 'P2', score: 0.84 },
    ]);
    const r = await classificarEspecialProjeto('P0', { dry: true });
    expect(r.ok).toBe(true);
    expect(r.origem_vizinhos).toBe('pinecone');
    expect(r.vizinhos?.map((v) => v.nome)).toEqual(['Projeto P1', 'Projeto P2']);
    // É o ponto da migração: o corpus inteiro não é mais carregado por classificação.
    expect(db.getEmbeddingsEspeciais).not.toHaveBeenCalled();
  });

  it('Pinecone indisponível (null) → cai no cosseno do SQLite e classifica igual', async () => {
    pinecone.consultarVizinhos.mockResolvedValue(null);
    const r = await classificarEspecialProjeto('P0', { dry: true });
    expect(r.ok).toBe(true);
    expect(r.origem_vizinhos).toBe('sqlite');
    expect(r.vizinhos?.length).toBeGreaterThan(0);
    expect(db.getEmbeddingsEspeciais).toHaveBeenCalled();
    expect(r.recomendacao?.estrelas_recomendada).toBe(1);
  });

  it('índice VAZIO ([]) não é fallback — não mascara o backfill que falta rodar', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([]);
    const r = await classificarEspecialProjeto('P0', { dry: true });
    expect(r.origem_vizinhos).toBe('pinecone');
    expect(r.vizinhos).toEqual([]);
    expect(db.getEmbeddingsEspeciais).not.toHaveBeenCalled();
  });

  it('o vetor do alvo é espelhado no índice com tem_nota_humana=false (P0 não tem nota)', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([]);
    await classificarEspecialProjeto('P0', { dry: true });
    expect(pinecone.upsertVetores).toHaveBeenCalledTimes(1);
    const [vetores] = pinecone.upsertVetores.mock.calls[0];
    // Minúsculo: o id é canonicalizado na ENTRADA de `classificarEspecialProjeto`, então
    // SQLite, embedding, Pinecone e `especial_avaliacao` endereçam sempre a mesma chave.
    expect(vetores[0].id).toBe('p0');
    expect(vetores[0].metadata.tem_nota_humana).toBe(false);
  });

  // ⚠️ Regressão dos 30 aprovados invisíveis (run 1 da calibragem, 03/09/2026): a planilha
  // guarda o id do legado em MAIÚSCULA e o sync reverso cria a linha em `projetos` sempre em
  // minúscula, e o `=` do SQLite é sensível a caixa. `LEGADO-049` devolvia "projeto sem
  // contexto para classificar" enquanto `legado-049` passava — sem erro, sem aviso. O mock
  // abaixo é sensível à caixa DE PROPÓSITO: é a falha de produção, não uma aproximação dela.
  it('id MAIÚSCULO da planilha endereça o SQLite pela chave canônica (minúscula)', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([]);
    db.getProjetoContextoData.mockImplementation(async (id: string) =>
      id === 'legado-049'
        ? {
            nome: 'SofIA do FP&A',
            area: 'FP&A',
            contexto_especial: null,
            descricao_breve: 'faz coisa',
            memorial_calculo: null,
            submitted_at: null,
          }
        : null,
    );
    db.getDocumentacaoConteudo.mockImplementation(async (id: string) =>
      id === 'legado-049' ? { conteudo: JSON.stringify({ o_que_faz: 'classifica notas' }) } : null,
    );

    // Não está entre os especiais do espelho — é um APROVADO normal, como os 30 do run 1.
    // Sem o resumo para salvar a chamada, quem decide é a leitura do SQLite.
    const r = await classificarEspecialProjeto('LEGADO-049', { dry: true });

    expect(r.ok).toBe(true);
    expect(r.motivo).toBeUndefined();
    expect(db.getProjetoContextoData).toHaveBeenCalledWith('legado-049');
    // E a chave canônica vale para a IDA e a VOLTA: o que se grava tem de endereçar o mesmo
    // projeto que se leu, senão nasce uma segunda identidade em `especial_avaliacao`.
    expect(r.projeto_id).toBe('legado-049');
  });

  /**
   * Memorial degenerado dos legados importados à mão.
   *
   * ⚠️ Medido em prod (03/09/2026): nesses 30 projetos o "Memorial de Saving" é a CONTA que a
   * triagem escreveu (mediana 57 caracteres, contra 1.903 dos memoriais do app) e o texto do
   * AUTOR ficou em "Memorial anterior". Lendo só a conta, **30 de 30 saíram 0★, sendo 15 com nota
   * humana 1**, contra uma taxa base de 50% de zeros nessa faixa. Não era veredito sobre os
   * projetos, era ausência de dossiê.
   */
  it('memorial que é só uma CONTA é complementado com o texto do autor', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([]);
    db.getProjetoContextoData.mockResolvedValue({
      nome: 'SofIA do FP&A', area: 'FP&A', contexto_especial: null,
      descricao_breve: 'consolida DREs', submitted_at: null,
      memorial_calculo: '8 análises/mês × ~19min = 2,5h/mês × R$82,10/h = R$205,25.',
    });
    lerLinhaEspelho.mockResolvedValue({
      'Memorial anterior': 'Essa automação reduz tempo de consultas frequentes de valores históricos feitas de forma recorrente pela diretoria. Quantidade de análises mensais: 8.',
    });

    await classificarEspecialProjeto('P0', { dry: true });

    const [alvo] = classificarEspecial.mock.calls[0] as [{ memorial: string | null }];
    expect(alvo.memorial).toContain('R$205,25');
    expect(alvo.memorial).toContain('recorrente pela diretoria');
  });

  // ⚠️ Em projeto do app, "Memorial anterior" é a versão ANTERIOR do memorial: juntar as duas
  // colocaria números velhos ao lado dos novos no mesmo texto.
  it('memorial CHEIO não é complementado', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([]);
    const cheio = 'Memorial de Cálculo. Contexto: ' + 'x'.repeat(400);
    db.getProjetoContextoData.mockResolvedValue({
      nome: 'Alvo', area: 'Fiscal', contexto_especial: null, descricao_breve: 'faz coisa',
      submitted_at: null, memorial_calculo: cheio,
    });
    lerLinhaEspelho.mockResolvedValue({ 'Memorial anterior': 'versão velha com números antigos' });

    await classificarEspecialProjeto('P0', { dry: true });

    const [alvo] = classificarEspecial.mock.calls[0] as [{ memorial: string | null }];
    expect(alvo.memorial).toBe(cheio);
    expect(alvo.memorial).not.toContain('números antigos');
  });

  it('upsert no índice falhando NÃO derruba a classificação (best-effort)', async () => {
    pinecone.upsertVetores.mockResolvedValue({ ok: false, enviados: 0, namespace: 'prod', motivo: 'boom' });
    pinecone.consultarVizinhos.mockResolvedValue([{ id: 'P1', score: 0.9 }]);
    const r = await classificarEspecialProjeto('P0', { dry: true });
    expect(r.ok).toBe(true);
  });

  it('dry:true não grava recomendação', async () => {
    pinecone.consultarVizinhos.mockResolvedValue([]);
    await classificarEspecialProjeto('P0', { dry: true });
    expect(db.upsertAvaliacaoEspecial).not.toHaveBeenCalled();
  });
});

describe('backfill do índice (T5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lerResumosEspelho.mockResolvedValue({ linhas: [resumo('P1', 3), resumo('P2', null)] });
    lerLinhaEspelho.mockResolvedValue(null);
    db.getAvaliacoesEspeciais.mockResolvedValue([]);
    pinecone.descreverIndice.mockResolvedValue({
      nome: 'godocs-especiais',
      host: 'h',
      dimensao: 3072,
      metrica: 'cosine',
      pronto: true,
    });
    db.getEmbeddingsEspeciaisPagina.mockResolvedValue([
      linhaEmbedding('P1', [1, 0]),
      linhaEmbedding('P2', [0, 1]),
    ]);
    pinecone.upsertVetores.mockResolvedValue({ ok: true, enviados: 2, namespace: 'prod' });
  });

  it('dry é o DEFAULT e não escreve nada', async () => {
    const r = await sincronizarPineconeEspeciais();
    expect(r.dry).toBe(true);
    expect(r.com_vetor).toBe(2);
    expect(r.upsertados).toBe(0);
    expect(pinecone.upsertVetores).not.toHaveBeenCalled();
  });

  it('com dry:false sobe os vetores e marca quem tem nota humana', async () => {
    const r = await sincronizarPineconeEspeciais({ dry: false });
    expect(r.ok).toBe(true);
    expect(r.upsertados).toBe(2);
    const [vetores] = pinecone.upsertVetores.mock.calls[0];
    const porId = Object.fromEntries(
      (vetores as { id: string; metadata: { tem_nota_humana: boolean } }[]).map((v) => [
        v.id,
        v.metadata.tem_nota_humana,
      ]),
    );
    expect(porId).toEqual({ P1: true, P2: false });
  });

  it('lê o corpus em PÁGINAS, nunca a tabela inteira', async () => {
    await sincronizarPineconeEspeciais({ dry: false, limite: 2, offset: 0 });
    expect(db.getEmbeddingsEspeciaisPagina).toHaveBeenCalledWith(0, 2);
    expect(db.getEmbeddingsEspeciais).not.toHaveBeenCalled();
  });

  it('página cheia devolve o próximo offset — a varredura continua de onde parou', async () => {
    const r = await sincronizarPineconeEspeciais({ dry: false, limite: 2 });
    expect(r.proximo_offset).toBe(2);
  });

  it('sem índice, reporta o motivo em vez de fingir sucesso', async () => {
    pinecone.descreverIndice.mockResolvedValue(null);
    const r = await sincronizarPineconeEspeciais({ dry: false });
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('Pinecone indisponível');
  });
});

describe('re-auditoria (T6) — relatório, nunca escrita', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lerResumosEspelho.mockResolvedValue({
      linhas: [resumo('A1', 4), resumo('A2', 1), resumo('A3', null)],
    });
    lerLinhaEspelho.mockResolvedValue(null);
    db.getAvaliacoesEspeciais.mockResolvedValue([]);
    db.getEmbeddingEspecial.mockImplementation(async (id: string) => linhaEmbedding(id, [1, 0]));
    pinecone.descreverIndice.mockResolvedValue({
      nome: 'godocs-especiais',
      host: 'h',
      dimensao: 3072,
      metrica: 'cosine',
      pronto: true,
    });
    pinecone.consultarVizinhos.mockResolvedValue([]);
  });

  it('nunca escreve nota nem recomendação', async () => {
    await reauditarEspeciais();
    expect(db.upsertAvaliacaoEspecial).not.toHaveBeenCalled();
    expect(db.upsertEmbeddingEspecial).not.toHaveBeenCalled();
    expect(pinecone.upsertVetores).not.toHaveBeenCalled();
  });

  it('só olha quem TEM nota humana', async () => {
    const r = await reauditarEspeciais();
    expect(r.linhas.map((l) => l.projeto_id).sort()).toEqual(['A1', 'A2']);
  });

  it('consulta o índice com o filtro de nota humana resolvido no SERVIDOR', async () => {
    await reauditarEspeciais();
    const [, opts] = pinecone.consultarVizinhos.mock.calls[0];
    expect(opts.filtro).toEqual({ tem_nota_humana: { $eq: true } });
  });

  it('nota bem acima dos pares vira "inflada", com os vizinhos que sustentam o veredito', async () => {
    lerResumosEspelho.mockResolvedValue({
      linhas: [resumo('A1', 4), resumo('B1', 1), resumo('B2', 1), resumo('B3', 1)],
    });
    pinecone.consultarVizinhos.mockResolvedValue([
      { id: 'B1', score: 0.9 },
      { id: 'B2', score: 0.85 },
      { id: 'B3', score: 0.8 },
    ]);
    const r = await reauditarEspeciais();
    const a1 = r.linhas.find((l) => l.projeto_id === 'A1');
    expect(a1?.desvio.veredito).toBe('inflada');
    expect(a1?.desvio.referencia).toBe(1);
    expect(a1?.vizinhos).toHaveLength(3);
    expect(r.resumo.inflada).toBe(1);
  });

  it('sem índice, recusa com motivo — relatório errado é pior que relatório nenhum', async () => {
    pinecone.descreverIndice.mockResolvedValue(null);
    const r = await reauditarEspeciais();
    expect(r.ok).toBe(false);
    expect(r.linhas).toEqual([]);
    expect(r.motivo).toContain('Pinecone');
  });

  it('projeto sem vetor entra como sem_base, não some do relatório', async () => {
    db.getEmbeddingEspecial.mockResolvedValue(null);
    const r = await reauditarEspeciais();
    expect(r.resumo.sem_base).toBe(2);
  });
});

/**
 * Trava de custo dos embeddings.
 *
 * ⚠️ As chamadas de LLM vão pelo ai-proxy e são baratas de testar. EMBEDDING é outra coisa: vai
 * direto na OpenAI, com chave própria, e se paga por chamada. Numa rodada de calibragem, que
 * repassa a base inteira cinco vezes, qualquer mudança no texto do dossiê muda o hash e
 * re-embeddaria o lote inteiro sem ninguém pedir (medido: o complemento de memorial sozinho
 * mudou o texto de 41 projetos).
 */
describe('EMBEDDINGS_SOMENTE_LEITURA', () => {
  const antes = process.env.EMBEDDINGS_SOMENTE_LEITURA;
  afterEach(() => {
    if (antes === undefined) delete process.env.EMBEDDINGS_SOMENTE_LEITURA;
    else process.env.EMBEDDINGS_SOMENTE_LEITURA = antes;
  });

  it('ligada, NÃO gera embedding nenhum — e a classificação continua', async () => {
    process.env.EMBEDDINGS_SOMENTE_LEITURA = '1';
    pinecone.consultarVizinhos.mockResolvedValue([]);
    db.getEmbeddingEspecial.mockResolvedValue(null); // alvo sem vetor: o caso que geraria

    const r = await classificarEspecialProjeto('P0', { dry: true });

    expect(gerarEmbeddingsLote).not.toHaveBeenCalled();
    expect(db.upsertEmbeddingEspecial).not.toHaveBeenCalled();
    expect(r.ok).toBe(true); // sem vetor o projeto fica sem vizinho, não sem nota
  });

  it('desligada, o comportamento de sempre volta', async () => {
    delete process.env.EMBEDDINGS_SOMENTE_LEITURA;
    pinecone.consultarVizinhos.mockResolvedValue([]);
    db.getEmbeddingEspecial.mockResolvedValue(null);

    await classificarEspecialProjeto('P0', { dry: true });

    expect(gerarEmbeddingsLote).toHaveBeenCalled();
  });
});
