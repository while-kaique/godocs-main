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
  recuperarDeProsa,
  acharCamposRecomendacao,
  normalizarRecomendacao,
  anexarEvidencia,
  buildSystemPromptEspecial,
  aplicarGuardVizinhoDivergente,
  type RecomendacaoEspecial,
} from '@/lib/agents/especial-classificador';
import type { Vizinho } from '@/lib/especial-corpus';

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
  it('lidera com o que o projeto FAZ, antes do memorial (o fim é o que o teto corta)', () => {
    const t = textoParaEmbedding({
      nome: 'Bot X',
      o_que_faz: 'precifica SKUs por margem',
      contexto_especial: 'controla risco',
      memorial: 'memorial longo',
    });
    expect(t.indexOf('Projeto: Bot X')).toBeLessThan(t.indexOf('O que faz:'));
    expect(t.indexOf('O que faz:')).toBeLessThan(t.indexOf('Memorial:'));
  });
  it('NÃO inclui área/ferramenta/tipo (boilerplate que dilui e aproxima por setor, não por função)', () => {
    const t = textoParaEmbedding({
      nome: 'GoPrice',
      o_que_faz: 'calcula preço',
      area: 'Gocase',
      ferramenta: 'Claude + GoDeploy',
      tipos: 'especial',
    });
    expect(t).not.toContain('Gocase');
    expect(t).not.toContain('Claude + GoDeploy');
    expect(t).not.toContain('especial');
    expect(t).toContain('GoPrice');
    expect(t).toContain('calcula preço');
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
    // ⚠️ 12 clampa em 10, mas 10 é ESCAPE: sem evidência citada o guard o devolve a 5★.
    // Com lastro, o 10 sobrevive — é o mesmo clamp de sempre, agora com o freio do escape.
    expect(
      normalizarRecomendacao({ estrelas_recomendada: 12, evidencias: { nao_existiria: 'a fila do Fiscal roda hoje só por causa dele', sem_volta: 'o processo manual foi desligado e ninguém o mantém' } })
        ?.estrelas_recomendada,
    ).toBe(10);
    expect(normalizarRecomendacao({ estrelas_recomendada: 12 })?.estrelas_recomendada).toBe(5);
    expect(normalizarRecomendacao({ estrelas_recomendada: -3 })?.estrelas_recomendada).toBe(0);
    expect(normalizarRecomendacao({ estrelas_recomendada: 1.7 })?.estrelas_recomendada).toBe(2);
  });
  it('⚠️ é a faixa 6-10 que marca contestada, não ≥3 (régua v2, 03/09/2026)', () => {
    // Sob a régua ANTIGA, ≥3★ era top 4% e por isso pedia segundo olhar. Sob a v2, 3★ é
    // "Garante" — um nível com definição e exemplos, nada raro entre especiais (41,7%).
    // O que exige gente agora é o ESCAPE: quem crava o número de 6 a 10 é humano.
    const r = normalizarRecomendacao({
      estrelas_recomendada: 7,
      confianca: 'alta',
      evidencias: { nao_existiria: 'a fila do Fiscal roda hoje só por causa dele', sem_volta: 'o processo manual foi desligado e ninguém o mantém' },
    });
    expect(r?.confianca).toBe('media');
    expect(r?.contestada).toBe(true);
    expect(Object.keys(r?.evidencias ?? {})).toHaveLength(2);
  });
  it('nota da faixa do agente preserva confiança alta e não contesta', () => {
    for (const nota of [2, 4, 5]) {
      const r = normalizarRecomendacao({ estrelas_recomendada: nota, confianca: 'alta' });
      expect(r?.confianca).toBe('alta');
      expect(r?.contestada).toBe(false);
      expect(r?.evidencias).toEqual({});
    }
  });
  it('⚠️ escape sem evidência CITADA volta para 5★ e diz o que houve na leitura', () => {
    const r = normalizarRecomendacao({
      estrelas_recomendada: 9,
      confianca: 'alta',
      leitura: 'muda o jogo',
      // só UM gatilho citado: o escape exige os DOIS
      evidencias: { nao_existiria: 'a fila do Fiscal roda hoje só por causa dele' },
    });
    expect(r?.estrelas_recomendada).toBe(5);
    expect(r?.ajuste_guard).toMatch(/sem citação da doc/);
    expect(r?.leitura).toMatch(/⚠/);
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
    expect(p).toContain('Muda o Jogo'); // a faixa 6-10 EXISTE no prompt
    expect(p).toContain('Experimenta'); // 0★ é nível nomeado
    expect(p).toContain('Godash'); // os exemplos reais ancoram os níveis
    // ⚠️ a régua vem de estrelas-regua.ts — a MESMA do time de avaliação. Se alguém
    // recriar uma régua paralela "dos especiais", estes literais saem daqui.
    expect(p).toContain('Assume'); // 5★ com o verbo da fonte única
    expect(p).toContain('JSON'); // formato forçado
    expect(p).toMatch(/0 a 10/); // escala
  });

  it('⚠️ a curva do prompt é a dos ESPECIAIS, não a da base inteira', () => {
    // Este teste substitui um que exigia o literal "top 4%" — a âncora ERRADA, que ele
    // prendia no lugar. Medido em 03/09/2026: na base inteira ≥3★ é 6,2% e ≥5★ é 1,5%;
    // entre os especiais auditados (a população que este agente julga) é 41,7% e 12,5%.
    // O agente recebia uma régua anti-inflação ~7× apertada demais e rebaixava o topo.
    const p = buildSystemPromptEspecial();
    expect(p).toContain('ESPECIAIS JÁ AUDITADOS');
    expect(p).toMatch(/≥3★ são 4\d%/); // a curva dos especiais, não os 4% da base
    expect(p).not.toMatch(/≥3★ é top 4% da base/);
    // A menção à base inteira SOBREVIVE, mas só como contraste explícito — é ela que
    // impede o modelo de confundir as duas populações.
    expect(p).toMatch(/Não confunda com a base inteira/);
  });
  it('instrui a igualar a faixa de um vizinho quase idêntico com nota maior', () => {
    expect(buildSystemPromptEspecial()).toMatch(/vizinho quase idêntico/i);
  });
});

// ─── Fix B: guard de divergência contra vizinho forte ─────────────────────────

function viz(over: Partial<Vizinho>): Vizinho {
  return {
    projeto_id: 'v',
    nome: 'Vizinho',
    area: 'CX',
    estrela_humana: null,
    estrela_recomendada: null,
    leitura: null,
    vetor: [1, 0, 0],
    similaridade: 0.8,
    estrela_efetiva: 3,
    fonte_rotulo: 'humana',
    ...over,
  };
}

function rec(over: Partial<RecomendacaoEspecial>): RecomendacaoEspecial {
  return {
    estrelas_recomendada: 0,
    confianca: 'baixa',
    leitura: 'memorial magro, parece POC',
    contestada: false,
    evidencias: {},
    ajuste_guard: null,
    ...over,
  };
}

describe('agente — aplicarGuardVizinhoDivergente', () => {
  it('nota ≤1 com vizinho forte (sim≥0.75, ≥3★) → confiança baixa, contestada e aviso na leitura', () => {
    const r = aplicarGuardVizinhoDivergente(rec({ estrelas_recomendada: 0, confianca: 'media' }), [
      viz({ nome: 'Agente precificador', similaridade: 0.82, estrela_efetiva: 4 }),
    ]);
    expect(r.confianca).toBe('baixa');
    expect(r.contestada).toBe(true);
    expect(r.leitura).toMatch(/Conferir na triagem/);
    expect(r.leitura).toContain('Agente precificador');
    expect(r.leitura).toContain('memorial magro'); // preserva a leitura original
  });
  it('não dispara quando a similaridade do vizinho é baixa', () => {
    const original = rec({ estrelas_recomendada: 1 });
    const r = aplicarGuardVizinhoDivergente(original, [viz({ similaridade: 0.5, estrela_efetiva: 4 })]);
    expect(r).toEqual(original);
  });
  it('não dispara quando o vizinho forte também é baixo (<3★)', () => {
    const original = rec({ estrelas_recomendada: 1 });
    const r = aplicarGuardVizinhoDivergente(original, [viz({ similaridade: 0.9, estrela_efetiva: 2 })]);
    expect(r).toEqual(original);
  });
  it('não dispara quando a nota do alvo já é ≥2 (não caiu em POC)', () => {
    const original = rec({ estrelas_recomendada: 2, confianca: 'media' });
    const r = aplicarGuardVizinhoDivergente(original, [viz({ similaridade: 0.9, estrela_efetiva: 4 })]);
    expect(r).toEqual(original);
  });
  it('NÃO reescreve a nota — só rebaixa confiança e sinaliza', () => {
    const r = aplicarGuardVizinhoDivergente(rec({ estrelas_recomendada: 1 }), [
      viz({ similaridade: 0.8, estrela_efetiva: 5 }),
    ]);
    expect(r.estrelas_recomendada).toBe(1);
  });
});

describe('agente — evidência do escape chega ao painel', () => {
  it('a citação é costurada na leitura (é a única coluna que a tela mostra)', () => {
    const rec = {
      estrelas_recomendada: 8,
      confianca: 'media' as const,
      leitura: 'muda o jogo na área',
      contestada: true,
      evidencias: { nao_existiria: 'a fila do Fiscal roda hoje só por causa dele', sem_volta: 'o processo manual foi desligado e ninguém o mantém' },
      ajuste_guard: null,
    };
    expect(anexarEvidencia(rec).leitura).toContain('Evidência do escape');
    expect(anexarEvidencia(rec).leitura).toContain('a fila do Fiscal');
  });

  it('fora da faixa 6-10 não mexe em nada', () => {
    const rec = {
      estrelas_recomendada: 3,
      confianca: 'alta' as const,
      leitura: 'garante',
      contestada: false,
      evidencias: {},
      ajuste_guard: null,
    };
    expect(anexarEvidencia(rec)).toEqual(rec);
  });
});

/**
 * Resposta em PROSA não é resposta ausente.
 *
 * ⚠️ Medido em prod (03/09/2026, `getAppLogs`): o modelo devolvia a avaliação COMPLETA em
 * Markdown (`**Recomendação: 0★ — Experimenta**`) e o parse dizia "LLM não devolveu recomendação
 * utilizável". O projeto sumia da rodada como se ninguém tivesse perguntado — a mesma perda
 * silenciosa dos 502, por outro caminho. Structured Outputs está morta no proxy, então o formato
 * é pedido, não garantido: quem tem de aguentar a variação é o parse.
 */
describe('recuperação de resposta em prosa', () => {
  const REAIS = [
    { texto: '**Recomendação: 0★ — Experimenta**  \n**Confiança: baixa**, por falta de comprovação.\n\n**Passo 1 — Muda o jogo?** Não.\n- **Gatilho 1:** não há processo citado.\nO projeto gera um relatório e ninguém além do autor usa.', nota: 0, conf: 'baixa' },
    { texto: '## Recomendação: **0★ — Experimenta**\n\n### Passo 1 — Muda o jogo?\n**Não.**\n\n- **Gatilho 1:** nada nomeado.\nEle roda uma vez por mês e alimenta uma planilha.', nota: 0, conf: 'baixa' },
    { texto: '## Recomendação: **3★ Garante**\nConfiança: média\nBloqueia pedidos com erro antes de seguir.', nota: 3, conf: 'media' },
  ];

  it('recupera nota e confiança do Markdown que prod realmente devolveu', () => {
    for (const c of REAIS) {
      const r = normalizarRecomendacao(recuperarDeProsa(c.texto));
      expect(r, c.texto.slice(0, 40)).not.toBeNull();
      expect(r!.estrelas_recomendada).toBe(c.nota);
      expect(r!.confianca).toBe(c.conf);
    }
  });

  // ⚠️ A trava que importa: trocar "perdi a resposta" por "inventei a nota" seria PIOR, porque o
  // primeiro aparece no relatório de falhas e o segundo entra na base como se fosse avaliação.
  it('NÃO inventa nota a partir de número solto na prosa', () => {
    for (const t of [
      'O projeto economiza 12 horas por mês e roda desde 2024.',
      'Foram 3 pessoas envolvidas e 5 integrações.',
      'Sem informação suficiente para avaliar.',
      '',
    ]) {
      expect(recuperarDeProsa(t)).toBeNull();
    }
  });

  // O porquê recuperado passa pelas MESMAS regras de escrita do gerado: sem o andaime do
  // raciocínio e sem travessão, senão o fallback reintroduz na tela o que o prompt proibiu.
  it('o porquê recuperado sai limpo, sem andaime e sem travessão', () => {
    const r = normalizarRecomendacao(recuperarDeProsa(REAIS[0].texto))!;
    expect(r.leitura).not.toMatch(/gatilho/i);
    expect(r.leitura).not.toMatch(/passo\s*\d/i);
    expect(r.leitura).not.toMatch(/[—–]/);
    expect(r.leitura).not.toMatch(/\*\*/);
    expect(r.leitura).toContain('ninguém além do autor usa');
  });
});

/**
 * Formas de JSON que o modelo devolve na prática.
 *
 * ⚠️ Colhidas dos logs de prod em 03/09/2026 — todas JSON VÁLIDO que o parse antigo descartava
 * como "não devolveu recomendação utilizável", tirando o projeto da rodada como se ninguém
 * tivesse perguntado. Structured Outputs está morta no proxy: o formato é pedido, não garantido.
 */
describe('formas alternativas do JSON', () => {
  const REAIS: { nome: string; json: unknown; nota: number }[] = [
    { nome: 'chave "recomendacao" com número', json: { recomendacao: 1, confianca: 'baixa', leitura: 'Coleta cotações.' }, nota: 1 },
    { nome: 'recomendacao aninhada', json: { recomendacao: { estrelas: 0, justificativa: 'A automação ajusta o Flex.' } }, nota: 0 },
    { nome: 'chave "nota"', json: { nota: 3, confianca: 'media', leitura: 'x' }, nota: 3 },
    { nome: 'canônica', json: { estrelas_recomendada: 2, confianca: 'alta', leitura: 'y' }, nota: 2 },
  ];

  it('aceita os apelidos e a nota chega inteira', () => {
    for (const c of REAIS) {
      const campos = acharCamposRecomendacao(c.json);
      expect(campos, c.nome).not.toBeNull();
      expect(normalizarRecomendacao(campos)!.estrelas_recomendada, c.nome).toBe(c.nota);
    }
  });

  it('a justificativa vira o porquê quando o modelo não usa "leitura"', () => {
    const r = normalizarRecomendacao(acharCamposRecomendacao(REAIS[1].json))!;
    expect(r.leitura).toContain('ajusta o Flex');
  });

  // ⚠️ O prompt manda um objeto `projeto`, e às vezes o modelo devolve ele de volta em vez de
  // responder. Isso é FALHA: eco da entrada não é julgamento, e aceitar um objeto só porque ele
  // é um objeto inventaria nota.
  it('eco da entrada continua sendo falha, não nota', () => {
    expect(acharCamposRecomendacao({ projeto: {} })).toBeNull();
    expect(acharCamposRecomendacao({ projeto: { nome: 'X', area: 'TECNOLOGIA' } })).toBeNull();
    expect(acharCamposRecomendacao({ comentario: 'nada a dizer' })).toBeNull();
  });
});
