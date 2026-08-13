import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do relatório de PROJETOS ESPECIAIS pendentes há mais de N dias. Fora do `npm run test`.
//   npx vitest run --config scripts/dryrun-lider/especiais.config.ts              (dry-run)
//   ESPECIAIS_WRITE=1 npx vitest run --config scripts/dryrun-lider/especiais.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/relatorio-especiais.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
