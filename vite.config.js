import { defineConfig } from 'vite';

// GitHub Pages serve da /release-radar-expander/
// In dev (localhost) base = '/'
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/release-radar-expander/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
