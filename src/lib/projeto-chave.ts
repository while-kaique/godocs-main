/**
 * Chave canônica do ID de projeto — módulo PURO (sem import de servidor).
 *
 * Mora fora de `sheet-espelho.ts` pelo mesmo motivo de `coluna-chave.ts`: a régua é uma
 * linha de texto, mas quem precisa dela são módulos que mockam o espelho inteiro nos
 * testes. Deixá-la lá dentro obrigava cada `vi.mock('@/lib/sheet-espelho')` a
 * REIMPLEMENTAR a normalização — e mock que reimplementa produção é a forma mais
 * silenciosa de as duas divergirem.
 *
 * ⚠️ **Por que existe:** a planilha guarda o id do legado em MAIÚSCULA (`LEGADO-049`) e o
 * sync reverso cria a linha em `projetos` sempre em minúscula (`sync-reverse.ts`). Como o
 * `=` do SQLite é sensível a caixa, todo leitor que recebe um id vindo da planilha e o usa
 * cru contra o banco lê NADA — sem erro, sem aviso. Foi assim que 30 aprovados ficaram
 * fora de toda rodada de classificação ("projeto sem contexto para classificar") enquanto
 * os mesmos ids em minúscula passavam.
 */
export function chaveProjeto(id: string): string {
  return String(id ?? "")
    .trim()
    .toLowerCase();
}
