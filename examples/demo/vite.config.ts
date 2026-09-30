import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The page calls Alice's API through this dev server, so both share one origin.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    proxy: {
      '/alice': {
        target: 'http://127.0.0.1:4001',
        rewrite: (p) => p.replace(/^\/alice/, ''),
      },
    },
  },
});
