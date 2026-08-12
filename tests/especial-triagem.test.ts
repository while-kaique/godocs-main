/**
 * TRIAGEM DO PROJETO ESPECIAL (Etapa 2.5) — 2 perguntas que DESQUALIFICAM.
 *
 * O "especial" pula o memorial financeiro e vai direto à validação humana, e por essa porta
 * entravam dois perfis que não são especiais: **dashboard/painel de controle** (é uma
 * entrega — o ganho aparece nas horas que ninguém gasta mais montando o relatório) e
 * projeto cujo ganho principal é **apenas organizacional** (organizar é meio, não impacto).
 *
 * O gate é de FORMULÁRIO e DETERMINÍSTICO: qualquer "sim" bloqueia o envio com a mensagem da
 * fonte única (`src/lib/mensagens-submissao.ts`). Não há máquina de estados de chat aqui — a
 * pessoa clica, a tela responde na hora, e a mesma função pura decide na hora de enviar.
 */
import { describe, it, expect } from "vitest";
import {
  motivoBloqueioEspecial,
  validarEtapa25Especial,
} from "@/lib/submeter/constants";
import {
  PERGUNTAS_ESPECIAL,
  mensagemEspecialDashboard,
  mensagemEspecialGanhoOrganizacional,
  mensagemEspecialInvalido,
} from "@/lib/mensagens-submissao";

type Triagem = Parameters<typeof motivoBloqueioEspecial>[0];

function tri(over: Partial<Triagem> = {}): Triagem {
  return {
    especial: true,
    especialDashboard: "",
    especialGanhoOrganizacional: "",
    ...over,
  };
}

describe("PERGUNTAS_ESPECIAL — texto acordado (mudar tem de ser DECISÃO)", () => {
  it("são exatamente as 2 perguntas, na ordem, com os 2 rótulos cada", () => {
    expect(PERGUNTAS_ESPECIAL.map((p) => p.id)).toEqual(["dashboard", "organizacional"]);
    expect(PERGUNTAS_ESPECIAL[0].pergunta).toBe(
      "Este projeto é, objetivamente (ou principalmente), um dashboard ou um painel de controle?",
    );
    expect(PERGUNTAS_ESPECIAL[1].pergunta).toBe(
      "O ganho principal deste projeto é prioritariamente organizacional?",
    );
    for (const p of PERGUNTAS_ESPECIAL) {
      expect(p.sim.length).toBeGreaterThan(3);
      expect(p.nao.length).toBeGreaterThan(3);
    }
  });

  it("as perguntas têm acentuação (regra 4) e não vazam roteiro interno", () => {
    for (const p of PERGUNTAS_ESPECIAL) {
      expect(p.pergunta).toMatch(/[áàãâéêíóõôúç]/i);
      expect(p.pergunta).not.toMatch(/\[\d+\.\d+\]/);
    }
  });
});

describe("motivoBloqueioEspecial — o predicado do bloqueio", () => {
  it("projeto PADRÃO nunca é afetado, mesmo com as respostas marcadas", () => {
    expect(
      motivoBloqueioEspecial(
        tri({ especial: false, especialDashboard: "sim", especialGanhoOrganizacional: "sim" }),
      ),
    ).toBeNull();
  });

  it("perguntas em branco NÃO bloqueiam (quem cobra a resposta é a validação)", () => {
    expect(motivoBloqueioEspecial(tri())).toBeNull();
  });

  it('"sim" para dashboard bloqueia por dashboard', () => {
    expect(motivoBloqueioEspecial(tri({ especialDashboard: "sim" }))).toBe("dashboard");
  });

  it('"sim" para ganho organizacional bloqueia por organizacional', () => {
    expect(
      motivoBloqueioEspecial(
        tri({ especialDashboard: "nao", especialGanhoOrganizacional: "sim" }),
      ),
    ).toBe("organizacional");
  });

  it("com os dois 'sim', o dashboard vence (é o critério objetivo)", () => {
    expect(
      motivoBloqueioEspecial(
        tri({ especialDashboard: "sim", especialGanhoOrganizacional: "sim" }),
      ),
    ).toBe("dashboard");
  });

  it("as duas respondidas com 'não' liberam o especial", () => {
    expect(
      motivoBloqueioEspecial(
        tri({ especialDashboard: "nao", especialGanhoOrganizacional: "nao" }),
      ),
    ).toBeNull();
  });
});

describe("validarEtapa25Especial — o que a tela cobra", () => {
  it("projeto padrão não gera erro nenhum", () => {
    expect(validarEtapa25Especial(tri({ especial: false }))).toEqual({});
  });

  it("cobra a 1ª pergunta quando nada foi respondido", () => {
    const errs = validarEtapa25Especial(tri());
    expect(errs.especialDashboard).toMatch(/Responda/);
    expect(errs.especialGanhoOrganizacional).toBeUndefined();
    expect(errs.especialBloqueio).toBeUndefined();
  });

  it("cobra a 2ª pergunta só depois de a 1ª ser 'não' (é quando ela aparece)", () => {
    const errs = validarEtapa25Especial(tri({ especialDashboard: "nao" }));
    expect(errs.especialDashboard).toBeUndefined();
    expect(errs.especialGanhoOrganizacional).toMatch(/Responda/);
  });

  it("com a 1ª em 'sim', NÃO cobra a 2ª (ela nem é exibida) — só bloqueia", () => {
    const errs = validarEtapa25Especial(tri({ especialDashboard: "sim" }));
    expect(errs.especialGanhoOrganizacional).toBeUndefined();
    expect(errs.especialBloqueio).toBe(mensagemEspecialDashboard());
  });

  it("o bloqueio por ganho organizacional usa a mensagem da fonte única", () => {
    const errs = validarEtapa25Especial(
      tri({ especialDashboard: "nao", especialGanhoOrganizacional: "sim" }),
    );
    expect(errs.especialBloqueio).toBe(mensagemEspecialGanhoOrganizacional());
  });

  it("as duas em 'não' passam sem erro (o contexto especial segue sendo exigido à parte)", () => {
    expect(
      validarEtapa25Especial(
        tri({ especialDashboard: "nao", especialGanhoOrganizacional: "nao" }),
      ),
    ).toEqual({});
  });
});

describe("as 2 mensagens de bloqueio", () => {
  const dashboard = mensagemEspecialDashboard();
  const organizacional = mensagemEspecialGanhoOrganizacional();

  it("o dispatcher devolve a mensagem de cada motivo", () => {
    expect(mensagemEspecialInvalido("dashboard")).toBe(dashboard);
    expect(mensagemEspecialInvalido("organizacional")).toBe(organizacional);
  });

  it("dizem o que foi respondido e por que isso não é especial", () => {
    expect(dashboard).toMatch(/dashboard/i);
    expect(dashboard).toMatch(/painel de controle/i);
    // A NEGAÇÃO é o que importa, não a redação exata: hoje o título diz "não entram como
    // projeto especial" (antes era "não é projeto especial"). Reescrever a frase é permitido;
    // publicar uma mensagem que não nega o enquadramento, não.
    expect(dashboard).toMatch(/não (é|entram? como) projeto especial/i);
    expect(organizacional).toMatch(/organizacional/i);
    expect(organizacional).toMatch(/sem saving considerado nem receita real medida/i);
  });

  it("terminam ensinando o caminho (padrão do módulo: 'Para corrigir…')", () => {
    for (const msg of [dashboard, organizacional]) {
      expect(msg).toMatch(/Para corrigir/);
      expect(msg).toMatch(/Saving Operacional/);
      expect(msg).toMatch(/Receita Incremental/);
      expect(msg).toMatch(/CUSTO EVITADO/);
      // Acentuação obrigatória (regra 4) e nenhum código de roteiro interno.
      expect(msg).not.toMatch(/\bproducao\b|\bsubmissao\b|\[\d+\.\d+\]/);
      expect(msg.length).toBeGreaterThan(80);
    }
  });

  it("NÃO expõem R$ (a triagem é qualitativa; valor/hora é escondido do usuário)", () => {
    for (const msg of [dashboard, organizacional]) {
      expect(msg).not.toMatch(/R\$\s*[\d.,]+/);
    }
  });
});
