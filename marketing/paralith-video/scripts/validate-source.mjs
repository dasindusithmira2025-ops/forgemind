import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;

const requireFile = (relative, minimumBytes = 1) => {
  const file = path.join(root, relative);
  const valid = existsSync(file) && statSync(file).size >= minimumBytes;
  console.log(`${valid ? 'ok' : 'FAIL'} asset ${relative}`);
  if (!valid) failed = true;
};

[
  ['public/brand/mark-alpha.png', 1_000],
  ['public/brand/wordmark-alpha.png', 1_000],
  // Transparent masters cut from the 4K logo pack for the brand film's reveal and endcard.
  ['public/brand/mark.png', 100_000],
  ['public/brand/wordmark.png', 100_000],
  ['public/brand/lockup.png', 100_000],
  ['public/fonts/Geist-Variable.woff2', 50_000],
  ['public/fonts/OFL.txt', 4_000],
  ['public/fonts/OFL-CascadiaMono.txt', 4_000],
  ['public/audio/paralith-score.mp3', 100_000],
  ['public/audio/paralith-trailer-score.mp3', 50_000],
  ['public/audio/paralith-teaser-score.mp3', 25_000],
  // The terminal face the product ships with, inlined; see scripts/embed-mono-font.mjs.
  ['src/mono-font-data.ts', 400_000],
].forEach(([file, bytes]) => requireFile(file, bytes));

/**
 * The product twin is only worth anything if it is current. This re-derives the generated
 * stylesheet and theme from `Paralith-tauri` and fails if what is checked in has drifted, so a
 * change to the desktop app's design system cannot leave a stale film behind.
 */
const twin = spawnSync(process.execPath, [path.join(root, 'scripts/sync-product-ui.mjs'), '--check'], {
  encoding: 'utf8',
});
const twinFresh = twin.status === 0;
console.log(`${twinFresh ? 'ok' : 'FAIL'} product twin in sync with Paralith-tauri`);
if (!twinFresh) {
  console.log((twin.stderr || twin.stdout).trim());
  failed = true;
}

const voiceLimits = {
  fragmentation: 6,
  pressure: 8.3,
  alignment: 5.6,
  workspace: 10.1,
  parallel: 11.2,
  repository: 10.2,
  record: 9.1,
  decision: 8.2,
  direction: 5.3,
};

for (const [scene, limit] of Object.entries(voiceLimits)) {
  const relative = `public/audio/voice/${scene}.mp3`;
  requireFile(relative, 10_000);
  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', path.join(root, relative)],
    { encoding: 'utf8' },
  );
  const duration = Number(probe.stdout);
  const valid = probe.status === 0 && duration > 0 && duration <= limit;
  console.log(`${valid ? 'ok' : 'FAIL'} voice ${scene} ${duration.toFixed(2)}s <= ${limit.toFixed(1)}s`);
  if (!valid) failed = true;
}

const sourceFiles = [
  'src/data/copy.ts',
  'src/data/timing.ts',
  'src/components/ProductWindow.tsx',
  'src/scenes/Record.tsx',
  'src/scenes/Direction.tsx',
];
const source = sourceFiles.map((file) => readFileSync(path.join(root, file), 'utf8')).join('\n');
const forbidden = ['v0.9.4', '/products/paralith', 'memory index', 'knowledge graph'];
for (const claim of forbidden) {
  const absent = !source.toLowerCase().includes(claim.toLowerCase());
  console.log(`${absent ? 'ok' : 'FAIL'} unsupported claim absent: ${claim}`);
  if (!absent) failed = true;
}

const fontData = readFileSync(path.join(root, 'src/font-data.ts'), 'utf8');
const fontValid = fontData.includes('data:font/woff2;base64,') && fontData.length > 80_000;
console.log(`${fontValid ? 'ok' : 'FAIL'} embedded Geist font`);
if (!fontValid) failed = true;

if (failed) process.exit(1);
