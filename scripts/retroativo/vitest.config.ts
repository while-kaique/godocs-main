import { defineConfig } from 'vitest/config';
import path from 'path';

// Config DEDICADO da validação retroativa §10 (NÃO entra no `npm run test`, que usa
// o vitest.config.ts da raiz com include 'tests/**'). Reusa o vitest só para resolver
// o alias `@/` (necessário p/ importar o analyzer.ts) e dar timeout longo às chamadas
// de LLM em sequência. Rodar:
//   npx vitest run --config scripts/retroativo/vitest.config.ts
// Flags (env): RETRO_LIMIT=<n> (amostra/smoke), RETRO_WRITE=1 (escreve no Sheets).
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '../../src') },
  },
  test: {
    globals: true,
    environment: 'node',
    root: path.resolve(__dirname, '../..'),
    include: ['scripts/retroativo/audit.ts'],
    testTimeout: 1_800_000, // 30 min — N projetos × 1 chamada LLM em sequência
    hookTimeout: 120_000,
    disableConsoleIntercept: true, // logs do harness direto no stdout
  },
});
