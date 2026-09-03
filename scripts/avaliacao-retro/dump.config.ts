import { defineConfig } from 'vitest/config';
import path from 'path';

// Dump SÓ-LEITURA da planilha de prod (todas as colunas) para o retroativo do time (T19).
//   RETRO_OUT=<arquivo.json> npx vitest run --config scripts/avaliacao-retro/dump.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/avaliacao-retro/dump.ts'],
    testTimeout: 600_000,
    disableConsoleIntercept: true,
  },
});
