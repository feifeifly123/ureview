import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    server: {
      proxy: {
        '/data': {
          target: 'http://localhost:7001',
          changeOrigin: true,
        },
      },
    },
  },
});
