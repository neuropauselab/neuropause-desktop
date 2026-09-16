import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /auth and /api to the local NeuroPause backend so the web
// app exercises the REAL auth routes (OAuth start/callback, tokens, account
// flows) with no mocks. Backend port comes from apps/backend env.PORT.
const BACKEND = process.env.NP_BACKEND_URL ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      '/auth': { target: BACKEND, changeOrigin: true },
      '/api': { target: BACKEND, changeOrigin: true },
    },
  },
});
