import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do DIAGNÓSTICO de um projeto (leitura pura).
//   PROJETO=<id> npx vitest run --config scripts/dryrun-lider/diag-projeto.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/diag-projeto.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
