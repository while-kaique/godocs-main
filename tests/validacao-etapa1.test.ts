// Validação pura da Etapa 1 (Envio) — participantes/papéis + campos do projeto.
// Guarda a decisão D2/RF-103 (edição de legado relaxa escopo/status/ferramenta) sem
// regredir a submissão NOVA (RF-106). Função pura extraída de submeter.tsx.
import { describe, it, expect } from "vitest";
import {
  validarEtapa1,
  selecionadosComPapel,
  papeisRepetidos,
  limitarUmPorPapel,
  type FormData,
} from "@/lib/submeter/constants";

// Form base VÁLIDO para submissão nova (todos os campos preenchidos, sem equipe).
function baseForm(over: Partial<FormData> = {}): FormData {
  return {
    escopo: "interno",
    prodStatus: "sim",
    nome: "",
    email: "dono@gocase.com",
    ferramentas: ["Python"],
    ferramentaOutra: "",
    servicoExterno: "",
    emEquipe: "nao",
    participantes: [],
    participantesPapeis: {},
    participantesContribuicoes: {},
    ganhoCategorias: ["saving_efetivado"],
    nomeProjeto: "",
    descricaoBreve: "",
    usaAiProxy: "",
    contrafactualAfetadosTipo: "pessoa",
    contrafactualAfetados: [],
    temAppGodeploy: "",
    urlGodeploy: "",
    vinculo: "novo",
    paiId: "",
    paiNome: "",
    ...over,
  };
}

describe("validarEtapa1 — submissão NOVA (modoEdicao=false, RF-106)", () => {
  it("form completo e válido passa sem erros", () => {
    expect(validarEtapa1(baseForm(), { modoEdicao: false })).toEqual({});
  });

  it("bloqueia por ferramenta ausente (validação cheia)", () => {
    const errs = validarEtapa1(baseForm({ ferramentas: [] }), { modoEdicao: false });
    expect(errs.ferramentas).toBeTruthy();
  });

  it("bloqueia por escopo ausente", () => {
    const errs = validarEtapa1(baseForm({ escopo: "" }), { modoEdicao: false });
    expect(errs.escopo).toBeTruthy();
  });

  it("bloqueia projeto fora de produção", () => {
    const errs = validarEtapa1(baseForm({ prodStatus: "dev" }), { modoEdicao: false });
    expect(errs.prodStatus).toBeTruthy();
  });

  it("externo exige nome do serviço", () => {
    const errs = validarEtapa1(
      baseForm({ escopo: "externo", ferramentas: [], servicoExterno: "" }),
      { modoEdicao: false },
    );
    expect(errs.servicoExterno).toBeTruthy();
  });
});

describe("validarEtapa1 — EDIÇÃO de legado (modoEdicao=true, RF-103/D2)", () => {
  it("legado sem ferramenta/escopo/status passa (só participantes é o foco)", () => {
    const legado = baseForm({ escopo: "", prodStatus: "", ferramentas: [], emEquipe: "nao" });
    expect(validarEtapa1(legado, { modoEdicao: true })).toEqual({});
  });

  it("prodStatus fora de produção NÃO trava em edição", () => {
    const errs = validarEtapa1(baseForm({ prodStatus: "dev" }), { modoEdicao: true });
    expect(errs.prodStatus).toBeUndefined();
  });

  it("ainda exige identidade detectada (e-mail da conta)", () => {
    const errs = validarEtapa1(baseForm({ email: "" }), { modoEdicao: true });
    expect(errs.email).toBeTruthy();
  });

  // A ferramenta virou EDITÁVEL na Etapa 1 da edição (a stack muda: Vercel → GoDeploy).
  // Trocar de uma opção da lista para outra — ou marcar VÁRIAS — não pode gerar erro.
  it("trocar/acumular ferramentas na edição não gera erro", () => {
    const errs = validarEtapa1(baseForm({ ferramentas: ["Claude Code", "GoDeploy"] }), {
      modoEdicao: true,
    });
    expect(errs).toEqual({});
  });
});

// "Outros" sem o nome gravaria a string literal "Outros" na planilha — é o único pedaço
// da ferramenta cobrado nos DOIS modos (a ferramenta em si segue opcional no legado).
describe('validarEtapa1 — "Outros" exige o nome da ferramenta nos DOIS modos', () => {
  for (const modoEdicao of [false, true]) {
    it(`bloqueia "Outros" sem especificar (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(baseForm({ ferramentas: ["Outros"], ferramentaOutra: "  " }), {
        modoEdicao,
      });
      expect(errs.ferramentaOutra).toBeTruthy();
    });

    it(`aceita "Outros" com o nome preenchido (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(baseForm({ ferramentas: ["Outros"], ferramentaOutra: "Retool" }), {
        modoEdicao,
      });
      expect(errs.ferramentaOutra).toBeUndefined();
    });
  }

  it('escopo externo não é cobrado pela regra do "Outros"', () => {
    const errs = validarEtapa1(
      baseForm({
        escopo: "externo",
        ferramentas: ["Outros"],
        ferramentaOutra: "",
        servicoExterno: "Zapier",
      }),
      { modoEdicao: true },
    );
    expect(errs.ferramentaOutra).toBeUndefined();
  });
});

describe("validarEtapa1 — participantes/papéis exigidos nos DOIS modos (RF-101/RF-102)", () => {
  for (const modoEdicao of [false, true]) {
    it(`em equipe sem participante bloqueia (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(baseForm({ emEquipe: "sim", participantes: [] }), { modoEdicao });
      expect(errs.participantes).toBeTruthy();
    });

    it(`participante com domínio inválido bloqueia (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["fulano@gmail.com"],
          participantesPapeis: { "fulano@gmail.com": "coexecutor" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain("@gocase");
    });

    it(`participante sem papel escolhido bloqueia (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com"],
          participantesPapeis: { "a@gocase.com": "" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBe("Escolha o papel de cada participante");
    });

    it(`participante válido com papel passa quanto a participantes (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com"],
          participantesPapeis: { "a@gocase.com": "contribuidor" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBeUndefined();
    });
  }
});

// ⚠️ CADA PAPEL é ÚNICO por projeto (decisão do dono do produto 15/09/2026, generalizando a
// regra do Coautor de 30/07): 1 autor (o submissor) + 1 Coautor + 1 Participante + 1
// Contribuidor. Vale nos DOIS modos (submissão nova e edição de legado, que é de onde vêm os
// mapas com repetição).
describe("um participante por papel", () => {
  for (const modoEdicao of [false, true]) {
    it(`bloqueia 2 Coautores (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com", "b@gocase.com"],
          participantesPapeis: { "a@gocase.com": "coexecutor", "b@gocase.com": "coexecutor" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain("1 Coautor");
    });

    // Antes de 15/09 estes dois passavam: só o Coautor era limitado.
    it(`bloqueia 2 Participantes (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com", "b@gocase.com"],
          participantesPapeis: { "a@gocase.com": "planejador", "b@gocase.com": "planejador" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain("1 Participante");
    });

    it(`bloqueia 2 Contribuidores (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com", "b@gocase.com"],
          participantesPapeis: { "a@gocase.com": "contribuidor", "b@gocase.com": "contribuidor" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain("1 Contribuidor");
    });

    it(`nomeia TODOS os papéis repetidos, não só o primeiro (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com", "b@gocase.com", "c@gocase.com", "d@gocase.com"],
          participantesPapeis: {
            "a@gocase.com": "coexecutor",
            "b@gocase.com": "coexecutor",
            "c@gocase.com": "contribuidor",
            "d@gocase.com": "contribuidor",
          },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toContain("Coautor");
      expect(errs.participantes).toContain("Contribuidor");
    });

    it(`aceita um de cada papel (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com", "b@gocase.com", "c@gocase.com"],
          participantesPapeis: {
            "a@gocase.com": "coexecutor",
            "b@gocase.com": "planejador",
            "c@gocase.com": "contribuidor",
          },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBeUndefined();
    });

    it(`aceita projeto SEM Coautor (modoEdicao=${modoEdicao})`, () => {
      const errs = validarEtapa1(
        baseForm({
          emEquipe: "sim",
          participantes: ["a@gocase.com", "b@gocase.com"],
          participantesPapeis: { "a@gocase.com": "planejador", "b@gocase.com": "contribuidor" },
        }),
        { modoEdicao },
      );
      expect(errs.participantes).toBeUndefined();
    });
  }
});

describe("selecionadosComPapel / papeisRepetidos / limitarUmPorPapel (helpers puros)", () => {
  it("lista só quem tem aquele papel, na ordem da lista", () => {
    const participantes = ["a@gocase.com", "b@gocase.com", "c@gocase.com"];
    const papeis = {
      "a@gocase.com": "planejador",
      "b@gocase.com": "coexecutor",
      "c@gocase.com": "coexecutor",
    } as const;
    expect(selecionadosComPapel(participantes, { ...papeis }, "coexecutor")).toEqual([
      "b@gocase.com",
      "c@gocase.com",
    ]);
  });

  it("papeisRepetidos devolve os papéis com 2+, na ordem do catálogo", () => {
    const participantes = ["a@gocase.com", "b@gocase.com", "c@gocase.com", "d@gocase.com"];
    const papeis = {
      "a@gocase.com": "contribuidor",
      "b@gocase.com": "contribuidor",
      "c@gocase.com": "coexecutor",
      "d@gocase.com": "coexecutor",
    } as const;
    expect(papeisRepetidos(participantes, { ...papeis })).toEqual(["coexecutor", "contribuidor"]);
  });

  /**
   * ⚠️ Mantém o PRIMEIRO e LIMPA os demais — não promove ninguém por conta própria. Quem
   * reclassifica é a pessoa; o formulário já exige papel de todos, então ninguém escapa em
   * branco.
   */
  it("seed do legado com repetição: mantém o primeiro de CADA papel e limpa o resto", () => {
    const participantes = ["a@gocase.com", "b@gocase.com", "c@gocase.com", "d@gocase.com"];
    const papeis = {
      "a@gocase.com": "coexecutor",
      "b@gocase.com": "coexecutor",
      "c@gocase.com": "planejador",
      "d@gocase.com": "planejador",
    } as const;
    expect(limitarUmPorPapel(participantes, { ...papeis })).toEqual({
      "a@gocase.com": "coexecutor",
      "b@gocase.com": "",
      "c@gocase.com": "planejador",
      "d@gocase.com": "",
    });
  });

  it("seed já conforme volta inalterado (a MESMA referência, sem cópia)", () => {
    const participantes = ["a@gocase.com", "b@gocase.com"];
    const papeis = { "a@gocase.com": "coexecutor", "b@gocase.com": "contribuidor" } as const;
    const entrada = { ...papeis };
    expect(limitarUmPorPapel(participantes, entrada)).toBe(entrada);
  });
});
