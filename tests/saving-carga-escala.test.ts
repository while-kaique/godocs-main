import { describe, it, expect } from "vitest";
import { buildSavingPrompt, aplicaSplitCargaEscala, resolverSplitCargaEscala } from "@/lib/agents/orchestrator";
import { documentacaoVazia, savingVazio } from "@/lib/agents/types";
import type { ProjetoContexto, SavingColetado, SavingLinha } from "@/lib/agents/types";

// F4 — Carga real × ganho por escala. Quando ALGUÉM fazia a tarefa à mão
// (alguem_fazia='sim') e o saving é recorrente (não pontual), separa o total de horas
// em horas_carga_real (trabalho humano de fato) e horas_escala (volume incremental que
// só a automação cobre). O TOTAL não muda — o split é transparência.
// A pergunta é CONDUZIDA PELO AGENTE no chat (padrão da verificação de IA — opções, uma
// vez, aceita e segue), NÃO por um gate determinístico que bloqueia o preview (isso gerava
// loop na edição). A rede de segurança é NÃO-bloqueante e vive na gravação:
// resolverSplitCargaEscala assume o conservador (carga real = total, escala 0) quando o
// agente não capturou. Ver SPEC_CORRECOES (jul/2026).

const ctx = (over: Partial<ProjetoContexto> = {}): ProjetoContexto =>
  ({
    nome_projeto: "Projeto X",
    ferramenta: "Python",
    membros: [],
    alguem_fazia: "sim",
    ...over,
  }) as unknown as ProjetoContexto;

const linha = (over: Partial<SavingLinha> = {}): SavingLinha => ({
  cargo: "Analista",
  horas_antes: 132,
  horas_depois: 0,
  valor_hora: 50,
  economia_horas_mes: 132,
  economia_reais_mes: 0,
  ...over,
});

const saving = (over: Partial<SavingColetado> = {}): SavingColetado => ({
  ...savingVazio(),
  tipo_saving: "mensal",
  economia_horas_mes: 132,
  linhas: [linha()],
  ...over,
});

const BLOCO = "CARGA REAL × GANHO POR ESCALA";

describe("aplicaSplitCargaEscala (escopo do split)", () => {
  it("TRUE quando alguém fazia (sim) + recorrente + horas reais", () => {
    expect(aplicaSplitCargaEscala(ctx(), saving())).toBe(true);
    expect(aplicaSplitCargaEscala(ctx(), saving({ tipo_saving: "trimestral" }))).toBe(true);
    expect(aplicaSplitCargaEscala(ctx(), saving({ tipo_saving: "semestral" }))).toBe(true);
  });
  it("FALSE no contrafactual (nao) e no custo evitado puro (externo)", () => {
    expect(aplicaSplitCargaEscala(ctx({ alguem_fazia: "nao" }), saving())).toBe(false);
    expect(aplicaSplitCargaEscala(ctx({ alguem_fazia: "externo" }), saving())).toBe(false);
  });
  it("FALSE no pontual (trabalho único, sem escala)", () => {
    expect(aplicaSplitCargaEscala(ctx(), saving({ tipo_saving: "pontual" }))).toBe(false);
  });
  it("FALSE quando não há horas reais (todas 0h antes)", () => {
    const semHoras = saving({ linhas: [linha({ horas_antes: 0, horas_depois: 0, economia_horas_mes: 0 })] });
    expect(aplicaSplitCargaEscala(ctx(), semHoras)).toBe(false);
  });
});

describe("resolverSplitCargaEscala (rede silenciosa na gravação — não bloqueia o chat)", () => {
  it("split NÃO capturado + 'sim' recorrente → conservador (carga real = total, escala 0)", () => {
    const r = resolverSplitCargaEscala("sim", saving({ horas_carga_real: null, horas_escala: null }));
    expect(r).toEqual({ horas_carga_real: 132, horas_escala: 0 });
  });
  it("split JÁ capturado pelo agente é preservado (não sobrescreve)", () => {
    const r = resolverSplitCargaEscala("sim", saving({ horas_carga_real: 24, horas_escala: 108 }));
    expect(r).toEqual({ horas_carga_real: 24, horas_escala: 108 });
  });
  it("NÃO se aplica no contrafactual (nao) / externo / pontual → null (deixa como está)", () => {
    expect(resolverSplitCargaEscala("nao", saving())).toBeNull();
    expect(resolverSplitCargaEscala("externo", saving())).toBeNull();
    expect(resolverSplitCargaEscala("sim", saving({ tipo_saving: "pontual" }))).toBeNull();
  });
  it("NÃO se aplica sem horas reais nem com total 0 → null", () => {
    const semHoras = saving({ linhas: [linha({ horas_antes: 0, horas_depois: 0, economia_horas_mes: 0 })] });
    expect(resolverSplitCargaEscala("sim", semHoras)).toBeNull();
    expect(resolverSplitCargaEscala("sim", saving({ economia_horas_mes: 0, linhas: [linha({ economia_horas_mes: 0 })] }))).toBeNull();
  });
});

describe("buildSavingPrompt — bloco carga real × escala (CONDUZIDO PELO AGENTE)", () => {
  it("injeta o bloco e instrui o AGENTE a conduzir (com opções, uma vez) quando aplicável", () => {
    const p = buildSavingPrompt(ctx(), documentacaoVazia(), saving(), "resumo");
    expect(p).toContain(BLOCO);
    expect(p).toContain("VOCÊ conduz");
    expect(p).toContain('type:"options"');
    expect(p).toContain("horas_carga_real");
    expect(p).toContain("horas_escala");
    // Padrão saudável: opções + aceita e segue, sem repetir. O bloco explicita "pergunte 1×".
    expect(p).toContain("pergunte 1×");
    expect(p).toContain("NUNCA repita");
  });

  it("NÃO injeta no contrafactual / externo / pontual / sem horas", () => {
    expect(buildSavingPrompt(ctx({ alguem_fazia: "nao" }), documentacaoVazia(), saving(), "r")).not.toContain(BLOCO);
    expect(buildSavingPrompt(ctx({ alguem_fazia: "externo" }), documentacaoVazia(), saving(), "r")).not.toContain(BLOCO);
    expect(buildSavingPrompt(ctx(), documentacaoVazia(), saving({ tipo_saving: "pontual" }), "r")).not.toContain(BLOCO);
    const semHoras = saving({ linhas: [linha({ horas_antes: 0, horas_depois: 0, economia_horas_mes: 0 })] });
    expect(buildSavingPrompt(ctx(), documentacaoVazia(), semHoras, "r")).not.toContain(BLOCO);
  });
});
