import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Background build only: no CRXJS plugin, no React/Tailwind.
// Goal: produce a single, self-contained dist/background.js.
export default defineConfig({
  plugins: [],
  build: {
    target: ['chrome120'],
    outDir: 'dist',
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: 'background.js',
        chunkFileNames: '[name].js',
        inlineDynamicImports: true,
      },
      plugins: [
        {
          name: 'crxjs-rewrite-manifest-background',
          closeBundle: () => {
            const manifestPath = resolve(__dirname, 'dist/manifest.json');
            const sourceManifestPath = resolve(__dirname, 'manifest.json');

            if (!fs.existsSync(manifestPath)) {
              fs.mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
              fs.copyFileSync(sourceManifestPath, manifestPath);
            }

            const raw = fs.readFileSync(manifestPath, 'utf8');
            const manifest = JSON.parse(raw);

            manifest.background = {
              service_worker: 'background.js',
              type: 'module',
            };

            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          },
        },
      ],
    },
  },
});


