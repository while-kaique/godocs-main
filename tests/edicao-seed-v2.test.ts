/**
 * O seed da EDIÇÃO e a rede do card do líder.
 *
 * Os dois bugs que estes testes travam foram achados em 14/09/2026 e têm a MESMA forma:
 * um objeto de retorno CURADO que deixou de fora campos que a outra ponta já lia. O
 * TypeScript não pega — o consumidor lê `data.campo` de um `Record<string, unknown>` e
 * recebe `undefined` em silêncio.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const seed = ler("src/lib/meus-projetos.functions.ts");
const form = ler("src/routes/submeter.tsx");
const fila = ler("src/lib/aprovacoes.functions.ts");

/**
 * Todo campo que o formulário semeia de `data.<campo>` na edição.
 *
 * ⚠️ Esta lista é EXTRAÍDA do próprio `submeter.tsx`, não digitada: campo novo no form
 * entra no teste sozinho, e é isso que impede a omissão de voltar. Foi exatamente assim
 * que o bloco inteiro da v2 ficou de fora sem ninguém notar.
 */
function camposQueOFormLe(): string[] {
  const achados = new Set<string>();
  for (const m of form.matchAll(/\bdata\.([a-z_][a-z0-9_]*)\b/g)) achados.add(m[1]);
  return [...achados].sort();
}

describe("a edição semeia o que o formulário pede", () => {
  it("⚠️ TODO campo lido pelo form existe no retorno do seed", () => {
    const faltando = camposQueOFormLe().filter((c) => !seed.includes(c));
    expect(
      faltando,
      `o formulário lê data.<campo> que o getMeuProjeto não devolve: ${faltando.join(", ")}`,
    ).toEqual([]);
  });

  it("o bloco da v2 está lá, nominalmente", () => {
    // Sem ele, a Etapa 3 reabria em branco e SALVAR zerava o impacto do projeto.
    for (const campo of [
      "saving_efetivado_valor_antes",
      "saving_efetivado_valor_agora",
      "custo_evitado_horas_linhas",
      "custo_evitado_nao_contratado",
      "receita_incremental_valor",
      "ganho_imensuravel_racional",
      "custo_rodar_itens",
      "ganho_categorias",
    ]) {
      expect(seed, `falta ${campo} no seed da edição`).toContain(campo);
    }
  });

  it("o vínculo de feature e o link do app também voltam", () => {
    expect(seed).toContain("projeto_pai_id");
    expect(seed).toContain("url_godeploy");
  });
});

describe("o card do líder tem rede da v2, não da v1", () => {
  it("⚠️ a rede é `resumirGanhoV2` (SQLite), não os campos da v1", () => {
    // A DM ao líder sai na submissão e a escrita no Sheets vai por `runBackground`, que o
    // Godeploy cancela: o espelho pode não ter a linha quando o líder abre a fila. Caindo
    // nos campos da v1 — que a v2 nunca escreve — o card ficava sem número nenhum.
    expect(fila).toContain("resumirGanhoV2");
    expect(fila).toMatch(/return resumirGanhoV2\(projeto\);/);
  });

  it("a planilha continua sendo o caminho PREFERIDO", () => {
    // A rede não pode virar o caminho padrão: o espelho tem o dado já conciliado.
    const i = fila.indexOf("function ganhoDoCard");
    const corpo = fila.slice(i, i + 1600);
    expect(corpo.indexOf("resumirGanhoDaPlanilha")).toBeLessThan(
      corpo.indexOf("return resumirGanhoV2"),
    );
  });
});
