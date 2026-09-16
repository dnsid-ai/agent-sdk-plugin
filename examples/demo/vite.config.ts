import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Alice and Bob run under `dnsid testnet run`, each with its own identity, so
// they are two processes. The browser reaches both through this one origin.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    proxy: {
      '/alice': {
        target: 'http://127.0.0.1:4001',
        rewrite: (p) => p.replace(/^\/alice/, ''),
      },
      '/bob': {
        target: 'http://127.0.0.1:4002',
        rewrite: (p) => p.replace(/^\/bob/, ''),
      },
    },
  },
});
