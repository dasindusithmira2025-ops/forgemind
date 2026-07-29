import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '..', '..', 'media', 'exports');
const remotionCli = path.join(
  root,
  'node_modules',
  '@remotion',
  'cli',
  'remotion-cli.js',
);
mkdirSync(output, { recursive: true });

const renders = [
  ['ParalithHero1080p', 'paralith-hero-film-1080p.mp4', 4, 16],
  ['ParalithHeroVertical', 'paralith-hero-film-vertical.mp4', 4, 16],
  ['ParalithHeroSquare', 'paralith-hero-film-square.mp4', 4, 16],
  ['ParalithTrailer30', 'paralith-trailer-30s.mp4', 4, 16],
  ['ParalithTeaser15', 'paralith-teaser-15s.mp4', 4, 16],
  ['ParalithHeroCaptioned', 'paralith-hero-captioned.mp4', 4, 16],
  ['ParalithHeroClean', 'paralith-hero-clean.mp4', 4, 16],
  ['ParalithHero4K', 'paralith-hero-film-4k.mp4', 2, 14],
];

for (const [composition, filename, concurrency, crf] of renders) {
  const destination = path.join(output, filename);
  console.log(`\n== ${composition} -> ${destination}`);
  const result = spawnSync(
    process.execPath,
    [
      remotionCli,
      'render',
      composition,
      destination,
      '--codec=h264',
      `--crf=${crf}`,
      '--image-format=png',
      '--pixel-format=yuv420p',
      '--color-space=bt709',
      '--audio-codec=aac',
      '--audio-bitrate=320k',
      '--x264-preset=medium',
      '--timeout=180000',
      `--concurrency=${concurrency}`,
      '--overwrite',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const normalization = spawnSync(process.execPath, ['scripts/normalize-audio.mjs'], {
  cwd: root,
  stdio: 'inherit',
});
if (normalization.error) console.error(normalization.error);
if (normalization.status !== 0) process.exit(normalization.status ?? 1);

const poster = spawnSync(
  process.execPath,
  [
    remotionCli,
    'still',
    'ParalithPoster',
    path.join(output, 'paralith-poster.png'),
    '--overwrite',
  ],
  { cwd: root, stdio: 'inherit' },
);
if (poster.error) console.error(poster.error);
if (poster.status !== 0) process.exit(poster.status ?? 1);
