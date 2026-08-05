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
