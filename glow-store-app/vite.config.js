import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/glow-store/',
  plugins: [react()],
  build: {
    outDir: 'dist/glow-store',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        storefront: resolve(process.cwd(), 'index.html'),
        admin: resolve(process.cwd(), 'admin/index.html'),
      },
    },
  },
});
