/**
 * Montagem final do PAINEL (T6) — parte PURA + a guarda de que `dry` não grava.
 *
 * O que estes testes prendem:
 * - **`dry` é o DEFAULT e não grava nada** (a guarda pedida pelo plano): a rota em lote é chamada
 *   sem `dry` e nenhuma escrita acontece; só `{dry:false}` grava;
 * - **a coluna "Estrelas" nunca é tocada** e a `origem` é `painel-agentes` (é ela que separa o
 *   painel do agente único no cartão — a tabela tem UMA linha por projeto);
 * - **o teto de CUSTO para a corrida** e devolve `proximo_offset` de onde continuar;
 * - **nunca lança**: projeto que falha vira linha em `falhas` e a corrida segue;
 * - a confiança do painel: lente faltando ou `contestada` → baixa; nota rara → no máximo média;
 * - a leitura determinística nomeia a prova de cada eixo (4 números sem endereço não servem).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MAX_LEITURA_PAINEL,
  ORIGEM_PAINEL,
  confiancaDoPainel,
  leituraDoPainel,
} from "@/lib/especiais-painel";
import {
  LENTES,
  LENTE_GATE,
  consolidarLentes,
  type AvaliacaoLente,
} from "@/lib/agents/especiais-lentes";
import {
  aplicarRevisao,
  iniciarConvergencia,
  podeRevisarDeNovo,
} from "@/lib/especiais-convergencia";
import { NOTA_EXIGE_PROVA_NOMEADA } from "@/lib/especiais-calibrador";

function av(
  lente: string,
  nota: number,
  evidencia: "nomeada" | "vaga" | "ausente" = "nomeada",
): AvaliacaoLente {
  return {
    lente,
    piso: null,
    ancora: null,
    nota,
    evidencia,
    confianca: "media",
    justificativa: "porque sim",
    sustentacao: "relatório de faturamento diário",
  };
}

const TODAS = (nota: number, ev: "nomeada" | "vaga" | "ausente" = "nomeada") =>
  LENTES.map((l) => av(l.chave, nota, ev));

describe("confiança do painel", () => {
  it("lente faltando → BAIXA (julgou com menos olhos)", () => {
    const avals = [av(LENTE_GATE, 1)];
    const c = consolidarLentes(avals);
    expect(c.faltando.length).toBeGreaterThan(0);
    expect(confiancaDoPainel(avals, c, iniciarConvergencia(1), 1)).toBe("baixa");
  });

  it("contestada (não convergiu) → BAIXA", () => {
    const avals = TODAS(6);
    let e = iniciarConvergencia(6);
    while (podeRevisarDeNovo(e)) {
      e = aplicarRevisao(e, { refutada: true, nota_sugerida: null, motivo: "nada prova" });
    }
    expect(e.contestada).toBe(true);
    expect(confiancaDoPainel(avals, consolidarLentes(avals), e, e.nota)).toBe("baixa");
  });

  it("nota rara (≥3) nunca passa de MÉDIA, mesmo com tudo respondido e prova nomeada", () => {
    const avals = TODAS(4);
    const c = consolidarLentes(avals);
    const e = aplicarRevisao(iniciarConvergencia(4), {
      refutada: false,
      nota_sugerida: null,
      motivo: "sustentou",
    });
    expect(confiancaDoPainel(avals, c, e, 4)).toBe("media");
  });

  it("nota baixa, todas as lentes e prova nomeada no eixo estrutural → ALTA", () => {
    const avals = TODAS(2);
    expect(confiancaDoPainel(avals, consolidarLentes(avals), iniciarConvergencia(2), 2)).toBe(
      "alta",
    );
    expect(NOTA_EXIGE_PROVA_NOMEADA).toBeGreaterThan(2);
  });

  it("prova só VAGA no eixo estrutural não dá confiança alta", () => {
    const avals = TODAS(2, "vaga");
    expect(confiancaDoPainel(avals, consolidarLentes(avals), iniciarConvergencia(2), 2)).toBe(
      "media",
    );
  });
});

describe("leitura determinística", () => {
  it("nomeia a PROVA de cada eixo, não só a nota", () => {
    const avals = TODAS(2);
    const texto = leituraDoPainel({
      linha: { projeto_id: "p", nota_antes: 2, nota_depois: 2, motivos: [] },
      avaliacoes: avals,
      estado: iniciarConvergencia(2),
    });
    expect(texto).toContain("prova nomeada");
    for (const l of LENTES) expect(texto).toContain(l.rotulo);
    expect(texto).toContain("abaixo do corte");
  });

  it("mostra o argumento do revisor quando houve refutação, e respeita o teto de tamanho", () => {
    const e = aplicarRevisao(iniciarConvergencia(5), {
      refutada: true,
      nota_sugerida: 2,
      motivo: "o painel citado é o próprio entregável do projeto",
    });
    const texto = leituraDoPainel({
      linha: { projeto_id: "p", nota_antes: 5, nota_depois: 2, motivos: ["prova_nao_nomeada"] },
      avaliacoes: TODAS(5),
      estado: e,
      refutacao: "o painel citado é o próprio entregável do projeto",
    });
    expect(texto).toContain("Revisor:");
    expect(texto).toContain("próprio entregável");
    expect(texto.length).toBeLessThanOrEqual(MAX_LEITURA_PAINEL);
  });

  it("corta no teto quando as justificativas são gigantes", () => {
    const gordas = LENTES.map((l) => ({ ...av(l.chave, 3), justificativa: "x".repeat(400) }));
    const texto = leituraDoPainel({
      linha: { projeto_id: "p", nota_antes: 3, nota_depois: 3, motivos: [] },
      avaliacoes: gordas,
      estado: iniciarConvergencia(3),
    });
    expect(texto.length).toBeLessThanOrEqual(MAX_LEITURA_PAINEL);
  });
});

// ─── O lote: `dry` não grava, teto para a corrida, falha não derruba ───────────

const upsertAvaliacao = vi.fn();
const upsertEmbedding = vi.fn();
const avaliarComLentes = vi.fn();
const revisarAdversarial = vi.fn();
const redigirLeitura = vi.fn();

function resumo(id: string, estrelas: number | null = null) {
  return {
    id,
    nome: `Projeto ${id}`,
    area: "RPA",
    especial: true,
    estrelas,
    autor: "Alguém",
    email: "a@x.com",
    status: "Pendente",
    statusChave: "pendente",
    tipos: "especial",
  };
}

vi.mock("@/integrations/db/client.server", () => ({
  getProjetoContextoData: vi.fn(async (id: string) => ({
    id,
    nome: `Projeto ${id}`,
    area: "RPA",
    ferramenta: "n8n",
    tipos_projeto: '["especial"]',
    contexto_especial: "sem memorial financeiro",
    descricao: "roda todo dia por cron e o time fiscal confere no relatório",
    memorial_calculo: null,
    submitted_at: "2026-08-01",
  })),
  getProjetoById: vi.fn(),
  getDocumentacaoConteudo: vi.fn(async () => null),
  getAvaliacoesEspeciais: vi.fn(async () => []),
  upsertAvaliacaoEspecial: (...a: unknown[]) => upsertAvaliacao(...a),
  getEmbeddingsEspeciais: vi.fn(async () => []),
  getEmbeddingEspecial: vi.fn(async () => null),
  getEmbeddingsEspeciaisPagina: vi.fn(async () => []),
  upsertEmbeddingEspecial: (...a: unknown[]) => upsertEmbedding(...a),
  parseJson: (t: string | null) => {
    try {
      return t ? JSON.parse(t) : null;
    } catch {
      return null;
    }
  },
}));

vi.mock("@/lib/sheet-espelho", () => ({
  lerResumosEspelho: vi.fn(async () => ({
    linhas: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
  })),
}));

vi.mock("@/lib/dashboard-resumo", () => ({
  mapResumo: (l: { id: string }) => resumo(l.id),
}));

vi.mock("@/lib/especiais-view", () => ({
  apenasEspeciais: (ps: unknown[]) => ps,
}));

vi.mock("@/lib/embeddings", () => ({
  gerarEmbeddingsLote: vi.fn(async () => []),
  base64ParaVetor: vi.fn(() => []),
  vetorParaBase64: vi.fn(() => ""),
  embeddingConfig: vi.fn(() => ({ modelo: "text-embedding-3-large", dim: 3072, temChave: false })),
}));

vi.mock("@/lib/pinecone", () => ({
  consultarVizinhos: vi.fn(async () => null),
  upsertVetores: vi.fn(async () => ({ ok: false, upsertados: 0, descartados_dim: 0 })),
  namespacePinecone: vi.fn(() => "staging"),
  descreverIndice: vi.fn(async () => null),
  garantirIndice: vi.fn(async () => ({ ok: false })),
}));

vi.mock("@/lib/agents/especiais-lentes", async () => {
  const real = await vi.importActual<typeof import("@/lib/agents/especiais-lentes")>(
    "@/lib/agents/especiais-lentes",
  );
  return { ...real, avaliarComLentes: (...a: unknown[]) => avaliarComLentes(...a) };
});

vi.mock("@/lib/agents/especiais-revisor", () => ({
  revisarAdversarial: (...a: unknown[]) => revisarAdversarial(...a),
}));

vi.mock("@/lib/agents/especiais-calibrador", () => ({
  redigirLeituraCalibrada: (...a: unknown[]) => redigirLeitura(...a),
}));

vi.mock("@/lib/agents/especial-classificador", async () => {
  const real = await vi.importActual<typeof import("@/lib/agents/especial-classificador")>(
    "@/lib/agents/especial-classificador",
  );
  return { ...real, classificarEspecial: vi.fn(async () => null) };
});

describe("painel em lote (T6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    avaliarComLentes.mockImplementation(async () => {
      const avals = TODAS(2);
      return { avaliacoes: avals, falhas: [], consolidado: consolidarLentes(avals) };
    });
    revisarAdversarial.mockResolvedValue({
      refutada: false,
      nota_sugerida: null,
      motivo: "sustentou",
    });
  });

  it("`dry` é o DEFAULT e NÃO grava nada", async () => {
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    const r = await julgarEspeciaisComPainel({ limite: 3 });
    expect(r.dry).toBe(true);
    expect(r.julgados).toBe(3);
    expect(r.gravados).toBe(0);
    expect(upsertAvaliacao).not.toHaveBeenCalled();
    for (const l of r.linhas) expect(l.gravado).toBe(false);
  });

  it("`{dry:false}` grava em `especial_avaliacao` com a origem do painel", async () => {
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    const r = await julgarEspeciaisComPainel({ dry: false, limite: 2 });
    expect(r.gravados).toBe(2);
    expect(upsertAvaliacao).toHaveBeenCalledTimes(2);
    const dados = upsertAvaliacao.mock.calls[0][0] as Record<string, unknown>;
    expect(dados.origem).toBe(ORIGEM_PAINEL);
    expect(dados).toHaveProperty("estrelas_recomendada");
    // nada de nota humana / coluna Estrelas no payload de escrita
    expect(Object.keys(dados)).not.toContain("estrelas");
    expect(r.sobrescritos).toBe(0);
  });

  it("o TETO de custo para a corrida e diz de onde continuar", async () => {
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    // teto de 8 chamadas: cada projeto reserva 4 lentes + 3 voltas = 7 → só 1 projeto entra
    const r = await julgarEspeciaisComPainel({ limite: 3, tetoChamadas: 8 });
    expect(r.parou_no_teto).toBe(true);
    expect(r.julgados).toBe(1);
    expect(r.proximo_offset).toBe(1);
    expect(r.chamadas_llm).toBeLessThanOrEqual(r.teto_chamadas);
  });

  it("projeto que explode não derruba a corrida — vira linha em `falhas`", async () => {
    let n = 0;
    avaliarComLentes.mockImplementation(async () => {
      n++;
      if (n === 2) throw new Error("proxy caiu");
      const avals = TODAS(1);
      return { avaliacoes: avals, falhas: [], consolidado: consolidarLentes(avals) };
    });
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    const r = await julgarEspeciaisComPainel({ limite: 3 });
    expect(r.ok).toBe(true);
    expect(r.julgados).toBe(2);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0].motivo).toContain("proxy caiu");
  });

  it("sem `redigirLeitura`, nenhuma chamada de LLM é gasta redigindo", async () => {
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    const r = await julgarEspeciaisComPainel({ limite: 2 });
    expect(redigirLeitura).not.toHaveBeenCalled();
    for (const l of r.linhas) expect(l.leitura.length).toBeGreaterThan(20);
  });

  it("a revisão que baixa a nota manda na nota gravada", async () => {
    avaliarComLentes.mockImplementation(async () => {
      const avals = TODAS(5);
      return { avaliacoes: avals, falhas: [], consolidado: consolidarLentes(avals) };
    });
    revisarAdversarial.mockResolvedValue({
      refutada: true,
      // caso da `DERRUBA` (o ponteiro citado é o próprio entregável) → ignora o piso estrutural.
      // Sem a flag, o piso do gate `TODAS(5)` (5, prova nomeada) manteria a nota em 5.
      derruba: true,
      nota_sugerida: 2,
      motivo: "o relatório citado é o próprio entregável",
    });
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    const r = await julgarEspeciaisComPainel({ limite: 1 });
    expect(r.linhas[0].nota).toBe(2);
    expect(r.linhas[0].nota_lentes).toBeGreaterThan(2);
    expect(r.linhas[0].voltas).toBeGreaterThan(0);
  });

  it("refutação de ALTURA não zera projeto cujo eixo estrutural provou — o caso VERSTA", async () => {
    // Real, medido em 28/08/2026: «[VERSTA] Robô orçamento» (nota humana 8★) teve eixos 3/2/4/1 —
    // estrutural 3 com prova NOMEADA — e UMA volta do revisor fechou em 0★. O revisor refutou a
    // altura do alcance e a queda livre virou "este projeto não vale nada".
    avaliarComLentes.mockImplementation(async () => {
      const avals = TODAS(4);
      return { avaliacoes: avals, falhas: [], consolidado: consolidarLentes(avals) };
    });
    revisarAdversarial.mockResolvedValue({
      refutada: true,
      derruba: false, // altura, não DERRUBA
      nota_sugerida: 0,
      motivo: "o alcance declarado não se confirma",
    });
    const { julgarEspeciaisComPainel } = await import("@/lib/especial-classificador.functions");
    const r = await julgarEspeciaisComPainel({ limite: 1 });
    // o piso é a nota do gate (4, prova nomeada) — a nota não desce abaixo do que ele provou
    expect(r.linhas[0].nota).toBe(4);
    expect(r.linhas[0].voltas).toBeGreaterThan(0);
  });
});

describe("T7 — fiação do painel no harness de concordância", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    avaliarComLentes.mockImplementation(async () => {
      const avals = TODAS(2);
      return { avaliacoes: avals, falhas: [], consolidado: consolidarLentes(avals) };
    });
    revisarAdversarial.mockResolvedValue({
      refutada: false,
      nota_sugerida: null,
      motivo: "sustentou",
    });
  });

  it("mede SÓ os especiais com nota humana e NÃO grava nada", async () => {
    const mod = await import("@/lib/especial-classificador.functions");
    const espelho = await import("@/lib/sheet-espelho");
    const resumoMod = await import("@/lib/dashboard-resumo");
    // p1 e p3 auditados; p2 sem nota → fica fora do test set
    vi.spyOn(resumoMod, "mapResumo").mockImplementation((l: { id: string }) =>
      resumo(l.id, l.id === "p2" ? null : 3),
    );
    expect(espelho.lerResumosEspelho).toBeDefined();

    const r = await mod.medirConcordanciaPainel({ limite: 5 });
    expect(r.somente_leitura).toBe(true);
    expect(r.juiz).toBe(mod.JUIZ_PAINEL);
    expect(r.total_com_nota).toBe(2);
    expect(r.pares.map((p) => p.projeto_id).sort()).toEqual(["p1", "p3"]);
    expect(upsertAvaliacao).not.toHaveBeenCalled();
    // o gabarito é a nota humana; a recomendada é a do painel
    for (const par of r.pares) expect(par.humana).toBe(3);
    expect(r.metricas.pares).toBe(2);
  });

  it("o juiz do painel recebe a FUNÇÃO derivada pelo harness (mesmo recipe do lote)", async () => {
    const mod = await import("@/lib/especial-classificador.functions");
    const resumoMod = await import("@/lib/dashboard-resumo");
    vi.spyOn(resumoMod, "mapResumo").mockImplementation((l: { id: string }) => resumo(l.id, 2));
    await mod.medirConcordanciaPainel({ limite: 1 });
    expect(avaliarComLentes).toHaveBeenCalled();
    const opts = avaliarComLentes.mock.calls[0][2] as { funcao?: string | null };
    expect(opts).toHaveProperty("funcao");
  });
});
