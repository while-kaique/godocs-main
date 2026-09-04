// Busca de projetos por nome — autocomplete do PAI na Etapa 1 (feature de outro projeto).
//
// ⚠️ Lê do ESPELHO da planilha (`sheet_espelho` via `lerResumosEspelho`), NUNCA um
// readAllRows()/Sheets em request — a cota de 60 leituras/min é compartilhada com prod.
// O espelho nunca tem rascunho (a planilha não os recebe), então o resultado já é só
// projeto NÃO-rascunho, sem filtro extra.

import { lerResumosEspelho } from '@/lib/sheet-espelho';
import {
  filtrarProjetosPorNome,
  type ProjetoBusca,
} from '@/lib/projeto-vinculo';

/**
 * Projetos cujo nome casa `q` (sem acento, substring). `{id, nome, autor}`, no máx. 20.
 * `q` < 2 chars → []. Falha de leitura → [] (o campo segue utilizável, sem sugestões).
 */
export async function buscarProjetosPorNome(q: string): Promise<ProjetoBusca[]> {
  const termo = (q ?? '').trim();
  if (termo.length < 2) return [];
  try {
    const { linhas } = await lerResumosEspelho();
    const projetos: ProjetoBusca[] = linhas
      .map((row) => ({
        id: (row['ID Projeto'] ?? '').trim(),
        nome: (row['Projeto'] ?? '').trim(),
        autor: (row['Nome Completo'] ?? '').trim(),
      }))
      .filter((p) => p.id && p.nome);
    return filtrarProjetosPorNome(projetos, termo);
  } catch (e) {
    console.error('[projetos-busca] falha ao buscar projetos por nome:', e);
    return [];
  }
}
