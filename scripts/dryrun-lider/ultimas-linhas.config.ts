import { defineConfig } from 'vitest/config';
import path from 'path';

// Config do dump das últimas linhas da aba GoDocs. Leitura pura, fora do `npm run test`.
//   npx vitest run --config scripts/dryrun-lider/ultimas-linhas.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/dryrun-lider/ultimas-linhas.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
