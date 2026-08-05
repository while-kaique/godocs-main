import { defineConfig } from 'vitest/config';
import path from 'path';

// Config dedicado do DRY-RUN da pré-aprovação (leitura pura: aba GoDocs de prod +
// índice de liderança da TeamGuide). Fora do `npm run test`. Rodar:
//   npx vitest run --config scripts/dryrun-lider/vitest.config.ts
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
