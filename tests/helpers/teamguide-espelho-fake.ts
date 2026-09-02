// Helper de teste: semeia o ESPELHO da TeamGuide direto no banco, a partir dos MESMOS
// fixtures (times/membros/refs) que os testes já usavam quando mockavam `fetch`.
//
// Desacopla o teste da rede: em vez de reproduzir os endpoints (`/teams`, `/employees/refs`,
// `/teams/{id}/members` recursivo), grava as 2 coleções normalizadas que o sync gravaria. As
// leituras (`teamguide.server.ts`) leem daqui. Use com `criarDbMemoria()` no `beforeEach`.
import { upsertTeamguideEspelho } from '@/integrations/db/client.server';
import {
  normalizarTimes,
  montarPessoas,
  type TGTeam,
  type TGMember,
  type TGEmployeeRef,
} from '@/lib/areas/teamguide-derivacao';
import { __resetTeamguideSnapshotCache } from '@/lib/areas/teamguide.server';

export async function semearEspelhoTeamGuide(dados: {
  times: TGTeam[];
  membros?: TGMember[];
  refs?: TGEmployeeRef[];
}): Promise<void> {
  const times = normalizarTimes(dados.times);
  const pessoas = montarPessoas(dados.refs ?? [], dados.membros ?? []);
  const em = Date.now();
  await upsertTeamguideEspelho({
    chave: 'times',
    dados: JSON.stringify(times),
    hash: 'seed-times',
    atualizado_em: em,
  });
  await upsertTeamguideEspelho({
    chave: 'pessoas',
    dados: JSON.stringify(pessoas),
    hash: 'seed-pessoas',
    atualizado_em: em,
  });
  // Cada teste tem um banco novo; zera o snapshot por isolate para não servir o do anterior.
  __resetTeamguideSnapshotCache();
}
