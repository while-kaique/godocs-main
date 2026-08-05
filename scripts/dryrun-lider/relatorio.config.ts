import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do RELATÓRIO líder↔liderado na aba dedicada. Fora do `npm run test`.
//   npx vitest run --config scripts/dryrun-lider/relatorio.config.ts              (dry-run)
//   RELATORIO_WRITE=1 npx vitest run --config scripts/dryrun-lider/relatorio.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/relatorio-sheet.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
