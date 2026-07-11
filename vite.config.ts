import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

const __dirname = dirname(fileURLToPath(import.meta.url));

// CRXJS reads `background` at startup; during the UI build we must remove it
// so it doesn't crash with [UNRESOLVED_ENTRY] for background.js.
const manifestCopy: any =
  typeof structuredClone === 'function'
    ? structuredClone(manifest)
    : { ...(manifest as any) };

delete manifestCopy.background;

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest: manifestCopy })],
  build: {
    target: ['chrome120'],
    outDir: 'dist',
    // IMPORTANT: don't wipe dist so background.js from the background build remains.
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/sidepanel/index.html'),
        offscreen: resolve(__dirname, 'src/offscreen/index.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});

