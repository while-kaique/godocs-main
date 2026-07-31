import { describe, it, expect } from "vitest";
import * as orquestrador from "@/lib/agents/orchestrator";
import * as chatFns from "@/lib/chat.functions";
import { documentacaoVazia, savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// TAXONOMIA DE DESTINO DO GANHO (Seção 2.4 / gate da alocação de ganhos).
//
// Defeito medido: quando a contrapartida do saving é MENOS CUSTO (vaga não reposta,
// redução de 3 auxiliares, contrato cancelado), a entrega NÃO aumenta — ela fica igual
// com menos gente. A régua atual, replicada em 3 textos de prompt, define "resposta
// completa" como o PAR "atividades NOMEADAS **E** o que o time entrega A MAIS", então a
// resposta certa do usuário lê como incompleta e o gate repergunta (5x no caso real).
//
// O que passa a valer: uma resposta é completa quando NOMEIA o destino concreto e o
// ENCAIXA em um dos 5 destinos aceitos — mais entrega · menos custo · menos
// erro/retrabalho · menos risco/fraude · menos prazo. Uma fonte (a constante
// TAXONOMIA_DESTINO_GANHO), três consumidores; nenhum redigita a lista.
//
// Segundo defeito, independente: o LLM-juiz do preview não tem limite de recusas —
// reinterroga mesmo depois do gate determinístico já ter coletado o destino.

const ctx = (over: Partial<ProjetoContexto> = {}): ProjetoContexto =>
  ({
    nome_projeto: "Projeto X",
    ferramenta: "n8n",
    membros: [],
    alguem_fazia: "sim",
    ...over,
  }) as unknown as ProjetoContexto;

const linha = (over: Partial<SavingLinha> = {}): SavingLinha => ({
  cargo: "Auxiliar",
  horas_antes: 124,
  horas_depois: 0,
  valor_hora: 50,
  economia_horas_mes: 124,
  economia_reais_mes: 0,
  ...over,
});

const saving = (over: Partial<SavingColetado> = {}): SavingColetado => ({
  ...savingVazio(),
  tipo_saving: "mensal",
  economia_horas_mes: 124,
  linhas: [linha()],
  ...over,
});

// ─── acesso tolerante (as exportações são o que este teste cobra) ────────────
const orqAny = orquestrador as unknown as Record<string, unknown>;
const chatAny = chatFns as unknown as Record<string, unknown>;

function taxonomia(): string {
  const t = orqAny.TAXONOMIA_DESTINO_GANHO;
  expect(
    typeof t,
    "TAXONOMIA_DESTINO_GANHO deve ser exportada de @/lib/agents/orchestrator (string, módulo-level)",
  ).toBe("string");
  return t as string;
}

function textoDoGate(nome: string, ...args: unknown[]): string {
  const fn = chatAny[nome];
  expect(typeof fn, `${nome} deve ser exportada de @/lib/chat.functions`).toBe("function");
  return (fn as (...a: unknown[]) => string)(...args);
}

// Os 5 destinos aceitos, ancorados por rótulo (não por frase copiada).
const DESTINOS: Array<[string, RegExp]> = [
  ["mais entrega", /mais\s+entrega/i],
  ["menos custo", /menos\s+custo/i],
  ["menos erro/retrabalho", /menos\s+erro/i],
  ["menos risco/fraude", /menos\s+risco/i],
  ["menos prazo", /menos\s+prazo/i],
];

// Trechos estáveis da PRÓPRIA constante (derivados em runtime, não copiados):
// se um consumidor interpola a constante, todas as suas linhas substantivas aparecem.
function trechosDaTaxonomia(): string[] {
  return taxonomia()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 24);
}

// "Exigir o par" = pedir a entrega A MAIS como condição CONJUNTA de aprovação.
// Padrões que hoje existem nos 3 textos e que o fix tem de dissolver.
const PADROES_PAR_OBRIGATORIO: Array<[string, RegExp]> = [
  ['"(a) ... e (b) ... A MAIS"', /\(a\)[\s\S]{0,260}\(b\)[\s\S]{0,120}a\s+mais/i],
  ['"atividades NOMEADAS + nova entrega / + A MAIS"', /nomeadas\s*\+/i],
  ['"NOMEAR as atividades ... E ... entregar A MAIS"', /nomear[\s\S]{0,140}\be\b[\s\S]{0,80}a\s+mais/i],
  ['"nomear as atividades e a nova entrega"', /atividades\s+e\s+a\s+nova\s+entrega/i],
];

function paresObrigatoriosEncontrados(texto: string): string[] {
  return PADROES_PAR_OBRIGATORIO.filter(([, re]) => re.test(texto)).map(([rotulo]) => rotulo);
}

const MARCADOR_PV = "ATENÇÃO — ECONOMIA ALTA (≥44h/mês)";

// ─────────────────────────────────────────────────────────────────────────────
// C1 — a constante única
// ─────────────────────────────────────────────────────────────────────────────
describe("C1 — TAXONOMIA_DESTINO_GANHO (fonte única dos destinos aceitos)", () => {
  it("é exportada de @/lib/agents/orchestrator, ao lado de LIMITE_ECONOMIA_ALTA", () => {
    expect(orqAny.LIMITE_ECONOMIA_ALTA).toBe(44); // âncora: mesmo módulo, nada mudou aqui
    expect(taxonomia().length).toBeGreaterThan(80);
  });

  it("declara os 5 destinos aceitos do tempo/custo liberado", () => {
    const t = taxonomia();
    for (const [rotulo, re] of DESTINOS) {
      expect(re.test(t), `taxonomia não declara o destino "${rotulo}"`).toBe(true);
    }
  });

  it("aceita 'a mesma entrega com um time menor' como resposta COMPLETA (menos custo)", () => {
    const t = taxonomia();
    // o destino "menos custo" precisa vir com exemplo concreto de equipe/vaga/contrato,
    // senão a régua continua ilegível para o caso-âncora (redução de 3 auxiliares).
    expect(
      /vaga\s+n[ãa]o\s+reposta|time\s+menor|equipe\s+menor|redu[çc][ãa]o\s+de\s+equipe|contrato\s+cancelad|servi[çc]o\s+cancelad/i.test(
        t,
      ),
      "o destino 'menos custo' precisa de exemplo concreto (time menor / vaga não reposta / contrato cancelado)",
    ).toBe(true);
  });

  it("não exige a entrega A MAIS como condição conjunta de aprovação", () => {
    expect(paresObrigatoriosEncontrados(taxonomia())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — os 3 consumidores
// ─────────────────────────────────────────────────────────────────────────────
describe("C2 — os 3 pontos consomem a constante (nenhum redigita a régua)", () => {
  const consumidores = (): Array<[string, string]> => [
    [
      "blocoEconomiaAlta (buildSavingPrompt)",
      orquestrador.buildSavingPrompt(ctx(), documentacaoVazia(), saving(), "resumo"),
    ],
    [
      "blocoEconomiaAltaPv (buildSavingPreviewPrompt)",
      orquestrador.buildSavingPreviewPrompt(
        saving({ alocacao_ganhos: null, memorial_calculo: "memorial sem a seção 2.4" }),
      ),
    ],
    [
      "perguntaAlocacaoGanhos (chat.functions)",
      textoDoGate("perguntaAlocacaoGanhos", 124, "h/mês"),
    ],
    [
      "perguntaAlocacaoGanhosFirme (chat.functions)",
      textoDoGate("perguntaAlocacaoGanhosFirme", 124, "h/mês"),
    ],
    [
      "nudgeAlocacaoGanhos (chat.functions)",
      textoDoGate("nudgeAlocacaoGanhos", 124, "h/mês", "reduzimos 3 auxiliares"),
    ],
  ];

  it("os 5 destinos aparecem em todos os textos do gate/prompt", () => {
    for (const [nome, texto] of consumidores()) {
      for (const [rotulo, re] of DESTINOS) {
        expect(re.test(texto), `${nome} não menciona o destino "${rotulo}"`).toBe(true);
      }
    }
  });

  it("cada consumidor interpola a própria constante (uma fonte, três consumidores)", () => {
    const trechos = trechosDaTaxonomia();
    expect(trechos.length).toBeGreaterThan(0);
    for (const [nome, texto] of consumidores()) {
      for (const trecho of trechos) {
        expect(texto.includes(trecho), `${nome} não contém o trecho da constante: «${trecho}»`).toBe(
          true,
        );
      }
    }
  });

  it("nenhum dos consumidores exige 'entregar A MAIS' como condição obrigatória conjunta", () => {
    for (const [nome, texto] of consumidores()) {
      expect(paresObrigatoriosEncontrados(texto), `${nome} ainda exige o par`).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C3 — anti-loop determinístico no juiz do preview
// ─────────────────────────────────────────────────────────────────────────────
describe("C3 — anti-loop: o juiz do preview não reinterroga o que o gate já coletou", () => {
  it("alocacao_ganhos 'ok' → o bloco de economia alta NÃO é injetado", () => {
    const prompt = orquestrador.buildSavingPreviewPrompt(saving({ alocacao_ganhos: "ok" }));
    expect(prompt).not.toContain(MARCADOR_PV);
  });

  it("alocacao_ganhos 'reperguntado' → o bloco de economia alta NÃO é injetado", () => {
    const prompt = orquestrador.buildSavingPreviewPrompt(
      saving({ alocacao_ganhos: "reperguntado" }),
    );
    expect(prompt).not.toContain(MARCADOR_PV);
  });

  it("alocacao_ganhos null → o bloco CONTINUA presente (o juiz é a única rede)", () => {
    const prompt = orquestrador.buildSavingPreviewPrompt(saving({ alocacao_ganhos: null }));
    expect(prompt).toContain(MARCADOR_PV);
  });

  it("alocacao_ganhos 'pendente' → o bloco CONTINUA presente", () => {
    const prompt = orquestrador.buildSavingPreviewPrompt(saving({ alocacao_ganhos: "pendente" }));
    expect(prompt).toContain(MARCADOR_PV);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C4 — nada afrouxou na ponta vaga (complemento do que falta em
//      tests/gate-alocacao-ganhos.test.ts)
// ─────────────────────────────────────────────────────────────────────────────
describe("C4 — o predicado da ponta vaga segue INALTERADO", () => {
  it("ACEITA o caso-âncora 'reduzimos 3 auxiliares' (menos custo, com número)", () => {
    expect(orquestrador.respostaAlocacaoVaga("reduzimos 3 auxiliares")).toBe(false);
    expect(
      orquestrador.respostaAlocacaoVaga(
        "a mesma entrega com um time menor: 3 auxiliares a menos, vaga não reposta",
      ),
    ).toBe(false);
  });

  it("continua RECUSANDO o vago sem nome", () => {
    expect(orquestrador.respostaAlocacaoVaga("ganhou produtividade")).toBe(true);
    expect(orquestrador.respostaAlocacaoVaga("sobra tempo para o time")).toBe(true);
    expect(orquestrador.respostaAlocacaoVaga("o tempo foi para outras atividades")).toBe(true);
  });

  it("o gate determinístico e o limiar não mudaram", () => {
    expect(orquestrador.LIMITE_ECONOMIA_ALTA).toBe(44);
    expect(orquestrador.aplicaGateAlocacaoGanhos(ctx(), saving())).toBe(true);
    expect(orquestrador.aplicaGateAlocacaoGanhos(ctx({ alguem_fazia: "nao" }), saving())).toBe(
      false,
    );
  });
});
