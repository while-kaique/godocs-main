import { defineConfig } from 'vitest/config';
import path from 'path';

// Dump SÓ-LEITURA da planilha de prod para a validação cega da régua (T1).
//   npx vitest run --config scripts/regua-t1/dump.config.ts
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '../../src') } },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/regua-t1/dump.ts'],
    testTimeout: 900_000,
    disableConsoleIntercept: true,
  },
});
