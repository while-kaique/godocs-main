import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do relatório de ESPERA por pré-aprovação (quem está há mais de N dias
// esperando o líder). Fora do `npm run test`.
//   npx vitest run --config scripts/dryrun-lider/espera.config.ts              (dry-run)
//   ESPERA_WRITE=1 npx vitest run --config scripts/dryrun-lider/espera.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/relatorio-espera.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
