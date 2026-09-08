/**
 * T9 (fatia (b) do plano `docs/plans/calibragem-time-avaliacao.md`) — a discordância humana
 * chega ao PROMPT do especialista da mesa.
 *
 * O que este arquivo trava:
 *
 * 1. `EntradaEspecialista` carrega o campo **`licoes`** — o bloco JÁ RENDERIZADO por
 *    `blocoCorrecoes` (reuso puro; nenhuma recuperação nova), ou string vazia.
 * 2. `buildPromptEspecialista` **injeta** esse bloco quando ele não é vazio e **não deixa rastro
 *    nenhum** quando é vazio (nem cabeçalho órfão, nem "(nenhuma)").
 * 3. `montarEntradasEspecialistas` aceita o bloco e o repassa às **4** dimensões (a lição é a
 *    mesma para a mesa inteira), com o 4º parâmetro OPCIONAL: quem chama com 3 argumentos
 *    continua funcionando e recebe `licoes: ''`.
 *
 * ⚠️ A lição NÃO é o parecer dos outros especialistas (isso segue vetado pela RF-231 e travado em
 * `tests/racional-primeiro.test.ts`): são correções de OUTROS PROJETOS, feitas pela triagem.
 *
 * ⚠️ Toda asserção de AUSÊNCIA usa marcas que hoje NÃO existem no prompt (o cabeçalho literal do
 * `blocoCorrecoes` e o radical "correções") — sem isso, um `not.toContain` sobre palavra genérica
 * como "triagem", que já aparece nas personas, passaria por acidente.
 */
import { describe, it, expect } from "vitest";
import {
  buildPromptEspecialista,
  type DimensaoAvaliacao,
  type EntradaEspecialista,
  type TextoProjeto,
} from "@/lib/agents/especialista-avaliacao";
import {
  montarEntradasEspecialistas,
  type VotosDeterministicos,
} from "@/lib/agents/mesa-especialistas";
import { blocoCorrecoes, MOTIVO_MIN, type Correcao } from "@/lib/correcoes";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const TEXTO: TextoProjeto = {
  nome: "Robô de Faturamento",
  area: "Financeiro",
  descricao: "Automatiza a emissão de notas.",
  o_que_faz: "Emite e concilia notas fiscais.",
  memorial: "Saving de 418h/mês para 2 pessoas.",
  doc: "Documentação técnica do robô.",
};

/** O motivo humano — texto distintivo, para o `toContain` não casar por acidente. */
const MOTIVO_HUMANO =
  "Subi porque OUTROS PROJETOS RODAM EM CIMA DELE, e você leu isso como alcance em vez de plataforma.";

const correcao = (over: Partial<Correcao> = {}): Correcao => ({
  tipo: "estrela",
  projeto_id: "piapp",
  projeto_nome: "PIAPP Plataforma",
  de: 5,
  para: 8,
  eixo: "precedente",
  veredito_de: null,
  veredito_para: null,
  recomendado: 5,
  leitura_agente: "É um app isolado de uma marca só.",
  motivo: MOTIVO_HUMANO,
  quando: "2026-09-05T10:00:00Z",
  ...over,
});

function votosBase(): VotosDeterministicos {
  return {
    fte: { implausivel: false, fte: 0.5, pessoas: 1, motivo: null },
    financeiro: { veredito: "ok", confianca: 0.9, motivo: null, sinais: [] },
    rag: { apoio: true, confianca: 0.85, vizinhos: 3, topSimilaridade: 0.7, motivo: null },
    cetico: { refuta: false, confianca: 0, motivo: null, sinais: [] },
  };
}

/**
 * Entrada do especialista COM o campo novo. O cast declara o contrato que T9 pede (`licoes:
 * string` em `EntradaEspecialista`) sem depender de o tipo já tê-lo.
 */
function entradaComLicoes(licoes: string, dimensao: DimensaoAvaliacao = "rag") {
  const base = {
    dimensao,
    texto: TEXTO,
    voto: {
      preocupa: true,
      confianca: 0.3,
      motivo: "Materialidade de R$ 8.000/mês acima do teto.",
      sinais: ["s1"],
    },
    vizinhos: ["Projeto vizinho A aprovado"],
    outrosVotos: [],
    licoes,
  };
  return base as unknown as EntradaEspecialista;
}

/** Assinatura que T9 pede: 4º parâmetro OPCIONAL com o bloco de lições. */
const montarComLicoes = montarEntradasEspecialistas as unknown as (
  votos: VotosDeterministicos,
  texto: TextoProjeto,
  vizinhosTexto: string[],
  licoes?: string,
) => (EntradaEspecialista & { licoes: string })[];

const textoDoPrompt = (entrada: EntradaEspecialista): string =>
  buildPromptEspecialista(entrada)
    .map((m) => m.content)
    .join("\n");

const DIMENSOES: DimensaoAvaliacao[] = ["fte", "financeiro", "rag", "cetico"];

// ─── (1) a lição ENTRA quando há motivo ────────────────────────────────────────

describe("lição da triagem no prompt do especialista", () => {
  it("bloco com motivo entra no prompt: a réplica humana, o projeto corrigido e o eixo", () => {
    const bloco = blocoCorrecoes([correcao()]);
    // Guarda contra falso-verde: se o bloco viesse vazio, os `toContain` abaixo não provariam nada.
    expect(bloco).not.toBe("");
    expect(bloco).toContain(MOTIVO_HUMANO);

    const prompt = textoDoPrompt(entradaComLicoes(bloco));

    expect(prompt).toContain(MOTIVO_HUMANO);
    expect(prompt).toContain("PIAPP Plataforma");
    expect(prompt).toContain("CORREÇÕES QUE A TRIAGEM JÁ FEZ");
    // O eixo entra NOMEADO — é o que faz o especialista reconhecer a lição como sendo sobre ele.
    expect(prompt).toContain("eixo: precedente");
  });

  it("o bloco é injetado INTEIRO, incluindo a ressalva de não copiar a nota", () => {
    const bloco = blocoCorrecoes([correcao()]);
    const prompt = textoDoPrompt(entradaComLicoes(bloco));
    for (const linha of bloco.split("\n")) {
      expect(prompt).toContain(linha);
    }
  });

  it("vale para as 4 dimensões (a lição é da mesa, não de um eixo só)", () => {
    const bloco = blocoCorrecoes([correcao()]);
    for (const dim of DIMENSOES) {
      expect(textoDoPrompt(entradaComLicoes(bloco, dim))).toContain(MOTIVO_HUMANO);
    }
  });
});

// ─── (2) a lição NÃO entra, e não deixa rastro, quando não há motivo ──────────

describe("sem lição não há rastro no prompt", () => {
  it("correção SEM motivo não rende bloco — `blocoCorrecoes` devolve string vazia", () => {
    expect(blocoCorrecoes([correcao({ motivo: null })])).toBe("");
    expect(blocoCorrecoes([correcao({ motivo: "x".repeat(MOTIVO_MIN - 1) })])).toBe("");
  });

  it('licoes vazio: nem cabeçalho, nem "(nenhuma)", nem o nome do projeto corrigido', () => {
    const prompt = textoDoPrompt(entradaComLicoes(blocoCorrecoes([correcao({ motivo: null })])));

    expect(prompt).not.toContain("CORREÇÕES QUE A TRIAGEM JÁ FEZ");
    expect(prompt).not.toMatch(/corre[çc][õo]es/i);
    expect(prompt).not.toMatch(/nenhuma/i);
    expect(prompt).not.toContain("PIAPP Plataforma");
    // ...e o prompt continua sendo um prompt de verdade (o projeto sob julgamento está lá).
    expect(prompt).toContain("Robô de Faturamento");
  });
});

// ─── (3) o repasse pela mesa ──────────────────────────────────────────────────

describe("montarEntradasEspecialistas repassa a lição", () => {
  it("o 4º argumento chega às 4 dimensões, idêntico", () => {
    const bloco = blocoCorrecoes([correcao()]);
    const entradas = montarComLicoes(votosBase(), TEXTO, ["Bot Y (Fiscal)"], bloco);

    expect(entradas.map((e) => e.dimensao)).toEqual(DIMENSOES);
    for (const e of entradas) {
      expect(e.licoes).toBe(bloco);
      // ponta a ponta: o que a mesa monta é o que o prompt lê.
      expect(textoDoPrompt(e)).toContain(MOTIVO_HUMANO);
    }
  });

  // ⚠️ O 4º argumento é OBRIGATÓRIO de propósito (era `licoes = ''` e o default escondia o
  // chamador que esquecesse). String vazia é decisão explícita — e não pode deixar rastro.
  it("com lição VAZIA declarada, as entradas não deixam rastro no prompt", () => {
    const entradas = montarEntradasEspecialistas(
      votosBase(),
      TEXTO,
      [],
      "",
    ) as (EntradaEspecialista & {
      licoes: string;
    })[];

    expect(entradas).toHaveLength(4);
    for (const e of entradas) {
      expect(e.licoes).toBe("");
      expect(textoDoPrompt(e)).not.toMatch(/corre[çc][õo]es/i);
    }
  });
});
