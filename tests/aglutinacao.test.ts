import { describe, it, expect } from 'vitest';
import {
  escolherDirecao,
  candidatosDe,
  aplicarVeredito,
  consolidarSugestoes,
  PISO_SIMILARIDADE_AGLUTINACAO,
  type ProjetoAglutinavel,
  type ParCandidato,
} from '@/lib/aglutinacao';
import { montarPromptAglutinacao, interpretarVeredito } from '@/lib/agents/aglutinador';

const p = (id: string, dataMs: number | null, over: Partial<ProjetoAglutinavel> = {}): ProjetoAglutinavel => ({
  id,
  nome: `Projeto ${id}`,
  dataMs,
  ...over,
});
const universo = (...ps: ProjetoAglutinavel[]) => new Map(ps.map((x) => [x.id, x]));

describe('direção — o mais ANTIGO é o pai', () => {
  it('feature vem depois do produto', () => {
    expect(escolherDirecao(p('velho', 1000), p('novo', 2000))).toEqual({ paiId: 'velho', filhoId: 'novo' });
    expect(escolherDirecao(p('novo', 2000), p('velho', 1000))).toEqual({ paiId: 'velho', filhoId: 'novo' });
  });

  it('sem data nos DOIS lados não há direção — e sem direção não há sugestão', () => {
    expect(escolherDirecao(p('a', null), p('b', 2000))).toBeNull();
    expect(escolherDirecao(p('a', 1000), p('b', null))).toBeNull();
  });

  it('empate exato não é desempatado por chute', () => {
    expect(escolherDirecao(p('a', 1000), p('b', 1000))).toBeNull();
  });

  it('nunca ele mesmo', () => {
    expect(escolherDirecao(p('a', 1000), p('a', 2000))).toBeNull();
  });
});

describe('candidatosDe', () => {
  const filho = p('novo', 5000);
  const uni = universo(filho, p('velho', 1000), p('outro', 2000), p('futuro', 9000));

  it('respeita o piso de similaridade', () => {
    const r = candidatosDe(filho, [{ id: 'velho', similaridade: PISO_SIMILARIDADE_AGLUTINACAO - 0.01 }], uni);
    expect(r).toEqual([]);
  });

  it('ordena do mais parecido e corta em K', () => {
    const r = candidatosDe(
      filho,
      [
        { id: 'velho', similaridade: 0.7 },
        { id: 'outro', similaridade: 0.9 },
      ],
      uni,
      { k: 1 },
    );
    expect(r).toEqual([{ filhoId: 'novo', paiId: 'outro', similaridade: 0.9 }]);
  });

  it('vizinho MAIS NOVO inverte o par — quem vira filho é ele', () => {
    const r = candidatosDe(filho, [{ id: 'futuro', similaridade: 0.8 }], uni);
    expect(r[0]).toMatchObject({ paiId: 'novo', filhoId: 'futuro' });
  });

  it('não re-sugere quem JÁ está declarado como feature de alguém', () => {
    const jaVinculado = p('novo', 5000, { jaVinculado: true });
    const uni2 = universo(jaVinculado, p('velho', 1000));
    expect(candidatosDe(jaVinculado, [{ id: 'velho', similaridade: 0.9 }], uni2)).toEqual([]);
  });

  it('vizinho fora do universo é ignorado, não quebra', () => {
    expect(candidatosDe(filho, [{ id: 'fantasma', similaridade: 0.99 }], uni)).toEqual([]);
  });
});

describe('aplicarVeredito — o "não" é o default', () => {
  const cands: ParCandidato[] = [{ filhoId: 'novo', paiId: 'velho', similaridade: 0.8 }];
  const bom = { eh_feature: true, pai_id: 'velho', confianca: 0.9, porque: 'acrescenta a etapa de aprovação ao mesmo fluxo' };

  it('aceita o veredito completo', () => {
    expect(aplicarVeredito(cands, bom)).toMatchObject({ filhoId: 'novo', paiId: 'velho', confianca: 0.9 });
  });

  it('recusa quando o LLM diz que não é feature', () => {
    expect(aplicarVeredito(cands, { ...bom, eh_feature: false })).toBeNull();
  });

  it('⚠️ recusa pai que NÃO estava entre os candidatos (alucinação de id)', () => {
    expect(aplicarVeredito(cands, { ...bom, pai_id: 'legado-999' })).toBeNull();
  });

  it('recusa confiança abaixo do piso e justificativa vazia', () => {
    expect(aplicarVeredito(cands, { ...bom, confianca: 0.4 })).toBeNull();
    expect(aplicarVeredito(cands, { ...bom, porque: '   ' })).toBeNull();
  });

  it('resposta ausente/ininteligível não vira sugestão', () => {
    expect(aplicarVeredito(cands, null)).toBeNull();
    expect(aplicarVeredito(cands, interpretarVeredito('o proxy caiu'))).toBeNull();
  });

  it('casa o id do pai sem depender de caixa', () => {
    expect(aplicarVeredito(cands, { ...bom, pai_id: 'VELHO' })).not.toBeNull();
  });
});

describe('consolidarSugestoes', () => {
  const s = (filhoId: string, paiId: string, confianca: number, similaridade = 0.8) => ({
    filhoId, paiId, confianca, similaridade, justificativa: 'x',
  });

  it('um projeto é feature de UM produto — fica a de maior confiança', () => {
    const r = consolidarSugestoes([s('a', 'b', 0.7), s('a', 'c', 0.95)]);
    expect(r).toHaveLength(1);
    expect(r[0].paiId).toBe('c');
  });

  it('poda o ciclo A→B e B→A, mantendo o par mais confiante', () => {
    const r = consolidarSugestoes([s('a', 'b', 0.9), s('b', 'a', 0.7)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ filhoId: 'a', paiId: 'b' });
  });

  it('ordena por confiança — o painel valida o mais provável primeiro', () => {
    const r = consolidarSugestoes([s('a', 'x', 0.7), s('b', 'y', 0.95)]);
    expect(r.map((x) => x.filhoId)).toEqual(['b', 'a']);
  });
});

describe('prompt do juiz', () => {
  it('diz explicitamente que semelhança JÁ está descontada e que "outra marca" não é feature', () => {
    const t = montarPromptAglutinacao(p('novo', 2000), [p('velho', 1000)]);
    expect(t).toMatch(/IRM[ÃA]OS/i);
    expect(t).toMatch(/j[áa] est[áa] descontada/i);
    expect(t).toMatch(/dúvida, responda que N[ÃA]O/i);
  });

  it('⚠️ manda decidir pela DOCUMENTAÇÃO, não pelo nome — e entrega a doc dos dois lados', () => {
    const t = montarPromptAglutinacao(
      p('novo', 2000, { documentacao: 'acrescenta a etapa de aprovação ao fluxo do produto X' }),
      [p('velho', 1000, { documentacao: 'o produto X, que recebe pedidos e os despacha' })],
    );
    expect(t).toMatch(/N[ÃA]O PELO NOME/i);
    expect(t).toContain('acrescenta a etapa de aprovação');
    expect(t).toContain('o produto X, que recebe pedidos');
  });
});

describe('⚠️ falha de chamada NÃO é "não é feature"', () => {
  it('resposta não interpretável vira ERRO reportado, não silêncio', async () => {
    // Uma rajada de 502 do proxy (aconteceu em 03/09/2026, 40 seguidos) não pode terminar
    // com a varredura anunciando "nenhuma sugestão" sobre uma base que ninguém analisou.
    const { interpretarVeredito } = await import('@/lib/agents/aglutinador');
    expect(interpretarVeredito('<html>502 Bad gateway</html>')).toBeNull();
  });
});

describe('o NOME não decide sozinho (decisão do Luis, 03/09/2026)', () => {
  it('nome contido é BÔNUS: não cria candidato sobre conteúdo sem nada em comum', async () => {
    const { similaridadeFinal, BONUS_NOME_CONTIDO } = await import('@/lib/similaridade-lexical');
    // Dois projetos cujos textos não têm NADA em comum, mas um nome cabe no outro.
    expect(similaridadeFinal(0, true)).toBe(BONUS_NOME_CONTIDO);
    expect(similaridadeFinal(0, true)).toBeLessThan(PISO_SIMILARIDADE_AGLUTINACAO);
  });

  it('mas reforça o par que o CONTEÚDO já sugeriu', async () => {
    const { similaridadeFinal } = await import('@/lib/similaridade-lexical');
    expect(similaridadeFinal(0.3, true)).toBeCloseTo(0.45, 5);
    expect(similaridadeFinal(0.3, false)).toBe(0.3);
    expect(similaridadeFinal(0.95, true)).toBe(1);
  });

  it('a documentação entra no vocabulário do projeto', async () => {
    const { tokensPesados } = await import('@/lib/similaridade-lexical');
    const t = tokensPesados({ nome: 'Alpha', descricao: null, documentacao: 'despacha pedidos no protheus' });
    expect(t.has('protheus')).toBe(true);
    expect(t.has('despacha')).toBe(true);
  });
});

describe('prefixo de FAMÍLIA — o caso «Lab Gobeaute» (03/09/2026)', () => {
  it('pega a família que o TF-IDF sozinho perdia', async () => {
    const { calcularIdf, tokenizar, prefixoDeFamilia, similaridadeFinal } = await import(
      '@/lib/similaridade-lexical'
    );
    // ⚠️ O corpus do teste precisa ter TAMANHO REALISTA: `idf = ln(N/df)`, e o limiar de
    // 4,5 quer dizer "o token está em no máximo ~1,1% dos projetos". Num corpus de 12
    // documentos isso é inalcançável por construção — a 1ª versão deste teste falhou por
    // isso, não por defeito da régua. Na base real são 734 projetos e `lab` está em ~5.
    const corpus = [
      'Lab Gobeaute Sistema de P&D',
      'Lab Gobeaute Módulo Estabilidade',
      ...Array.from({ length: 300 }, (_, i) => `Painel Gobeaute area ${i}`),
    ];
    const idf = calcularIdf(corpus.map((t) => tokenizar(t)));
    const a = { nome: 'Lab Gobeaute Sistema de P&D' };
    const b = { nome: 'Lab Gobeaute Módulo Estabilidade' };
    expect(prefixoDeFamilia(a, b, idf)).toEqual(['lab', 'gobeaute']);
    // O par real media 0,135 — abaixo do piso. Com o bônus, passa.
    expect(similaridadeFinal(0.135, { prefixo: true })).toBeGreaterThan(0.35);
  });

  it('prefixo GENÉRICO não é família (é o que RUIDO + raridade impedem)', async () => {
    const { calcularIdf, tokenizar, prefixoDeFamilia } = await import('@/lib/similaridade-lexical');
    const corpus = Array.from({ length: 20 }, (_, i) => `Automação de Chamados area ${i}`);
    const idf = calcularIdf(corpus.map((t) => tokenizar(t)));
    // "automação" está em RUIDO; "chamados" está em 20 de 20 → idf 0.
    expect(prefixoDeFamilia({ nome: 'Automação de Chamados A' }, { nome: 'Automação de Chamados B' }, idf)).toEqual([]);
  });

  it('nem o prefixo decide sozinho: sem conteúdo em comum fica em 0,40 e o juiz ainda recusa', async () => {
    const { similaridadeFinal, BONUS_PREFIXO_FAMILIA } = await import('@/lib/similaridade-lexical');
    expect(similaridadeFinal(0, { prefixo: true })).toBe(BONUS_PREFIXO_FAMILIA);
  });
});

describe('varredura em duas fases (03/09/2026)', () => {
  it('o lote com pares prontos não precisa da similaridade — ela já foi decidida', async () => {
    // A fase 1 escolhe os pares (determinística, uma vez); a fase 2 só julga. É o que
    // impede cada um dos ~30 lotes de reler ~11 MB de vetores para redescobrir o mesmo.
    const { aplicarVeredito } = await import('@/lib/aglutinacao');
    const cands = [{ filhoId: 'novo', paiId: 'velho', similaridade: 0 }];
    const r = aplicarVeredito(cands, {
      eh_feature: true,
      pai_id: 'velho',
      confianca: 0.9,
      porque: 'acrescenta a etapa de aprovação',
    });
    // Similaridade 0 (não recomputada) NÃO invalida a sugestão: quem julga é o LLM.
    expect(r).not.toBeNull();
    expect(r?.paiId).toBe('velho');
  });

  it('⚠️ o pai continua conferido contra os candidatos, mesmo com pares prontos', () => {
    // A trava contra id alucinado não pode cair junto com a recuperação.
    expect(
      aplicarVeredito([{ filhoId: 'novo', paiId: 'velho', similaridade: 0 }], {
        eh_feature: true,
        pai_id: 'outro-qualquer',
        confianca: 0.99,
        porque: 'x',
      }),
    ).toBeNull();
  });
});

describe('avaliação na SUBMISSÃO (03/09/2026)', () => {
  it('quem já DECLAROU o pai na Etapa 1 fica de fora da sugestão automática', () => {
    // A pessoa disse o que o projeto é; um palpite por cima disso não acrescenta nada e
    // ainda apareceria no painel como decisão pendente sobre um caso já decidido.
    const declarado = p('novo', 5000, { jaVinculado: true });
    const uni = universo(declarado, p('velho', 1000));
    expect(candidatosDe(declarado, [{ id: 'velho', similaridade: 0.9 }], uni)).toEqual([]);
  });

  it('só o par em que o projeto NOVO é o filho interessa na submissão', () => {
    // Um recém-submetido pode ser o PAI de algo ainda mais novo (impossível pelo relógio)
    // ou o FILHO de algo mais antigo (o caso real). A direção sai do relógio, não do LLM.
    const novo = p('novo', 5000);
    const uni = universo(novo, p('velho', 1000), p('futuro', 9000));
    const cands = candidatosDe(
      novo,
      [
        { id: 'velho', similaridade: 0.8 },
        { id: 'futuro', similaridade: 0.9 },
      ],
      uni,
    );
    const comoFilho = cands.filter((c) => c.filhoId === novo.id);
    expect(comoFilho).toHaveLength(1);
    expect(comoFilho[0].paiId).toBe('velho');
  });
});
