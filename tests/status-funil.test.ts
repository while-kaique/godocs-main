/**
 * A coluna ÚNICA de status.
 *
 * O que estes testes seguram é o que a fusão de duas colunas pode quebrar em silêncio: a
 * régua de quem vence quem, o vocabulário legado que continua na planilha, e o portão do
 * agente — que é a razão de a coluna ter virado uma só.
 *
 * ⚠️ Os casos de `unificarStatus` são as combinações MEDIDAS em produção (14/09/2026, 782
 * linhas), não exemplos inventados: é lá que estão as contradições que a coluna única
 * resolve (36 Reprovados marcados como "Pré-aprovado", 14 Aprovados como "Pré-pendente").
 */
import { describe, it, expect } from "vitest";
import { rotuloIsencaoSheet } from "@/lib/aprovacoes.functions";
import {
  STATUS_PROJETO,
  STATUS_GRAVAVEIS_PROJETO,
  STATUS_ARQUIVO,
  STATUS_FINAIS,
  ehArquivado,
  ehReenvioDeAjuste,
  podeAgenteDecidir,
  statusDeSubmissao,
  statusDoParecerDoLider,
  statusDoTexto,
  unificarStatus,
  entraNaFilaDeAvaliacao,
} from "@/lib/status-funil";
import { pilulaDe, STATUS_TRIAGEM } from "@/components/dashboard/status-triagem";
import { STATUS_GRAVAVEIS_ESPECIAIS } from "@/lib/especiais-acoes";
import { ehStatusIndeciso } from "@/lib/decisao-humana";
import { planejarMigracao } from "@/lib/migrar-status-unico";
import { agenteDeveGravar, agentePodeGravar } from "@/lib/funil-status";
import { ehDaFilaRpa } from "@/lib/aprovacao-pendentes-view";

describe("o vocabulário", () => {
  it("são cinco status de funil, nesta ordem", () => {
    expect(STATUS_PROJETO).toEqual([
      "Pendente",
      "Pré-aprovado",
      "Ajuste pedido",
      "Aprovado",
      "Reprovado",
    ]);
  });

  it("`Descontinuado` é gravável, mas NÃO é etapa do funil", () => {
    expect(STATUS_GRAVAVEIS_PROJETO).toContain(STATUS_ARQUIVO);
    expect(STATUS_PROJETO as readonly string[]).not.toContain(STATUS_ARQUIVO);
    expect(ehArquivado("Descontinuado")).toBe(true);
    expect(statusDoTexto("Descontinuado")).toBeNull();
  });

  it("o vocabulário ANTERIOR continua sendo lido: a planilha tem as duas gerações", () => {
    expect(statusDoTexto("Em validação")).toBe("Pendente");
    expect(statusDoTexto("Reenvio Pendente")).toBe("Ajuste pedido");
    expect(statusDoTexto("Rejeitado")).toBe("Ajuste pedido");
    expect(statusDoTexto("Validado")).toBe("Aprovado");
    expect(statusDoTexto("Pré-pendente")).toBe("Pendente");
    expect(statusDoTexto("Pré-reprovado")).toBe("Reprovado");
  });

  it("a isenção vem com o porquê colado e ainda casa", () => {
    expect(statusDoTexto("Pré-aprovado (liderança)")).toBe("Pré-aprovado");
    expect(statusDoTexto("Pré-aprovado (sem líder)")).toBe("Pré-aprovado");
    expect(statusDoTexto("pre-aprovado")).toBe("Pré-aprovado");
  });

  it("⚠️ texto DESCONHECIDO devolve null, nunca um palpite", () => {
    // É a lição do `Dispensado` que virava `Pré-reprovado` num fall-through e afirmava que o
    // líder tinha reprovado um projeto que ele nunca abriu.
    expect(statusDoTexto("Em revisão pelo comitê")).toBeNull();
    expect(statusDoTexto("Dispensado")).toBeNull();
    expect(statusDoTexto("")).toBeNull();
    expect(statusDoTexto("—")).toBeNull();
    expect(statusDoTexto(null)).toBeNull();
  });
});

describe("unificar as duas colunas antigas", () => {
  it("arquivo vence tudo", () => {
    expect(unificarStatus("Descontinuado", "Pré-aprovado")).toBe("Descontinuado");
    expect(unificarStatus("Descontinuado", "Pré-pendente")).toBe("Descontinuado");
  });

  it("decisão FINAL vence o parecer do líder (as contradições medidas em prod)", () => {
    // 36 linhas em produção: Reprovado com "Pré-aprovado" ao lado.
    expect(unificarStatus("Reprovado", "Pré-aprovado")).toBe("Reprovado");
    // 14 linhas: Aprovado com "Pré-pendente" ao lado.
    expect(unificarStatus("Aprovado", "Pré-pendente")).toBe("Aprovado");
    // 6 + 3 linhas: decidido com "Ajuste pedido" ao lado.
    expect(unificarStatus("Aprovado", "Ajuste pedido")).toBe("Aprovado");
    expect(unificarStatus("Reprovado", "Ajuste pedido")).toBe("Reprovado");
    // 1 linha: Aprovado com "Pré-reprovado" ao lado.
    expect(unificarStatus("Aprovado", "Pré-reprovado")).toBe("Aprovado");
  });

  it("sem decisão final, o parecer do líder é quem manda", () => {
    expect(unificarStatus("Pendente", "Pré-aprovado")).toBe("Pré-aprovado");
    expect(unificarStatus("Pendente", "Ajuste pedido")).toBe("Ajuste pedido");
    expect(unificarStatus("Pendente", "Pré-reprovado")).toBe("Reprovado");
    expect(unificarStatus("Em validação", "Pré-aprovado")).toBe("Pré-aprovado");
  });

  it("o pedido de ajuste da TRIAGEM vence o 'esperando' do líder", () => {
    expect(unificarStatus("Reenvio Pendente", "Pré-pendente")).toBe("Ajuste pedido");
    expect(unificarStatus("Reenvio Pendente", "Pré-aprovado")).toBe("Ajuste pedido");
  });

  it("`Dispensado` não decide nada: fecha a FILA, não o projeto", () => {
    expect(unificarStatus("Pendente", "Dispensado")).toBe("Pendente");
  });

  it("as 3 linhas Pendentes sem parecer de prod continuam Pendentes", () => {
    expect(unificarStatus("Pendente", "")).toBe("Pendente");
    expect(unificarStatus("Pendente", null)).toBe("Pendente");
    expect(unificarStatus("Pendente", "—")).toBe("Pendente");
  });

  it("linha vazia dos dois lados vira Pendente, nunca null", () => {
    expect(unificarStatus(null, null)).toBe("Pendente");
    expect(unificarStatus("", "")).toBe("Pendente");
  });

  it("⚠️ a maioria de prod (Aprovado + pré-status vazio) não se mexe", () => {
    // 434 linhas. A migração precisa ser quase um no-op, senão ela é o risco, não o remédio.
    expect(unificarStatus("Aprovado", "")).toBe("Aprovado");
    expect(unificarStatus("Reprovado", "")).toBe("Reprovado");
  });

  it("é IDEMPOTENTE: rodar a migração duas vezes não muda nada", () => {
    for (const s of [...STATUS_GRAVAVEIS_PROJETO]) {
      expect(unificarStatus(s, null)).toBe(s);
      // e com a coluna antiga já vazia, que é como a base fica depois de migrar
      expect(unificarStatus(unificarStatus(s, null), null)).toBe(s);
    }
  });
});

describe("o portão do agente", () => {
  it("⚠️ SÓ decide em Pré-aprovado", () => {
    expect(podeAgenteDecidir("Pré-aprovado")).toBe(true);
    expect(podeAgenteDecidir("Pré-aprovado (liderança)")).toBe(true);
    expect(podeAgenteDecidir("Pendente")).toBe(false);
    expect(podeAgenteDecidir("Ajuste pedido")).toBe(false);
    expect(podeAgenteDecidir("Aprovado")).toBe(false);
    expect(podeAgenteDecidir("Reprovado")).toBe(false);
    expect(podeAgenteDecidir("Descontinuado")).toBe(false);
    expect(podeAgenteDecidir(null)).toBe(false);
  });

  it("`Pré-aprovado` NÃO conta como decisão humana, senão a trava barraria o agente onde ele foi convocado", () => {
    expect(ehStatusIndeciso("Pré-aprovado")).toBe(true);
    expect(ehStatusIndeciso("Pré-aprovado (liderança)")).toBe(true);
    // e o que é decisão de verdade continua sendo
    expect(ehStatusIndeciso("Aprovado")).toBe(false);
    expect(ehStatusIndeciso("Reprovado")).toBe(false);
  });
});

describe("quem move o status", () => {
  it("o parecer do líder", () => {
    expect(statusDoParecerDoLider("aprovado")).toBe("Pré-aprovado");
    expect(statusDoParecerDoLider("ajuste")).toBe("Ajuste pedido");
    expect(statusDoParecerDoLider("reprovado")).toBe("Reprovado");
  });

  it("fila aberta e fila dispensada NÃO movem o funil", () => {
    expect(statusDoParecerDoLider("pendente")).toBeNull();
    expect(statusDoParecerDoLider("dispensado")).toBeNull();
    expect(statusDoParecerDoLider("qualquer coisa nova")).toBeNull();
  });

  it("a submissão: quem entra em fila nasce Pendente, quem é isento nasce Pré-aprovado", () => {
    expect(statusDeSubmissao({ isento: false })).toBe("Pendente");
    expect(statusDeSubmissao({ isento: true })).toBe("Pré-aprovado");
  });

  /**
   * ⚠️ REGRESSÃO REAL (15/09/2026). A 1ª versão desta régua lia o `rotuloSheet`, e
   * `rotuloIsencaoSheet` devolve "Pré-aprovado" em UM dos quatro casos de isenção e "—" nos
   * outros três — de propósito (D12: aqueles três não têm ESTADO, o porquê vai na
   * justificativa). Resultado em produção: **projeto especial nascia `Pendente` e ficava
   * preso para sempre**, porque especial não entra em fila (D27) e o portão só deixa o
   * agente agir em `Pré-aprovado`. Três dos oito Pendentes de prod estavam nessa situação.
   *
   * Este teste percorre os QUATRO motivos usando a MESMA função que monta o rótulo, então
   * ele quebra se alguém voltar a derivar o funil daquela coluna.
   */
  it("⚠️ os QUATRO motivos de isenção nascem Pré-aprovado, não só o de liderança", () => {
    const motivos = ["lideranca", "sem_lider", "teamguide_indisponivel", "especial"] as const;
    for (const motivo of motivos) {
      const rotulo = rotuloIsencaoSheet(motivo);
      expect(
        statusDeSubmissao({ isento: true }),
        `isenção por "${motivo}" (rótulo "${rotulo}") tem de nascer Pré-aprovado`,
      ).toBe("Pré-aprovado");
    }
    // E a prova de que o rótulo NÃO servia como régua: 3 dos 4 não dizem "Pré-aprovado".
    const rotulos = motivos.map(rotuloIsencaoSheet);
    expect(rotulos.filter((r) => r === "Pré-aprovado")).toHaveLength(1);
  });

  it("o reenvio só reabre quem estava em Ajuste pedido", () => {
    expect(ehReenvioDeAjuste("Ajuste pedido")).toBe(true);
    // vocabulário anterior, mesma coisa
    expect(ehReenvioDeAjuste("Reenvio Pendente")).toBe(true);
    // ⚠️ reenvio de um Aprovado NÃO o rebaixa: a triagem decidiu, e desfazer é de gente
    expect(ehReenvioDeAjuste("Aprovado")).toBe(false);
    expect(ehReenvioDeAjuste("Pendente")).toBe(false);
    expect(ehReenvioDeAjuste(null)).toBe(false);
  });

  it("os finais são os dois que encerram", () => {
    expect([...STATUS_FINAIS]).toEqual(["Aprovado", "Reprovado"]);
  });
});

describe("a tela fala a mesma língua do funil", () => {
  it("toda pílula da triagem é um status gravável", () => {
    for (const s of STATUS_TRIAGEM) {
      const casa = STATUS_GRAVAVEIS_PROJETO.some((g) => g.toLowerCase() === s.chave);
      expect(casa, `pílula "${s.chave}" não existe em STATUS_GRAVAVEIS_PROJETO`).toBe(true);
    }
  });

  it("todo status gravável tem pílula (senão a fila fica inalcançável)", () => {
    for (const g of STATUS_GRAVAVEIS_PROJETO) {
      const casa = STATUS_TRIAGEM.some((s) => s.chave === g.toLowerCase());
      expect(casa, `status "${g}" não tem pílula na triagem`).toBe(true);
    }
  });

  it("o vocabulário legado cai na pílula equivalente, sem coluna solta", () => {
    expect(pilulaDe("reenvio pendente")).toBe("ajuste pedido");
    expect(pilulaDe("rejeitado")).toBe("ajuste pedido");
    expect(pilulaDe("em validação")).toBe("pendente");
    expect(pilulaDe("pré-pendente")).toBe("pendente");
    expect(pilulaDe("pré-reprovado")).toBe("reprovado");
    expect(pilulaDe("pré-aprovado (liderança)")).toBe("pré-aprovado");
    // célula vazia é a mesma fila de "ninguém decidiu"
    expect(pilulaDe(null)).toBe("pendente");
    expect(pilulaDe("—")).toBe("pendente");
  });

  it("as ações do cartão gravam status que existem", () => {
    for (const status of Object.values(STATUS_GRAVAVEIS_ESPECIAIS)) {
      expect(STATUS_GRAVAVEIS_PROJETO as readonly string[]).toContain(status);
    }
  });
});

// ─── A migração da planilha ──────────────────────────────────────────────────

describe("planejar a migração", () => {
  const linha = (id: string, status: string, parecer = "") => ({
    "ID Projeto": id,
    Status: status,
    "Aprovação do Líder": parecer,
  });

  it("só propõe mudança onde o status muda de verdade", () => {
    const r = planejarMigracao([
      linha("a", "Aprovado", ""),
      linha("b", "Pendente", "Pré-aprovado"),
      linha("c", "Reprovado", "Pré-aprovado"),
    ]);
    expect(r.mudancas.map((m) => m.id)).toEqual(["b"]);
    expect(r.mudancas[0]).toMatchObject({ de: "Pendente", para: "Pré-aprovado" });
    expect(r.inalteradas).toBe(2);
  });

  it("⚠️ linha SEM id é descartada, nunca migrada", () => {
    // Sem id não há o que endereçar, e inventar um destino escreveria na linha errada.
    const r = planejarMigracao([linha("", "Pendente", "Pré-aprovado")]);
    expect(r.mudancas).toEqual([]);
    expect(r.inalteradas).toBe(0);
  });

  it("é IDEMPOTENTE: rodar de novo sobre o resultado não propõe nada", () => {
    const antes = [linha("a", "Pendente", "Pré-aprovado"), linha("b", "Reenvio Pendente", "")];
    const r1 = planejarMigracao(antes);
    expect(r1.mudancas).toHaveLength(2);
    const depois = antes.map((l) => ({
      ...l,
      Status: r1.mudancas.find((m) => m.id === l["ID Projeto"])?.para ?? l.Status,
    }));
    expect(planejarMigracao(depois).mudancas).toEqual([]);
  });

  it("o relatório diz o PORQUÊ: o parecer que causou a mudança vai junto", () => {
    const r = planejarMigracao([linha("a", "Pendente", "Ajuste pedido")]);
    expect(r.mudancas[0].parecer).toBe("Ajuste pedido");
  });

  it("célula de status vazia aparece como (vazio), não como string vazia no relatório", () => {
    const r = planejarMigracao([linha("a", "", "Pré-aprovado")]);
    expect(r.mudancas[0]).toMatchObject({ de: "(vazio)", para: "Pré-aprovado" });
  });
});

// ─── A tela que ficou fora do menu não pode quebrar calada ───────────────────

describe("a fila do RPA reconhece o status novo", () => {
  const proj = (statusChave: string | null) =>
    ({
      id: "x",
      statusChave,
      especial: false,
    }) as unknown as Parameters<typeof ehDaFilaRpa>[0];

  it("⚠️ `Pré-aprovado` continua na fila: é o que a tela existe para mostrar", () => {
    // Antes da coluna única o pré-aprovado tinha `statusChave === 'pendente'` e o que o
    // distinguia era a coluna do líder. Sem reconhecer o status novo, os pré-aprovados
    // sumiriam da `/aprovacoes-pendentes` — que saiu do menu, mas continua no ar.
    expect(ehDaFilaRpa(proj("pré-aprovado"))).toBe(true);
    expect(ehDaFilaRpa(proj("pré-aprovado (liderança)"))).toBe(true);
    expect(ehDaFilaRpa(proj("pendente"))).toBe(true);
    expect(ehDaFilaRpa(proj(""))).toBe(true);
  });

  it("quem já foi decidido continua fora", () => {
    expect(ehDaFilaRpa(proj("aprovado"))).toBe(false);
    expect(ehDaFilaRpa(proj("reprovado"))).toBe(false);
    expect(ehDaFilaRpa(proj("descontinuado"))).toBe(false);
    expect(ehDaFilaRpa(proj("ajuste pedido"))).toBe(false);
  });
});

// ─── O 2º passo da migração: destravar quem ninguém vai decidir ──────────────

describe("migração destrava quem não tem fila", () => {
  const linha = (id: string, status: string, parecer = "") => ({
    "ID Projeto": id,
    Status: status,
    "Aprovação do Líder": parecer,
  });

  it("⚠️ Pendente SEM fila aberta vira Pré-aprovado: ninguém virá decidir", () => {
    // O caso real de prod: 3 especiais e 1 legado, todos com a coluna do líder vazia.
    const r = planejarMigracao([linha("especial-1", "Pendente", "")], new Set());
    expect(r.mudancas).toEqual([
      { id: "especial-1", de: "Pendente", para: "Pré-aprovado", parecer: "(vazio)" },
    ]);
  });

  it("Pendente COM fila aberta continua Pendente: o líder ainda vai olhar", () => {
    const r = planejarMigracao(
      [linha("esperando", "Pendente", "Pré-pendente")],
      new Set(["esperando"]),
    );
    expect(r.mudancas).toEqual([]);
    expect(r.inalteradas).toBe(1);
  });

  it("o casamento do id ignora a CAIXA (legado é MAIÚSCULO na planilha)", () => {
    const r = planejarMigracao([linha("LEGADO-042", "Pendente", "")], new Set(["legado-042"]));
    expect(r.mudancas, "tem fila aberta, não pode ser destravado").toEqual([]);
  });

  it("⚠️ o 2º passo NÃO toca quem já foi decidido nem quem está em ajuste", () => {
    const r = planejarMigracao(
      [
        linha("a", "Aprovado", ""),
        linha("b", "Reprovado", ""),
        linha("c", "Ajuste pedido", ""),
        linha("d", "Descontinuado", ""),
      ],
      new Set(),
    );
    expect(r.mudancas).toEqual([]);
    expect(r.inalteradas).toBe(4);
  });

  it("sem o conjunto, o comportamento é o da 1ª versão (só unifica as 2 colunas)", () => {
    const r = planejarMigracao([linha("a", "Pendente", "")]);
    expect(r.mudancas).toEqual([]);
  });

  it("é IDEMPOTENTE com o 2º passo ligado", () => {
    const antes = [linha("sem-fila", "Pendente", "")];
    const r1 = planejarMigracao(antes, new Set());
    expect(r1.mudancas).toHaveLength(1);
    const depois = antes.map((l) => ({ ...l, Status: r1.mudancas[0].para }));
    expect(planejarMigracao(depois, new Set()).mudancas).toEqual([]);
  });
});

// ─── Avaliar ≠ decidir, e "não decidi" não se escreve ────────────────────────

describe("o que o agente FAZ e o que ele GRAVA são coisas diferentes", () => {
  /**
   * ⚠️ REGRESSÃO REAL (15/09/2026). Eu pus `podeAgenteDecidir` no filtro da FILA, e projeto
   * em `Pendente` — esperando o líder — deixou de ser AVALIADO: ficava sem estrela e sem
   * parecer. Dono do produto: *"deveria ter o time de agentes já classificado eles, não é?"*.
   * A classificação é informação e ajuda o próprio líder a decidir.
   */
  it("⚠️ `Pendente` ENTRA na fila de avaliação, mesmo sem poder ser decidido", () => {
    expect(entraNaFilaDeAvaliacao("Pendente")).toBe(true);
    expect(podeAgenteDecidir("Pendente")).toBe(false);
  });

  it("`Pré-aprovado` entra nas duas: é avaliado E pode ser decidido", () => {
    expect(entraNaFilaDeAvaliacao("Pré-aprovado")).toBe(true);
    expect(podeAgenteDecidir("Pré-aprovado")).toBe(true);
  });

  it("célula vazia é tratada como Pendente e entra na fila", () => {
    expect(entraNaFilaDeAvaliacao(null)).toBe(true);
    expect(entraNaFilaDeAvaliacao("")).toBe(true);
    expect(entraNaFilaDeAvaliacao("—")).toBe(true);
  });

  it("quem já foi decidido, está em ajuste ou arquivado NÃO é reavaliado", () => {
    // Gastar ~30 chamadas de LLM em material que já foi decidido ou que o autor vai reescrever.
    for (const s of ["Aprovado", "Reprovado", "Ajuste pedido", "Descontinuado"]) {
      expect(entraNaFilaDeAvaliacao(s), s).toBe(false);
    }
  });

  /**
   * ⚠️ REGRESSÃO REAL (15/09/2026), a mais cara da sessão. O líder pré-aprovou o «Protheus
   * reports», o cron pegou o projeto às 14:43, o time não fechou e o agente gravou
   * `Pré-aprovado → Pendente` — desfazendo a pré-aprovação do líder E retrancando o projeto,
   * porque sem `Pré-aprovado` o portão volta a bloquear. O agente derrubou a própria
   * autorização.
   */
  it("⚠️ o agente NÃO grava `Pendente`: 'não decidi' não se escreve por cima de ninguém", () => {
    expect(agenteDeveGravar("Aprovado")).toBe(true);
    expect(agenteDeveGravar("Reprovado")).toBe(true);
    expect(agenteDeveGravar("Pendente")).toBe(false);
    expect(agenteDeveGravar("Ajuste pedido")).toBe(false);
    expect(agenteDeveGravar("Pré-aprovado")).toBe(false);
  });

  it("tudo que o agente GRAVA é também algo que ele PODE gravar", () => {
    // As duas travas têm de ser coerentes: `agenteDeveGravar` é um subconjunto de
    // `agentePodeGravar`, senão uma delas autorizaria o que a outra proíbe.
    for (const s of [...STATUS_GRAVAVEIS_PROJETO]) {
      if (agenteDeveGravar(s)) expect(agentePodeGravar(s), s).toBe(true);
    }
  });
});
