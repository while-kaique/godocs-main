// O ESCRITOR da discordância com o time de avaliação (`registrarFeedbackSombra`) — o elo que
// transforma um 👎 em lição.
//
// ⚠️ O caso central é o ROUND-TRIP: o que o escritor põe em `meta_json` é entregue ao
// `correcoesDoLog` REAL, e só então se afirma que virou `Correcao`. Sem isso, um teste que
// redigita as chaves à mão é espelho, não prova: renomear `leitura_do_agente` no escritor
// manteria a suíte verde e faria a lição nascer sem o par argumento/réplica.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/google/sheets", () => ({
  readAllRows: vi.fn(async () => []),
  updateRowByProjectId: vi.fn(async () => true),
}));

const espelhoFakeP = vi.hoisted(async () =>
  (await import("./helpers/espelho-fake")).criarEspelhoFake(),
);

vi.mock("@/integrations/db/client.server", async () => ({
  insertAdminStatusLog: vi.fn(),
  getAdminStatusLogs: vi.fn(async () => []),
  getAdminStatusLogsPorIds: vi.fn(async () => new Map()),
  getContrafactualAfetados: vi.fn(async () => null),
  getContrafactualAfetadosPorIds: vi.fn(async () => new Map()),
  getContribuicoesDeParticipantesPorIds: vi.fn(async () => new Map()),
  getReenviosDoProjeto: vi.fn(async () => []),
  getReenviosPorIds: vi.fn(async () => new Map()),
  getAvaliacoesNormaisPorIds: vi.fn(async () => new Map()),
  getAvaliacaoNormal: vi.fn(async () => null),
  getDeliberacao: vi.fn(async () => null),
  getDeliberacoesPorIds: vi.fn(async () => new Map()),
  getAvaliacaoRetroativa: vi.fn(async () => null),
  getAvaliacoesRetroativasPorIds: vi.fn(async () => new Map()),
  getFeedbacksPorIds: vi.fn(async () => new Map()),
  getAvaliacaoFeedback: vi.fn(async () => null),
  upsertAvaliacaoFeedback: vi.fn(async () => undefined),
  deleteAvaliacaoFeedback: vi.fn(async () => undefined),
  getAprovacoesDoProjeto: vi.fn(async () => []),
  getAprovacoesDeProjetos: vi.fn(async () => []),
  ...(await espelhoFakeP).api,
  getAllProjetoIds: vi.fn(async () => []),
  getProjetosParaSyncReverso: vi.fn(async () => []),
  getProjetosNaoRascunho: vi.fn(async () => []),
  getProjetosByOwnerEmail: vi.fn(async () => []),
  getProjetoById: vi.fn(async () => undefined),
  insertProjetoRaw: vi.fn(async () => undefined),
  updateProjeto: vi.fn(async () => undefined),
  excluirProjetoCascade: vi.fn(async () => undefined),
  parseJson: (v: string | null) => {
    if (!v) return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  },
}));

// A auditoria é mockada para se poder INSPECIONAR o que o escritor mandou gravar — é dela que
// sai o `meta_json` da lição.
vi.mock("@/lib/atividades.functions", () => ({
  // ⚠️ Imita o retorno REAL (`true` = gravou): `registrarFeedbackSombra` só afirma "virou lição"
  // quando a auditoria confirma a escrita, então um mock que devolvesse `undefined` testaria
  // outro sistema.
  registrarAtividade: vi.fn(async () => true),
}));

import {
  getAvaliacaoNormal,
  upsertAvaliacaoFeedback,
  deleteAvaliacaoFeedback,
} from "@/integrations/db/client.server";
import { registrarAtividade } from "@/lib/atividades.functions";
import { registrarFeedbackSombra } from "@/lib/dashboard-admin.functions";
import { correcoesDoLog, ensinaAlgo, MOTIVO_MIN } from "@/lib/correcoes";

const registrar = vi.mocked(registrarAtividade);
const upsert = vi.mocked(upsertAvaliacaoFeedback);
const apagar = vi.mocked(deleteAvaliacaoFeedback);
const avaliacaoNormal = vi.mocked(getAvaliacaoNormal);

const PARECER_DA_MESA =
  "Horas: 120h/mês para uma pessoa só não fecha.\nFinanceiro: o valor bate com a descrição.";

beforeEach(() => {
  vi.clearAllMocks();
  avaliacaoNormal.mockResolvedValue({
    projeto_id: "p-1",
    veredito: "aprovar",
    confianca: 0.71,
    aplicar: 0,
    divergencia: 0,
    motivo: PARECER_DA_MESA,
    votos: null,
    origem: "mesa",
    modelo: null,
    criado_em: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

/** A linha de log que o `queryAdminActivities` devolveria para o que o escritor gravou. */
function linhaDoLogGravada() {
  expect(registrar).toHaveBeenCalledTimes(1);
  const reg = registrar.mock.calls[0][0];
  return {
    acao: String(reg.acao),
    projeto_id: reg.projeto_id ?? null,
    projeto_nome: reg.projeto_nome ?? null,
    meta_json: JSON.stringify(reg.meta ?? {}),
    created_at: "2026-09-08T12:00:00Z",
  };
}

describe("registrarFeedbackSombra — o servidor cobra o porquê", () => {
  it("RECUSA motivo mais curto que o piso, e não grava nada", async () => {
    await expect(
      registrarFeedbackSombra(
        { projetoId: "p-1", voto: "dislike", eixo: "horas", motivo: "errou" },
        "admin@gocase.com",
      ),
    ).rejects.toThrow(new RegExp(String(MOTIVO_MIN)));
    expect(upsert).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it("o piso é o MESMO do `ensinaAlgo`: um caractere abaixo recusa, no piso aceita", async () => {
    const curto = "x".repeat(MOTIVO_MIN - 1);
    await expect(
      registrarFeedbackSombra(
        { projetoId: "p-1", voto: "dislike", eixo: "horas", motivo: curto },
        "admin@gocase.com",
      ),
    ).rejects.toThrow();

    vi.clearAllMocks();
    await registrarFeedbackSombra(
      { projetoId: "p-1", voto: "dislike", eixo: "horas", motivo: "x".repeat(MOTIVO_MIN) },
      "admin@gocase.com",
    );
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it("👎 SEM motivo grava o voto e NÃO registra lição (é o polegar simples de sempre)", async () => {
    await registrarFeedbackSombra({ projetoId: "p-1", voto: "dislike" }, "admin@gocase.com");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('o "like" LEGADO segue aceito (aba com JS em cache não leva 400) e não ensina nada', async () => {
    await registrarFeedbackSombra({ projetoId: "p-1", voto: "like" }, "admin@gocase.com");
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(registrar).not.toHaveBeenCalled();
  });

  it("voto null apaga o estado e não registra lição", async () => {
    await registrarFeedbackSombra({ projetoId: "p-1", voto: null }, "admin@gocase.com");
    expect(apagar).toHaveBeenCalledWith("p-1");
    expect(upsert).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });
});

describe("registrarFeedbackSombra — round-trip: o que foi gravado volta como lição", () => {
  const DISCORDANCIA = {
    projetoId: "p-1",
    projetoNome: "Robô de Faturamento",
    voto: "dislike" as const,
    eixo: "horas" as const,
    vereditoCerto: "reprovar",
    motivo: "As 120h são de três pessoas, não de uma, e o memorial não diz isso.",
  };

  it("o meta_json gravado é lido de volta por `correcoesDoLog` SEM PERDA", async () => {
    await registrarFeedbackSombra(DISCORDANCIA, "admin@gocase.com");

    // ⚠️ O parser REAL, sobre o que o escritor REAL produziu: é isto que pega um rename de chave.
    const correcoes = correcoesDoLog([linhaDoLogGravada()]);
    expect(correcoes).toHaveLength(1);
    const c = correcoes[0];
    expect(c).toMatchObject({
      tipo: "veredito",
      projeto_id: "p-1",
      projeto_nome: "Robô de Faturamento",
      eixo: "horas",
      motivo: DISCORDANCIA.motivo,
      veredito_de: "aprovar",
      veredito_para: "reprovar",
    });
    // E ela passa o portão do motivo — o que a torna lição de verdade, não só linha de log.
    expect(ensinaAlgo(c)).toBe(true);
  });

  it("a `leitura_do_agente` gravada é a frase do especialista DO EIXO escolhido", async () => {
    await registrarFeedbackSombra(DISCORDANCIA, "admin@gocase.com");
    const c = correcoesDoLog([linhaDoLogGravada()])[0];
    // O eixo era `horas`, então o par tem de guardar a linha do especialista de HORAS — não o
    // parecer inteiro (que o `recortar` de 220 chars cortaria justamente nas primeiras linhas,
    // quase nunca a que a pessoa respondeu).
    expect(c.leitura_agente).toContain("120h/mês para uma pessoa só não fecha");
    expect(c.leitura_agente).not.toContain("o valor bate com a descrição");
  });

  it("o veredito do agente entra no par mesmo quando a mesa ainda não avaliou", async () => {
    avaliacaoNormal.mockResolvedValue(null);
    await registrarFeedbackSombra(DISCORDANCIA, "admin@gocase.com");
    const c = correcoesDoLog([linhaDoLogGravada()])[0];
    // Sem avaliação, `veredito_de` fica nulo — e aí NÃO há mudança a ensinar (o portão barra),
    // porque "corrigiu de nada para reprovar" não é uma correção de raciocínio.
    expect(c.veredito_de).toBeNull();
    expect(ensinaAlgo(c)).toBe(false);
  });

  it("DIZ que virou lição quando virou, e diz que NÃO quando não vira", async () => {
    const ok = await registrarFeedbackSombra(DISCORDANCIA, "admin@gocase.com");
    expect(ok).toMatchObject({ virouLicao: true, porque: null });

    // Mesmo desfecho que o agente deu: não há correção de raciocínio a ensinar.
    vi.clearAllMocks();
    const igual = await registrarFeedbackSombra(
      { ...DISCORDANCIA, vereditoCerto: "aprovar" },
      "admin@gocase.com",
    );
    expect(igual).toMatchObject({ virouLicao: false });
    expect((igual as { porque: string | null }).porque).toMatch(/mesmo que o agente/i);

    // Mesa ainda não avaliou: sem recomendação, não há o que corrigir.
    vi.clearAllMocks();
    avaliacaoNormal.mockResolvedValue(null);
    const semMesa = await registrarFeedbackSombra(DISCORDANCIA, "admin@gocase.com");
    expect(semMesa).toMatchObject({ virouLicao: false });
    expect((semMesa as { porque: string | null }).porque).toMatch(/ainda não avaliou/i);
  });

  it('a rota NÃO aceita "nota certa" (a ficha não tem nota do agente para comparar)', async () => {
    await registrarFeedbackSombra(
      { ...DISCORDANCIA, notaCerta: 7 } as unknown as Record<string, unknown>,
      "admin@gocase.com",
    );
    const meta = registrar.mock.calls[0][0].meta as Record<string, unknown>;
    expect(meta).not.toHaveProperty("nota_certa");
  });

  it("falha ao ler a avaliação não derruba o registro da discordância", async () => {
    avaliacaoNormal.mockRejectedValue(new Error("banco fora"));
    await expect(registrarFeedbackSombra(DISCORDANCIA, "admin@gocase.com")).resolves.toMatchObject({
      ok: true,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
