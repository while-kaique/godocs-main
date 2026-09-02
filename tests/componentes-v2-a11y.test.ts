import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * SMOKE dos 4 componentes da T4 (GoDocs v2), como este repo cobre `.tsx`: leitura do
 * arquivo como TEXTO.
 *
 * Por que assim e não renderizando: o Vitest deste projeto roda `environment: 'node'` e
 * `include: ['tests/**\/*.test.ts']` — não há jsdom nem testing-library. O comportamento
 * dos componentes foi extraído para módulos PUROS (`acordeao-estado`, `itens-lista`,
 * `horas`, `evidencia`), que têm teste de verdade; o que sobra no `.tsx` é marcação, e é
 * ela que este canário prende.
 *
 * O piso de a11y vem da regra 11 do CLAUDE.md: foco de teclado visível, estado NUNCA só
 * por cor, e todo campo com nome acessível.
 */
const ler = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../src/lib/submeter/${rel}`, import.meta.url)), "utf8");

/**
 * O CÓDIGO sem comentários.
 *
 * ⚠️ Necessário porque as asserções de PROIBIÇÃO daqui ("não redigite o rótulo", "não
 * importe `resolverValorHora`") casariam nos comentários que PROÍBEM justamente aquilo —
 * a primeira versão deste canário acusou 5 falsos positivos assim. A régua é sobre o
 * código; a prosa que a explica não pode reprová-la.
 */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ACORDEAO = ler("acordeao.tsx");
const ACORDEAO_CODIGO = semComentarios(ACORDEAO);
const LISTA = ler("lista-itens.tsx");
const LISTA_CODIGO = semComentarios(LISTA);
const TABELA = ler("tabela-horas.tsx");
const TABELA_CODIGO = semComentarios(TABELA);
const EVIDENCIA = ler("campo-evidencia.tsx");
const EVIDENCIA_CODIGO = semComentarios(EVIDENCIA);
const TODOS: [string, string][] = [
  ["acordeao.tsx", ACORDEAO_CODIGO],
  ["lista-itens.tsx", LISTA_CODIGO],
  ["tabela-horas.tsx", TABELA_CODIGO],
  ["campo-evidencia.tsx", EVIDENCIA_CODIGO],
];

describe("Acordeao — disclosure acessível", () => {
  it("a tira inteira é o botão, com aria-expanded e aria-controls", () => {
    expect(ACORDEAO).toContain("aria-expanded={expandido}");
    expect(ACORDEAO).toContain("aria-controls={idPainel}");
    // O `<button>` precisa envolver título/resumo/chevron — se o chevron virasse um
    // segundo botão, seriam 2 stops de teclado para 1 ação.
    expect(ACORDEAO_CODIGO.match(/<button/g)?.length).toBe(1);
  });

  it("o painel é uma região nomeada pelo cabeçalho", () => {
    expect(ACORDEAO).toContain('role="region"');
    expect(ACORDEAO).toContain("aria-labelledby={idCabecalho}");
  });

  it("esconde o painel por atributo, não por display", () => {
    // `hidden` é o que o leitor de tela e o `aria-expanded` combinam; esconder por
    // `display` deixaria o conteúdo focável em alguns caminhos.
    expect(ACORDEAO).toContain("hidden={!expandido}");
  });

  it('"completo" tem ícone E a palavra — estado nunca só por cor', () => {
    expect(ACORDEAO).toContain("Check");
    expect(ACORDEAO).toContain('"Completo"');
  });
});

describe("ListaItens — a lista incremental unificada", () => {
  it("os 4 campos têm nome acessível vindo das props de rótulo", () => {
    for (const aria of [
      "aria-label={rotulos.ariaNome}",
      "aria-label={rotulos.ariaValor}",
      "aria-label={rotulos.ariaFrequencia}",
      "aria-label={rotulos.ariaDescricao}",
      "aria-label={rotulos.ariaRemover}",
    ]) {
      expect(LISTA, `faltou ${aria}`).toContain(aria);
    }
  });

  it("marca aria-invalid nos 4 campos quando há erro", () => {
    expect(LISTA.match(/aria-invalid=\{erro\w+ \? true : undefined\}/g)?.length).toBe(4);
  });

  it("os rótulos das 4 frequências vêm de TIPO_SAVING_LABEL, não redigitados", () => {
    expect(LISTA).toContain("TIPO_SAVING_LABEL");
    for (const texto of ["A cada trimestre", "A cada semestre", "Recorrente (mensal)"]) {
      expect(LISTA_CODIGO, `"${texto}" foi redigitado no componente`).not.toContain(texto);
    }
  });

  it("oferece as 4 frequências de impacto.ts", () => {
    for (const f of ["mensal", "pontual", "trimestral", "semestral"]) {
      expect(LISTA).toContain(`"${f}"`);
    }
  });
});

describe("TabelaHoras — horas por função", () => {
  it("tem nome acessível na função, nas duas colunas de horas e no remover", () => {
    expect(TABELA).toContain('aria-label="Função de quem fazia o trabalho"');
    expect(TABELA).toContain("aria-label={`Horas antes da automação (${unidade})`}");
    expect(TABELA).toContain("aria-label={`Horas depois da automação (${unidade})`}");
    expect(TABELA).toContain('aria-label="Remover esta função"');
  });

  it('mostra o campo de descrição só quando a função é "Outro"', () => {
    expect(TABELA).toContain("precisaDescricaoFuncao(linha.funcao)");
    expect(TABELA).toContain("pedeDescricao ?");
  });

  it("reusa o InfoTooltip canônico (hover E foco de teclado)", () => {
    expect(TABELA).toContain("InfoTooltip");
    expect(TABELA).toContain('from "./form-components"');
  });

  it("a unidade das horas vem de unidadeHoras, não redigitada", () => {
    expect(TABELA).toContain("unidadeHoras(");
    expect(TABELA_CODIGO).not.toContain('"h/trimestre"');
  });
});

describe("CampoEvidencia — texto + anexo + colar", () => {
  it("trata colar imagem e arrastar arquivo", () => {
    expect(EVIDENCIA).toContain("onPaste");
    expect(EVIDENCIA).toContain("clipboardData");
    expect(EVIDENCIA).toContain("onDrop");
  });

  it("não engole o colar de TEXTO — só intercepta quando há imagem", () => {
    // `preventDefault` incondicional quebraria colar texto no campo, que é o uso comum.
    expect(EVIDENCIA).toContain("if (!item) return");
  });

  it("descarta arquivo de 0 byte no cliente", () => {
    // base64 vazio estoura o zod do backend e derruba a submissão inteira (bug real).
    expect(EVIDENCIA).toContain("file.size === 0");
  });

  it("a miniatura tem texto alternativo e o remover tem nome", () => {
    expect(EVIDENCIA).toContain("alt={`Miniatura de ${anexo.filename}`}");
    expect(EVIDENCIA).toContain("aria-label={`Remover anexo ${anexo.filename}`}");
  });

  it("reusa readFileAsBase64 em vez de reimplementar a leitura", () => {
    expect(EVIDENCIA).toContain("readFileAsBase64");
  });

  it("o piso de tamanho sai de EVIDENCIA_MIN, não do literal", () => {
    expect(EVIDENCIA).toContain("EVIDENCIA_MIN");
  });
});

describe("invariantes que valem para os 4", () => {
  it("nenhum importa o cálculo de R$ por hora do backend", () => {
    // O R$ por hora é escondido do submissor de propósito (decisão desde a v1): exibi-lo
    // induz manipulação. `resolverValorHora`/`saving-calc` são backend.
    for (const [nome, src] of TODOS) {
      expect(src, `${nome} importa saving-calc`).not.toContain("saving-calc");
      expect(src, `${nome} usa resolverValorHora`).not.toContain("resolverValorHora");
      expect(src, `${nome} lê valor_hora`).not.toContain("valor_hora");
    }
  });

  it("nenhum guarda estado de negócio em useState", () => {
    // A régua tem de morar nos módulos puros — `useState` no `.tsx` é lógica sem teste
    // neste repo. Só o `CampoEvidencia` tem estado, e é de ARRASTO (visual).
    for (const [nome, src] of TODOS) {
      const usos = src.match(/useState/g)?.length ?? 0;
      if (nome === "campo-evidencia.tsx") {
        expect(usos, "campo-evidencia deveria ter só o estado de arrasto").toBe(1);
        expect(src).toContain("setArrastando");
      } else {
        expect(usos, `${nome} não deveria ter useState`).toBe(0);
      }
    }
  });

  it("nenhum redige critério de negócio: a régua vem dos módulos puros", () => {
    expect(LISTA).toContain('from "./itens-lista"');
    expect(TABELA).toContain('from "./horas"');
    expect(EVIDENCIA).toContain('from "./evidencia"');
  });
});
