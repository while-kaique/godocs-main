/**
 * MENSAGENS DE BLOQUEIO DA SUBMISSÃO.
 *
 * O caso que originou o módulo: submissão com 60h/mês validadas no memorial recebia
 * "sem ganho mensurável… o ganho precisa vir de uma redução concreta de horas" — o oposto do
 * que estava na tela. O que barrava era o LÍQUIDO (custo da ferramenta abatendo), e o texto
 * nunca citava isso nem dizia o que fazer.
 */
import { describe, it, expect } from "vitest";
import {
  mensagemSavingSemGanho,
  mensagemReceitaZerada,
  mensagemReceitaIncompleta,
  mensagemDocAusente,
  mensagemDuplicata,
  bloqueioSavingSemGanho,
  bloqueioReceitaZerada,
  bloqueioReceitaIncompleta,
  bloqueioDocAusente,
  bloqueioDuplicata,
  formatarBloqueio,
  erroDeBloqueio,
  type BloqueioSubmissao,
} from "@/lib/mensagens-submissao";

// O caso real: 60h/mês (2 analistas) contra a Plataforma SmartOnline.
const CASO_SMARTONLINE = {
  horas: 60,
  unidade: "/mês",
  custoEvitado: 0,
  custoExterno: 2500,
  custoProjeto: 0,
  liquido: -868.3,
};

describe("mensagemSavingSemGanho — custos comem o ganho", () => {
  const msg = mensagemSavingSemGanho(CASO_SMARTONLINE);

  it("NÃO afirma que faltam horas quando há horas declaradas", () => {
    // A regressão que o módulo existe para impedir.
    expect(msg).not.toMatch(/sem ganho mensurável/i);
    expect(msg).not.toMatch(/nenhuma hora/i);
    expect(msg).toContain("60h/mês");
  });

  it("nomeia a causa real: o líquido e o custo declarado na Etapa 2", () => {
    expect(msg).toMatch(/LÍQUIDO/);
    expect(msg).toContain("2.500,00");
    expect(msg).toMatch(/ferramenta externa/);
  });

  it("traz o direcionamento com a pegadinha do valor anual", () => {
    expect(msg).toMatch(/Para corrigir/);
    expect(msg).toMatch(/anual/);
    expect(msg).toMatch(/CUSTO EVITADO/);
    expect(msg).toMatch(/ESPECIAL/);
  });

  it("avisa que valor citado só na conversa não é gravado", () => {
    // O outro lado do bug: o R$ 324 mil digitado no chat nunca chegou ao banco.
    expect(msg).toMatch(/não é gravado/);
  });

  it("NÃO expõe o R$ das horas (valor/hora por cargo é escondido do usuário)", () => {
    // 60h × R$ 21,29/33,10 = R$ 1.631,70 — este número não pode aparecer.
    expect(msg).not.toContain("1.631,70");
    expect(msg).not.toMatch(/valor.?hora|por hora/i);
  });

  it("soma os dois tipos de custo quando os dois existem", () => {
    const m = mensagemSavingSemGanho({ ...CASO_SMARTONLINE, custoProjeto: 400 });
    expect(m).toContain("2.500,00");
    expect(m).toContain("400,00");
    expect(m).toMatch(/custo do projeto/);
  });

  it("cita o custo evitado quando ele existe e ainda assim não cobre", () => {
    const m = mensagemSavingSemGanho({
      ...CASO_SMARTONLINE,
      horas: 0,
      custoEvitado: 1200,
      custoExterno: 3000,
    });
    expect(m).toContain("1.200,00");
    expect(m).not.toMatch(/nenhuma hora economizada/);
  });
});

describe("mensagemSavingSemGanho — ganho zero de verdade", () => {
  const msg = mensagemSavingSemGanho({
    horas: 0,
    custoEvitado: 0,
    custoExterno: 0,
    custoProjeto: 0,
    liquido: 0,
  });

  it("aí sim diz que não há ganho, e ensina os 3 caminhos", () => {
    expect(msg).toMatch(/nenhuma hora economizada/);
    expect(msg).toMatch(/nenhum gasto externo eliminado/);
    expect(msg).toMatch(/Para corrigir/);
    expect(msg).toMatch(/CUSTO EVITADO/);
    expect(msg).toMatch(/ESPECIAL/);
  });
});

describe("as outras mensagens de bloqueio", () => {
  it("todas dizem o que fazer, com acentuação (regra 4)", () => {
    for (const msg of [
      mensagemReceitaZerada(),
      mensagemReceitaIncompleta(),
      mensagemDocAusente(),
      mensagemDuplicata("Automação de DIFAL"),
      mensagemSavingSemGanho(CASO_SMARTONLINE),
    ]) {
      expect(msg).toMatch(/Para corrigir/);
      // Sem "producao"/"submissao" sem acento e sem marcador de roteiro interno.
      expect(msg).not.toMatch(/\bproducao\b|\bsubmissao\b|\[\d+\.\d+\]/);
      expect(msg.length).toBeGreaterThan(80);
    }
  });

  it("a duplicata cita o nome e oferece editar o existente", () => {
    const m = mensagemDuplicata("Automação de DIFAL");
    expect(m).toContain('"Automação de DIFAL"');
    expect(m).toMatch(/Meus Projetos/);
  });

  it("a receita incompleta ainda oferece a troca de tipo para Saving", () => {
    expect(mensagemReceitaIncompleta()).toMatch(/troque o tipo do projeto para Saving/);
  });
});

/**
 * CAMADA ESTRUTURADA (12/08/2026) — o bloqueio viaja como dado até a tela, que o mostra num
 * painel âmbar ancorado no botão em vez de um toast vermelho de 20s. Ver
 * `spec-docs/SPEC_MENSAGENS_ERRO.md`.
 */
describe("bloqueio estruturado", () => {
  const TODOS: BloqueioSubmissao[] = [
    bloqueioSavingSemGanho(CASO_SMARTONLINE),
    bloqueioSavingSemGanho({ horas: 0, custoEvitado: 0, custoExterno: 0, custoProjeto: 0, liquido: 0 }),
    bloqueioReceitaZerada(),
    bloqueioReceitaIncompleta(),
    bloqueioDocAusente(),
    bloqueioDuplicata("Automação de DIFAL"),
  ];

  it("todo bloqueio tem veredito CURTO, o porquê e ao menos um caminho", () => {
    for (const b of TODOS) {
      expect(b.codigo).toBeTruthy();
      // O título é uma linha — ele vai num `h3` de 13,5px acima do botão. Se virar parágrafo,
      // volta a ser a parede de texto que o painel existe para desfazer.
      expect(b.titulo.length).toBeLessThanOrEqual(80);
      expect(b.titulo).not.toMatch(/^Erro|^Falha/i);
      expect(b.resumo.length).toBeGreaterThan(30);
      expect(b.caminhos.length).toBeGreaterThan(0);
      for (const c of b.caminhos) {
        // Rótulo é a ação escaneável; o detalhe diz onde/como.
        expect(c.rotulo.length).toBeLessThanOrEqual(60);
        expect(c.detalhe.length).toBeGreaterThan(30);
        // Caminhos são ALTERNATIVAS — quem numera é a lista, nunca o texto (o "(1)(2)(3)"
        // antigo fazia parecer obrigatório cumprir os três).
        expect(c.rotulo).not.toMatch(/^\(?\d/);
      }
    }
  });

  it("os códigos são estáveis (a tela não depende do texto)", () => {
    expect(TODOS.map((b) => b.codigo)).toEqual([
      "saving_sem_ganho",
      "saving_sem_ganho",
      "receita_zerada",
      "receita_incompleta",
      "doc_ausente",
      "nome_duplicado",
    ]);
  });

  it("NUNCA expõe o R$ das horas em nenhum campo do bloqueio", () => {
    // 60h × as taxas por cargo daria R$ 1.631,70 — número escondido do usuário de propósito.
    for (const b of TODOS) {
      const tudo = formatarBloqueio(b);
      expect(tudo).not.toContain("1.631,70");
      expect(tudo).not.toMatch(/valor.?hora|por hora|taxa/i);
    }
  });

  it("manda a pessoa para o lugar onde o campo REALMENTE está", () => {
    // Regressões reais: o custo evitado / custo da ferramenta ficam no formulário de impacto
    // (etapa do Agente) e a mensagem antiga dizia "Etapa 2"; o nome do projeto está na
    // Etapa 2 e a mensagem antiga dizia "Etapa 1".
    const saving = formatarBloqueio(bloqueioSavingSemGanho(CASO_SMARTONLINE));
    expect(saving).toContain('Dados para Análise de Impacto');
    expect(saving).not.toMatch(/campo de CUSTO EVITADO da Etapa 2|Etapa 2 e: /);

    const dup = formatarBloqueio(bloqueioDuplicata("Automação de DIFAL"));
    expect(dup).toMatch(/nome na Etapa 2/);
    expect(dup).not.toMatch(/Etapa 1/);
  });

  it("o texto plano continua trazendo tudo (Error.message / api_logs / cliente antigo)", () => {
    const b = bloqueioReceitaZerada();
    const txt = formatarBloqueio(b);
    expect(txt).toContain(b.titulo);
    expect(txt).toContain(b.resumo);
    expect(txt).toMatch(/Para corrigir/);
    for (const c of b.caminhos) expect(txt).toContain(c.detalhe);
    expect(txt).toBe(mensagemReceitaZerada());
  });

  it("erroDeBloqueio devolve 400 (preenchimento não é 5xx) com o bloqueio anexado", () => {
    const b = bloqueioDocAusente();
    const err = erroDeBloqueio(b) as Error & { status?: number; bloqueio?: BloqueioSubmissao };
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.bloqueio).toEqual(b);
    expect(err.message).toBe(formatarBloqueio(b));
  });
});
