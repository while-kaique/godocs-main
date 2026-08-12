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
  mensagemEspecialDashboard,
  mensagemEspecialGanhoOrganizacional,
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
      // Triagem do especial (Etapa 2.5) — detalhe em tests/especial-triagem.test.ts.
      mensagemEspecialDashboard(),
      mensagemEspecialGanhoOrganizacional(),
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
