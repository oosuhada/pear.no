import { cp, mkdir, rm } from 'node:fs/promises';

const copy = async (from, to) => cp(from, to, { recursive: true, force: true });

await mkdir('dist/hada', { recursive: true });
await rm('dist/hada/review', { recursive: true, force: true });
await copy('hada/review', 'dist/hada/review');

await mkdir('dist/scripts/hada', { recursive: true });
await copy('scripts/hada/youtube-archive-manifest.json', 'dist/scripts/hada/youtube-archive-manifest.json');
await copy('scripts/hada/youtube-archive-manifest-overrides.json', 'dist/scripts/hada/youtube-archive-manifest-overrides.json');

// The local source-library media folder is intentionally excluded from GitHub Pages.
// It is several GB and remains a local/Tailscale review asset.
