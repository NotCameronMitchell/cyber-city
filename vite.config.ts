import { defineConfig } from 'vite';

// base './' keeps asset URLs relative so the build works from any sub-path
// (GitHub Pages project sites, a local file server, or a single-file artifact).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
