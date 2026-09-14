/**
 * Smoke de RENDER do quadro da triagem.
 *
 * ⚠️ Este repo não tem harness de render (sem jsdom), e por isso os guards de UI são feitos
 * sobre o FONTE — o que pega fiação, mas não pega o componente que EXPLODE ao montar. Aqui a
 * renderização é estática (`renderToStaticMarkup`), que não precisa de DOM nenhum: é o piso
 * mais barato que prova que o quadro monta com dado real, nos cinco eixos.
 *
 * Sem JSX de propósito: a suíte só coleta `tests/**\/*.test.ts`, e passar a coletar `.tsx`
 * seria mudar a configuração do projeto por causa de um arquivo.
 */
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuadroTriagem, QuadroEsqueleto } from "@/components/dashboard/quadro-triagem";
import { BarraFiltros } from "@/components/dashboard/painel-filtros";
import { agruparKanban, EIXOS } from "@/lib/dashboard-kanban";
import { FILTROS_VAZIOS } from "@/lib/dashboard-filtros";
import type { ProjetoDashboardResumo } from "@/lib/dashboard-resumo";

const PROJETO: ProjetoDashboardResumo = {
  id: "abc",
  nome: "Projeto de teste",
  autor: "Maria",
  email: "maria@gocase.com",
  area: "FISCAL",
  status: "Pendente",
  statusChave: "pendente",
  dataSubmissao: "01/09/2026",
  dataOrdenacao: Date.parse("2026-09-01T00:00:00Z"),
  ganhoTotal: 1234,
  savingReais: null,
  receitaMensal: null,
  savingEfetivado: null,
  custoEvitadoHoras: null,
  complexidade: "media",
  tipoProjeto: "Agente",
  tipos: "custo evitado",
  especial: true,
  aprovacaoLider: "Pré-pendente",
  estrelas: 3,
  estrelaAgente: "6-10",
  confiancaAgente: "alta",
  busca: "projeto maria",
};

function quadro(eixo: Parameters<typeof agruparKanban>[1], projetos = [PROJETO]) {
  return renderToStaticMarkup(
    h(QuadroTriagem, {
      colunas: agruparKanban(projetos, eixo),
      eixo,
      avaliacoes: {
        abc: { veredito: "aprovar", confianca: 0.9, divergencia: true, aplicar: false },
      },
      feedbacks: {},
      selecionados: new Set(["abc"]),
      salvandoId: null,
      agoraMs: Date.parse("2026-09-14T00:00:00Z"),
      onSelecionar: () => {},
      onDecidir: () => {},
      onAbrirFicha: () => {},
      onAquecer: () => {},
    }),
  );
}

describe("o quadro monta", () => {
  it("com um cartão completo, e o cartão traz decisão + espera", () => {
    const html = quadro("status");
    expect(html).toContain("Projeto de teste");
    expect(html).toContain("Aprovar");
    expect(html).toContain("Pedir reenvio");
    expect(html).toContain("Reprovar");
    expect(html).toContain("dias esperando");
  });

  it("⚠️ sem travessão: o traço saiu das telas (pedido do Luis, 14/09/2026)", () => {
    expect(quadro("status")).not.toContain("—");
  });

  it("nos CINCO eixos do seletor, sem quebrar nenhum", () => {
    for (const { eixo } of EIXOS) {
      expect(quadro(eixo)).toContain("Projeto de teste");
    }
  });

  it("sem nenhum projeto, diz isso em vez de quebrar", () => {
    const html = renderToStaticMarkup(
      h(QuadroTriagem, {
        colunas: [],
        eixo: "status",
        avaliacoes: {},
        feedbacks: {},
        selecionados: new Set<string>(),
        salvandoId: null,
        agoraMs: 0,
        onSelecionar: () => {},
        onDecidir: () => {},
        onAbrirFicha: () => {},
        onAquecer: () => {},
      }),
    );
    expect(html).toContain("Nenhum projeto casa com esse recorte");
  });

  it("o esqueleto respeita prefers-reduced-motion e é decorativo", () => {
    const html = renderToStaticMarkup(h(QuadroEsqueleto));
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("aria-hidden");
  });
});

describe("a barra de filtros monta", () => {
  it("com as pílulas do que está ligado", () => {
    const html = renderToStaticMarkup(
      h(BarraFiltros, {
        filtros: { ...FILTROS_VAZIOS, especial: "apenas", area: "FISCAL" },
        setFiltros: () => {},
        busca: "",
        setBusca: () => {},
        areas: ["FISCAL"],
        pareceres: [],
        categorias: [],
        contagemAgente: { sem: 1, com: 2 },
        hoje: "2026-09-14",
        ordenarMaisAntigos: false,
        onOrdenarMaisAntigos: () => {},
        buscaRef: { current: null },
      }),
    );
    expect(html).toContain("Filtros");
    expect(html).toContain("Especiais");
    expect(html).toContain("FISCAL");
    // Painel FECHADO por padrão: os campos não ocupam a tela antes de alguém pedir.
    expect(html).not.toContain("Pré-aprovação do líder");
  });
});
