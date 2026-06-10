// Áreas — fonte única para o seletor da etapa 1 e para o admin.
// A tabela `areas` (SQLite) é a fonte de verdade; é sincronizada a partir da
// TeamGuide (cron diário + botão manual no admin). Se a tabela estiver vazia,
// caímos na lista hardcoded (AREAS) como fallback, para o formulário nunca ficar
// sem opções.

import { getAreas as dbGetAreas, insertArea } from '@/integrations/db/client.server';
import { deriveAreasFromTeamGuide } from '@/lib/areas/teamguide.server';
import { AREAS } from '@/lib/submeter/constants';

const log = (...args: unknown[]) => console.log('[areas.functions]', ...args);

export type AreaPublica = { id: string | null; nome: string };

/** Lista de áreas para o formulário público de submissão (fonte única + fallback). */
export async function getAreasPublicas(): Promise<AreaPublica[]> {
  const rows = await dbGetAreas();
  if (rows.length > 0) return rows.map((a) => ({ id: a.id, nome: a.nome }));
  // Fallback: tabela vazia (TeamGuide ainda não sincronizada) → lista hardcoded.
  return AREAS.map((nome) => ({ id: null, nome }));
}

/**
 * Deriva as áreas da TeamGuide e faz upsert na tabela `areas` (adiciona as novas;
 * não remove existentes para não orfanar projetos vinculados). Idempotente.
 */
export async function sincronizarAreas(): Promise<{ derivadas: number; adicionadas: number; total: number }> {
  const derivadas = await deriveAreasFromTeamGuide();
  const existentes = await dbGetAreas();
  const existentesSet = new Set(existentes.map((a) => a.nome.trim().toLowerCase()));

  let adicionadas = 0;
  for (const nome of derivadas) {
    if (!existentesSet.has(nome.trim().toLowerCase())) {
      await insertArea(nome);
      adicionadas++;
    }
  }

  const total = existentes.length + adicionadas;
  log(`Sincronização concluída: ${derivadas.length} derivadas, ${adicionadas} novas, ${total} no total.`);
  return { derivadas: derivadas.length, adicionadas, total };
}
