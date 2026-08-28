// A coluna "Sombra" da LISTAGEM do /dashboard recebe a base INTEIRA (~700 ids) num `IN`, e o
// datasource do Godeploy limita as variáveis por statement em 100 — um `IN` de 101 estourava
// com "too many SQL variables" e derrubava a leitura da sombra da página toda (mapa vazio → a
// coluna virava "—" para todos, inclusive quem já tinha veredito). Os getters PorIds passaram a
// quebrar o `IN` em lotes.
//
// `better-sqlite3` (o banco de verdade dos testes) NÃO tem o teto de 100, então este teste
// ENVOLVE o adapter com o cap do Godeploy: qualquer statement com >100 params lança. Assim o
// teste é VERMELHO sem o chunk e VERDE com ele.
import { describe, it, expect, beforeEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { adapterAsync } from './helpers/db-memoria';
import {
  setDb,
  upsertAvaliacaoNormal,
  upsertAvaliacaoFeedback,
  getAvaliacoesNormaisPorIds,
  getFeedbacksPorIds,
} from '@/integrations/db/client.server';
import { initSchema } from '@/integrations/db/schema';
import type { GoDeployDB } from '@/integrations/db/db-adapter';

const CAP_GODEPLOY = 100;

/** Adapter idêntico ao do Godeploy no que importa aqui: statement com >100 variáveis explode. */
function adapterComCap(db: BetterSqlite3.Database): GoDeployDB {
  const real = adapterAsync(db);
  return {
    async query(sql, params = []) {
      if (params.length > CAP_GODEPLOY) {
        throw new Error(`too many SQL variables at offset 361: SQLITE_ERROR`);
      }
      return real.query(sql, params);
    },
    async exec(sql, params = []) {
      if (params.length > CAP_GODEPLOY) {
        throw new Error(`too many SQL variables at offset 361: SQLITE_ERROR`);
      }
      return real.exec(sql, params);
    },
  };
}

const N = 250; // bem acima do teto de 100 → força >2 lotes
const ids = Array.from({ length: N }, (_, i) => `PROJ-${String(i).padStart(4, '0')}`);

async function semear() {
  for (const id of ids) {
    await upsertAvaliacaoNormal({
      projeto_id: id,
      veredito: 'aprovar',
      confianca: 0.8,
      aplicar: false,
      divergencia: false,
      motivo: null,
      votos: null,
      origem: 'teste',
      modelo: 'teste',
    });
    await upsertAvaliacaoFeedback({
      projeto_id: id,
      voto: 'like',
      veredito_referente: 'aprovar',
      admin_email: 'a@x',
    });
  }
}

describe('superfície SOMBRA — getters PorIds chunkam o IN (teto de 100 do Godeploy)', () => {
  beforeEach(async () => {
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    const adapter = adapterComCap(db);
    await initSchema(adapter);
    await setDb(adapter);
    await semear();
  });

  it('getAvaliacoesNormaisPorIds devolve TODOS os 250 sem estourar o teto de variáveis', async () => {
    const mapa = await getAvaliacoesNormaisPorIds(ids);
    expect(mapa.size).toBe(N);
    // amostra em fronteiras de lote (0, 90, 180, último): nada some na costura dos chunks
    for (const i of [0, 89, 90, 179, 180, N - 1]) {
      const linha = mapa.get(ids[i].toLowerCase());
      expect(linha, `id ${ids[i]}`).toBeDefined();
      expect(linha!.veredito).toBe('aprovar');
    }
  });

  it('getFeedbacksPorIds devolve TODOS os 250 sem estourar o teto de variáveis', async () => {
    const mapa = await getFeedbacksPorIds(ids);
    expect(mapa.size).toBe(N);
    expect(mapa.get(ids[123].toLowerCase())?.voto).toBe('like');
  });

  it('lista pequena (≤100) segue num único lote — comportamento idêntico ao de antes', async () => {
    const poucos = ids.slice(0, 30);
    const mapa = await getAvaliacoesNormaisPorIds(poucos);
    expect(mapa.size).toBe(30);
  });
});
