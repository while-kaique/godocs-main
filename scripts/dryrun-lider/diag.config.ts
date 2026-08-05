import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do DIAGNÓSTICO de uma pessoa na relação líder↔liderado (leitura pura).
//   ALVO=fabl npx vitest run --config scripts/dryrun-lider/diag.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/diag-pessoa.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
