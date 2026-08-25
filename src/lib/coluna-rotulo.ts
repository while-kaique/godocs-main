/**
 * Rótulo de EXIBIÇÃO de uma coluna da planilha — módulo PURO.
 *
 * O nome da coluna no Sheets é a CHAVE do mapeamento (`SHEET_COLUMNS`/`chaveColuna`) e não
 * pode mudar: renomear a coluna quebraria o casamento por nome. Mas alguns desses nomes são
 * históricos e não dizem nada a quem lê a ficha — em especial as 3 colunas de papel, que na
 * planilha se chamam "Participantes" / "Participantes 2" / "Contribuidor" e na tela do
 * formulário são **Coautor** / **Participante** / **Contribuidor**.
 *
 * Ver o vocabulário em `PAPEIS_PARTICIPANTE` (`submeter/constants.ts`): "Participantes 2" é
 * o papel `planejador`, cujo rótulo é "Participante" — o "2" é resíduo de quando a coluna
 * foi acrescentada ao lado da original. Mostrar o nome cru fazia a ficha dizer
 * "PARTICIPANTES 2" para o mesmo papel que o autor escolheu como "Participante".
 *
 * ⚠️ Isto é só o RÓTULO. Nada aqui altera a chave usada para ler/escrever a célula.
 */
import { chaveColuna } from '@/lib/coluna-chave';

/** Nome da coluna (como na planilha) → rótulo exibido. Casamento tolerante a acento/caixa. */
const ROTULOS: Record<string, string> = {
  Participantes: 'Coautor',
  'Participantes 2': 'Participante',
};

const POR_CHAVE = new Map(Object.entries(ROTULOS).map(([col, rot]) => [chaveColuna(col), rot]));

/** Rótulo de exibição de uma coluna; sem override, devolve o nome como está. */
export function rotuloColuna(nome: string): string {
  return POR_CHAVE.get(chaveColuna(nome)) ?? nome;
}
