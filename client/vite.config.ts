import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // On Vercel, Firebase sign-in runs through this site's own /__/auth/* (proxied in vercel.json),
    // so the Google redirect doesn't depend on cross-site storage the browser may block.
    'import.meta.env.VITE_AUTH_SAME_HOST': JSON.stringify(process.env.VERCEL ? 'true' : ''),
  },
  server: {
    port: 5173,
    // In development, /api calls are forwarded to the local API server (no CORS setup needed).
    proxy: { '/api': 'http://localhost:8080' },
  },
});
