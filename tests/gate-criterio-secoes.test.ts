import { describe, it, expect } from "vitest";
import {
  secaoProcessoVaga,
  secaoPonteiroVaga,
  MIN_SECAO_CRITERIO,
  BLOCO_SECOES_CRITERIO,
  buildSavingPrompt,
  buildReceitaPrompt,
} from "@/lib/agents/orchestrator";
import {
  extrairProcessoAlterado,
  extrairPonteiroMovido,
  normalizarMarcadoresMemorial,
} from "@/lib/agents/memorial-format";
import {
  perguntaCriterioSecoes,
  respostaTrouxeFonte,
  OPCOES_PONTEIRO,
} from "@/lib/chat.functions";
import { savingVazio, receitaVazia, documentacaoVazia } from "@/lib/agents/types";
import type { ProjetoContexto, DocumentacaoColetada } from "@/lib/agents/types";

const CTX_TESTE: ProjetoContexto = {
  responsavel_nome: "Ana",
  responsavel_email: "ana@gocase.com",
  area: "Fiscal",
  ferramenta: "n8n",
  membros: [],
  nome_projeto: "Conciliação diária",
  data_criacao: null,
  doc_texto: null,
};

const DOC_TESTE: DocumentacaoColetada = {
  ...documentacaoVazia(),
  nome_projeto: "Conciliação diária",
  o_que_faz: "Concilia notas fiscais",
  execucao: "Todo dia às 7h",
  fluxo: "1. baixa notas 2. compara 3. grava",
  dependencias: "Metabase, Protheus",
};

// Gate DETERMINÍSTICO do CRITÉRIO DE PROJETO — seções [1.3] "Processo alterado" e [1.4]
// "Ponteiro movido e onde verificar". Origem: validação em staging 29/07/2026 (runs
// stg-ctx-01/02) — o `receita-pura` fechou o memorial SEM a [1.3] nas 2 rodadas e sem a
// [1.4] numa; o `custo-evitado-puro` gravou só a METADE da [1.4] nas 2. Falha SILENCIOSA:
// o analisador lê a ausência como rastreabilidade não comprovada e o autor cai em triagem
// manual injusta. Ver docs/roteiro-validacao-criterios.md (seção RESULTADO).

const memorialCompleto = `### Contexto
Robô que concilia notas fiscais.

### Processo alterado
Antes o time Fiscal conferia manualmente ~1.200 notas por mês, uma a uma, no Protheus,
gastando cerca de 3 dias úteis no fechamento. Hoje a conciliação roda sozinha todo dia.

### Ponteiro movido e onde verificar
O ponteiro movido é o retrabalho do fechamento fiscal: as divergências caíram de ~80 para
~5 por mês. Dá para conferir no relatório "Conciliação Fiscal" do Metabase, painel do time.

### Resumo
Economia total de 40h/mês.`;

describe("extração das seções [1.3]/[1.4]", () => {
  it("fatia as duas seções do memorial completo", () => {
    expect(extrairProcessoAlterado(memorialCompleto)).toContain("1.200 notas");
    expect(extrairPonteiroMovido(memorialCompleto)).toContain("Metabase");
  });

  it("devolve null quando a seção não existe (o caso receita-pura da staging)", () => {
    const semSecoes = "### Contexto\nGera estampas.\n\n### Resumo\nReceita de R$ 10 mil/mês.";
    expect(extrairProcessoAlterado(semSecoes)).toBeNull();
    expect(extrairPonteiroMovido(semSecoes)).toBeNull();
  });

  it("ENXERGA a meia-seção do custo-evitado-puro — rótulo curto 'Ponteiro movido'", () => {
    // Casa por PREFIXO de propósito: com título exato isto voltaria null e seria
    // indistinguível da ausência total; precisamos ver o conteúdo para julgá-lo.
    const meia = "**Ponteiro movido:** custo externo eliminado.";
    expect(extrairPonteiroMovido(meia)).toBe("custo externo eliminado.");
  });

  it("funciona sobre memorial legado com os códigos [1.3]/[1.4] normalizados", () => {
    const legado =
      "[1.3] O time deixou de baixar 300 boletos por mês no portal do banco, um a um, " +
      "para ter tudo importado automaticamente todo dia às 7h.\n" +
      "[1.4] Caiu o prazo de fechamento (de 4 para 1 dia); confere-se no painel Financeiro do Metabase.";
    const norm = normalizarMarcadoresMemorial(legado);
    expect(secaoProcessoVaga(extrairProcessoAlterado(norm))).toBe(false);
    expect(secaoPonteiroVaga(extrairPonteiroMovido(norm))).toBe(false);
  });
});

describe("secaoProcessoVaga — [1.3]", () => {
  it("ausente (null) é vaga → bloqueia", () => {
    expect(secaoProcessoVaga(null)).toBe(true);
    expect(secaoProcessoVaga("")).toBe(true);
  });

  it("rótulo sem substância é vago", () => {
    expect(secaoProcessoVaga("Mudou o processo.")).toBe(true);
  });

  it("descrição com antes/depois e magnitude passa", () => {
    expect(secaoProcessoVaga(extrairProcessoAlterado(memorialCompleto))).toBe(false);
  });
});

describe("secaoPonteiroVaga — [1.4]", () => {
  it("ausente é vaga → bloqueia", () => {
    expect(secaoPonteiroVaga(null)).toBe(true);
  });

  it("a meia-seção observada na staging é vaga (não diz ONDE conferir)", () => {
    expect(secaoPonteiroVaga("custo externo eliminado.")).toBe(true);
  });

  it("texto longo sem NENHUMA pista de onde conferir é vago", () => {
    const semOnde =
      "O projeto melhorou bastante a rotina do time e trouxe mais tranquilidade para " +
      "todo mundo que participava daquela etapa do trabalho diário.";
    expect(semOnde.length).toBeGreaterThan(MIN_SECAO_CRITERIO);
    expect(secaoPonteiroVaga(semOnde)).toBe(true);
  });

  it("ponteiro + fonte nomeada passa", () => {
    expect(secaoPonteiroVaga(extrairPonteiroMovido(memorialCompleto))).toBe(false);
  });

  it("ACEITA o 'não sei onde conferir' registrado honestamente (ponto 3 do roteiro)", () => {
    // Comportamento que JÁ passou em staging: o agente registra a ausência em vez de
    // inventar uma fonte. O gate não pode punir isso — vira zona cinzenta no analisador,
    // nunca reprovação automática.
    const honesto =
      "O ponteiro é a redução de retrabalho, mas não foi informada uma planilha, " +
      "relatório ou base específica com nome próprio para conferência.";
    expect(secaoPonteiroVaga(honesto)).toBe(false);
  });
});

describe("estado do gate no tipo", () => {
  it("nasce null em saving e receita (backend-only, não ecoado pelo LLM)", () => {
    expect(savingVazio().criterio_secoes).toBeNull();
    expect(receitaVazia().criterio_secoes).toBeNull();
  });
});

// ─── Apresentação da pergunta do gate (ago/2026) ─────────────────────────────
// Bug reportado: no meio da conversa o usuário via "b) onde alguém abre e confere?" —
// uma alínea de um roteiro que ele nunca viu. Duas origens, as duas fechadas aqui:
// (1) o texto do gate numerava os pedidos com "**(a)**"/"**(b)**" e, quando só o ponteiro
//     faltava (o caso mais comum), a mensagem COMEÇAVA num "(b)" órfão;
// (2) o prompt do agente usa a)/b)/c) como roteiro e nada proibia copiá-los para o chat.
const ALINEA_ORFA = /\(?[a-c]\)\s/;

describe("perguntaCriterioSecoes — sem marcadores de roteiro", () => {
  it.each([
    ["só o ponteiro falta", false, true],
    ["só o processo falta", true, false],
    ["os dois faltam", true, true],
  ])("não emite alínea órfã quando %s", (_caso, faltaProcesso, faltaPonteiro) => {
    const texto = perguntaCriterioSecoes(faltaProcesso, faltaPonteiro);
    expect(texto).not.toMatch(ALINEA_ORFA);
    expect(texto).not.toContain("[1.3]");
    expect(texto).not.toContain("[1.4]");
  });

  it("com os dois buracos, usa bullets — cada item se lê sozinho", () => {
    const texto = perguntaCriterioSecoes(true, true);
    const bullets = texto.split("\n").filter((l) => l.startsWith("- "));
    expect(bullets).toHaveLength(2);
  });

  it("só o ponteiro: pergunta curta que casa com os botões", () => {
    const texto = perguntaCriterioSecoes(false, true);
    expect(texto).toContain("qual ponteiro este projeto moveu");
    expect(texto).not.toContain("processo que mudou");
  });

  it("só o processo: não fala de ponteiro nem de escolher opção", () => {
    const texto = perguntaCriterioSecoes(true, false);
    expect(texto).toContain("processo que mudou");
    expect(texto).not.toMatch(/escolha abaixo/i);
  });

  it.each([
    ["ponteiro", false, true],
    ["ambos", true, true],
  ])("mantém o escape 'não sei onde conferir' quando falta %s", (_c, fp, fpt) => {
    // Decisão fechada (SPEC_CRITERIOS_PROJETO): a ausência de fonte é resposta legítima
    // (zona cinzenta, nunca reprovação automática). Sem a frase, a pessoa inventa fonte.
    expect(perguntaCriterioSecoes(fp, fpt)).toMatch(/em vez de inventar uma fonte/);
  });
});

describe("OPCOES_PONTEIRO — botões do gate", () => {
  it("oferece os 3 ponteiros da régua + a saída honesta", () => {
    expect(OPCOES_PONTEIRO).toHaveLength(4);
    expect(OPCOES_PONTEIRO[0]).toMatch(/^Custo/);
    expect(OPCOES_PONTEIRO[1]).toMatch(/^Receita/);
    expect(OPCOES_PONTEIRO[2]).toMatch(/^KPI da área/);
    expect(OPCOES_PONTEIRO[3]).toBe("Ainda não sei dizer");
  });
});

describe("respostaTrouxeFonte — o clique não vale por fonte", () => {
  it("clique em botão NUNCA conta como fonte, nem o rótulo com 'KPI'", () => {
    // ⚠️ Guard preciso: PISTA_ONDE_VERIFICAR aceita "kpi", então o rótulo
    // "KPI da área (erro, retrabalho, prazo, risco)" casaria a regex por acidente e o
    // nudge daria a fonte por resolvida — a seção [1.4] sairia pela metade, que é
    // exatamente a falha do custo-evitado-puro que originou este gate.
    for (const opcao of OPCOES_PONTEIRO) {
      expect(respostaTrouxeFonte(opcao, true)).toBe(false);
    }
  });

  it("texto digitado com fonte nomeada conta", () => {
    expect(
      respostaTrouxeFonte('Caiu o retrabalho; confere no painel "Conciliação" do Metabase', false),
    ).toBe(true);
  });

  it("texto digitado sem nenhuma pista de onde conferir não conta", () => {
    expect(respostaTrouxeFonte("Melhorou bastante a rotina do time.", false)).toBe(false);
  });
});

describe("BLOCO_SECOES_CRITERIO — fonte única do [1.3]/[1.4] no prompt", () => {
  it("proíbe explicitamente ecoar os marcadores do roteiro", () => {
    // Sem esta linha o LLM copia "b) …" para o chat — a origem (2) do bug.
    expect(BLOCO_SECOES_CRITERIO).toContain("ROTEIRO INTERNO");
    expect(BLOCO_SECOES_CRITERIO).toMatch(/NUNCA os escreva na mensagem ao usuário/);
  });

  it("é o MESMO bloco nos prompts de saving e de receita (não redigitar)", () => {
    // Antes eram duas cópias idênticas caractere a caractere, prontas para divergir.
    const saving = buildSavingPrompt(CTX_TESTE, DOC_TESTE, savingVazio(), "resumo");
    const receita = buildReceitaPrompt(CTX_TESTE, DOC_TESTE, receitaVazia(), "resumo");
    expect(saving).toContain(BLOCO_SECOES_CRITERIO);
    expect(receita).toContain(BLOCO_SECOES_CRITERIO);
  });
});
