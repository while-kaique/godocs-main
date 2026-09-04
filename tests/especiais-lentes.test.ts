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
import { EIXOS, pisoDaLente } from "@/lib/agents/especiais-lentes";
import {
  NIVEL_ZERO,
  CRITERIOS_ESTRELA,
  ESCAPE_MUDA_O_JOGO,
  PISO_ZERO,
  NOTA_MAX,
  TETO_AGENTE,
} from "@/lib/estrelas-regua";
import type { AlvoClassificacao } from "@/lib/agents/especial-classificador";
import type { Vizinho } from "@/lib/especial-corpus";

function av(lente: string, nota: number, evidencia: Evidencia = "nomeada"): AvaliacaoLente {
  return {
    lente,
    piso: null,
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
    const titulos = EIXOS.map((c) => c.titulo);
    for (const l of LENTES) {
      for (const t of l.criterios) expect(titulos).toContain(t);
    }
    for (const t of CRITERIOS_GLOBAIS) expect(titulos).toContain(t);
  });

  it("lentes + globais COBREM a régua inteira — critério novo esquecido aqui falha", () => {
    const cobertos = new Set<string>([...LENTES.flatMap((l) => l.criterios), ...CRITERIOS_GLOBAIS]);
    const orfaos = EIXOS.map((c) => c.titulo).filter((t) => !cobertos.has(t));
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

describe("âncoras por eixo", () => {
  it("cobrem 0..5 no mínimo, em ordem, sem repetir nota e dentro da escala", () => {
    for (const l of LENTES) {
      const notas = l.ancoras.map((a) => a.nota);
      expect(notas).toEqual([...notas].sort((a, b) => a - b));
      expect(new Set(notas).size).toBe(notas.length);
      for (const n of notas) expect(n).toBeGreaterThanOrEqual(0);
      for (const n of notas) expect(n).toBeLessThanOrEqual(NOTA_MAX);
      for (let n = 0; n <= 5; n++) expect(notas).toContain(n);
    }
  });

  it("a âncora de cada nota é DIFERENTE entre as lentes — senão o eixo não é um eixo", () => {
    for (let n = 0; n <= 5; n++) {
      const defs = LENTES.map((l) => l.ancoras.find((a) => a.nota === n)?.definicao).filter(
        (d): d is string => !!d,
      );
      expect(new Set(defs).size).toBe(defs.length);
    }
  });
});

describe("prompt de cada lente", () => {
  it("traz só os critérios da lente + os globais, e diz o que ela NÃO julga", () => {
    const gate = lentePorChave(GATE)!;
    const p = buildSystemPromptLente(gate);
    // o texto do seu próprio critério está lá…
    const meu = EIXOS.find((c) => c.titulo === gate.criterios[0])!;
    expect(p).toContain(meu.texto);
    // …e o texto de um critério de OUTRA lente, não.
    const alheio = EIXOS.find((c) => c.titulo === "Alcance e reuso")!;
    expect(p).not.toContain(alheio.texto);
    // o bloco de "não julgo" nomeia as outras lentes
    for (const r of outrosEixos(gate.chave)) expect(p).toContain(r);
  });

  // ⚠️ Repoint de 03/09/2026 para a régua nova (`estrelas-regua.ts`). Duas mudanças de contrato:
  //  1. o teto da LENTE é `TETO_AGENTE`, não `NOTA_MAX` — a faixa 6-10 não sai de eixo isolado,
  //     exige duas citações e o comitê humano;
  //  2. a CURVA saiu do prompt da lente, e a saída não deve voltar por engano: ela dizia "≥3★ é
  //     top 4% da base" sobre a base INTEIRA, e está na lista do que já foi medido e reprovado
  //     (nenhuma lente passava de 2★ em 48 especiais).
  it("o teto da lente é o do AGENTE, e a curva da base NÃO entra no prompt", () => {
    const p = buildSystemPromptLente(LENTES[1]);
    expect(p).toContain(`0 a ${TETO_AGENTE}`);
    expect(p).toContain(`${TETO_AGENTE + 1} a ${NOTA_MAX}`); // diz que o escape existe, e que não é dela
    expect(p).not.toContain("top 4%");
    expect(p).not.toContain("0★:");
  });

  // O piso deixa de ser prosa: a lente tem de NOMEAR o desqualificador que aplicou. É o defeito
  // medido no run 1 (nenhuma das 173 notas que subiram citou um item do piso sequer).
  it("o piso entra com as chaves da régua e é campo obrigatório da resposta", () => {
    const p = buildSystemPromptLente(LENTES[0]);
    for (const chave of pisoDaLente(LENTES[0].chave)) expect(p).toContain(chave);
    expect(p).toContain('"piso"');
    expect(p).toMatch(/piso.{0,40}OBRIGATÓRIO/s);
  });

  /**
   * ⚠️ Medido no 1º teste do painel repointado: com a lista inteira em todas as lentes,
   * `apenas_mensuravel` disparou em 4 das 5 num relatório diário comum. Todo projeto normal TEM
   * número, e a lente de risco não tem como saber se o projeto se RESUME a ele.
   */
  it("cada lente só vê os itens do piso do PRÓPRIO eixo", () => {
    for (const l of LENTES) {
      const p = buildSystemPromptLente(l);
      const meus = pisoDaLente(l.chave);
      for (const item of PISO_ZERO) {
        if (meus.includes(item.chave)) expect(p, `${l.chave} deveria ver ${item.chave}`).toContain(item.chave);
        else expect(p, `${l.chave} NÃO deveria ver ${item.chave}`).not.toContain(item.chave);
      }
    }
  });

  it("cada item do piso tem exatamente UMA lente dona — nenhum fica órfão nem duplicado", () => {
    const donos = LENTES.flatMap((l) => pisoDaLente(l.chave));
    expect([...donos].sort()).toEqual(PISO_ZERO.map((x) => x.chave).sort());
  });

  it("chave de piso de OUTRO eixo é descartada na normalização", () => {
    // `so_o_autor` é da lente de alcance: a de função não pode zerar o projeto com ela.
    const av = normalizarAvaliacaoLente({ nota: 3, piso: "so_o_autor" }, "funcao_cadeia")!;
    expect(av.piso).toBeNull();
    expect(av.nota).toBe(3);
    // e a dona dela zera normalmente
    const dona = normalizarAvaliacaoLente({ nota: 3, piso: "so_o_autor" }, "alcance_reuso")!;
    expect(dona.piso).toBe("so_o_autor");
    expect(dona.nota).toBe(0);
  });

  it("traz as âncoras DO EIXO da lente, e não as de outra lente", () => {
    for (const l of LENTES) {
      const p = buildSystemPromptLente(l);
      for (const a of l.ancoras) expect(p).toContain(a.definicao);
      // as âncoras das OUTRAS lentes não vazam para cá (senão a lente volta a julgar o projeto
      // inteiro — é exatamente a trava que estas âncoras existem para desfazer)
      for (const outra of LENTES.filter((o) => o.chave !== l.chave))
        for (const a of outra.ancoras) expect(p).not.toContain(a.definicao);
    }
  });

  it("NÃO traz as definições GLOBAIS de 3★ para cima — era o gargalo medido do T7", () => {
    // A régua global descreve o PROJETO INTEIRO ("plataforma, várias áreas, autonomia"): um eixo
    // isolado não pode alegar isso, e toda lente respondia 1–2 corretamente. Ver o diagnóstico de
    // 28/08/2026 em docs/plans/painel-agentes-especiais.md.
    for (const l of LENTES) {
      const p = buildSystemPromptLente(l);
      // ⚠️ Vale inclusive para a lente de FUNÇÃO, cujo eixo É a espinha da régua: ela usa o
      // VERBO de cada nível (fonte única) com definição LOCAL, contendo só a parte de função.
      // O texto global do 3★ cobra "recai sobre OUTRA área", que é alcance — e é essa mistura
      // que fazia toda lente parar em 1 ou 2.
      for (const n of CRITERIOS_ESTRELA) {
        if (n.nota < 3) continue;
        expect(p).not.toContain(n.criterio);
      }
    }
  });

  it("traz a escala global só em TÍTULOS, para ler a nota dos vizinhos", () => {
    const p = buildSystemPromptLente(LENTES[0]);
    for (const n of [NIVEL_ZERO, ...CRITERIOS_ESTRELA]) expect(p).toContain(`${n.nota} ${n.verbo}`);
    expect(p).toContain(ESCAPE_MUDA_O_JOGO.verbo);
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
    // Clampa no teto do AGENTE: uma lente que devolve 7 está opinando sobre o escape.
    expect(normalizarAvaliacaoLente({ nota: 99 }, GATE)!.nota).toBe(TETO_AGENTE);
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

  // O ponto original continua valendo: eixo forte não é comprimido pela média dos fracos. O que
  // mudou com a régua nova é a altura em que isso acontece — o topo do painel é 5, e 6 a 10 é
  // outra decisão, com duas citações e comitê humano.
  it("projeto de topo não é comprimido: gate 4 + alcance 5 sustenta 5", () => {
    const c = consolidarLentes([av(GATE, 4, "nomeada"), av(VALOR[1], 5)]);
    expect(c.nota_preliminar).toBe(5);
  });

  it("nunca passa do TETO DO AGENTE, mesmo com todas as lentes no máximo", () => {
    const c = consolidarLentes([av(GATE, TETO_AGENTE, "nomeada"), av(VALOR[0], TETO_AGENTE)]);
    expect(c.teto).toBe(TETO_AGENTE);
    expect(c.nota_preliminar).toBe(TETO_AGENTE);
  });

  /**
   * O piso é do PROJETO, não do eixo: "ninguém além do autor usa" não é uma verdade sobre
   * alcance, é uma verdade sobre o projeto. Sem esta regra, uma lente diria "0, está parado" e as
   * outras quatro fariam média por cima dela.
   */
  it("uma lente que NOMEIA um item do piso zera o conjunto, e a explicação diz qual", () => {
    const comPiso: AvaliacaoLente = { ...av(VALOR[1], 4, "nomeada"), piso: "so_o_autor" };
    const c = consolidarLentes([av(GATE, 3, "nomeada"), comPiso]);
    expect(c.nota_preliminar).toBe(0);
    expect(c.explicacao).toContain("so_o_autor");
    expect(c.explicacao).toContain(VALOR[1]);
  });

  it("sem piso nomeado, nada muda", () => {
    const c = consolidarLentes([av(GATE, 3, "nomeada"), av(VALOR[1], 4)]);
    expect(c.nota_preliminar).toBeGreaterThan(0);
    expect(c.explicacao).not.toContain("piso");
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
