/**
 * Chave de comparação de nome de coluna — módulo PURO (sem import de servidor).
 *
 * Mora fora de `google/sheets.ts` porque o CLIENTE também precisa casar nome de coluna:
 * a ficha de triagem (`/dashboard`) recebe a linha da planilha chaveada pelo cabeçalho
 * REAL e tem de achar "Justificativa Aprovação do **Lider**" (sem acento, como está em
 * prod e na staging) a partir do nome acentuado que o código escreve. Redigitar a regra
 * no frontend faria o painel do líder nascer vazio — o mesmo bug de 05/08/2026, só do
 * outro lado. FONTE ÚNICA: `google/sheets.ts` importa daqui.
 */

/**
 * Minúsculas, SEM ACENTO, espaços colapsados. Só para CASAR nomes — o nome escrito no
 * código continua acentuado (regra 4).
 *
 * ⚠️ Por que existe: o cabeçalho real é digitado à mão pela equipe e uma letra de
 * diferença fazia a coluna ser ignorada COM AVISO, em silêncio para quem usa o app. Foi
 * exatamente o que aconteceu com a pré-aprovação do líder: o cabeçalho de prod e da
 * staging tem "Justificativa Aprovação do **Lider**" (sem acento no "i") e o código
 * escreve "…do **Líder**" → o estado do parecer aparecia na planilha e o checklist + a
 * justificativa do gestor eram DESCARTADOS (confirmado ao vivo em 04 e 05/08/2026).
 */
export function chaveColuna(nome: string): string {
  return String(nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira os acentos (marcas combinantes do NFD)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Valor de uma coluna num mapa chaveado pelo cabeçalho REAL: match EXATO primeiro,
 * tolerante (acento/caixa/espaço) como rede — a mesma precedência do
 * `resolverColunaLetra` da escrita. `undefined` = coluna não veio na linha.
 *
 * Fail-safe idêntico ao da escrita: se DUAS chaves do mapa normalizam igual, a
 * tolerante é ambígua e não decide — só o nome exato resolve.
 */
export function valorDaColuna(
  campos: Record<string, string>,
  nome: string,
): string | undefined {
  if (nome in campos) return campos[nome];
  const alvo = chaveColuna(nome);
  const casam = Object.keys(campos).filter((k) => chaveColuna(k) === alvo);
  return casam.length === 1 ? campos[casam[0]] : undefined;
}

/**
 * NOME NOVO (v2) → NOME LEGADO (v1), para o código falar com uma aba que ainda não foi
 * renomeada. É o mesmo `pick(novo, antigo)` que pedi ao Gomoon, do nosso lado.
 *
 * ⚠️ **Por que existe, e por que é melhor que renomear a aba de prod.** A régua D1 da v2
 * renomeou 17 colunas in-place; a `STAGING-V2` já foi migrada, mas a aba `GoDocs` de
 * PRODUÇÃO não — medido em 03/09/2026: **22 nomes que o código escreve não existem lá**,
 * incluindo `Impacto Bruto` e `Impacto Líquido`. Sem este mapa, subir a v2 em prod faria o
 * `/dashboard` ler `undefined` e mostrar **R$ 0 para todo projeto**, e o append gravaria a
 * linha sem nenhum número (com um `console.warn`, que ninguém lê).
 *
 * Renomear a aba resolveria — mas quebraria o **ingest do Gomoon** no mesmo instante e em
 * silêncio: ele lê `Ganho Total`, `Saving Reais`, `Horas em Reais`… por NOME, e coluna
 * ausente vira `0` lá (ver `docs/integracao-gomoon-impacto-v2.md`). O alias deixa os dois
 * lados funcionarem e tira a migração do caminho crítico do deploy.
 *
 * ⚠️ **O alias resolve POSIÇÃO, não SIGNIFICADO.** `Impacto Bruto` (v2 = S + CE + R, receita
 * DENTRO) escrito na célula que a v1 chama `Saving Reais` (só saving) faz o Gomoon somar 10%
 * da receita de novo — dupla contagem. Isso só afeta linha ESCRITA pelo caminho v2, e é
 * coordenação com o JV, não algo que este mapa possa consertar sozinho.
 *
 * ⚠️ As 3 colunas genuinamente NOVAS da v2 (`Saving Efetivado Agora`, `Custo Evitado Não
 * Contratado`, `Impacto Líquido Mensal`) ficam DE FORA de propósito: não têm equivalente
 * legado, e inventar um apontaria dado novo para uma célula que significa outra coisa. Numa
 * aba não migrada elas simplesmente não são escritas — que é o correto, e é inclusive o
 * discriminador que o rollup usa para saber que a linha é v1.
 */
export const NOME_LEGADO: Readonly<Record<string, string>> = {
  'Coautor': 'Participantes',
  'Participante': 'Participantes 2',
  'Tipos de Ganho': 'Tipos Projeto',
  'Custo Evitado Horas': 'Saving Horas',
  'Custo Evitado Horas Reais': 'Horas em Reais',
  'Saving Efetivado': 'Custo Evitado',
  'Evidência Saving Efetivado': 'Justificativa Custo Evitado',
  'Freq. Saving Efetivado': 'Custo Mensal ou Pontual',
  'Impacto Bruto': 'Saving Reais',
  'Freq. Custo Evitado': 'Tipo de Saving',
  'Receita Incremental': 'Receita Mensal',
  'Freq. Receita': 'Tipo de Receita',
  'Racional Receita': 'Receita Memorial',
  'Impacto Líquido': 'Ganho Total',
  'Ganho Imensurável': 'Contexto do Projeto Especial',
  'Custo para Rodar': 'Custo do Projeto',
  'Justificativa Custo para Rodar': 'Justificativa Custo do Projeto',
  'Freq. Custo para Rodar': 'Custo do Projeto Mensal ou Pontual',
  'Racional Custo Evitado': 'Justificativa Saving Escalado e Real',
} as const;
