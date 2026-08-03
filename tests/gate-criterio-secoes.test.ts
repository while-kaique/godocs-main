import { describe, it, expect } from "vitest";
import { secaoProcessoVaga, secaoPonteiroVaga, MIN_SECAO_CRITERIO } from "@/lib/agents/orchestrator";
import {
  extrairProcessoAlterado,
  extrairPonteiroMovido,
  normalizarMarcadoresMemorial,
} from "@/lib/agents/memorial-format";
import { savingVazio, receitaVazia } from "@/lib/agents/types";
import { deveBloquearPorCriterio } from "@/lib/chat.functions";

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

// ─── Loop de 38 perguntas (prod, 03/08/2026) ─────────────────────────────────
// O gate lia `criterioAtual`, um SNAPSHOT tirado no topo do turno. No mesmo turno, o ramo
// de resposta marcava `criterio_secoes:'ok'` no estado e o gate, logo abaixo, relia o
// snapshot ainda 'pendente' → re-armava 'pendente' e reperguntava. O anti-loop documentado
// ("pergunta UMA vez só") se anulava sozinho. Quem respondia "não há indicador" repetia a
// mesma pergunta 38× e a submissão morria em 500 ("sem ganho mensurável"), porque a fase
// financeira nunca completava. Escapava só quem tinha painel para citar — texto longo o
// bastante para `secaoPonteiroVaga` liberar.
describe("deveBloquearPorCriterio — o anti-loop que se anulava", () => {
  it("bloqueia na PRIMEIRA vez (estado ainda não resolvido)", () => {
    expect(deveBloquearPorCriterio(null, "preview")).toBe(true);
    expect(deveBloquearPorCriterio(undefined, "complete")).toBe(true);
  });

  it("NUNCA bloqueia depois de resolvido — o coração do fix", () => {
    expect(deveBloquearPorCriterio("ok", "preview")).toBe(false);
    expect(deveBloquearPorCriterio("ok", "complete")).toBe(false);
  });

  it("só age sobre preview/complete (um gate por turno)", () => {
    for (const tipo of ["question", "options", "message"]) {
      expect(deveBloquearPorCriterio(null, tipo)).toBe(false);
      expect(deveBloquearPorCriterio("pendente", tipo)).toBe(false);
    }
  });

  it("REPRODUZ a sequência do loop: estado vivo converge, snapshot não", () => {
    // Turno 1 — nada resolvido, o LLM manda preview sem as seções → o gate pergunta.
    let estado: "pendente" | "ok" | null = null;
    expect(deveBloquearPorCriterio(estado, "preview")).toBe(true);
    estado = "pendente";

    // Turno 2 — o usuário responde. O ramo de resposta marca 'ok' ANTES do gate rodar.
    const snapshotDoTopoDoTurno = estado; // 'pendente' — o que o código lia (bug)
    estado = "ok"; // estado vivo, o que o gate passou a ler (fix)

    // Com o estado VIVO o gate libera e a submissão fecha.
    expect(deveBloquearPorCriterio(estado, "preview")).toBe(false);
    // Com o SNAPSHOT ele reperguntaria — e o turno 3 recomeçaria idêntico, 38×.
    expect(deveBloquearPorCriterio(snapshotDoTopoDoTurno, "preview")).toBe(true);
  });

  it("converge em NO MÁXIMO 1 pergunta mesmo se o memorial nunca melhorar", () => {
    // O pior caso real: o autor não tem indicador nenhum e o LLM só escreve seções curtas,
    // que `secaoPonteiroVaga` reprova para sempre. Antes isso era o loop infinito; agora o
    // estado resolvido encerra o gate independentemente do texto.
    const memorialQueNuncaPassa = "**Ponteiro movido:** não há indicador.";
    expect(secaoPonteiroVaga(memorialQueNuncaPassa)).toBe(true); // segue reprovando…

    // Simula a ORDEM REAL de `enviarMensagem`: dentro do MESMO turno, o ramo de resposta
    // roda primeiro (marca 'ok'), o LLM roda, e só então o gate avalia.
    function simular(leituraDoGate: "viva" | "snapshot") {
      let estado: "pendente" | "ok" | null = null;
      let perguntas = 0;
      for (let turno = 0; turno < 40; turno++) {
        const snapshotDoTopo = estado; // capturado ANTES de qualquer mutação do turno
        if (estado === "pendente") estado = "ok"; // turno de resposta: aceita o que vier
        const lido = leituraDoGate === "viva" ? estado : snapshotDoTopo;
        if (deveBloquearPorCriterio(lido, "preview")) {
          perguntas++;
          estado = "pendente"; // o gate re-arma para o próximo turno
        }
      }
      return perguntas;
    }

    expect(simular("viva")).toBe(1); // fix: pergunta uma vez e libera
    expect(simular("snapshot")).toBe(40); // bug: repergunta em todo turno, sem fim
  });
});
