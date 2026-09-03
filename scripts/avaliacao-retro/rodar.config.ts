import { defineConfig } from 'vitest/config';
import path from 'path';

// Rodada do retroativo em SOMBRA (T19): lê o dump da planilha, roda o time de agentes com a OpenAI
// direto, grava log em árvore num SQLite EM MEMÓRIA e escreve relatório + JSON em docs/plans/retro-rodadas.
//   RETRO_IN=<corpus.json> RETRO_N=30 RETRO_SEED=7 npx vitest run --config scripts/avaliacao-retro/rodar.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/avaliacao-retro/rodar.ts'],
    testTimeout: 6 * 3600_000,
    disableConsoleIntercept: true,
  },
});
