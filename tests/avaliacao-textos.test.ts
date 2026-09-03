/**
 * TRÊS TEXTOS PRONTOS da avaliação unificada (T17, §11.3 do plano `regua-estrelas-e-time-unificado.md`;
 * D16, dossiê de comitê) — `src/lib/avaliacao/textos.ts`, módulo PURO.
 *
 * O time (cérebro A = mérito, cérebro B = estrela, consenso) produz JULGAMENTO; quem fala com gente é
 * este módulo, em 3 públicos com réguas diferentes:
 *
 *   1. `textoJustificativaInterna` — para a triagem/admin. PODE ter R$. Precisa ser AUDITÁVEL: saída,
 *      estrela, critério, cada evidência, cada preocupação, divergências, motivos e a auditoria de valor.
 *      Julgamento `fallback:true` é declarado como "sem resposta do agente" (nunca passa por parecer).
 *   2. `textoAoAutor` — só existe no AJUSTE (aprovar/humano → `null`). Segue a régua de
 *      `mensagens-submissao.ts`: diz o que aconteceu, por quê, e termina em "Para corrigir…"; NUNCA expõe
 *      R$ (valor/hora por cargo é escondido do submissor — 3 camadas, ver memória); NUNCA mostra a máquina
 *      (agente/LLM/cético/cérebro/consenso); curto (≤ 1.200 chars).
 *   3. `dossieDeComite` — para o comitê que decide 6–10 (escape) ou desempata humano. Traz o resumo, a
 *      nota do time, os gatilhos de escape com evidência, os PARES ordenados por nota DESC e uma frase
 *      "O time lê … acima/abaixo/no nível de <par>". PODE ter R$.
 *
 * Transversal: nenhum texto tem travessão "—" (fonte única `semTravessao`, `mesa-parecer.ts`), nem
 * "undefined"/"null"/"[object Object]" vazando de campo opcional.
 * `ocultarValoresMonetarios` é a fonte única da sanitização de R$ ("R$ 1.234,56", "R$1234", "147,40/hora").
 */
import { describe, it, expect } from "vitest";
import {
  textoJustificativaInterna,
  textoAoAutor,
  dossieDeComite,
  ocultarValoresMonetarios,
  type ParComite,
} from "@/lib/avaliacao/textos";
import type { Consenso } from "@/lib/avaliacao/consenso";
import type { SaidaMerito } from "@/lib/avaliacao/cerebro-merito";
import type { SaidaEstrela } from "@/lib/avaliacao/cerebro-estrela";

// ─── Tipos LOCAIS de entrada (espelham cerebro-merito / cerebro-estrela / consenso, escritos em paralelo) ──

type Veredito = "aprovar" | "ajuste" | "humano";
type Valor = { absurdo: boolean; valor_sugerido: number | null; justificativa: string } | null;

type ConsensoLocal = {
  saida: Veredito;
  veredito_merito: Veredito;
  estrela: number;
  vale_estrela: boolean;
  escape: boolean;
  confianca: "alta" | "media" | "baixa";
  divergencias: string[];
  motivos: string[];
  perguntas_ao_autor: string[];
  valor: Valor;
  contestacao: unknown | null;
  age_sozinho: boolean;
};

type Julgamento = {
  dimensao: string;
  preocupa: boolean;
  argumento: string;
  evidencias: string[];
  pergunta_ao_autor: string | null;
  valor: unknown | null;
  fallback: boolean;
};

type SaidaMeritoLocal = {
  veredito: Veredito;
  julgamentos: Julgamento[];
  preocupacoes: string[];
  perguntas_ao_autor: string[];
  valor: Valor;
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

const PROJETO = { id: "abc123", nome: "Portal de Reembolsos" };

function consenso(over: Partial<ConsensoLocal> = {}): Consenso {
  return {
    saida: "aprovar",
    veredito_merito: "aprovar",
    estrela: 3,
    vale_estrela: true,
    escape: false,
    confianca: "alta",
    divergencias: [],
    motivos: [],
    perguntas_ao_autor: [],
    valor: null,
    contestacao: null,
    age_sozinho: true,
    ...over,
  } as unknown as Consenso;
}

function julgamento(over: Partial<Julgamento> = {}): Julgamento {
  return {
    dimensao: "recorrencia",
    preocupa: false,
    argumento: "Roda toda semana desde março.",
    evidencias: ["fluxo: cron semanal"],
    pergunta_ao_autor: null,
    valor: null,
    fallback: false,
    ...over,
  };
}

function merito(over: Partial<SaidaMeritoLocal> = {}): SaidaMerito {
  return {
    veredito: "aprovar",
    julgamentos: [julgamento()],
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
    criterio_aplicado: "garante: a automação garante o resultado sem revisão humana",
    desqualificador: null,
    evidencias: ["Pagamento sai direto para o fornecedor (fluxo, passo 4)", "Zero retrabalho registrado no memorial"],
    sem_evidencia: false,
    promocao: { aplicada: false, dependente: null },
    escape: { indicado: false, valido: false, evidencias: {} },
    tipo: "operacao",
    nivel: "garante",
    racional: "Executa e garante o pagamento correto.",
    contestacao: null,
    ancora_congelada: false,
    sinais: { temEvidenciaCitada: true, temVizinhos: true },
    ...over,
  } as unknown as SaidaEstrela;
}

const SEM_VAZAMENTO = ["undefined", "null", "[object Object]"];
function semVazamento(texto: string) {
  for (const marca of SEM_VAZAMENTO) expect(texto, `vazou "${marca}"`).not.toContain(marca);
}

// ─── 1. ocultarValoresMonetarios ─────────────────────────────────────────────────────────────────

describe("ocultarValoresMonetarios (fonte única da sanitização de R$)", () => {
  it("troca R$ com milhar/decimal, R$ colado e valor/hora por [valor], preservando as horas", () => {
    const saida = ocultarValoresMonetarios("Saving de R$ 8.844,00 com R$147,40/hora e 60 h");
    expect(saida).not.toContain("R$");
    expect(saida).not.toContain("8.844");
    expect(saida).not.toContain("147,40");
    expect(saida).toContain("60 h");
    expect(saida).toContain("[valor]");
  });

  it("R$ sem espaço e sem centavos também é ocultado", () => {
    const saida = ocultarValoresMonetarios("Custo de R$1234 por mês");
    expect(saida).not.toContain("R$");
    expect(saida).not.toContain("1234");
    expect(saida).toContain("[valor]");
  });

  it("texto sem valores monetários volta inalterado", () => {
    const original = "Roda 3 vezes por semana e economiza 12 h/mês de 2 analistas.";
    expect(ocultarValoresMonetarios(original)).toBe(original);
  });
});

// ─── 2. textoJustificativaInterna ─────────────────────────────────────────────────────────────────

describe("textoJustificativaInterna (auditável, uso interno)", () => {
  const CONSENSO = consenso({
    saida: "ajuste",
    veredito_merito: "ajuste",
    estrela: 3,
    divergencias: ["A pede ajuste e B dá 3 estrelas com evidência"],
    motivos: ["Horas por pessoa acima do teto de 220 h"],
    valor: { absurdo: true, valor_sugerido: 8844, justificativa: "Contrato pagava justamente essas horas" },
  });
  const MERITO = merito({
    veredito: "ajuste",
    julgamentos: [
      julgamento({ dimensao: "plausibilidade", preocupa: true, argumento: "Uma pessoa não executa 500 h por mês." }),
      julgamento({ dimensao: "recorrencia", preocupa: false, argumento: "Roda toda semana desde março." }),
      julgamento({ dimensao: "rastreabilidade", preocupa: true, argumento: "", evidencias: [], fallback: true }),
    ],
  });
  const ESTRELA = estrela();

  const texto = () => textoJustificativaInterna({ projeto: PROJETO, consenso: CONSENSO, merito: MERITO, estrela: ESTRELA });

  it("cita o projeto, a saída em português e a estrela por extenso", () => {
    const t = texto();
    expect(t).toContain("Portal de Reembolsos");
    expect(t).toContain("Pedir ajuste");
    expect(t).toContain("3 estrelas");
  });

  it("saída 'aprovar' → 'Aprovar'; 'humano' → 'Encaminhar ao humano'", () => {
    const aprovar = textoJustificativaInterna({ projeto: PROJETO, consenso: consenso({ saida: "aprovar" }), merito: merito(), estrela: ESTRELA });
    expect(aprovar).toContain("Aprovar");
    const humano = textoJustificativaInterna({ projeto: PROJETO, consenso: consenso({ saida: "humano" }), merito: merito(), estrela: ESTRELA });
    expect(humano).toContain("Encaminhar ao humano");
  });

  it("estrela 0 → 'sem estrela'; 1 → '1 estrela' (singular)", () => {
    const zero = textoJustificativaInterna({ projeto: PROJETO, consenso: consenso({ estrela: 0, vale_estrela: false }), merito: merito(), estrela: estrela({ nota: 0 }) });
    expect(zero).toContain("sem estrela");
    expect(zero).not.toMatch(/0 estrelas?/);
    const uma = textoJustificativaInterna({ projeto: PROJETO, consenso: consenso({ estrela: 1 }), merito: merito(), estrela: estrela({ nota: 1 }) });
    expect(uma).toContain("1 estrela");
    expect(uma).not.toContain("1 estrelas");
  });

  it("traz o critério aplicado e CADA evidência de B", () => {
    const t = texto();
    expect(t).toContain(ESTRELA.criterio_aplicado);
    for (const ev of ESTRELA.evidencias) expect(t).toContain(ev);
  });

  it("traz cada julgamento de A que PREOCUPA (dimensão + argumento)", () => {
    const t = texto();
    expect(t).toContain("plausibilidade");
    expect(t).toContain("Uma pessoa não executa 500 h por mês.");
  });

  it("julgamento fallback:true aparece como 'sem resposta do agente'", () => {
    const t = texto();
    expect(t).toContain("rastreabilidade");
    expect(t).toContain("sem resposta do agente");
  });

  it("traz as divergências, os motivos e a auditoria de valor (valor_sugerido + justificativa)", () => {
    const t = texto();
    expect(t).toContain("A pede ajuste e B dá 3 estrelas com evidência");
    expect(t).toContain("Horas por pessoa acima do teto de 220 h");
    expect(t).toMatch(/8\.844|8844/);
    expect(t).toContain("Contrato pagava justamente essas horas");
  });

  it("não tem travessão e nada vaza (undefined/null/[object Object])", () => {
    const t = texto();
    expect(t).not.toContain("—");
    semVazamento(t);
  });
});

// ─── 3. textoAoAutor ──────────────────────────────────────────────────────────────────────────────

describe("textoAoAutor (só no ajuste; sem R$; sem a máquina; termina em 'Para corrigir')", () => {
  const PERGUNTAS = ["Como uma pessoa executava 500 h por mês?", "Seu saving de R$ 8.844,00 usa quantas pessoas?"];
  const PALAVRAS_DA_MAQUINA = ["agente", "LLM", "cético", "cérebro", "consenso"];

  it("saída 'aprovar' → null", () => {
    expect(textoAoAutor({ projeto: PROJETO, consenso: consenso({ saida: "aprovar" }), merito: merito() })).toBeNull();
  });

  it("saída 'humano' → null (o autor só é acionado no ajuste)", () => {
    expect(textoAoAutor({ projeto: PROJETO, consenso: consenso({ saida: "humano", veredito_merito: "humano" }), merito: merito({ veredito: "humano" }) })).toBeNull();
  });

  describe("saída 'ajuste' com perguntas", () => {
    const t = () =>
      textoAoAutor({
        projeto: PROJETO,
        consenso: consenso({ saida: "ajuste", veredito_merito: "ajuste", perguntas_ao_autor: PERGUNTAS }),
        merito: merito({ veredito: "ajuste", perguntas_ao_autor: PERGUNTAS }),
      });

    it("devolve texto com o nome do projeto e as 2 perguntas (a 2ª SANITIZADA)", () => {
      const texto = t();
      expect(texto).not.toBeNull();
      expect(texto!).toContain("Portal de Reembolsos");
      expect(texto!).toContain("Como uma pessoa executava 500 h por mês?");
      expect(texto!).toContain("usa quantas pessoas?");
      expect(texto!).not.toContain("8.844");
    });

    it("NUNCA expõe R$ em lugar nenhum", () => {
      expect(t()!).not.toContain("R$");
    });

    it("não tem travessão", () => {
      expect(t()!).not.toContain("—");
    });

    it("a última seção começa por 'Para corrigir'", () => {
      const texto = t()!;
      expect(texto).toContain("Para corrigir");
      const depois = texto.slice(texto.lastIndexOf("Para corrigir"));
      // Nada estrutural depois da orientação: sem novo título/seção (linha em branco seguida de texto)
      expect(depois.trim()).not.toMatch(/\n\s*\n/);
    });

    it("diz que o projeto aguarda ajuste / está em validação", () => {
      expect(t()!).toMatch(/em validação|aguardando ajuste/i);
    });

    it("não mostra a máquina (agente/LLM/cético/cérebro/consenso)", () => {
      const texto = t()!.toLowerCase();
      for (const palavra of PALAVRAS_DA_MAQUINA) expect(texto, `citou "${palavra}"`).not.toContain(palavra.toLowerCase());
    });

    it("tem no máximo 1.200 caracteres", () => {
      expect(t()!.length).toBeLessThanOrEqual(1200);
    });

    it("nada vaza (undefined/null/[object Object])", () => {
      semVazamento(t()!);
    });
  });

  describe("saída 'ajuste' SEM perguntas → usa os motivos do consenso, sanitizados", () => {
    const MOTIVOS = ["O total de horas soma R$ 12.621,74 acima do que o contrato cobria", "Falta dizer onde o número é conferido"];
    const t = () =>
      textoAoAutor({
        projeto: PROJETO,
        consenso: consenso({ saida: "ajuste", veredito_merito: "ajuste", perguntas_ao_autor: [], motivos: MOTIVOS }),
        merito: merito({ veredito: "ajuste", perguntas_ao_autor: [] }),
      });

    it("ainda devolve texto (não null), com os motivos", () => {
      const texto = t();
      expect(texto).not.toBeNull();
      expect(texto!).toContain("Falta dizer onde o número é conferido");
      expect(texto!).toContain("acima do que o contrato cobria");
    });

    it("sanitiza o R$ dos motivos e mantém 'Para corrigir'", () => {
      const texto = t()!;
      expect(texto).not.toContain("R$");
      expect(texto).not.toContain("12.621");
      expect(texto).toContain("Para corrigir");
      expect(texto).not.toContain("—");
      semVazamento(texto);
    });
  });
});

// ─── 4. dossieDeComite ────────────────────────────────────────────────────────────────────────────

describe("dossieDeComite (D16: quem decide 6 a 10 ou desempata o humano)", () => {
  const RESUMO = "Portal que valida e paga reembolsos de 4 marcas sem passar por analista.";
  const PARES: ParComite[] = [
    { nome: "Agente precificador", nota: 4, resumo: "Precifica SKUs de 2 marcas." },
    { nome: "PIAPP", nota: 10, resumo: "Plataforma de IA que sustenta 3 times." },
    { nome: "Prisma", nota: 5, resumo: "Roteia atendimentos." },
  ];

  const ESCAPE = {
    consenso: consenso({ saida: "humano", estrela: 5, escape: true, confianca: "media", divergencias: ["B indica escape e A não vê rastro do sem_volta"] }),
    merito: merito(),
    estrela: estrela({
      nota: 5,
      escape: {
        indicado: true,
        valido: true,
        evidencias: {
          nao_existiria: "Sem o portal, o reembolso multimarca não teria sido lançado (doc, seção Contexto).",
          sem_volta: "A terceirizada foi encerrada em junho e o time não foi reposto.",
        },
      },
    }),
  };

  const dossie = (over: Partial<Parameters<typeof dossieDeComite>[0]> = {}) =>
    dossieDeComite({ projeto: PROJETO, ...ESCAPE, pares: PARES, resumoProjeto: RESUMO, ...over });

  it("título com o nome do projeto e 'comitê'; traz o resumo do projeto", () => {
    const d = dossie();
    const primeiraLinha = d.trim().split("\n")[0];
    expect(primeiraLinha).toContain("Portal de Reembolsos");
    expect(primeiraLinha.toLowerCase()).toContain("comitê");
    expect(d).toContain(RESUMO);
  });

  it("cita a nota do time ('5 estrelas') e a faixa '6 a 10' quando há escape", () => {
    const d = dossie();
    expect(d).toContain("5 estrelas");
    expect(d).toContain("6 a 10");
  });

  it("cita a evidência de CADA gatilho de escape (nao_existiria, sem_volta)", () => {
    const d = dossie();
    expect(d).toContain("Sem o portal, o reembolso multimarca não teria sido lançado (doc, seção Contexto).");
    expect(d).toContain("A terceirizada foi encerrada em junho e o time não foi reposto.");
  });

  it("lista os pares com nome e nota, ordenados por nota DESC", () => {
    const d = dossie();
    expect(d).toContain("PIAPP (10 estrelas)");
    expect(d).toContain("Prisma (5 estrelas)");
    expect(d).toContain("Agente precificador (4 estrelas)");
    const iPiapp = d.indexOf("PIAPP (10 estrelas)");
    const iPrisma = d.indexOf("Prisma (5 estrelas)");
    const iPrec = d.indexOf("Agente precificador (4 estrelas)");
    expect(iPiapp).toBeLessThan(iPrisma);
    expect(iPrisma).toBeLessThan(iPrec);
  });

  it("frase de comparação começa com 'O time lê' e cita acima/abaixo/no nível de um par", () => {
    const d = dossie();
    const frase = d.split("\n").find((l) => l.trim().startsWith("O time lê"));
    expect(frase, "não achou linha começando por 'O time lê'").toBeDefined();
    expect(frase!).toMatch(/acima|abaixo|no nível/);
    expect(PARES.some((p) => frase!.includes(p.nome))).toBe(true);
  });

  it("sem pares → diz que não há par na faixa, e ainda assim não vaza nada", () => {
    const d = dossie({ pares: [] });
    expect(d.toLowerCase()).toMatch(/sem par|nenhum par/);
    expect(d).not.toMatch(/^O time lê .*(acima|abaixo|no nível)/m);
    semVazamento(d);
  });

  it("traz as divergências e a confiança", () => {
    const d = dossie();
    expect(d).toContain("B indica escape e A não vê rastro do sem_volta");
    expect(d.toLowerCase()).toMatch(/confian[çc]a/);
    expect(d.toLowerCase()).toContain("média");
  });

  it("não tem travessão e nada vaza", () => {
    const d = dossie();
    expect(d).not.toContain("—");
    semVazamento(d);
  });

  it("PODE conter R$ (é para o comitê): o resumo com valor passa inteiro", () => {
    const d = dossie({ resumoProjeto: "Elimina contrato de R$ 8.844,00/mês da terceirizada." });
    expect(d).toContain("R$ 8.844,00");
  });

  it("escape false + saída 'humano' (divergência/baixa confiança) → dossiê existe e cita cada motivo do encaminhamento", () => {
    const MOTIVOS = ["A e B divergem em 2 níveis", "Confiança baixa: só 1 evidência citada"];
    const d = dossieDeComite({
      projeto: PROJETO,
      consenso: consenso({ saida: "humano", estrela: 2, escape: false, confianca: "baixa", motivos: MOTIVOS, divergencias: ["A vê 0, B vê 2"] }),
      merito: merito({ veredito: "humano" }),
      estrela: estrela({ nota: 2 }),
      pares: PARES,
      resumoProjeto: RESUMO,
    });
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(0);
    for (const m of MOTIVOS) expect(d).toContain(m);
    expect(d).not.toContain("6 a 10");
    expect(d).not.toContain("—");
    semVazamento(d);
  });
});
