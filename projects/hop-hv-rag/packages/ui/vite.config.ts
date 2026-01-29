import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  server: {
    allowedHosts: ['local.gnarlybox-ai'],
    proxy: {
      '/api': {
        target: 'http://localhost:3200',
        changeOrigin: true,
      },
      '/thumbnails': {
        target: 'http://localhost:3200',
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tailwindcss()],
});
