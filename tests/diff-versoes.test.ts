// Comparação entre versões (card de EDIÇÃO da fila do líder) — módulo PURO, sem I/O.
//
// O que estes testes protegem, e por quê:
//  • campo vazio nas DUAS versões não pode aparecer (poluiria o bloco "sem mudança" com
//    campos que o projeto nunca preencheu);
//  • adicionado/removido são estados próprios: "memorial apagado" e "memorial reescrito"
//    são eventos diferentes para quem dá parecer;
//  • o delta só existe quando a UNIDADE é a mesma — "120 h/mês → 120 h/trimestre" não é
//    variação zero, é outra régua (foi o motivo de o delta olhar `tipo_saving`);
//  • `montarEdicao` nunca inventa um "antes": sem snapshot anterior ela devolve
//    `comparavel: false`, e a tela mostra o card completo dizendo o porquê.

import { describe, it, expect } from "vitest";
import { compararVersoes, resumirComparacao, type SnapshotVersao } from "@/lib/diff-versoes";
import { montarEdicao } from "@/lib/aprovacoes.functions";
import type { VersaoParaComparacao } from "@/integrations/db/client.server";

function snap(
  projeto: Record<string, unknown>,
  doc: Record<string, unknown> | null = null,
): SnapshotVersao {
  return { projeto, doc };
}

const BASE = {
  nome: "Conferência fiscal automática",
  area: "Fiscal",
  ferramenta: "n8n",
  tipos_projeto: ["saving"],
  tipo_saving: "mensal",
  saving_horas: 120,
  saving_reais: 5400,
  ganho_total_mensal: 5400,
  alguem_fazia: "sim",
  memorial_calculo: "### Contexto\nO time conferia à mão.",
};

function achar<T extends { chave: string }>(lista: T[], chave: string): T | undefined {
  return lista.find((c) => c.chave === chave);
}

describe("compararVersoes", () => {
  it("separa o que mudou do que ficou igual", () => {
    const c = compararVersoes(snap(BASE), snap({ ...BASE, saving_horas: 162 }));
    expect(achar(c.mudancas, "saving_horas")?.estado).toBe("alterado");
    expect(achar(c.mudancas, "saving_horas")?.antes).toBe("120 h/mês");
    expect(achar(c.mudancas, "saving_horas")?.depois).toBe("162 h/mês");
    // o resto do projeto não entrou na lista de mudanças
    expect(achar(c.mudancas, "nome")).toBeUndefined();
    expect(achar(c.iguais, "nome")?.estado).toBe("igual");
    expect(resumirComparacao(c).mudou).toBe(1);
  });

  it("campo vazio nas duas versões não aparece em lugar nenhum", () => {
    const c = compararVersoes(snap(BASE), snap({ ...BASE, saving_horas: 162 }));
    const chaves = [...c.mudancas, ...c.iguais].map((x) => x.chave);
    // ninguém declarou custo evitado nas duas pontas
    expect(chaves).not.toContain("custo_evitado_itens");
    expect(chaves).not.toContain("custo_evitado_justificativa");
  });

  it('null → valor é "adicionado" e valor → null é "removido"', () => {
    const antes = snap({ ...BASE, memorial_calculo: null, custo_externo_mensal: 180 });
    const depois = snap({ ...BASE, memorial_calculo: "texto novo", custo_externo_mensal: null });
    const c = compararVersoes(antes, depois);
    expect(achar(c.mudancas, "memorial_calculo")?.estado).toBe("adicionado");
    expect(achar(c.mudancas, "custo_externo_mensal")?.estado).toBe("removido");
  });

  it("marca o memorial e a documentação como texto longo (o card colapsa)", () => {
    const c = compararVersoes(
      snap(BASE, { documentacao: { o_que_faz: "lê o XML" } }),
      snap(
        { ...BASE, memorial_calculo: "outro memorial" },
        { documentacao: { o_que_faz: "lê o XML e concilia" } },
      ),
    );
    expect(achar(c.mudancas, "memorial_calculo")?.longo).toBe(true);
    expect(achar(c.mudancas, "doc_o_que_faz")?.longo).toBe(true);
    expect(resumirComparacao(c).temTextoLongoAlterado).toBe(true);
  });

  it("calcula o delta com sinal e unidade quando o número sobe", () => {
    const c = compararVersoes(snap(BASE), snap({ ...BASE, saving_horas: 162, saving_reais: 7000 }));
    const horas = achar(c.mudancas, "saving_horas");
    expect(horas?.delta?.direcao).toBe("subiu");
    expect(horas?.delta?.valor).toBe(42);
    expect(horas?.delta?.texto).toBe("+ 42 h/mês");
    expect(achar(c.mudancas, "saving_reais")?.delta?.texto).toContain("+ R$");
  });

  it("delta negativo usa o sinal de menos (e não um hífen solto)", () => {
    const c = compararVersoes(snap(BASE), snap({ ...BASE, saving_horas: 90 }));
    const horas = achar(c.mudancas, "saving_horas");
    expect(horas?.delta?.direcao).toBe("caiu");
    expect(horas?.delta?.texto).toBe("− 30 h/mês");
  });

  it("NÃO calcula delta quando a recorrência muda (unidade diferente)", () => {
    // 120 h/mês → 120 h/trimestre: o número é o mesmo, o significado não. Um delta de 0
    // (ou de qualquer valor) diria uma mentira aritmética.
    const c = compararVersoes(snap(BASE), snap({ ...BASE, tipo_saving: "trimestral" }));
    const horas = achar(c.mudancas, "saving_horas");
    expect(horas?.estado).toBe("alterado");
    expect(horas?.antes).toBe("120 h/mês");
    expect(horas?.depois).toBe("120 h/trimestre");
    expect(horas?.delta).toBeNull();
  });

  it("itens de custo evitado viram texto estável — reordenar não conta como mudança", () => {
    const a = snap({
      ...BASE,
      custo_evitado_itens: JSON.stringify([
        { nome: "BPO Fiscal", valor: 3600, recorrencia: "mensal" },
        { nome: "Licença ACME", valor: 500, recorrencia: "mensal" },
      ]),
    });
    const b = snap({
      ...BASE,
      custo_evitado_itens: JSON.stringify([
        { nome: "Licença ACME", valor: 500, recorrencia: "mensal" },
        { nome: "BPO Fiscal", valor: 3600, recorrencia: "mensal" },
      ]),
    });
    expect(achar(compararVersoes(a, b).iguais, "custo_evitado_itens")?.estado).toBe("igual");

    const c = snap({
      ...BASE,
      custo_evitado_itens: JSON.stringify([
        { nome: "BPO Fiscal", valor: 4200, recorrencia: "mensal" },
      ]),
    });
    expect(achar(compararVersoes(a, c).mudancas, "custo_evitado_itens")?.estado).toBe("alterado");
  });

  it("aceita tipos_projeto como array (snapshot novo) ou string JSON (legado)", () => {
    const legado = snap({ ...BASE, tipos_projeto: '["saving"]' });
    expect(achar(compararVersoes(legado, snap(BASE)).iguais, "tipos_projeto")?.estado).toBe(
      "igual",
    );
    const virouReceita = snap({ ...BASE, tipos_projeto: ["saving", "receita_incremental"] });
    expect(achar(compararVersoes(legado, virouReceita).mudancas, "tipos_projeto")?.depois).toBe(
      "Saving · Receita incremental",
    );
  });
});

describe("montarEdicao", () => {
  const versao = (
    n: number,
    projeto: Record<string, unknown>,
    acao = "reenvio",
  ): VersaoParaComparacao => ({
    projeto_id: "p1",
    versao_num: n,
    acao,
    snapshot_projeto: JSON.stringify(projeto),
    snapshot_doc: null,
    submetido_por: "autor@x.com",
    created_at: `2026-08-1${n} 10:00:00`,
  });

  it("versão 1 é submissão nova: não existe card de edição", () => {
    expect(montarEdicao(1, [versao(1, BASE, "submit_inicial")])).toBeNull();
  });

  it("compara a versão da fila com a imediatamente anterior", () => {
    const e = montarEdicao(2, [
      versao(2, { ...BASE, saving_horas: 162 }),
      versao(1, BASE, "submit_inicial"),
    ]);
    expect(e?.comparavel).toBe(true);
    expect(e?.versao).toBe(2);
    expect(e?.versao_anterior).toBe(1);
    expect(e?.mudancas.map((m) => m.chave)).toContain("saving_horas");
  });

  it("sem snapshot da versão anterior → comparavel: false (a tela explica, não inventa)", () => {
    const e = montarEdicao(3, [versao(3, BASE)]);
    expect(e?.comparavel).toBe(false);
    expect(e?.versao_anterior).toBeNull();
    expect(e?.mudancas).toEqual([]);
  });

  it("snapshot ilegível conta como ausente, não derruba a fila", () => {
    const quebrado = { ...versao(1, BASE), snapshot_projeto: "{isso não é json" };
    const e = montarEdicao(2, [versao(2, BASE), quebrado]);
    expect(e?.comparavel).toBe(false);
  });

  it("reenvio cuja própria versão não foi gravada ainda é reconhecido como edição", () => {
    // `gravarVersaoProjeto` é NÃO-BLOQUEANTE: a versão pode faltar. O sinal de "é edição"
    // é o número da versão na fila, não a existência do snapshot.
    const e = montarEdicao(4, []);
    expect(e).not.toBeNull();
    expect(e?.versao).toBe(4);
    expect(e?.comparavel).toBe(false);
  });
});
