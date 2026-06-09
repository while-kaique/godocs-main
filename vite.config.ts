// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: {
    preset: "cloudflare-module",
    cloudflare: { nodeCompat: true, deployConfig: true },
  },
  vite: {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/@radix-ui")) return "vendor-radix";
            if (id.includes("node_modules/@supabase")) return "vendor-supabase";
            if (id.includes("node_modules/@tanstack")) return "vendor-tanstack";
            if (id.includes("node_modules/react-dom")) return "vendor-react";
            if (id.includes("node_modules/react/")) return "vendor-react";
          },
        },
      },
      target: "es2022",
      minify: "esbuild",
    },
  },
});
