/**
 * Gate do CUSTO EVITADO DECLARADO NO CHAT — caso SmartOnline/DIFAL (10/08/2026).
 *
 * A fala real da autora está reproduzida abaixo palavra por palavra: é ela que tem de armar
 * o gate. Junto vão as três travas que impedem o gate de virar loop (o [1.4] já custou 38
 * perguntas em prod) e os falsos positivos que ele NÃO pode ter.
 */
import { describe, it, expect } from "vitest";
import {
  detectarCustoEvitadoNoChat,
  extrairValoresMonetarios,
  interpretarCustoEvitadoChat,
  perguntaCustoEvitadoChat,
  perguntaCustoEvitadoChatFirme,
  nudgeCustoEvitadoPago,
  deveBloquearPorCustoEvitadoChat,
  aplicaGateCustoEvitadoChat,
  custoEvitadoChatResolvido,
  OPCOES_CUSTO_EVITADO_CHAT,
  type EstadoCustoEvitadoChat,
} from "@/lib/agents/custo-evitado-chat";

// A fala que passou batido em produção (msg 18 do projeto dba1cc1c…).
const FALA_DIFAL =
  "Valor médio pago: com base na média de recolhimento de DIFAL das 7 empresas/filiais do " +
  "grupo (R$ 2.234.517,87/mês), aplicando o histórico real de multa e juros observado em " +
  "pagamentos com atraso (multa de 8% + juros SELIC ~6,5%, totalizando ~14,5% sobre o " +
  "principal), o custo evitado é de R$ 324.005,09/mês.";

const FALA_PEDIDO =
  "alem dos analistas, quero incluir o saving de quanto iriamos pagar de multa e juros de " +
  "difal, por nao recolher no vencimento";

describe("extrairValoresMonetarios", () => {
  it("lê valores pt-BR com e sem centavos", () => {
    expect(extrairValoresMonetarios("R$ 324.005,09 e R$ 3.600")).toEqual([324005.09, 3600]);
  });

  it("NÃO confunde percentual nem horas com dinheiro", () => {
    // "8%", "14,5%" e "60h" não podem virar valor — senão qualquer conversa de horas
    // armaria o gate. "14,5" tem vírgula mas só uma casa decimal.
    expect(extrairValoresMonetarios("multa de 8% + juros 6,5%, 60h/mês, 22 dias")).toEqual([]);
  });
});

describe("detectarCustoEvitadoNoChat", () => {
  it("arma no caso real (multa + juros + valor), que passou batido em prod", () => {
    const det = detectarCustoEvitadoNoChat([FALA_PEDIDO, FALA_DIFAL], null);
    expect(det).not.toBeNull();
    // O MAIOR valor citado é o principal do DIFAL; é o que dá a dimensão do que está em jogo.
    expect(det!.valor).toBe(2234517.87);
    expect(det!.marcas).toContain("multa");
    expect(det!.marcas).toContain("juros");
    expect(det!.marcas).toContain("custo-evitado");
  });

  it('arma no contrafactual "iríamos pagar" com valor — a forma que PISTAS_PROJECAO não cobre', () => {
    const det = detectarCustoEvitadoNoChat(
      ["sem a automação iriamos pagar R$ 12.500,00 de multa por mês"],
      null,
    );
    expect(det?.valor).toBe(12500);
    expect(det!.marcas).toContain("iriamos-pagar");
  });

  it("NÃO arma quando o valor já está cadastrado como item do formulário", () => {
    const itens = JSON.stringify([{ nome: "Multa de DIFAL", valor: 324005.09 }]);
    const det = detectarCustoEvitadoNoChat(
      ["o custo evitado é de R$ 324.005,09/mês de multa"],
      itens,
    );
    expect(det).toBeNull();
  });

  it("NÃO arma com termo ambíguo sem verbo de evitação (contrato pode ser CUSTO do projeto)", () => {
    const det = detectarCustoEvitadoNoChat(
      ["o contrato da plataforma custa R$ 3.600,00 por mês"],
      null,
    );
    expect(det).toBeNull();
  });

  it('arma quando o termo ambíguo vem com o verbo ("contrato cancelado")', () => {
    const det = detectarCustoEvitadoNoChat(
      ["cancelamos o contrato da terceirizada, eram R$ 3.600,00 por mês"],
      null,
    );
    expect(det?.valor).toBe(3600);
  });

  it("NÃO arma numa conversa normal de horas, sem dinheiro", () => {
    expect(
      detectarCustoEvitadoNoChat(
        ["eram 30h/mês do analista júnior e 30h/mês do sênior, hoje é 0h"],
        null,
      ),
    ).toBeNull();
  });

  it("exige valor e vocabulário na MESMA fala (não casa entre mensagens diferentes)", () => {
    expect(
      detectarCustoEvitadoNoChat(
        ["pagamos R$ 5.000,00 por mês de servidor", "tinha multa antes"],
        null,
      ),
    ).toBeNull();
  });
});

describe("interpretarCustoEvitadoChat", () => {
  it("clique decide (ordem fixa das opções)", () => {
    expect(OPCOES_CUSTO_EVITADO_CHAT).toHaveLength(2);
    expect(interpretarCustoEvitadoChat("", 1)).toBe("pago");
    expect(interpretarCustoEvitadoChat("", 2)).toBe("estimado");
  });

  it("texto livre: reconhece gasto real e estimativa", () => {
    expect(interpretarCustoEvitadoChat("é gasto real, pagamos todo mês", null)).toBe("pago");
    expect(interpretarCustoEvitadoChat("é uma estimativa do que aconteceria", null)).toBe(
      "estimado",
    );
  });

  it('a NEGAÇÃO vence: "não é estimativa, é real" → pago', () => {
    expect(interpretarCustoEvitadoChat("não é estimativa, isso a gente paga", null)).toBe("pago");
  });

  it("devolve null no ambíguo (o chamador repergunta 1x e encerra)", () => {
    expect(interpretarCustoEvitadoChat("sei lá", null)).toBeNull();
  });
});

describe("escopo do gate", () => {
  it("vale só nas fases de saving", () => {
    expect(aplicaGateCustoEvitadoChat("saving", "sim")).toBe(true);
    expect(aplicaGateCustoEvitadoChat("saving_preview", "sim")).toBe(true);
    expect(aplicaGateCustoEvitadoChat("receita", "sim")).toBe(false);
    expect(aplicaGateCustoEvitadoChat("doc", "sim")).toBe(false);
  });

  it("fica FORA do custo evitado puro (lá a validação de realidade já é cobrada)", () => {
    expect(aplicaGateCustoEvitadoChat("saving", "externo")).toBe(false);
  });

  it("bloqueia só preview/complete — pergunta intermediária passa", () => {
    expect(deveBloquearPorCustoEvitadoChat(null, "question")).toBe(false);
    expect(deveBloquearPorCustoEvitadoChat(null, "preview")).toBe(true);
    expect(deveBloquearPorCustoEvitadoChat(null, "complete")).toBe(true);
  });

  it('estados terminais liberam para sempre — inclusive "estimado"', () => {
    for (const t of ["pago", "estimado", "nao_respondido"] as EstadoCustoEvitadoChat[]) {
      expect(custoEvitadoChatResolvido(t)).toBe(true);
      expect(deveBloquearPorCustoEvitadoChat(t, "preview")).toBe(false);
    }
  });
});

describe("textos", () => {
  const det = detectarCustoEvitadoNoChat([FALA_DIFAL], null)!;

  it("a pergunta cita o valor e as duas naturezas, com acentuação", () => {
    const p = perguntaCustoEvitadoChat(det);
    expect(p).toContain("2.234.517,87");
    expect(p).toMatch(/já acontece e é medido/);
    expect(p).toMatch(/estimativa/);
  });

  it("a repergunta é curta e pede a escolha", () => {
    expect(perguntaCustoEvitadoChatFirme(det)).toMatch(/escolha/i);
  });

  it('o nudge de "pago" cobra a seção do memorial E o cadastro no formulário', () => {
    const n = nudgeCustoEvitadoPago(324005.09, "pagamos todo mês, sai no contas a pagar");
    expect(n).toContain("[SISTEMA]");
    expect(n).toContain("Contratos/Serviços Evitados");
    // O ponto que faltava: valor citado só no chat NÃO é gravado (o R$ vem do formulário).
    expect(n).toMatch(/CUSTO EVITADO/);
    expect(n).toMatch(/não é gravado/);
    expect(n).toContain("324.005,09");
  });

  it("nenhum texto vaza marcador de roteiro interno ([x.y])", () => {
    for (const t of [
      perguntaCustoEvitadoChat(det),
      perguntaCustoEvitadoChatFirme(det),
      nudgeCustoEvitadoPago(1, ""),
    ]) {
      expect(t).not.toMatch(/\[\d+\.\d+\]/);
    }
  });
});

/**
 * ANTI-LOOP — a trava que este repo já quebrou duas vezes. Simula a máquina de estados do
 * `chat.functions.ts` com um usuário que responde coisas ininteligíveis para sempre: o gate
 * tem de parar de perguntar em NO MÁXIMO 2 vezes e nunca andar para trás.
 */
describe("anti-loop (simulação de 20 turnos ininteligíveis)", () => {
  it("faz no máximo 2 perguntas e termina em estado absorvente", () => {
    // O estado vive num objeto (como no `estado.saving` do chat.functions) e é LIDO por
    // função: sem isso o TypeScript estreita o union dentro do laço e a simulação deixaria
    // de exercitar justamente os ramos que o gate real percorre.
    const st: { valor: EstadoCustoEvitadoChat | null } = { valor: null };
    const atual = (): EstadoCustoEvitadoChat | null => st.valor;
    let perguntas = 0;
    const ordem: Record<string, number> = {
      null: 0,
      pendente: 1,
      reperguntado: 2,
      pago: 3,
      estimado: 3,
      nao_respondido: 3,
    };

    for (let turno = 0; turno < 20; turno++) {
      const anterior = atual();
      // (a) turno de RESPOSTA (só quando há pergunta em aberto)
      if (atual() === "pendente" || atual() === "reperguntado") {
        const resp = interpretarCustoEvitadoChat("???", null);
        st.valor = resp ?? (atual() === "pendente" ? "reperguntado" : "nao_respondido");
      }
      // (b) o gate, lendo o estado VIVO, decide se pergunta
      if (deveBloquearPorCustoEvitadoChat(atual(), "preview")) {
        if (atual() === "reperguntado") {
          // O ramo que NÃO pode voltar a 'pendente' — era o loop real do gate irmão.
          st.valor = "nao_respondido";
        } else {
          perguntas++;
          st.valor = atual() === "pendente" ? "reperguntado" : "pendente";
        }
      }
      // MONOTÔNICO: nenhum ramo anda para trás.
      expect(ordem[String(atual())]).toBeGreaterThanOrEqual(ordem[String(anterior)]);
    }

    expect(perguntas).toBeLessThanOrEqual(2);
    expect(custoEvitadoChatResolvido(atual())).toBe(true);
  });

  it("clique na 1ª pergunta encerra com UMA pergunta só", () => {
    // Estado no turno da resposta: 'pendente' + clique na opção 1 → terminal, sem 2ª pergunta.
    const decidido: EstadoCustoEvitadoChat = interpretarCustoEvitadoChat("", 1) ?? "reperguntado";
    expect(decidido).toBe("pago");
    expect(deveBloquearPorCustoEvitadoChat(decidido, "complete")).toBe(false);
  });
});
