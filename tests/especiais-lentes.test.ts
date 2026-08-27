/**
 * Avaliadores por LENTE (T3 do painel de agentes) — parte PURA.
 *
 * O que estes testes prendem:
 * - **a régua não é redigitada**: cada lente referencia TÍTULOS de `CRITERIOS`, e a união
 *   lentes + globais cobre a régua inteira — critério novo na régua e esquecido aqui FALHA
 *   (em vez de sumir do painel em silêncio);
 * - **as lentes são DISTINTAS**: nenhum critério em duas lentes, e o prompt de cada uma diz o que
 *   ela não julga (N cópias do mesmo prompt concordam por construção — é o teatro que a decisão 2
 *   do plano proíbe);
 * - **consolidação SEM média**: lente 0 + lente 4 nunca dá 2 (a compressão para o meio medida no
 *   T1: viés −0,06 escondendo 0★→+1,94 e 7★→−7);
 * - **o gate é teto**: sem recorrência com ponteiro nomeado, complexidade não compra nota — é o
 *   achado 3 do T1 (12 dos 17 zeros humanos foram promovidos pelo agente único);
 * - **eixo sem prova não sustenta nota** (`evidencia: 'ausente'` → teto 1) e **`nomeada` sem
 *   trecho copiado vira `vaga`** (alegar fonte é grátis, copiar o trecho não é);
 * - **lente que falha ≠ lente que deu 0**: falha vira `faltando`, nunca nota 0.
 */
import { describe, it, expect } from "vitest";
import {
  CRITERIOS_GLOBAIS,
  LENTES,
  LENTE_GATE,
  MARGEM_ACIMA_DO_GATE,
  MARGEM_VALOR_NOMEADO,
  NOTA_VALOR_EMPRESTA,
  MIN_SUSTENTACAO,
  TETO_SEM_EVIDENCIA,
  aplicarTetoSemEvidencia,
  buildSystemPromptLente,
  buildUserMessageLente,
  consolidarLentes,
  lentePorChave,
  normalizarAvaliacaoLente,
  outrosEixos,
  type AvaliacaoLente,
  type Evidencia,
} from "@/lib/agents/especiais-lentes";
import { CRITERIOS, NOTA_MAX } from "@/lib/especiais-regua";
import type { AlvoClassificacao } from "@/lib/agents/especial-classificador";
import type { Vizinho } from "@/lib/especial-corpus";

function av(lente: string, nota: number, evidencia: Evidencia = "nomeada"): AvaliacaoLente {
  return {
    lente,
    nota,
    evidencia,
    confianca: "media",
    justificativa: "teste",
    sustentacao: "relatório de faturamento diário",
  };
}

const GATE = LENTE_GATE;
const VALOR = LENTES.filter((l) => l.chave !== GATE).map((l) => l.chave);

describe("as lentes são declaradas e distintas", () => {
  it("tem chaves únicas, rótulo, pergunta e ao menos 1 critério", () => {
    const chaves = LENTES.map((l) => l.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const l of LENTES) {
      expect(l.rotulo.length).toBeGreaterThan(5);
      expect(l.pergunta.length).toBeGreaterThan(20);
      expect(l.criterios.length).toBeGreaterThan(0);
    }
  });

  it("a lente gate existe e é uma das declaradas", () => {
    expect(lentePorChave(LENTE_GATE)).not.toBeNull();
  });

  it("nenhum critério aparece em DUAS lentes (senão as lentes deixam de ser distintas)", () => {
    const vistos = new Set<string>();
    for (const l of LENTES) {
      for (const t of l.criterios) {
        expect(vistos.has(t)).toBe(false);
        vistos.add(t);
      }
    }
  });

  it("todo critério referenciado EXISTE na régua (nada é redigitado aqui)", () => {
    const titulos = CRITERIOS.map((c) => c.titulo);
    for (const l of LENTES) {
      for (const t of l.criterios) expect(titulos).toContain(t);
    }
    for (const t of CRITERIOS_GLOBAIS) expect(titulos).toContain(t);
  });

  it("lentes + globais COBREM a régua inteira — critério novo esquecido aqui falha", () => {
    const cobertos = new Set<string>([...LENTES.flatMap((l) => l.criterios), ...CRITERIOS_GLOBAIS]);
    const orfaos = CRITERIOS.map((c) => c.titulo).filter((t) => !cobertos.has(t));
    expect(orfaos).toEqual([]);
  });

  it("`outrosEixos` devolve os rótulos das OUTRAS lentes, nunca o da própria", () => {
    for (const l of LENTES) {
      const outros = outrosEixos(l.chave);
      expect(outros).not.toContain(l.rotulo);
      expect(outros.length).toBe(LENTES.length - 1);
    }
  });
});

describe("prompt de cada lente", () => {
  it("traz só os critérios da lente + os globais, e diz o que ela NÃO julga", () => {
    const gate = lentePorChave(GATE)!;
    const p = buildSystemPromptLente(gate);
    // o texto do seu próprio critério está lá…
    const meu = CRITERIOS.find((c) => c.titulo === gate.criterios[0])!;
    expect(p).toContain(meu.texto);
    // …e o texto de um critério de OUTRA lente, não.
    const alheio = CRITERIOS.find((c) => c.titulo === "Alcance e reuso")!;
    expect(p).not.toContain(alheio.texto);
    // o bloco de "não julgo" nomeia as outras lentes
    for (const r of outrosEixos(gate.chave)) expect(p).toContain(r);
  });

  it("traz a régua, a curva e o teto da escala (importados, não redigitados)", () => {
    const p = buildSystemPromptLente(LENTES[1]);
    expect(p).toContain(`0–${NOTA_MAX}`);
    expect(p).toContain("top 4%");
    expect(p).toContain("0★:"); // a curva real
  });

  it("dois prompts de lentes diferentes NÃO são o mesmo texto", () => {
    const a = buildSystemPromptLente(LENTES[0]);
    const b = buildSystemPromptLente(LENTES[1]);
    expect(a).not.toBe(b);
  });
});

describe("mensagem de usuário", () => {
  const alvo: AlvoClassificacao = {
    projeto_id: "p1",
    nome: "Robô de romaneio",
    area: "Fiscal",
    ferramenta: "n8n",
    tipos: "especial",
    contexto_especial: "sem memorial financeiro",
    descricao: "gera romaneio todo dia",
    memorial: null,
    doc: "roda por cron às 6h",
    submetido_em: "2026-08-01",
  };
  const vizinhos: Vizinho[] = [];

  it("sem função declarada, não inventa bloco de grupo", () => {
    const m = buildUserMessageLente(alvo, vizinhos);
    expect(m).not.toContain("GRUPO DE FUNÇÃO");
    expect(m).toContain("Robô de romaneio");
  });

  it("com função, o grupo entra como CONTEXTO e avisa que grupo não prevê nota", () => {
    const m = buildUserMessageLente(alvo, vizinhos, "documento_fiscal");
    expect(m).toContain("GRUPO DE FUNÇÃO");
    expect(m).toContain("não o quanto ele vale");
  });
});

describe("normalização e guards da saída", () => {
  it("nota fora da escala é clampada e arredondada", () => {
    expect(normalizarAvaliacaoLente({ nota: 99 }, GATE)!.nota).toBe(NOTA_MAX);
    expect(normalizarAvaliacaoLente({ nota: -4 }, GATE)!.nota).toBe(0);
    expect(normalizarAvaliacaoLente({ nota: 2.6 }, GATE)!.nota).toBe(3);
  });

  it("sem nota utilizável devolve null (é lente FALTANDO, não nota 0)", () => {
    expect(normalizarAvaliacaoLente({ justificativa: "oi" }, GATE)).toBeNull();
    expect(normalizarAvaliacaoLente({ nota: "muito boa" }, GATE)).toBeNull();
    expect(normalizarAvaliacaoLente(null, GATE)).toBeNull();
  });

  it("evidência/confiança inválidas caem no valor CONSERVADOR", () => {
    const r = normalizarAvaliacaoLente({ nota: 4, evidencia: "ótima", confianca: "total" }, GATE)!;
    expect(r.evidencia).toBe("ausente");
    expect(r.confianca).toBe("baixa");
  });

  it("`nomeada` sem trecho copiado vira `vaga` (alegar fonte é grátis)", () => {
    const semTrecho = normalizarAvaliacaoLente(
      { nota: 3, evidencia: "nomeada", sustentacao: "sim" },
      GATE,
    )!;
    expect(semTrecho.evidencia).toBe("vaga");

    const comTrecho = normalizarAvaliacaoLente(
      { nota: 3, evidencia: "nomeada", sustentacao: "x".repeat(MIN_SUSTENTACAO) },
      GATE,
    )!;
    expect(comTrecho.evidencia).toBe("nomeada");
  });

  it("eixo com evidência AUSENTE não sustenta nota acima do teto", () => {
    const cortado = aplicarTetoSemEvidencia(av(GATE, 5, "ausente"));
    expect(cortado.nota).toBe(TETO_SEM_EVIDENCIA);
    expect(cortado.confianca).toBe("baixa");
    // evidência vaga NÃO é cortada aqui (quem limita é o gate na consolidação)
    expect(aplicarTetoSemEvidencia(av(GATE, 5, "vaga")).nota).toBe(5);
    // e o teto nunca SOBE uma nota baixa
    expect(aplicarTetoSemEvidencia(av(GATE, 0, "ausente")).nota).toBe(0);
  });
});

describe("consolidação — sem média, gate como teto", () => {
  it("NÃO é média: gate 0 com lente de valor 4 não devolve 2", () => {
    const c = consolidarLentes([av(GATE, 0, "ausente"), av(VALOR[0], 4)]);
    expect(c.nota_preliminar).not.toBe(2);
    expect(c.nota_preliminar).toBe(0);
  });

  it("o gate é TETO: prova nomeada empresta exatamente a margem declarada", () => {
    const c = consolidarLentes([av(GATE, 2, "nomeada"), av(VALOR[0], 6)]);
    expect(c.teto).toBe(2 + MARGEM_ACIMA_DO_GATE);
    expect(c.nota_preliminar).toBe(3);
    expect(c.explicacao).toContain("teto");
  });

  // ⚠️ Decisão do Kaique, 27/08/2026, com a medição do T7 na mesa: gate com prova `vaga` PASSOU a
  // receber margem quando um eixo de VALOR sustenta ≥3 COM prova nomeada. Antes a margem era 0 e
  // NENHUM dos 48 especiais passava de 2★, contra 41,7% de ≥3★ da triagem humana.
  it("gate VAGO recebe a margem emprestada de um eixo de valor com prova NOMEADA", () => {
    const c = consolidarLentes([av(GATE, 2, "vaga"), av(VALOR[0], 6)]);
    expect(c.valor_nomeado_max).toBe(6);
    expect(c.teto).toBe(2 + MARGEM_VALOR_NOMEADO);
    expect(c.nota_preliminar).toBe(3);
  });

  // ⚠️ O empréstimo é de ESPAÇO, não da nota do eixo: com `teto = valor_nomeado_max` direto, o caso
  // real «Acompanhamento de Mudanças de Preço» (humana 2, gate 2/vaga, alcance 4/nomeada) iria a 4★
  // — trocaria um erro de −1 por um de +2. Este teste é o que impede essa "melhoria".
  it("o empréstimo é UMA nota, não a nota cheia do eixo de valor", () => {
    const c = consolidarLentes([av(GATE, 2, "vaga"), av(VALOR[0], 4)]);
    expect(c.nota_preliminar).toBe(3);
    expect(c.nota_preliminar).toBeLessThan(4);
  });

  it("eixo de valor sem prova nomeada NÃO empresta nada ao gate vago", () => {
    const c = consolidarLentes([av(GATE, 2, "vaga"), av(VALOR[0], 6, "vaga")]);
    expect(c.valor_nomeado_max).toBe(0);
    expect(c.teto).toBe(2);
    expect(c.nota_preliminar).toBe(2);
  });

  it("eixo de valor nomeado ABAIXO de 3 não empresta (o limiar é declarado)", () => {
    const c = consolidarLentes([av(GATE, 1, "vaga"), av(VALOR[0], NOTA_VALOR_EMPRESTA - 1)]);
    expect(c.teto).toBe(1);
    expect(c.nota_preliminar).toBe(1);
  });

  it("gate com prova AUSENTE não recebe empréstimo nenhum (ponteiro vago ≠ inexistente)", () => {
    const c = consolidarLentes([av(GATE, 2, "ausente"), av(VALOR[0], 6)]);
    expect(c.teto).toBe(2);
    expect(c.nota_preliminar).toBe(2);
  });

  it("para cima é DISJUNTIVO: um eixo forte basta, os outros zerados não puxam para baixo", () => {
    const c = consolidarLentes([
      av(GATE, 5, "nomeada"),
      av(VALOR[0], 5),
      av(VALOR[1], 0, "ausente"),
      av(VALOR[2], 0, "ausente"),
    ]);
    expect(c.nota_preliminar).toBe(5);
  });

  it("projeto de topo não é comprimido: gate 7 + alcance 8 sustenta 8", () => {
    const c = consolidarLentes([av(GATE, 7, "nomeada"), av(VALOR[1], 8)]);
    expect(c.nota_preliminar).toBe(8);
  });

  it("nunca passa do teto da escala", () => {
    const c = consolidarLentes([av(GATE, NOTA_MAX, "nomeada"), av(VALOR[0], NOTA_MAX)]);
    expect(c.teto).toBe(NOTA_MAX);
    expect(c.nota_preliminar).toBe(NOTA_MAX);
  });

  it("gate sozinho vale a própria nota (sem lente de valor não zera o projeto)", () => {
    const c = consolidarLentes([av(GATE, 2, "nomeada")]);
    expect(c.nota_preliminar).toBe(2);
    expect(c.valor_max).toBe(0);
    expect(c.faltando).toEqual(VALOR);
  });

  it("gate que FALHOU não cria teto e a falha aparece em `faltando`", () => {
    const c = consolidarLentes([av(VALOR[0], 4)]);
    expect(c.gate).toBeNull();
    expect(c.teto).toBeNull();
    expect(c.nota_preliminar).toBe(4);
    expect(c.faltando).toContain(GATE);
    expect(c.explicacao).toContain("sem teto");
  });

  it("nenhuma lente respondeu → 0 explicando que ninguém julgou (nunca lança)", () => {
    const c = consolidarLentes([]);
    expect(c.nota_preliminar).toBe(0);
    expect(c.faltando.length).toBe(LENTES.length);
    expect(c.explicacao).toContain("ausência de julgamento");
  });

  it("é determinística: a ordem das lentes na entrada não muda a nota", () => {
    const entrada = [av(GATE, 3, "nomeada"), av(VALOR[0], 1), av(VALOR[1], 5)];
    const a = consolidarLentes(entrada).nota_preliminar;
    const b = consolidarLentes([...entrada].reverse()).nota_preliminar;
    expect(a).toBe(b);
  });
});
