/**
 * Taxonomia de FUNÇÃO + roteador (T2 do painel de agentes).
 *
 * O que estes testes prendem:
 * - **estabilidade**: mesmo texto → mesma função, sempre (é o que torna 2 corridas comparáveis, e
 *   a razão de o roteador não ser um LLM);
 * - **acento e caixa não mudam a rota** (a base é PT-BR escrita à mão);
 * - **radical casa flexão** (`precific` pega "precificador"), mas termo não casa DENTRO de outra
 *   palavra;
 * - as duas funções genéricas (`painel_indicador`/`plataforma_ia`) **não engolem** as específicas;
 * - **vizinho é evidência, não decisor**: só fala quando NADA casou no texto do projeto (medido:
 *   desempatando, ele errou 3 de 13);
 * - **termo no título vence termo no corpo** — inclui os 4 casos reais que isso consertou;
 * - `medirCobertura` acusa taxonomia que não cobre a base (o que faria a lista ser opinião).
 */
import { describe, it, expect } from 'vitest';
import {
  FUNCAO_INDEFINIDA,
  TAXONOMIA_FUNCAO,
  classificarFuncao,
  medirCobertura,
  normalizarTexto,
  placarFuncao,
  rotuloFuncao,
} from '@/lib/especiais-funcao';

describe('taxonomia declarada', () => {
  it('tem chaves únicas, rótulo e definição em todas', () => {
    const chaves = TAXONOMIA_FUNCAO.map((f) => f.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const f of TAXONOMIA_FUNCAO) {
      expect(f.rotulo.length).toBeGreaterThan(3);
      expect(f.definicao.length).toBeGreaterThan(20);
      expect(f.termos.length).toBeGreaterThan(3);
    }
  });

  it('os termos são declarados SEM acento (o texto é normalizado antes de casar)', () => {
    for (const f of TAXONOMIA_FUNCAO) {
      for (const t of f.termos) {
        const semAcento = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
        expect(t).toBe(semAcento);
      }
    }
  });

  it('as duas funções genéricas ficam no FIM (a ordem é o desempate)', () => {
    const chaves = TAXONOMIA_FUNCAO.map((f) => f.chave);
    expect(chaves.slice(-2)).toEqual(['painel_indicador', 'plataforma_ia']);
  });

  it('chave desconhecida tem rótulo honesto', () => {
    expect(rotuloFuncao(FUNCAO_INDEFINIDA)).toMatch(/indefinida/i);
    expect(rotuloFuncao('inventada')).toMatch(/indefinida/i);
  });
});

describe('normalização e casamento', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizarTexto('Precificação, MARGEM!')).toBe(' precificacao margem ');
  });

  it('radical casa a flexão', () => {
    expect(placarFuncao('agente precificador de SKUs')[0].funcao).toBe('preco_margem');
    expect(placarFuncao('rotina de precificação semanal')[0].funcao).toBe('preco_margem');
  });

  it('termo NÃO casa no meio de outra palavra', () => {
    expect(placarFuncao('resultado impreciso e desimpedido')).toEqual([]);
  });

  it('conta termos DISTINTOS, não ocorrências (repetição é estilo, não assunto)', () => {
    const repetido = placarFuncao('dashboard dashboard dashboard dashboard');
    const variado = placarFuncao('preço, margem e markup');
    expect(repetido[0].pontos).toBe(1);
    expect(variado[0].pontos).toBe(3);
  });
});

describe('classificarFuncao', () => {
  it('é ESTÁVEL: mesmo texto, mesma resposta', () => {
    const texto = 'Projeto: Agente precificador. O que faz: recalcula preço e margem por SKU.';
    const a = classificarFuncao(texto);
    const b = classificarFuncao(texto);
    expect(a).toEqual(b);
    expect(a.funcao).toBe('preco_margem');
    expect(a.origem).toBe('texto');
  });

  it('irmãos de função em ÁREAS diferentes caem na MESMA função (a lição 2)', () => {
    const goprice = classificarFuncao('GoPrice: monitora preço e margem dos produtos Gocase.');
    const agente = classificarFuncao(
      'Agente precificador: sugere preço e margem dos produtos Gobeaute.',
    );
    expect(goprice.funcao).toBe(agente.funcao);
    expect(goprice.funcao).toBe('preco_margem');
  });

  it('o genérico não engole o específico: painel de preço é preço', () => {
    const d = classificarFuncao('Dashboard de preço e margem por marca, com gráfico semanal.');
    expect(d.funcao).toBe('preco_margem');
  });

  it('painel puro continua painel', () => {
    const d = classificarFuncao(
      'Painel consolidado com os indicadores do time, um gráfico por KPI.',
    );
    expect(d.funcao).toBe('painel_indicador');
  });

  it('nada casou e sem vizinhos → indefinida (não chuta)', () => {
    const d = classificarFuncao('Projeto: Prisma. O que faz: ajuda o time no dia a dia.');
    expect(d.funcao).toBe(FUNCAO_INDEFINIDA);
    expect(d.origem).toBe('nenhuma');
    expect(d.placar).toEqual([]);
  });

  it('vizinho decide quando o texto nada diz', () => {
    const d = classificarFuncao('Projeto: Prisma. O que faz: ajuda o time.', [
      { texto: 'GoPrice — mesma faixa: monitora preço e margem', similaridade: 0.81 },
      { texto: 'Tabela de preço automática', similaridade: 0.62 },
    ]);
    expect(d.funcao).toBe('preco_margem');
    expect(d.origem).toBe('vizinhos');
  });

  it('vizinho NÃO atropela texto que já decidiu', () => {
    const d = classificarFuncao('Gera estampa e criativo para anúncio.', [
      { texto: 'monitora preço e margem e markup', similaridade: 0.99 },
    ]);
    expect(d.funcao).toBe('conteudo_criativo');
    expect(d.origem).toBe('texto');
  });

  it('no EMPATE manda a ordem DECLARADA — vizinho NÃO desempata', () => {
    const texto = 'Fluxo que abre ticket quando a estampa chega.';
    const placar = placarFuncao(texto);
    expect(placar[0].pontos).toBe(placar[1].pontos);
    const d = classificarFuncao(texto, [
      { texto: 'chamado e atendimento do CX', similaridade: 0.99 },
    ]);
    // 'conteudo_criativo' vem antes de 'atendimento_mensagem' na taxonomia
    expect(d.funcao).toBe('conteudo_criativo');
    expect(d.origem).toBe('texto');
    expect(d.empate).toBe(true);
    expect(classificarFuncao(texto, []).funcao).toBe(d.funcao); // e não muda sem vizinho
  });

  it('termo no TÍTULO vence termo no corpo (o desempate honesto)', () => {
    const d = classificarFuncao({
      titulo: 'Gobeaute Prompt Studio',
      corpo: 'Plataforma para o time. Precisa integrar com o sistema de catálogo.',
    });
    expect(d.funcao).toBe('plataforma_ia');
    expect(d.origem).toBe('texto');
  });

  it('os 4 casos REAIS que o peso do título consertou (26/08/2026)', () => {
    const casos: { titulo: string; corpo: string; esperado: string }[] = [
      {
        titulo: 'Gobeaute Prompt Studio — estúdio de prompts do time',
        corpo: 'Foi preciso integrar com o catálogo.',
        esperado: 'plataforma_ia',
      },
      {
        titulo: '[VERSTA] Robo orçamento - Marca — monta o orçamento da campanha',
        corpo: 'Roda sobre a conta de Google Ads.',
        esperado: 'preco_margem',
      },
      {
        titulo: 'Hub Criativo — centraliza a produção de criativo da marca',
        corpo: 'Tem um checklist de aprovação interno.',
        esperado: 'conteudo_criativo',
      },
      {
        titulo: 'Ferramenta de comentar nos posts — responde comentários dos perfis',
        corpo: 'Também acompanha os vídeos publicados.',
        esperado: 'atendimento_mensagem',
      },
    ];
    for (const c of casos) {
      const d = classificarFuncao({ titulo: c.titulo, corpo: c.corpo });
      expect(d.funcao, c.titulo).toBe(c.esperado);
    }
  });

  it('vizinho de similaridade zero/inválida não vota', () => {
    const d = classificarFuncao('Projeto sem vocabulário reconhecível.', [
      { texto: 'preço e margem', similaridade: 0 },
      { texto: 'preço e margem', similaridade: Number.NaN },
    ]);
    expect(d.funcao).toBe(FUNCAO_INDEFINIDA);
  });
});

describe('medirCobertura', () => {
  const det = (funcao: string, origem: 'texto' | 'vizinhos' | 'nenhuma' = 'texto') => ({
    funcao,
    rotulo: rotuloFuncao(funcao),
    origem,
    termos: [] as string[],
    placar: [],
    empate: false,
  });

  it('conta indefinidas e quem precisou de vizinho', () => {
    const c = medirCobertura([
      det('preco_margem'),
      det('preco_margem'),
      det('painel_indicador', 'vizinhos'),
      det(FUNCAO_INDEFINIDA, 'nenhuma'),
    ]);
    expect(c.total).toBe(4);
    expect(c.por_funcao[0]).toMatchObject({ funcao: 'preco_margem', n: 2, pct: 50 });
    expect(c.indefinidas).toBe(1);
    expect(c.indefinidas_pct).toBe(25);
    expect(c.por_vizinhos).toBe(1);
  });

  it('aponta as funções DECLARADAS que ninguém ocupou', () => {
    const c = medirCobertura([det('preco_margem')]);
    expect(c.vazias).toContain('plataforma_ia');
    expect(c.vazias).not.toContain('preco_margem');
    expect(c.vazias.length).toBe(TAXONOMIA_FUNCAO.length - 1);
  });

  it('lista vazia não divide por zero', () => {
    const c = medirCobertura([]);
    expect(c.total).toBe(0);
    expect(c.indefinidas_pct).toBe(0);
    expect(c.vazias.length).toBe(TAXONOMIA_FUNCAO.length);
  });
});
