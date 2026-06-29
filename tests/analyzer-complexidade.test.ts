import { describe, it, expect } from "vitest";
import { buildSystemPrompt, normalizarComplexidade } from "@/lib/agents/analyzer";

// Importar o prompt já valida que o template literal compila (sem este teste, um
// erro de sintaxe no prompt do analyzer.ts passa batido — nenhum outro teste o importa).
describe("analyzer — prompt de classificação (régua de dois eixos: ação > IA)", () => {
  const prompt = buildSystemPrompt();
  const lower = prompt.toLowerCase();

  it("usa os dois sinais: usa_ia (eixo IA) e acao_autonoma (eixo ação)", () => {
    expect(prompt).toContain("usa_ia");
    expect(prompt).toContain("acao_autonoma");
  });

  it("distingue IA de construção/hospedagem (Claude Code/GoDeploy) de IA no runtime", () => {
    expect(lower).toContain("construir/desenvolver o projeto");
    expect(prompt).toContain("construir/hospedar");
    expect(lower).toContain("ia para desenvolver ≠ ia na execução");
    expect(prompt).toContain("quando EXECUTA");
  });

  it("a árvore põe a AÇÃO primeiro, com precedência sobre a IA (autonomia independe de IA)", () => {
    expect(prompt).toContain("ação consequente na última ponta");
    expect(prompt).toContain("com OU sem IA");
    // ordem DENTRO da árvore: o passo da ação (1) vem ANTES do passo da IA (2)
    const passoAcao = prompt.indexOf("1. O projeto EXECUTA uma ação consequente na última ponta, sozinho");
    const passoIa = prompt.indexOf("2. Senão: usa IA como FUNCIONALIDADE");
    expect(passoAcao).toBeGreaterThan(-1);
    expect(passoIa).toBeGreaterThan(-1);
    expect(passoAcao).toBeLessThan(passoIa);
  });

  it("NÃO usa mais a régua antiga (tem_ia=false força automacao sempre / ia_decide_caminho)", () => {
    expect(prompt).not.toContain("minimamente inteligente");
    expect(prompt).not.toContain("ia_decide_caminho");
    expect(prompt).not.toContain("usa IA (LLM, ML, NLP");
    // a régua antiga rebaixava qualquer não-automacao quando tem_ia=false; agora autonomia sobrevive
    expect(prompt).not.toContain('a complexidade é **"automacao"** independentemente de qualquer outro fator');
  });

  it("freio anti-dashboard: rodar 24/7 e eliminar trabalho humano NÃO é autonomia", () => {
    expect(lower).toContain("24/7");
    expect(lower).toContain("dashboard");
    expect(prompt).toContain("red herring");
    expect(lower).toContain("eliminou trabalho humano");
  });

  it("traz os três testes desempatadores (write-decisão×persistência, resolve×avisa, antes×depois)", () => {
    expect(prompt).toContain("DECISÃO");
    expect(prompt).toContain("PERSISTÊNCIA");
    expect(prompt).toContain("RESOLVE × AVISA");
    expect(prompt).toContain("Confirmação ANTES × override DEPOIS");
  });

  it("avalia criticamente se o projeto marcado como especial é realmente especial", () => {
    expect(prompt).toContain("AVALIAÇÃO DE PROJETO ESPECIAL");
    expect(prompt).toContain("marcado_como_especial");
    expect(prompt).toContain("NÃO parece especial");
    expect(prompt).toContain("documentacao_enviada_usuario");
  });

  it("inclui exemplos canônicos (Protheus=automacao, doc por IA=inteligencia, RPA que aprova=autonomia)", () => {
    expect(prompt).toContain("Protheus");
    expect(lower).toContain("nenhuma ia como funcionalidade");
    expect(prompt).toContain("gera documentação");
    expect(prompt).toContain("APROVA o pedido sozinho no ERP");
  });
});

// Gate determinístico (função pura, testável). É a camada de segurança DURA sobre a
// sugestão do LLM: ela falhava em ser testada de ponta a ponta (o sinal tem_ia nunca
// chegava ao analisador — bug G0), por isso aqui exercitamos a régua diretamente.
describe("normalizarComplexidade — invariantes dos dois eixos", () => {
  it("D1: determinístico que TOMA A AÇÃO na ponta (sem IA) é AUTONOMIA — não rebaixa", () => {
    // O caso impossível no modelo antigo: usa_ia=false rebaixava para automacao.
    const r = normalizarComplexidade({ complexidade: "autonomia", usa_ia: false, acao_autonoma: true });
    expect(r.complexidade).toBe("autonomia");
    expect(r.usa_ia).toBe(false);
  });

  it("freio anti-falso-autonomia: autonomia sem ação consequente (acao_autonoma=false) e sem IA → automacao", () => {
    const r = normalizarComplexidade({ complexidade: "autonomia", usa_ia: false, acao_autonoma: false });
    expect(r.complexidade).toBe("automacao");
    expect(r.ajuste).toMatch(/autonomia rebaixada/);
  });

  it("confirmação humana ANTES da ação (com IA) → inteligencia, não autonomia", () => {
    const r = normalizarComplexidade({ complexidade: "autonomia", usa_ia: true, acao_autonoma: false });
    expect(r.complexidade).toBe("inteligencia");
  });

  it("IA classifica e humano trata a fila → inteligencia (eleva automacao quando há IA)", () => {
    const r = normalizarComplexidade({ complexidade: "automacao", usa_ia: true, acao_autonoma: false });
    expect(r.complexidade).toBe("inteligencia");
    expect(r.ajuste).toMatch(/elevada para 'inteligencia'/);
  });

  it("não-regressão PR#94: determinístico que só informa (sem IA) → automacao", () => {
    const r = normalizarComplexidade({ complexidade: "inteligencia", usa_ia: false, acao_autonoma: false });
    expect(r.complexidade).toBe("automacao");
    expect(r.ajuste).toMatch(/sem IA como funcionalidade/);
  });

  it("tem_ia_como_funcionalidade (resposta do usuário) tem PRECEDÊNCIA sobre o usa_ia inferido", () => {
    // usuário disse que NÃO usa IA, mesmo o LLM inferindo que sim → automacao + usa_ia=false
    const r1 = normalizarComplexidade({ complexidade: "inteligencia", usa_ia: true, tem_ia_como_funcionalidade: false });
    expect(r1.complexidade).toBe("automacao");
    expect(r1.usa_ia).toBe(false);
    // usuário disse que SIM usa IA, LLM havia subavaliado → inteligencia + usa_ia=true
    const r2 = normalizarComplexidade({ complexidade: "automacao", usa_ia: false, tem_ia_como_funcionalidade: true });
    expect(r2.complexidade).toBe("inteligencia");
    expect(r2.usa_ia).toBe(true);
  });

  it("D1: tem_ia=false NÃO rebaixa uma autonomia legítima (ação consequente sobrevive sem IA)", () => {
    const r = normalizarComplexidade({
      complexidade: "autonomia",
      usa_ia: true,
      acao_autonoma: true,
      tem_ia_como_funcionalidade: false,
    });
    expect(r.complexidade).toBe("autonomia");
    expect(r.usa_ia).toBe(false);
  });

  it("retrocompat: sinais null/undefined não rebaixam — confia na sugestão do LLM", () => {
    expect(normalizarComplexidade({ complexidade: "autonomia" }).complexidade).toBe("autonomia");
    expect(normalizarComplexidade({ complexidade: "inteligencia", usa_ia: true }).complexidade).toBe("inteligencia");
    expect(normalizarComplexidade({ complexidade: "autonomia", acao_autonoma: null }).complexidade).toBe("autonomia");
  });

  it("NÃO força-promove a autonomia (acao_autonoma=true não eleva o que o LLM julgou ser inteligencia)", () => {
    const r = normalizarComplexidade({ complexidade: "inteligencia", usa_ia: true, acao_autonoma: true });
    expect(r.complexidade).toBe("inteligencia");
  });

  it("complexidade inválida/ausente → fallback conservador automacao", () => {
    expect(normalizarComplexidade({ complexidade: undefined }).complexidade).toBe("automacao");
    expect(normalizarComplexidade({ complexidade: "foo" }).complexidade).toBe("automacao");
  });
});
