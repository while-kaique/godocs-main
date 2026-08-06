import { defineConfig } from 'vitest/config';
import path from 'path';

// Config dos IDs da fila (backfill retroativo). Leitura pura, fora do `npm run test`.
//   npx vitest run --config scripts/dryrun-lider/ids-fila.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/ids-fila.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
