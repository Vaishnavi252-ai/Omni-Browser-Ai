import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootManifestPath = resolve(__dirname, 'manifest.json');
const distManifestPath = resolve(__dirname, 'dist/manifest.json');

if (!existsSync(rootManifestPath)) {
  console.error('Root manifest not found:', rootManifestPath);
  process.exit(1);
}

mkdirSync(resolve(__dirname, 'dist'), { recursive: true });

const rootManifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
const distManifest = existsSync(distManifestPath)
  ? JSON.parse(readFileSync(distManifestPath, 'utf8'))
  : {};

if (rootManifest.background) {
  distManifest.background = rootManifest.background;
} else {
  delete distManifest.background;
}

if (rootManifest.content_security_policy) {
  distManifest.content_security_policy = rootManifest.content_security_policy;
} else {
  delete distManifest.content_security_policy;
}

writeFileSync(distManifestPath, `${JSON.stringify(distManifest, null, 2)}\n`);
console.log('Patched dist/manifest.json with the root background and CSP configuration.');
