/**
 * O texto de apoio dos campos do formulário mora em TOOLTIP, não na página.
 *
 * Pedido do dono do produto (15/09/2026), olhando a Etapa 2 inteira: *"todo texto abaixo de
 * título de seção assim deve estar em tooltip para enxugar a página de informação e texto"*.
 * Com quatro campos seguidos, três deles com duas ou três linhas de apoio, a pessoa rolava
 * mais texto do que formulário — e parava de ler, inclusive o que importa.
 *
 * ⚠️ O que estes testes seguram é a REGRESSÃO fácil: alguém volta a renderizar o `hint` como
 * parágrafo abaixo do rótulo "porque fica mais visível". Fica — e é justamente o problema.
 *
 * Render estático (`renderToStaticMarkup`), o mesmo piso barato de `quadro-render`: sem DOM,
 * os efeitos não rodam, então o tooltip não é montado e o que sobra no markup é só o gatilho.
 * É exatamente o estado que se quer provar.
 */
import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormLabel } from "@/lib/submeter/form-components";
import {
  AFETADO_TIPOS,
  AFETADO_EMPRESA,
  PAPEIS_PARTICIPANTE,
  MAX_PARTICIPANTES,
} from "@/lib/submeter/constants";

const HINT = "Descreva em 2-4 frases para que serve este projeto, para quem e o resultado";

describe("FormLabel: a orientação sai da página e vira tooltip", () => {
  it("o título continua visível", () => {
    const html = renderToStaticMarkup(
      h(FormLabel, { hint: HINT, children: "Contexto de Negócio" }),
    );
    expect(html).toContain("Contexto de Negócio");
  });

  it("⚠️ o texto de apoio NÃO é renderizado como parágrafo na página", () => {
    const html = renderToStaticMarkup(
      h(FormLabel, { hint: HINT, children: "Contexto de Negócio" }),
    );
    // O hint só existe no `aria-label` do gatilho; não pode aparecer como conteúdo de texto.
    expect(html).not.toContain(`>${HINT}<`);
  });

  it("o gatilho existe e carrega a orientação no aria-label (leitor de tela a ouve)", () => {
    const html = renderToStaticMarkup(
      h(FormLabel, { hint: HINT, children: "Contexto de Negócio" }),
    );
    expect(html).toContain("go-info-icon");
    expect(html).toContain(`aria-label="${HINT}"`);
  });

  it("o gatilho é alcançável por teclado", () => {
    const html = renderToStaticMarkup(h(FormLabel, { hint: HINT, children: "Contexto" }));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
  });

  it("campo sem orientação não ganha gatilho nenhum", () => {
    const html = renderToStaticMarkup(h(FormLabel, { children: "Nome do Projeto" }));
    expect(html).not.toContain("go-info-icon");
  });

  it("o asterisco de obrigatório sobrevive ao tooltip", () => {
    const html = renderToStaticMarkup(
      h(FormLabel, { required: true, hint: HINT, children: "Contexto" }),
    );
    expect(html).toContain("*");
    expect(html).toContain("go-info-icon");
  });
});

describe('"quem sentiria falta" oferece a empresa inteira', () => {
  it("são três opções, e a empresa é a terceira", () => {
    expect(AFETADO_TIPOS.map((t) => t.value)).toEqual(["pessoa", "time", "empresa"]);
  });

  /** ⚠️ A grafia da marca é `Gogroup` — nunca `GoGroup`, nunca `Go Group`. */
  it("o valor gravado usa a grafia da marca", () => {
    expect(AFETADO_EMPRESA).toBe("Gogroup");
  });

  it("cada opção tem rótulo com ícone E texto (estado nunca só por cor)", () => {
    for (const t of AFETADO_TIPOS) {
      expect(t.label.length).toBeGreaterThan(4);
      expect(t.label).toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});

describe("os três papéis de participante", () => {
  /**
   * ⚠️ "Apenas 1 por projeto" saiu da descrição do Coautor quando a regra passou a valer para
   * os três (15/09/2026): repetir a frase em um só deles diria que os outros são ilimitados.
   * A nota abaixo do campo é quem informa a regra, uma vez.
   */
  it("nenhuma descrição de papel promete exclusividade só para si", () => {
    for (const p of PAPEIS_PARTICIPANTE) {
      expect(p.descricao.toLowerCase()).not.toContain("apenas 1");
      expect(p.descricao.toLowerCase()).not.toContain("apenas um");
    }
  });
});

describe("o teto de participantes é consequência de um por papel", () => {
  /**
   * ⚠️ Com três papéis únicos, a quarta pessoa não teria papel possível: o campo dela ficaria
   * sem opções e o gate "escolha o papel de cada participante" travaria o avanço para sempre,
   * sem dizer o que fazer. O teto existe para esse beco não abrir — e é DERIVADO do catálogo,
   * nunca um número solto.
   */
  it("é exatamente o número de papéis", () => {
    expect(MAX_PARTICIPANTES).toBe(PAPEIS_PARTICIPANTE.length);
    expect(MAX_PARTICIPANTES).toBe(3);
  });
});
