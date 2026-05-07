import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const base = process.env.GITHUB_PAGES ? '/MkwTrackEditor/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      'noclip-rust-support': fileURLToPath(new URL('./src/noclipRustStub.ts', import.meta.url)),
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
