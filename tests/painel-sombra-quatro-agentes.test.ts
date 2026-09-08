/**
 * O painel de sombra da ficha passa a mostrar o veredito dos QUATRO agentes, com o porquê de cada
 * um, e sem truncar (queixas do Luis, 08/09/2026).
 *
 * ⚠️ A causa raiz: a ficha lia `projeto_avaliacao.motivo`, que é `conciliado.motivos.join('\n')` e
 * só carrega o argumento de **quem PREOCUPOU** — e cada corrida do cron o sobrescreve com os
 * preocupados daquela rodada. Daí "vi vários porquês, depois só 2". Pior: o `votos` gravado não
 * guardava o argumento, então o porquê dos tranquilos era DESCARTADO na gravação.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { montarPareceresDaMesa, ARGUMENTO_GRAVADO_MAX } from '@/lib/agents/mesa-especialistas';
import { serializarVotos } from '@/lib/avaliacao-normais.functions';
import { pareceresDosVotos, interpretarConsensoDoTime } from '@/lib/dashboard-admin.functions';

const votosBase = {
  fte: { implausivel: false, fte: 0.5, pessoas: 1, motivo: null },
  financeiro: { veredito: 'atencao', confianca: 0.3, motivo: 'Materialidade acima do teto.', sinais: ['x'], abaixoDoPiso: false },
  rag: { apoio: true, confianca: 0.85, vizinhos: 3, topSimilaridade: 0.7, motivo: null },
  cetico: { refuta: false, confianca: 0, motivo: null, sinais: [] },
};

describe('montarPareceresDaMesa — os QUATRO, sempre', () => {
  it('mesa determinística: devolve 4 pareceres, com o veredito de cada eixo', () => {
    const p = montarPareceresDaMesa(votosBase as never);
    expect(p.map((x) => x.dimensao)).toEqual(['fte', 'financeiro', 'rag', 'cetico']);
    expect(p.find((x) => x.dimensao === 'financeiro')!.preocupa).toBe(true);
    expect(p.find((x) => x.dimensao === 'financeiro')!.argumento).toContain('Materialidade');
    // Os TRANQUILOS aparecem — é o que o `motivo` nunca carregava.
    expect(p.find((x) => x.dimensao === 'rag')!.preocupa).toBe(false);
    expect(p.find((x) => x.dimensao === 'fte')!.preocupa).toBe(false);
  });

  it('mesa LLM: usa o argumento raciocinado, inclusive de quem NÃO preocupou', () => {
    const julgamentos = [
      { dimensao: 'fte', preocupa: false, argumento: 'Horas críveis para 1 pessoa.', confianca: 0.9 },
      { dimensao: 'financeiro', preocupa: true, argumento: 'O custo evitado não está detalhado.', confianca: 0.8 },
      { dimensao: 'rag', preocupa: false, argumento: 'Igual a projetos já aprovados.', confianca: 0.85 },
      { dimensao: 'cetico', preocupa: true, argumento: 'O ganho é esperado, não medido.', confianca: 0.7 },
    ];
    const p = montarPareceresDaMesa({ ...votosBase, julgamentos } as never);
    expect(p).toHaveLength(4);
    expect(p.find((x) => x.dimensao === 'fte')!.argumento).toBe('Horas críveis para 1 pessoa.');
    expect(p.find((x) => x.dimensao === 'cetico')!.preocupa).toBe(true);
    expect(p.every((x) => x.argumento.length > 0)).toBe(true);
  });

  it('argumento longo é cortado no teto (a coluna `votos` não é depósito de texto)', () => {
    const longo = 'a'.repeat(900);
    const p = montarPareceresDaMesa({
      ...votosBase,
      julgamentos: [{ dimensao: 'fte', preocupa: true, argumento: longo, confianca: 0.5 }],
    } as never);
    expect(p.find((x) => x.dimensao === 'fte')!.argumento.length).toBe(ARGUMENTO_GRAVADO_MAX);
  });

  it('tranquilo sem motivo devolve argumento vazio (a tela diz "nada a apontar")', () => {
    const p = montarPareceresDaMesa(votosBase as never);
    expect(p.find((x) => x.dimensao === 'rag')!.argumento).toBe('');
  });
});

describe('serializarVotos grava os pareceres (é o que a ficha lê de volta)', () => {
  it('ida e volta: o que foi gravado é o que a ficha recebe', () => {
    const json = serializarVotos({
      ...votosBase,
      conciliado: { grau: 'media', ceticoRefutou: false },
    } as never);
    const lidos = pareceresDosVotos(json);
    expect(lidos).toHaveLength(4);
    expect(lidos.find((x) => x.dimensao === 'financeiro')!.argumento).toContain('Materialidade');
  });

  it('votos ANTIGO (sem `pareceres`), JSON inválido ou ausente → [] e a tela cai no motivo', () => {
    expect(pareceresDosVotos(JSON.stringify({ fte: {}, grau: 'alta' }))).toEqual([]);
    expect(pareceresDosVotos('{ nao é json')).toEqual([]);
    expect(pareceresDosVotos(null)).toEqual([]);
    expect(pareceresDosVotos(undefined)).toEqual([]);
  });

  it('item torto no meio da lista não derruba a leitura', () => {
    const json = JSON.stringify({
      pareceres: [null, { dimensao: 'fte', preocupa: 'sim', argumento: 7 }, { dimensao: 'rag', preocupa: true, argumento: 'ok', confianca: 0.5 }],
    });
    const lidos = pareceresDosVotos(json);
    expect(lidos).toHaveLength(2);
    // `preocupa` só é `true` quando é o booleano `true` (uma string não vira problema aceso).
    expect(lidos[0]).toEqual({ dimensao: 'fte', preocupa: false, argumento: '', confianca: null });
  });
});

describe('interpretarConsensoDoTime — a ESTRELA vem do time, não da mesa', () => {
  it('lê estrela, saída, confiança e motivos do consenso gravado', () => {
    const r = interpretarConsensoDoTime({
      saida: JSON.stringify({
        estrela: 4,
        saida: 'aprovar',
        confianca: 'alta',
        motivos: ['Mérito aprova e estrela 4.'],
        divergencias: [],
      }),
      confianca: 'alta',
      veredito: 'aprovar',
      created_at: '2026-09-08T12:00:00Z',
    });
    expect(r).toEqual({
      estrela: 4,
      saida: 'aprovar',
      confianca: 'alta',
      quando: '2026-09-08T12:00:00Z',
      motivos: ['Mérito aprova e estrela 4.'],
      divergencias: [],
    });
  });

  it('o time nunca ter rodado é `null`, não erro — é o estado NORMAL', () => {
    expect(interpretarConsensoDoTime(null)).toBeNull();
    expect(interpretarConsensoDoTime(undefined)).toBeNull();
  });

  it('JSON torto degrada em vez de derrubar a ficha', () => {
    const r = interpretarConsensoDoTime({ saida: 'não sou json', confianca: 'media', veredito: 'humano', created_at: null });
    expect(r?.estrela).toBeNull();
    expect(r?.saida).toBe('humano');
    expect(r?.motivos).toEqual([]);
  });
});

describe('canários da TELA (as duas queixas viraram teste)', () => {
  const ficha = readFileSync('src/components/dashboard/projeto-detalhe-dialog.tsx', 'utf8');
  /**
   * O clamp APLICADO (dentro de um `className`), não a palavra: os comentários que registram a
   * remoção dele podem, e devem, citá-lo.
   */
  const CLAMP_APLICADO = /className=(?:"[^"]*|\{`[^`]*)line-clamp/;

  it('o parecer dos agentes NÃO é truncado (nenhum line-clamp no painel de sombra)', () => {
    const painel = ficha.slice(ficha.indexOf('function ParecerDosAgentes'), ficha.indexOf('function LinhaSombra'));
    expect(painel).not.toMatch(CLAMP_APLICADO);
    // o histórico de rodadas também perdeu o clamp
    const delib = ficha.slice(ficha.indexOf('rodadasAbertas'), ficha.indexOf('Confere com o humano?'));
    expect(delib).not.toMatch(CLAMP_APLICADO);
  });

  it('a seção de sombra existe mesmo SEM avaliação (senão não há onde clicar para rodar)', () => {
    expect(ficha).not.toMatch(/\{detalhe\.avaliacaoSombra && \(\s*<Secao/);
    expect(ficha).toMatch(/onRodar=\{rodarAnalise\}/);
  });

  it('as duas ações reusam as rotas de admin que já existem (nenhuma rota nova)', () => {
    expect(ficha).toContain('/api/admin/avaliar-normais');
    expect(ficha).toContain('/api/admin/avaliacao/time');
  });

  it('rodar a análise invalida o cache de 30 s da ficha antes de recarregar', () => {
    const fn = ficha.slice(ficha.indexOf('async function rodarAnalise'), ficha.indexOf('const campos = detalhe?.campos'));
    expect(fn).toContain('invalidarDetalhe');
    expect(fn).toContain('recarregarDetalhe');
  });
});
