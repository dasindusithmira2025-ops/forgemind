/**
 * The gate film's delivery batch.
 *
 *   node scripts/render-gate.mjs             # everything
 *   node scripts/render-gate.mjs 30s loop    # named deliveries only
 *
 * Encoding follows the settings every PARALITH film has been delivered on: PNG intermediates,
 * BT.709, yuv420p, AAC at 320k, H.264 at CRF 14 for 4K and 16 elsewhere, and a conservative
 * concurrency cap. That combination is what preserves 1px rules and 12px monospace through the
 * encoder without exhausting Chrome tabs on the 4K pass — and this film is almost entirely 1px
 * rules and 12px monospace, so it is the content those settings exist for.
 *
 * Every delivered name is new. Nothing here overwrites a file belonging to the explainer, the brand
 * cut or the campaign cut: those are committed deliverables that stay reproducible from their own
 * compositions, and reusing a filename because the product is the same would destroy one of them.
 */

import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '..', '..', 'media', 'exports');
const remotionCli = path.join(root, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
mkdirSync(output, { recursive: true });

/** key, composition, filename, concurrency, crf, normalise */
const RENDERS = [
  ['1080p', 'ParalithGate1080p', 'paralith-gate-film-1080p.mp4', 4, 16, true],
  ['captioned', 'ParalithGateCaptioned', 'paralith-gate-film-captioned.mp4', 4, 16, true],
  ['60s', 'ParalithGate60', 'paralith-gate-film-60s.mp4', 4, 16, true],
  ['30s', 'ParalithGate30', 'paralith-gate-film-30s.mp4', 4, 16, true],
  ['15s', 'ParalithGate15', 'paralith-gate-film-15s-teaser.mp4', 4, 16, true],
  // Silent by design: a website hero autoplays muted, so shipping it with a score is dead weight in
  // the page payload and a liability if a browser ever unmutes it.
  ['loop', 'ParalithGateLoop', 'paralith-gate-hero-loop.mp4', 4, 18, false],
  ['4k', 'ParalithGate4K', 'paralith-gate-film-4k.mp4', 2, 14, true],
];

const requested = process.argv.slice(2);
const selected = requested.length ? RENDERS.filter(([key]) => requested.includes(key)) : RENDERS;

if (requested.length && selected.length !== requested.length) {
  throw new Error(`Unknown delivery key. Known keys: ${RENDERS.map(([key]) => key).join(', ')}`);
}

for (const [, composition, filename, concurrency, crf, normalise] of selected) {
  const destination = path.join(output, filename);
  console.log(`\n== ${composition} -> ${filename}`);

  const args = [
    remotionCli,
    'render',
    composition,
    destination,
    '--codec=h264',
    `--crf=${crf}`,
    '--image-format=png',
    '--pixel-format=yuv420p',
    '--color-space=bt709',
    '--x264-preset=medium',
    '--timeout=180000',
    `--concurrency=${concurrency}`,
    '--overwrite',
  ];

  if (normalise) {
    args.splice(args.indexOf('--x264-preset=medium'), 0, '--audio-codec=aac', '--audio-bitrate=320k');
  } else {
    args.push('--muted');
  }

  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/**
 * Two-pass EBU R128 on everything with an audio stream, video copied — the loudness pass must never
 * re-encode the picture.
 */
const toNormalise = selected.filter(([, , , , , normalise]) => normalise).map(([, , filename]) => filename);
if (toNormalise.length) {
  console.log(`\n== normalising ${toNormalise.length} file(s)`);
  const normalization = spawnSync(process.execPath, ['scripts/normalize-audio.mjs', ...toNormalise], {
    cwd: root,
    stdio: 'inherit',
  });
  if (normalization.error) console.error(normalization.error);
  if (normalization.status !== 0) process.exit(normalization.status ?? 1);
}

if (!requested.length) {
  console.log('\n== poster');
  const poster = spawnSync(
    process.execPath,
    [remotionCli, 'still', 'ParalithGatePoster', path.join(output, 'paralith-gate-film-poster.png'), '--overwrite'],
    { cwd: root, stdio: 'inherit' },
  );
  if (poster.error) console.error(poster.error);
  if (poster.status !== 0) process.exit(poster.status ?? 1);

  console.log('\n== captions');
  const captions = spawnSync(process.execPath, ['scripts/generate-gate-captions.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (captions.status !== 0) process.exit(captions.status ?? 1);
}

console.log('\ndone');
