/**
 * Revisor adversarial + máquina de CONVERGÊNCIA (T5).
 *
 * O que estes testes prendem — as 4 travas anti-loop deste repo, agora sobre voltas de agente:
 * - **teto absorvente**: simulação de 20 revisões que NUNCA aceitam TERMINA (é o teste que pegou o
 *   loop do gate de sobreposição), com no máximo `TETO_VOLTAS` voltas;
 * - **monotonicidade**: `volta` só cresce e a nota **só desce** — empate ou sugestão para cima
 *   mantém a nota (decisão 4: "empate mantém a nota MENOR");
 * - **terminal é NO-OP**: revisar estado encerrado devolve o MESMO estado, histórico incluído;
 * - **não converge ≠ trava**: sem consenso grava `contestada: true` e segue;
 * - **veredicto ilegível vira REFUTAÇÃO**, nunca aceitação (aceitar por não entender carimbaria
 *   nota rara por acidente);
 * - o prompt do revisor é de DERRUBAR e proíbe sugerir nota maior.
 */
import { describe, it, expect } from "vitest";
import { percentilNaCurva } from "@/lib/especiais-regua";
import { CURVA_ESPECIAIS_AUDITADOS } from "@/lib/especiais-calibrador";
import {
  NOTA_REVISAO_ADVERSARIAL,
  TETO_VOLTAS,
  aplicarRevisao,
  deveRevisar,
  explicarConvergencia,
  iniciarConvergencia,
  podeRevisarDeNovo,
  type EstadoConvergencia,
  type VeredictoRevisor,
} from "@/lib/especiais-convergencia";
import {
  buildSystemPromptRevisor,
  buildUserMessageRevisor,
  eixoQueSustenta,
  normalizarVeredicto,
} from "@/lib/agents/especiais-revisor";
import { lentePorChave, type AvaliacaoLente } from "@/lib/agents/especiais-lentes";
import { NOTA_MAX } from "@/lib/especiais-regua";
import type { AlvoClassificacao } from "@/lib/agents/especial-classificador";

const REFUTA: VeredictoRevisor = { refutada: true, nota_sugerida: null, motivo: "não prova nada" };
const ACEITA: VeredictoRevisor = { refutada: false, nota_sugerida: null, motivo: "sustentou" };

describe("quem entra em revisão", () => {
  it("só nota ≥ corte de raridade", () => {
    expect(deveRevisar(NOTA_REVISAO_ADVERSARIAL)).toBe(true);
    expect(deveRevisar(NOTA_REVISAO_ADVERSARIAL - 1)).toBe(false);
    expect(deveRevisar(NaN)).toBe(false);
  });

  it("nota abaixo do corte já nasce encerrada, sem gastar revisor", () => {
    const e = iniciarConvergencia(1);
    expect(e.encerrado).toBe(true);
    expect(e.motivo).toBe("sem_revisao");
    expect(podeRevisarDeNovo(e)).toBe(false);
    expect(e.contestada).toBe(false);
  });

  it("nota fora da escala é trazida para dentro antes de qualquer decisão", () => {
    expect(iniciarConvergencia(99).nota).toBe(NOTA_MAX);
    expect(iniciarConvergencia(-5).nota).toBe(0);
  });
});

describe("teto absorvente (a guarda do plano)", () => {
  it("20 revisões que NUNCA aceitam terminam, em no máximo TETO_VOLTAS voltas", () => {
    let e = iniciarConvergencia(6);
    let chamadas = 0;
    for (let i = 0; i < 20; i++) {
      if (!podeRevisarDeNovo(e)) break;
      e = aplicarRevisao(e, REFUTA);
      chamadas++;
    }
    expect(e.encerrado).toBe(true);
    expect(e.volta).toBe(TETO_VOLTAS);
    expect(chamadas).toBe(TETO_VOLTAS);
    expect(e.contestada).toBe(true);
    expect(e.motivo).toBe("teto_de_voltas");
  });

  it("mesmo um laço INGÊNUO (sem consultar o predicado) para de mudar de estado", () => {
    let e = iniciarConvergencia(5);
    const estados: EstadoConvergencia[] = [];
    for (let i = 0; i < 20; i++) {
      e = aplicarRevisao(e, REFUTA);
      estados.push(e);
    }
    expect(e.volta).toBe(TETO_VOLTAS);
    expect(e.historico.length).toBe(TETO_VOLTAS);
    // depois do teto, todo passo devolve o MESMO objeto (terminal no-op)
    expect(estados[TETO_VOLTAS - 1]).toBe(estados[19]);
  });

  it("veredictos ininteligíveis (o caminho do LLM confuso) também terminam", () => {
    const lixo = [
      normalizarVeredicto(null),
      normalizarVeredicto("???"),
      normalizarVeredicto({ refutada: "talvez" }),
      normalizarVeredicto({ nota_sugerida: "oito" }),
      normalizarVeredicto({}),
    ];
    let e = iniciarConvergencia(7);
    for (let i = 0; i < 20; i++) e = aplicarRevisao(e, lixo[i % lixo.length]);
    expect(e.encerrado).toBe(true);
    expect(e.contestada).toBe(true);
    expect(e.nota).toBe(7); // nenhum lixo derrubou a nota
  });
});

describe("monotonicidade", () => {
  it("a nota só DESCE: sugestão maior e empate mantêm a atual", () => {
    let e = iniciarConvergencia(5);
    e = aplicarRevisao(e, { refutada: true, nota_sugerida: 9, motivo: "quis subir" });
    expect(e.nota).toBe(5);
    e = aplicarRevisao(e, { refutada: true, nota_sugerida: 5, motivo: "empatou" });
    expect(e.nota).toBe(5);
  });

  it("`volta` só cresce e o histórico registra cada passo", () => {
    let e = iniciarConvergencia(6);
    const voltas: number[] = [];
    while (podeRevisarDeNovo(e)) {
      e = aplicarRevisao(e, REFUTA);
      voltas.push(e.volta);
    }
    expect(voltas).toEqual([1, 2, 3].slice(0, TETO_VOLTAS));
    expect(e.historico.map((h) => h.volta)).toEqual(voltas);
  });

  it("nota que cai abaixo do corte encerra sem contestação (não há mais nota rara a defender)", () => {
    let e = iniciarConvergencia(NOTA_REVISAO_ADVERSARIAL);
    e = aplicarRevisao(e, {
      refutada: true,
      nota_sugerida: NOTA_REVISAO_ADVERSARIAL - 1,
      motivo: "sem ponteiro nomeado",
    });
    expect(e.nota).toBe(NOTA_REVISAO_ADVERSARIAL - 1);
    expect(e.encerrado).toBe(true);
    expect(e.motivo).toBe("abaixo_do_corte");
    expect(e.contestada).toBe(false);
  });
});

describe("desfechos", () => {
  it("revisor que tentou e não conseguiu encerra em ACEITA, sem contestação", () => {
    const e = aplicarRevisao(iniciarConvergencia(5), ACEITA);
    expect(e.encerrado).toBe(true);
    expect(e.motivo).toBe("aceita");
    expect(e.contestada).toBe(false);
    expect(e.nota).toBe(5);
  });

  it("aceitar depois de uma refutação que baixou a nota mantém a nota baixada", () => {
    let e = iniciarConvergencia(8);
    e = aplicarRevisao(e, { refutada: true, nota_sugerida: 5, motivo: "alcance não confirma" });
    e = aplicarRevisao(e, ACEITA);
    expect(e.nota).toBe(5);
    expect(e.volta).toBe(2);
    expect(e.encerrado).toBe(true);
  });

  it("a explicação diz como terminou, e o teto fala de segundo olhar humano", () => {
    let e = iniciarConvergencia(6);
    expect(explicarConvergencia(e)).toContain("volta 0");
    while (podeRevisarDeNovo(e)) e = aplicarRevisao(e, REFUTA);
    expect(explicarConvergencia(e)).toContain("humano");
    expect(explicarConvergencia(iniciarConvergencia(1))).toContain("abaixo do corte");
  });
});

describe("normalização do veredicto", () => {
  it("ilegível vira REFUTAÇÃO sem sugestão de nota", () => {
    for (const bruto of [null, undefined, "texto", 42, {}, { refutada: "sim" }]) {
      const v = normalizarVeredicto(bruto);
      expect(v.refutada).toBe(true);
      expect(v.nota_sugerida).toBeNull();
      expect(v.motivo.length).toBeGreaterThan(10);
    }
  });

  it("aceitação explícita é respeitada e ganha motivo quando vem sem texto", () => {
    const v = normalizarVeredicto({ refutada: false });
    expect(v.refutada).toBe(false);
    expect(v.motivo).toBe("nota sustentada");
  });

  it("nota sugerida é clampada na escala", () => {
    expect(normalizarVeredicto({ refutada: true, nota_sugerida: 999 }).nota_sugerida).toBe(
      NOTA_MAX,
    );
    expect(normalizarVeredicto({ refutada: true, nota_sugerida: -7 }).nota_sugerida).toBe(0);
    expect(normalizarVeredicto({ refutada: true, nota_sugerida: "x" }).nota_sugerida).toBeNull();
  });
});

describe("prompt do revisor", () => {
  const alvo: AlvoClassificacao = {
    projeto_id: "p1",
    nome: "Painel de margem",
    area: "Growth",
    ferramenta: "n8n",
    tipos: "especial",
    contexto_especial: "sem memorial financeiro",
    descricao: "roda todo dia",
    memorial: null,
    doc: null,
    submetido_em: "2026-08-01",
  };

  it("a tarefa é DERRUBAR e a nota maior é proibida", () => {
    const p = buildSystemPromptRevisor();
    expect(p).toContain("DERRUBAR");
    expect(p).toContain("IGUAL ou MENOR");
    // refutar exige NOMEAR a condição que falha — ver o teste da população abaixo
    expect(p).toContain("NOMEAR a condição da régua");
  });

  it("declara a população dos ESPECIAIS, não a base inteira — era o que o fazia refutar tudo", () => {
    // O revisor recebia `raridadeDe` (CURVA_BASE): "3+ = top 4% da base". Nos especiais auditados
    // ≥3★ é 42%, e com a moldura errada ele refutou 17 de 17 notas ≥3 (medido 28/08/2026), tornando
    // o corte de ≥3 absorvente: TODA nota alta virava 2★. Ver docs/plans/painel-agentes-especiais.md.
    const p = buildSystemPromptRevisor();
    const pct = Math.round(percentilNaCurva(CURVA_ESPECIAIS_AUDITADOS, NOTA_REVISAO_ADVERSARIAL));
    expect(pct).toBeGreaterThan(10); // sanidade: é a curva dos especiais (≥4 = 19%), não a da base (≥3 = 4%)
    expect(p).toContain(`${pct}%`);
    expect(p).toContain("ESPECIAIS");
    expect(p).not.toContain("top 4% da base");
    // e a dúvida deixou de ser refutação (era "Na dúvida, REFUTE")
    expect(p).toContain("Dúvida não é refutação");
  });

  it("nomeia o EIXO que sustenta a nota, com a âncora daquele eixo", () => {
    // O revisor recebia só a definição GLOBAL da faixa, que é conjuntiva ("inteligência no fluxo +
    // recorrência + evidência + adoção"): bastava faltar uma parte para refutar, e a nota do painel
    // é DISJUNTIVA (vem de UM eixo). Refutou 17 de 17 notas ≥3 (28/08/2026) → painel em 0% de ≥3★.
    const alcance = lentePorChave("alcance_reuso")!;
    const av: AvaliacaoLente[] = [
      {
        lente: "recorrencia_rastro",
        piso: null,
    ancora: null,
        nota: 2,
        evidencia: "nomeada",
        confianca: "alta",
        justificativa: "roda por cron e há painel nomeado",
        sustentacao: "painel Metabase de pedidos",
      },
      {
        lente: "alcance_reuso",
        piso: null,
    ancora: null,
        nota: 4,
        evidencia: "nomeada",
        confianca: "alta",
        justificativa: "duas áreas usam",
        sustentacao: "Fiscal e Compras usam o robô",
      },
    ];
    expect(eixoQueSustenta(av, 4)).toContain(alcance.rotulo);
    expect(eixoQueSustenta(av, 4)).toContain(alcance.ancoras.find((a) => a.nota === 4)!.definicao);

    const m = buildUserMessageRevisor({
      alvo,
      nota: 4,
      avaliacoes: av,
      vizinhos: [],
      comoSaiu: "alcance 4 com teto 4",
    });
    expect(m).toContain("O EIXO QUE SUSTENTA ESTA NOTA");
    // a definição global continua no prompt, mas rotulada como referência, não como requisito
    expect(m).toContain("NÃO é uma lista de requisitos");
  });

  it("o prompt PROÍBE refutar cobrando a condição de outro eixo", () => {
    const p = buildSystemPromptRevisor();
    expect(p).toContain("cobrar a condição de OUTRO eixo não é refutação");
    expect(p).toContain("DISJUNTIVA");
  });

  it("a raridade da mensagem sai da curva dos ESPECIAIS", () => {
    const m = buildUserMessageRevisor({
      alvo,
      nota: 3,
      avaliacoes: [],
      vizinhos: [],
      comoSaiu: "estrutural 3",
    });
    expect(m).toContain("dos especiais auditados");
    expect(m).not.toContain("da base");
  });

  it("a mensagem leva a nota, como ela saiu e os argumentos já usados", () => {
    const m = buildUserMessageRevisor({
      alvo,
      nota: 5,
      avaliacoes: [],
      vizinhos: [],
      comoSaiu: "estrutural 5 e alcance 5",
      refutacoesAnteriores: ["o painel é o próprio entregável"],
    });
    expect(m).toContain("5★");
    expect(m).toContain("estrutural 5");
    expect(m).toContain("não repita");
    expect(m).toContain("o painel é o próprio entregável");
  });

  it("sem voltas anteriores, não inventa a seção de argumentos usados", () => {
    const m = buildUserMessageRevisor({
      alvo,
      nota: 3,
      avaliacoes: [],
      vizinhos: [],
      comoSaiu: "x",
    });
    expect(m).not.toContain("VOLTAS ANTERIORES");
  });
});
