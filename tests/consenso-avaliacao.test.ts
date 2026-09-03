// T16 — Cérebro C (consenso): `src/lib/avaliacao/consenso.ts`, módulo PURO que concilia a saída do
// Cérebro A (mérito) com a do Cérebro B (estrela) e decide se a avaliação AGE SOZINHA ou vai ao
// humano (plano `docs/plans/regua-estrelas-e-time-unificado.md`, §7 e §11.3; decisões D13, D14, D16).
//
// O que este arquivo PRENDE:
//  - `politicaDeLiberacao`: a autonomia (D13) só é liberada com MEDIÇÃO que bate a meta E flag
//    ligada — sem medição, amostra < 300, acerto abaixo da meta ou erro grave > 0 → NÃO libera, e o
//    motivo diz qual foi a trava; erro grave só vale para `aprovar`. Nunca lança.
//  - `conciliar`: caminho feliz (A aprova, B garante com evidência) → `aprovar` com confiança alta;
//    a confiança sai de `confiancaDe` com os 3 sinais declarados (concordam / evidência citada nos
//    DOIS / vizinhos em UM), e confiança baixa vai ao humano mesmo com A aprovando (D14);
//  - D16: escape VÁLIDO vai SEMPRE ao humano (comitê); escape indicado mas inválido não é escape;
//  - `ajuste` carrega as perguntas de A; A `humano` é terminal; debate que não fechou vai ao
//    humano; cético que refuta um `aprovar` derruba a autonomia (vira `humano`), mas concorda com
//    `ajuste`;
//  - divergência A×B: A aprova e B desqualifica por `fora_de_uso`/`ressubmissao` → humano com a
//    frase da divergência; `apenas_mensuravel` (projeto padrão sem estrela) NÃO é divergência;
//  - `vale_estrela === (estrela >= 1)`, âncora congelada não é regravada (e é citada), `valor` e
//    `contestacao` são repassados;
//  - `age_sozinho` depende da saída E da liberação; `humano` nunca age sozinho;
//  - `motivos` nunca vazio, frases sem travessão e com ponto final.
//
// Os tipos de ENTRADA (SaidaMerito/SaidaEstrela) são fabricados localmente de propósito: este teste
// não depende dos módulos dos cérebros A e B, que estão sendo escritos em paralelo.
import { describe, it, expect } from 'vitest';
import {
  conciliar,
  politicaDeLiberacao,
  METAS_LIBERACAO,
  type Liberacao,
  type Consenso,
} from '@/lib/avaliacao/consenso';
import type { SaidaMerito } from '@/lib/avaliacao/cerebro-merito';
import type { SaidaEstrela } from '@/lib/avaliacao/cerebro-estrela';

// ─── Tipos locais de entrada (espelham o contrato do plano; não importam os cérebros) ─────────

type SaidaMeritoLocal = {
  veredito: 'aprovar' | 'ajuste' | 'humano';
  julgamentos: unknown[];
  preocupacoes: string[];
  perguntas_ao_autor: string[];
  valor: { absurdo: boolean; valor_sugerido: number | null; justificativa: string } | null;
  ressalvas: string[];
  sinais: { temEvidenciaCitada: boolean; temVizinhos: boolean };
};

type SaidaEstrelaLocal = {
  nota: number;
  criterio_aplicado: string;
  desqualificador: string | null;
  evidencias: string[];
  sem_evidencia: boolean;
  promocao: { aplicada: boolean; dependente: string | null };
  escape: { indicado: boolean; valido: boolean; evidencias: Record<string, string> };
  tipo: string | null;
  nivel: string | null;
  racional: string;
  contestacao: unknown | null;
  ancora_congelada: boolean;
  sinais: { temEvidenciaCitada: boolean; temVizinhos: boolean };
};

// ─── Fábricas ────────────────────────────────────────────────────────────────

function merito(over: Partial<SaidaMeritoLocal> = {}): SaidaMerito {
  return {
    veredito: 'aprovar',
    julgamentos: [],
    preocupacoes: [],
    perguntas_ao_autor: [],
    valor: null,
    ressalvas: [],
    sinais: { temEvidenciaCitada: true, temVizinhos: true },
    ...over,
  } as unknown as SaidaMerito;
}

function estrela(over: Partial<SaidaEstrelaLocal> = {}): SaidaEstrela {
  return {
    nota: 3,
    criterio_aplicado: 'garante',
    desqualificador: null,
    evidencias: ['Doc §2: "o robô valida o CPF antes de gravar".'],
    sem_evidencia: false,
    promocao: { aplicada: false, dependente: null },
    escape: { indicado: false, valido: false, evidencias: {} },
    tipo: 'controle',
    nivel: 'garante',
    racional: 'Garante a integridade do cadastro sem intervenção humana.',
    contestacao: null,
    ancora_congelada: false,
    sinais: { temEvidenciaCitada: true, temVizinhos: true },
    ...over,
  } as unknown as SaidaEstrela;
}

const LIBERADO: Liberacao = { aprovar: true, ajuste: true, motivos: [] };
const TRAVADO: Liberacao = { aprovar: false, ajuste: false, motivos: ['Sem medição.'] };

function ctx(over: Partial<Parameters<typeof conciliar>[2]> = {}) {
  return { debateFechou: true, ceticoRefuta: false, liberacao: LIBERADO, ...over };
}

const contem = (frases: string[], re: RegExp) => frases.some((f) => re.test(f));

// ─── politicaDeLiberacao ─────────────────────────────────────────────────────

describe('politicaDeLiberacao (D13) — autonomia só com medição que bate a meta E flag ligada', () => {
  it('METAS_LIBERACAO declara as metas do plano', () => {
    expect(METAS_LIBERACAO.aprovar).toEqual({ acerto_min: 0.9, erro_grave_max: 0, n_min: 300 });
    expect(METAS_LIBERACAO.ajuste).toEqual({ acerto_min: 0.85, n_min: 300 });
  });

  it('sem medição (null) não libera nada, mesmo com as duas flags ligadas', () => {
    const r = politicaDeLiberacao(null, { liberarAprovar: true, liberarAjuste: true });
    expect(r.aprovar).toBe(false);
    expect(r.ajuste).toBe(false);
    expect(contem(r.motivos, /sem medi|n[aã]o medid/i)).toBe(true);
  });

  it('medição batendo a meta mas flag desligada → não libera e o motivo cita a flag', () => {
    const r = politicaDeLiberacao({ aprovar: { acerto: 0.95, erro_grave: 0, n: 300 } }, {});
    expect(r.aprovar).toBe(false);
    expect(contem(r.motivos, /flag/i)).toBe(true);
  });

  it('meta batida E flag ligada → aprovar liberado', () => {
    const r = politicaDeLiberacao(
      { aprovar: { acerto: 0.95, erro_grave: 0, n: 300 } },
      { liberarAprovar: true },
    );
    expect(r.aprovar).toBe(true);
  });

  it('amostra abaixo de 300 → não libera e o motivo cita a amostra', () => {
    const r = politicaDeLiberacao(
      { aprovar: { acerto: 0.95, erro_grave: 0, n: 299 } },
      { liberarAprovar: true },
    );
    expect(r.aprovar).toBe(false);
    expect(contem(r.motivos, /amostra/i)).toBe(true);
  });

  it('acerto 0.89 (abaixo de 0.9) → não libera aprovar', () => {
    const r = politicaDeLiberacao(
      { aprovar: { acerto: 0.89, erro_grave: 0, n: 300 } },
      { liberarAprovar: true },
    );
    expect(r.aprovar).toBe(false);
  });

  it('1 erro grave → não libera aprovar e o motivo cita "erro grave"', () => {
    const r = politicaDeLiberacao(
      { aprovar: { acerto: 0.99, erro_grave: 1, n: 300 } },
      { liberarAprovar: true },
    );
    expect(r.aprovar).toBe(false);
    expect(contem(r.motivos, /erro grave/i)).toBe(true);
  });

  it('ajuste: acerto 0.85 com n 300 e flag → liberado (erro grave não se aplica ao ajuste)', () => {
    const r = politicaDeLiberacao(
      { ajuste: { acerto: 0.85, erro_grave: 7, n: 300 } },
      { liberarAjuste: true },
    );
    expect(r.ajuste).toBe(true);
  });

  it('as duas dimensões são independentes: aprovar liberado não libera ajuste', () => {
    const r = politicaDeLiberacao(
      { aprovar: { acerto: 0.95, erro_grave: 0, n: 300 } },
      { liberarAprovar: true, liberarAjuste: true },
    );
    expect(r.aprovar).toBe(true);
    expect(r.ajuste).toBe(false);
  });

  it('nunca lança com objeto vazio', () => {
    expect(() => politicaDeLiberacao({}, {})).not.toThrow();
    const r = politicaDeLiberacao({}, {});
    expect(r.aprovar).toBe(false);
    expect(r.ajuste).toBe(false);
    expect(r.motivos.length).toBeGreaterThan(0);
  });
});

// ─── conciliar ───────────────────────────────────────────────────────────────

describe('conciliar — caminho feliz', () => {
  it('A aprova, B garante 3 com evidência, tudo fechado e liberado → aprovar com confiança alta', () => {
    const c = conciliar(merito(), estrela(), ctx());
    expect(c.saida).toBe('aprovar');
    expect(c.veredito_merito).toBe('aprovar');
    expect(c.estrela).toBe(3);
    expect(c.vale_estrela).toBe(true);
    expect(c.escape).toBe(false);
    expect(c.confianca).toBe('alta');
    expect(c.divergencias).toEqual([]);
    expect(c.age_sozinho).toBe(true);
  });
});

describe('conciliar — confiança declarada (confiancaDe) e D14', () => {
  it('B sem evidência citada → confiança media (falta 1 sinal); ainda aprova', () => {
    const c = conciliar(
      merito(),
      estrela({ sem_evidencia: true, evidencias: [], sinais: { temEvidenciaCitada: false, temVizinhos: true } }),
      ctx(),
    );
    expect(c.confianca).toBe('media');
    expect(c.saida).toBe('aprovar');
  });

  it('evidência citada exige os DOIS cérebros: A sem evidência já baixa para media', () => {
    const c = conciliar(merito({ sinais: { temEvidenciaCitada: false, temVizinhos: true } }), estrela(), ctx());
    expect(c.confianca).toBe('media');
  });

  it('vizinhos basta em UM cérebro: só A com vizinhos mantém alta', () => {
    const c = conciliar(
      merito({ sinais: { temEvidenciaCitada: true, temVizinhos: true } }),
      estrela({ sinais: { temEvidenciaCitada: true, temVizinhos: false } }),
      ctx(),
    );
    expect(c.confianca).toBe('alta');
  });

  it('sem evidência E sem vizinhos → baixa → humano mesmo com A aprovando (D14)', () => {
    const c = conciliar(
      merito({ sinais: { temEvidenciaCitada: false, temVizinhos: false } }),
      estrela({ sem_evidencia: true, evidencias: [], sinais: { temEvidenciaCitada: false, temVizinhos: false } }),
      ctx(),
    );
    expect(c.confianca).toBe('baixa');
    expect(c.saida).toBe('humano');
    expect(c.veredito_merito).toBe('aprovar');
    expect(c.age_sozinho).toBe(false);
    expect(contem(c.motivos, /confian[çc]a/i)).toBe(true);
  });
});

describe('conciliar — D16 escape vai SEMPRE ao humano', () => {
  it('escape indicado e válido (nota 5) → humano, escape true, motivo cita comitê', () => {
    const c = conciliar(
      merito(),
      estrela({
        nota: 5,
        escape: { indicado: true, valido: true, evidencias: { muda_o_jogo: 'Doc §4: 12 áreas usam.' } },
      }),
      ctx(),
    );
    expect(c.saida).toBe('humano');
    expect(c.escape).toBe(true);
    expect(c.estrela).toBe(5);
    expect(c.age_sozinho).toBe(false);
    expect(contem(c.motivos, /comit[êe]/i)).toBe(true);
  });

  it('escape indicado mas inválido → NÃO é escape', () => {
    const c = conciliar(
      merito(),
      estrela({ escape: { indicado: true, valido: false, evidencias: {} } }),
      ctx(),
    );
    expect(c.escape).toBe(false);
    expect(c.saida).toBe('aprovar');
  });
});

describe('conciliar — veredito de A conduz a saída', () => {
  it('A ajuste com perguntas → ajuste, carrega as perguntas, age sozinho se ajuste liberado', () => {
    const perguntas = ['Quantas horas por semana o time gastava antes?', 'Onde o número é conferido?'];
    const c = conciliar(merito({ veredito: 'ajuste', perguntas_ao_autor: perguntas }), estrela(), ctx());
    expect(c.saida).toBe('ajuste');
    expect(c.veredito_merito).toBe('ajuste');
    expect(c.perguntas_ao_autor).toEqual(perguntas);
    expect(c.age_sozinho).toBe(true);
  });

  it('A ajuste com liberação de ajuste desligada → age_sozinho false', () => {
    const c = conciliar(
      merito({ veredito: 'ajuste', perguntas_ao_autor: ['Qual o volume mensal?'] }),
      estrela(),
      ctx({ liberacao: { aprovar: true, ajuste: false, motivos: ['Flag de ajuste desligada.'] } }),
    );
    expect(c.saida).toBe('ajuste');
    expect(c.age_sozinho).toBe(false);
  });

  it('A humano → humano', () => {
    const c = conciliar(merito({ veredito: 'humano' }), estrela(), ctx());
    expect(c.saida).toBe('humano');
    expect(c.veredito_merito).toBe('humano');
    expect(c.age_sozinho).toBe(false);
  });
});

describe('conciliar — debate e cético', () => {
  it('debate que não fechou → humano, motivo cita o debate', () => {
    const c = conciliar(merito(), estrela(), ctx({ debateFechou: false }));
    expect(c.saida).toBe('humano');
    expect(c.age_sozinho).toBe(false);
    expect(contem(c.motivos, /debate/i)).toBe(true);
  });

  it('cético refuta um aprovar → divergência cita o cético e a saída deixa de ser aprovar (vira humano)', () => {
    const c = conciliar(merito(), estrela(), ctx({ ceticoRefuta: true }));
    expect(contem(c.divergencias, /c[ée]tico/i)).toBe(true);
    expect(c.saida).not.toBe('aprovar');
    expect(c.saida).toBe('humano');
    expect(c.age_sozinho).toBe(false);
  });

  it('cético refuta um ajuste → segue ajuste (o cético concorda que não está pronto)', () => {
    const c = conciliar(
      merito({ veredito: 'ajuste', perguntas_ao_autor: ['Qual o volume mensal?'] }),
      estrela(),
      ctx({ ceticoRefuta: true }),
    );
    expect(c.saida).toBe('ajuste');
  });
});

describe('conciliar — divergência A×B', () => {
  it('A aprova e B desqualifica por fora_de_uso → divergência cita fora de uso/parado, saída humano', () => {
    const c = conciliar(
      merito(),
      estrela({ nota: 0, criterio_aplicado: 'piso_zero', desqualificador: 'fora_de_uso', nivel: null }),
      ctx(),
    );
    expect(contem(c.divergencias, /fora de uso|parad/i)).toBe(true);
    expect(c.saida).toBe('humano');
    expect(c.age_sozinho).toBe(false);
  });

  it('A aprova e B desqualifica por ressubmissao → divergência cita ressubmissão/duplicado, saída humano', () => {
    const c = conciliar(
      merito(),
      estrela({ nota: 0, criterio_aplicado: 'piso_zero', desqualificador: 'ressubmissao', nivel: null }),
      ctx(),
    );
    expect(contem(c.divergencias, /ressubmiss[ãa]o|duplicad/i)).toBe(true);
    expect(c.saida).toBe('humano');
  });

  it('A aprova e B nota 0 por apenas_mensuravel → NÃO é divergência: aprova sem estrela', () => {
    const c = conciliar(
      merito(),
      estrela({ nota: 0, criterio_aplicado: 'piso_zero', desqualificador: 'apenas_mensuravel', nivel: null }),
      ctx(),
    );
    expect(c.divergencias).toEqual([]);
    expect(c.saida).toBe('aprovar');
    expect(c.estrela).toBe(0);
    expect(c.vale_estrela).toBe(false);
  });
});

describe('conciliar — estrela, âncora e repasses', () => {
  it('vale_estrela é exatamente (estrela >= 1)', () => {
    for (const nota of [0, 1, 2, 3, 4, 5]) {
      const c = conciliar(merito(), estrela({ nota }), ctx());
      expect(c.estrela).toBe(nota);
      expect(c.vale_estrela).toBe(nota >= 1);
    }
  });

  it('âncora congelada: a estrela continua a de B e o motivo cita a âncora', () => {
    const c = conciliar(merito(), estrela({ nota: 4, ancora_congelada: true }), ctx());
    expect(c.estrela).toBe(4);
    expect(contem(c.motivos, /[âa]ncora/i)).toBe(true);
  });

  it('contestacao vem de B e valor vem de A, repassados sem mexer', () => {
    const contestacao = { alvo: 'PIAPP', racional: 'O vizinho faz menos e tem 10.' };
    const valor = { absurdo: true, valor_sugerido: 1200, justificativa: 'Horas acima do teto CLT.' };
    const c = conciliar(merito({ valor }), estrela({ contestacao }), ctx());
    expect(c.contestacao).toEqual(contestacao);
    expect(c.valor).toEqual(valor);
  });
});

describe('conciliar — age_sozinho depende da saída E da liberação', () => {
  it('aprovar com liberação de aprovar desligada → false', () => {
    const c = conciliar(merito(), estrela(), ctx({ liberacao: TRAVADO }));
    expect(c.saida).toBe('aprovar');
    expect(c.age_sozinho).toBe(false);
  });

  it('humano nunca age sozinho, mesmo com tudo liberado', () => {
    const c = conciliar(merito({ veredito: 'humano' }), estrela(), ctx({ liberacao: LIBERADO }));
    expect(c.saida).toBe('humano');
    expect(c.age_sozinho).toBe(false);
  });

  it('ajuste com liberação de ajuste ligada → true', () => {
    const c = conciliar(
      merito({ veredito: 'ajuste', perguntas_ao_autor: ['Qual o volume mensal?'] }),
      estrela(),
      ctx({ liberacao: { aprovar: false, ajuste: true, motivos: [] } }),
    );
    expect(c.age_sozinho).toBe(true);
  });
});

describe('conciliar — motivos nunca vazios, sem travessão, com ponto final', () => {
  const casos: Array<[string, () => Consenso]> = [
    ['caminho feliz', () => conciliar(merito(), estrela(), ctx())],
    ['confiança baixa', () =>
      conciliar(
        merito({ sinais: { temEvidenciaCitada: false, temVizinhos: false } }),
        estrela({ sinais: { temEvidenciaCitada: false, temVizinhos: false } }),
        ctx(),
      )],
    ['escape válido', () =>
      conciliar(merito(), estrela({ nota: 5, escape: { indicado: true, valido: true, evidencias: { x: 'y' } } }), ctx())],
    ['ajuste', () => conciliar(merito({ veredito: 'ajuste', perguntas_ao_autor: ['Qual o volume?'] }), estrela(), ctx())],
    ['A humano', () => conciliar(merito({ veredito: 'humano' }), estrela(), ctx())],
    ['debate aberto', () => conciliar(merito(), estrela(), ctx({ debateFechou: false }))],
    ['cético refuta', () => conciliar(merito(), estrela(), ctx({ ceticoRefuta: true }))],
    ['fora de uso', () => conciliar(merito(), estrela({ nota: 0, desqualificador: 'fora_de_uso' }), ctx())],
    ['âncora congelada', () => conciliar(merito(), estrela({ ancora_congelada: true }), ctx())],
    ['liberação travada', () => conciliar(merito(), estrela(), ctx({ liberacao: TRAVADO }))],
  ];

  for (const [nome, fabrica] of casos) {
    it(`${nome}: motivos não vazio, sem travessão e cada frase termina em ponto`, () => {
      const c = fabrica();
      expect(c.motivos.length).toBeGreaterThan(0);
      for (const m of [...c.motivos, ...c.divergencias]) {
        expect(m).not.toMatch(/—/);
        expect(m).not.toMatch(/ - /);
        expect(m.trim()).toMatch(/[.!?]$/);
      }
    });
  }
});
