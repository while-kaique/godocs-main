/**
 * O quadro da triagem — agrupamento por eixo.
 *
 * O que estes testes seguram é o que a fusão de três telas numa só pode quebrar calado: a
 * régua de cada eixo (que era de um módulo diferente em cada tela) e as colunas que têm de
 * aparecer MESMO VAZIAS, porque coluna que some faz a régua parecer ter buraco.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agruparKanban, EIXOS, CARTOES_INICIAIS } from "@/lib/dashboard-kanban";
import type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";

function projeto(over: Partial<ProjetoDashboardResumo> = {}): ProjetoDashboardResumo {
  return {
    id: "p1",
    nome: "Projeto",
    autor: "Maria",
    email: "maria@gocase.com",
    area: "FISCAL",
    status: "Pendente",
    statusChave: "pendente",
    dataSubmissao: "01/09/2026",
    dataOrdenacao: Date.parse("2026-09-01T00:00:00Z"),
    ganhoTotal: 100,
    savingReais: null,
    receitaMensal: null,
    savingEfetivado: null,
    custoEvitadoHoras: null,
    complexidade: null,
    tipoProjeto: null,
    tipos: null,
    especial: false,
    aprovacaoLider: null,
    estrelas: null,
    estrelaAgente: null,
    confiancaAgente: null,
    busca: "projeto maria",
    ...over,
  };
}

describe("eixo status", () => {
  it("Pendente, Aprovado e Reprovado aparecem mesmo sem ninguém", () => {
    const colunas = agruparKanban([], "status");
    expect(colunas.map((c) => c.chave)).toEqual(["pendente", "aprovado", "reprovado"]);
    expect(colunas.every((c) => c.total === 0)).toBe(true);
  });

  it("status fora do trio só ganha coluna quando tem projeto", () => {
    const semNinguem = agruparKanban([], "status").map((c) => c.chave);
    expect(semNinguem).not.toContain("descontinuado");

    const com = agruparKanban([projeto({ statusChave: "descontinuado" })], "status");
    expect(com.map((c) => c.chave)).toContain("descontinuado");
  });

  it("rótulo LEGADO cai na coluna equivalente, não numa coluna solta", () => {
    // "rejeitado" e "validado" ainda existem em linhas antigas da planilha.
    const colunas = agruparKanban(
      [
        projeto({ id: "a", statusChave: "rejeitado" }),
        projeto({ id: "b", statusChave: "validado" }),
      ],
      "status",
    );
    expect(colunas.find((c) => c.chave === "ajuste pedido")?.total).toBe(1);
    expect(colunas.find((c) => c.chave === "aprovado")?.total).toBe(1);
    expect(colunas.map((c) => c.chave)).not.toContain("rejeitado");
  });
});

describe("eixo nota", () => {
  it('os níveis 0 a 5 aparecem sempre: régua com buraco se lê como "não existe"', () => {
    const colunas = agruparKanban([], "nota");
    expect(colunas.map((c) => c.chave)).toEqual(["sem-nota", "0", "1", "2", "3", "4", "5"]);
  });

  it("a escala é ABERTA: nota acima de 5 ganha a própria coluna", () => {
    const colunas = agruparKanban([projeto({ estrelas: 8 })], "nota");
    expect(colunas.map((c) => c.chave)).toContain("8");
    expect(colunas.find((c) => c.chave === "8")?.total).toBe(1);
  });

  it("célula VAZIA não é zero: são colunas diferentes", () => {
    const colunas = agruparKanban(
      [projeto({ id: "vazio", estrelas: null }), projeto({ id: "zero", estrelas: 0 })],
      "nota",
    );
    expect(colunas.find((c) => c.chave === "sem-nota")?.projetos.map((p) => p.id)).toEqual([
      "vazio",
    ]);
    expect(colunas.find((c) => c.chave === "0")?.projetos.map((p) => p.id)).toEqual(["zero"]);
  });
});

describe("eixo autor", () => {
  it("quem tem mais projetos vem primeiro — é o ponto de agrupar por autor", () => {
    const colunas = agruparKanban(
      [
        projeto({ id: "1", autor: "Ana", email: "ana@x.com" }),
        projeto({ id: "2", autor: "Ana", email: "ana@x.com" }),
        projeto({ id: "3", autor: "Bruno", email: "bruno@x.com" }),
      ],
      "autor",
    );
    expect(colunas[0].rotulo).toBe("Ana");
    expect(colunas[0].total).toBe(2);
    expect(colunas[1].rotulo).toBe("Bruno");
  });
});

// ⚠️ O eixo "Fila" SAIU em 14/09/2026 (decisão do Luis): com a coluna ÚNICA de status, o eixo
// "Status" já responde "com quem está a bola" (Pendente = líder, Pré-aprovado = validação,
// Ajuste pedido = autor). Dois eixos para a mesma pergunta faziam o seletor parecer ter mais
// opções do que tem. A régua `filaDe` continua viva em `especiais-view.ts`, para as telas que
// seguem no ar.
describe("o seletor de eixos", () => {
  it("não oferece mais o eixo Fila", () => {
    expect(EIXOS.map((e) => e.eixo)).toEqual(["status", "nota", "autor", "area"]);
  });
});

describe("ordem dentro da coluna", () => {
  it('mais recente primeiro por padrão; "mais antigos" inverte', () => {
    const velho = projeto({ id: "velho", dataOrdenacao: 1 });
    const novo = projeto({ id: "novo", dataOrdenacao: 2 });
    const padrao = agruparKanban([velho, novo], "status");
    expect(padrao.find((c) => c.chave === "pendente")?.projetos.map((p) => p.id)).toEqual([
      "novo",
      "velho",
    ]);
    const invertido = agruparKanban([velho, novo], "status", true);
    expect(invertido.find((c) => c.chave === "pendente")?.projetos.map((p) => p.id)).toEqual([
      "velho",
      "novo",
    ]);
  });

  it('sem data vai para o FIM, nas duas ordens: falta de data não é "mais antigo"', () => {
    const semData = projeto({ id: "sem", dataOrdenacao: null });
    const comData = projeto({ id: "com", dataOrdenacao: 5 });
    for (const maisAntigos of [false, true]) {
      const colunas = agruparKanban([semData, comData], "status", maisAntigos);
      const ids = colunas.find((c) => c.chave === "pendente")?.projetos.map((p) => p.id);
      expect(ids?.[ids.length - 1]).toBe("sem");
    }
  });
});

describe("contrato do módulo", () => {
  it("todo eixo do seletor é agrupável — nenhum devolve undefined", () => {
    const base = [projeto()];
    for (const { eixo } of EIXOS) {
      const colunas = agruparKanban(base, eixo);
      expect(Array.isArray(colunas)).toBe(true);
      expect(colunas.reduce((n, c) => n + c.total, 0)).toBe(1);
    }
  });

  it("o TOTAL da coluna é o de verdade, não o recortado pelo teto de cartões", () => {
    // O teto é da TELA (`CARTOES_INICIAIS`): se ele vazasse para o total, o cabeçalho da
    // coluna mentiria sobre o tamanho da fila.
    const muitos = Array.from({ length: CARTOES_INICIAIS + 5 }, (_, i) => projeto({ id: `p${i}` }));
    const pendente = agruparKanban(muitos, "status").find((c) => c.chave === "pendente");
    expect(pendente?.total).toBe(CARTOES_INICIAIS + 5);
    expect(pendente?.projetos).toHaveLength(CARTOES_INICIAIS + 5);
  });
});

describe("a tela não busca nada de novo para desenhar o quadro", () => {
  const tela = readFileSync(
    resolve(process.cwd(), "src/routes/_authenticated/dashboard.tsx"),
    "utf8",
  );

  it("o quadro reagrupa a MESMA listagem já em cache", () => {
    expect(tela).toContain("agruparKanban(filtrados, eixo, maisAntigos)");
  });

  it("trocar de vista ou de eixo não dispara requisição", () => {
    // Só duas chamadas de rede existem nesta tela: a listagem (React Query) e a gravação
    // de status. Um `apiFetch` novo aqui seria uma requisição por troca de eixo.
    const chamadas = tela.match(/apiFetch[<(]/g) ?? [];
    // As 4: a listagem, o fallback dela quando não há prefetch, o "Atualizar" (?refresh=1)
    // e a gravação de status. Nenhuma delas depende da vista nem do eixo.
    expect(chamadas).toHaveLength(4);
  });
});
