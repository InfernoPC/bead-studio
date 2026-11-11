import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5174', changeOrigin: true },
      '/mcp': { target: 'http://localhost:5174', changeOrigin: true },
      '/ws': { target: 'ws://localhost:5174', ws: true, changeOrigin: true },
    },
  },
});
