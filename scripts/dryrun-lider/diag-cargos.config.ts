import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do diagnóstico de CARGOS × isenção (leitura pura).
//   npx vitest run --config scripts/dryrun-lider/diag-cargos.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/diag-cargos.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
