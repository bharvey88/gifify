import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3111',
    },
  },
  test: {
    environment: 'node',
    include: ['server/**/*.test.js', 'web/src/**/*.test.js'],
    root: fileURLToPath(new URL('.', import.meta.url)),
  },
});
