import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadServerEnv } from './server/env.ts';
import { moonAPI } from './server/api.ts';
import { fileURLToPath } from 'url';

loadServerEnv();

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'ares-server-api',
      configureServer(server) {
        server.middlewares.use(moonAPI);
      },
      configurePreviewServer(server) {
        server.middlewares.use(moonAPI);
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        website: fileURLToPath(new URL('./website.html', import.meta.url)),
      },
      output: {
        manualChunks(id) {
          if (id.includes('three')) return 'three';
          return undefined;
        },
      },
    },
  },
});
