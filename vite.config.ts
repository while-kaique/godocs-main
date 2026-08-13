import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { devApiPlugin } from './vite-plugin-dev-api'

export default defineConfig({
  plugins: [
    devApiPlugin(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@radix-ui')) return 'vendor-radix'
          if (id.includes('node_modules/@tanstack')) return 'vendor-tanstack'
          if (id.includes('node_modules/react-dom')) return 'vendor-react'
          if (id.includes('node_modules/react/')) return 'vendor-react'
          // Cada ícone do lucide-react é um módulo próprio e, por ser usado em 2+ rotas,
          // o Rollup o promove a chunk COMPARTILHADO — 22 arquivos de menos de 1 KB
          // (`chevron-left` tem 131 bytes). Como o edge do Godeploy cobra ~750 ms por
          // requisição, o que dói é a CONTAGEM, não o peso: /meus-projetos puxava 14
          // arquivos e levava ~4 s só de JS. Num chunk só, é 1 requisição cacheável
          // entre todas as rotas. Ver docs/deploy.md ("Por que os assets são poucos").
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons'
        },
        /**
         * Funde os chunks restantes abaixo deste tamanho no chunk que os importa
         * (`auth` tinha **41 bytes**, `format-date` 494, `info` 205 …). Mesmo motivo
         * acima: 800 ms de latência por um arquivo de 200 bytes é o pior negócio
         * possível. O Rollup só funde quando isso não duplica código em entradas
         * não relacionadas, então a divisão por rota continua de pé.
         */
        experimentalMinChunkSize: 20_000,
      },
    },
    target: 'es2022',
    minify: 'esbuild',
  },
})
