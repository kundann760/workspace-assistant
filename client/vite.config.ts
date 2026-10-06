import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development, /api calls are forwarded to the local API server (no CORS setup needed).
    proxy: { '/api': 'http://localhost:8080' },
  },
});
