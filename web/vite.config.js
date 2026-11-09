import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Pre-bundle the big dependencies at startup. Without this, Vite discovers
  // them on the first page load, re-bundles, and forces a full reload.
  optimizeDeps: {
    include: ['react', 'react-dom/client', 'react-router-dom', 'leaflet'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { leaflet: ['leaflet'], react: ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: false },
    },
  },
});
