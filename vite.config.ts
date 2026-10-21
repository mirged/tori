import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/web',
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { host: '0.0.0.0', allowedHosts: ['localhost'] },
});
