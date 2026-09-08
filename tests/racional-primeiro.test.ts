import { describe, it, expect } from 'vitest';

/**
 * CANÁRIO DO RACIONAL-PRIMEIRO (fatia (a) do plano `docs/plans/calibragem-time-avaliacao.md`,
 * achados A4 e D5).
 *
 * O que este arquivo trava:
 *
 * **T1** — nos 8 blocos "FORMATO … JSON" dos agentes que julgam, a chave de RACIOCÍNIO tem de
 * aparecer ANTES da chave de NÚMERO/BOOLEANO. Nenhuma chave é adicionada nem removida: o que se
 * verifica é só a ORDEM em que elas aparecem no texto do prompt.
 *
 * **T2** — o caso mais grave: em `buildSystemPromptEspecial`, `"confianca"` vem depois de
 * `"leitura"` (hoje o agente declara a confiança antes de raciocinar).
 *
 * **T3** — a 1ª passada do especialista julga CEGA: o prompt não cita o parecer dos outros.
 *
 * ⚠️ Toda comparação de posição é precedida da asserção de que as DUAS chaves existem — sem isso,
 * uma chave ausente daria `-1 < 0` e o teste passaria por acidente (falso-verde).
 */

import {
  buildPromptEspecialista,
  type EntradaEspecialista,
} from '@/lib/agents/especialista-avaliacao';
import { buildPromptEstrela, saidaEstrelaFallback } from '@/lib/avaliacao/cerebro-estrela';
import { buildPromptMerito, julgamentoFallback } from '@/lib/avaliacao/cerebro-merito';
import { buildSystemPromptLente, LENTES } from '@/lib/agents/especiais-lentes';
import { buildSystemPromptEspecial } from '@/lib/agents/especial-classificador';
import { buildSystemPromptRevisor } from '@/lib/agents/especiais-revisor';
import { buildPromptCeticoEstrela } from '@/lib/avaliacao/cetico-estrela';
import { buildPromptCetico } from '@/lib/avaliacao/time';

// ─── Fixtures mínimas ──────────────────────────────────────────────────────────

const ESTRELA = saidaEstrelaFallback('fixture do canário', { temVizinhos: true, notaHumana: null });

const VIZINHOS_ESTRELA = [
  { id: 'viz-1', nome: 'Painel do Fiscal', nota: 3, similaridade: 0.81, resumo: 'consolida notas' },
];

const VIZINHOS_MERITO = [
  {
    id: 'viz-1',
    nome: 'Painel do Fiscal',
    status: 'Aprovado',
    similaridade: 0.81,
    resumo: 'consolida notas',
  },
];

function entradaEspecialista(over: Partial<EntradaEspecialista> = {}): EntradaEspecialista {
  return {
    dimensao: 'financeiro',
    texto: {
      nome: 'Robô de Faturamento',
      area: 'Financeiro',
      descricao: 'Automatiza a emissão de notas.',
      o_que_faz: 'Emite e concilia notas fiscais.',
      memorial: 'Saving de 418h/mês para 2 pessoas.',
      doc: 'Documentação técnica do robô.',
    },
    voto: {
      preocupa: true,
      confianca: 0.3,
      motivo: 'Materialidade acima do teto.',
      sinais: ['materialidade'],
    },
    vizinhos: ['Projeto vizinho A aprovado'],
    licoes: '',
    outrosVotos: [
      { dimensao: 'fte', preocupa: true, argumento: 'FTE alto para 2 pessoas.' },
      { dimensao: 'rag', preocupa: false, argumento: 'Precedente aprovado sem ressalva.' },
    ],
    ...over,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

type Prompt = string | { role: string; content: string }[];

/** Só o texto a partir da linha que abre o bloco de FORMATO (é ali que a ordem das chaves vale). */
function textoDoBlocoFormato(prompt: Prompt): string {
  const partes = typeof prompt === 'string' ? [prompt] : prompt.map((m) => String(m.content));
  for (const parte of partes) {
    const m = /^FORMATO\b.*$/m.exec(parte);
    if (m && m.index !== undefined) return parte.slice(m.index);
  }
  throw new Error('Nenhuma mensagem do prompt abre um bloco de FORMATO');
}

/** Posição da chave JSON no texto (com as aspas, para `"nota"` não casar `"nota_sugerida"`). */
function posDaChave(texto: string, chave: string): number {
  return texto.indexOf(`"${chave}"`);
}

// ─── T1 — os 8 blocos de FORMATO ───────────────────────────────────────────────

type Caso = {
  nome: string;
  prompt: () => Prompt;
  raciocinio: string;
  numeros: string[];
};

const CASOS: Caso[] = [
  {
    nome: 'buildPromptEspecialista (agents/especialista-avaliacao.ts)',
    prompt: () => buildPromptEspecialista(entradaEspecialista()),
    raciocinio: 'argumento',
    numeros: ['preocupa', 'confianca'],
  },
  {
    nome: 'buildPromptEstrela (avaliacao/cerebro-estrela.ts)',
    prompt: () => buildPromptEstrela({ dossieTexto: 'dossiê do projeto', vizinhos: VIZINHOS_ESTRELA }),
    raciocinio: 'racional',
    numeros: ['nota'],
  },
  {
    nome: 'buildPromptMerito (avaliacao/cerebro-merito.ts)',
    prompt: () =>
      buildPromptMerito({
        dimensao: 'financeiro',
        dossieTexto: 'dossiê do projeto',
        vizinhos: VIZINHOS_MERITO,
      }),
    raciocinio: 'argumento',
    numeros: ['preocupa'],
  },
  ...LENTES.map((lente) => ({
    nome: `buildSystemPromptLente «${lente.rotulo}» (agents/especiais-lentes.ts)`,
    prompt: () => buildSystemPromptLente(lente),
    raciocinio: 'justificativa',
    numeros: ['nota', 'confianca'],
  })),
  {
    nome: 'buildSystemPromptEspecial (agents/especial-classificador.ts)',
    prompt: () => buildSystemPromptEspecial(),
    raciocinio: 'leitura',
    numeros: ['estrelas_recomendada', 'confianca'],
  },
  {
    nome: 'buildSystemPromptRevisor (agents/especiais-revisor.ts)',
    prompt: () => buildSystemPromptRevisor(),
    raciocinio: 'motivo',
    numeros: ['refutada'],
  },
  {
    nome: 'buildPromptCeticoEstrela (avaliacao/cetico-estrela.ts)',
    prompt: () =>
      buildPromptCeticoEstrela({
        dossieTexto: 'dossiê do projeto',
        estrela: ESTRELA,
        vizinhos: VIZINHOS_ESTRELA,
      }),
    raciocinio: 'motivo',
    numeros: ['refuta'],
  },
  {
    nome: 'buildPromptCetico (avaliacao/time.ts)',
    prompt: () =>
      buildPromptCetico({
        dossieTexto: 'dossiê do projeto',
        julgamentos: [julgamentoFallback('financeiro', 'sem resposta do modelo')],
        estrela: ESTRELA,
      }),
    raciocinio: 'motivo',
    numeros: ['refuta'],
  },
];

describe('T1 — racional-primeiro: o raciocínio vem ANTES do número em todo bloco de FORMATO', () => {
  for (const caso of CASOS) {
    it(`${caso.nome}: "${caso.raciocinio}" antes de ${caso.numeros.map((n) => `"${n}"`).join(' e ')}`, () => {
      const texto = textoDoBlocoFormato(caso.prompt());
      const posRaciocinio = posDaChave(texto, caso.raciocinio);

      // As duas chaves TÊM de existir antes de comparar posições (anti falso-verde).
      expect(
        posRaciocinio,
        `a chave "${caso.raciocinio}" não aparece no bloco de FORMATO`,
      ).toBeGreaterThanOrEqual(0);

      for (const numero of caso.numeros) {
        const posNumero = posDaChave(texto, numero);
        expect(posNumero, `a chave "${numero}" não aparece no bloco de FORMATO`).toBeGreaterThanOrEqual(0);
        expect(
          posRaciocinio,
          `"${caso.raciocinio}" (pos ${posRaciocinio}) deveria vir ANTES de "${numero}" (pos ${posNumero})`,
        ).toBeLessThan(posNumero);
      }
    });
  }

  it('cobre os 8 builders de prompt da fatia (a)', () => {
    // As 4 lentes compartilham o mesmo builder — o canário são 8 builders distintos.
    expect(CASOS.length).toBe(7 + LENTES.length);
    expect(LENTES.length).toBeGreaterThan(0);
  });
});

// ─── T2 — o caso mais grave ────────────────────────────────────────────────────

describe('T2 — o classificador de especiais não declara confiança antes de raciocinar', () => {
  it('"confianca" vem depois de "leitura" em buildSystemPromptEspecial', () => {
    const texto = textoDoBlocoFormato(buildSystemPromptEspecial());
    const posLeitura = posDaChave(texto, 'leitura');
    const posConfianca = posDaChave(texto, 'confianca');

    expect(posLeitura, 'a chave "leitura" não aparece no bloco de FORMATO').toBeGreaterThanOrEqual(0);
    expect(posConfianca, 'a chave "confianca" não aparece no bloco de FORMATO').toBeGreaterThanOrEqual(0);
    expect(
      posConfianca,
      `"confianca" (pos ${posConfianca}) deveria vir DEPOIS de "leitura" (pos ${posLeitura})`,
    ).toBeGreaterThan(posLeitura);
  });
});

// ─── T3 — a 1ª passada do especialista julga CEGA ──────────────────────────────

describe('T3 — o prompt do especialista não cita o parecer dos outros especialistas', () => {
  const SENTINELA = 'ZORVAX-QUIBBLE-4417 o FTE mastiga o teto';

  function textoInteiro(): string {
    return buildPromptEspecialista(
      entradaEspecialista({
        outrosVotos: [
          { dimensao: 'fte', preocupa: true, argumento: SENTINELA },
          { dimensao: 'rag', preocupa: false, argumento: 'PLIMTHORP-9902 precedente aprovado' },
        ],
      }),
    )
      .map((m) => String(m.content))
      .join('\n');
  }

  it('o argumento recebido em `outrosVotos` não aparece em nenhuma mensagem do prompt', () => {
    const texto = textoInteiro();
    expect(texto).not.toContain(SENTINELA);
    expect(texto).not.toContain('PLIMTHORP-9902');
  });

  it('não há cabeçalho apresentando o que os outros especialistas acharam', () => {
    const texto = textoInteiro();
    expect(texto).not.toMatch(/O QUE OS OUTROS ESPECIALISTAS ACHARAM/i);
  });

  it('a instrução de system não promete o parecer dos outros ao especialista', () => {
    const texto = textoInteiro();
    expect(texto).not.toMatch(/outros especialistas acharam/i);
  });
});
