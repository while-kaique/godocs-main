import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do diagnóstico da ÁRVORE de times (leitura pura).
//   ALVO=fabl npx vitest run --config scripts/dryrun-lider/diag-times.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/diag-times.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
