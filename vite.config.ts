import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the site from /MkwTrackEditor/; everywhere else it is at the root.
const base = process.env.GITHUB_PAGES ? '/MkwTrackEditor/' : '/';

export default defineConfig({
  base,
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', 'vendor/**'],
  },
  plugins: [react()],
  resolve: {
    alias: {
      // The vendored noclip code imports the upstream Rust/WASM helper module; we
      // substitute a pure-TypeScript stub. Mirrored by "paths" in tsconfig.json.
      'noclip-rust-support': fileURLToPath(new URL('./src/noclipRustStub.ts', import.meta.url)),
    },
  },
  build: {
    // The noclip renderer is a single tightly-coupled graph, so it lands in one big
    // chunk no matter how it is split. Splitting off React and the vendored renderer
    // keeps the app chunk small enough to be worth re-downloading on its own.
    chunkSizeWarningLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('vendor/noclip.website/')) return 'noclip';
          return undefined;
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    watch: {
      usePolling: true,
      interval: 200,
    },
  },
});
