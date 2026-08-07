/**
 * The campaign cut's delivery batch.
 *
 *   node scripts/render-campaign.mjs             # everything
 *   node scripts/render-campaign.mjs 30s loop    # named deliveries only
 *
 * Encoding follows the settings the earlier films were delivered on: PNG intermediates, BT.709,
 * yuv420p, AAC at 320k, H.264 at CRF 14 for 4K and 16 elsewhere, and a conservative concurrency
 * cap. That combination is what preserves 1px UI rules and 13px monospace without exhausting
 * Chrome tabs during the 4K pass.
 *
 * The delivered names carry a `master` infix rather than replacing `paralith-brand-film-4k.mp4`.
 * That file is the previous eight-beat cut's delivered master, it is committed, and it stays
 * reproducible from `ParalithBrandFilm4K`; overwriting it because this cut inherited the same
 * product would destroy a deliverable to save a word.
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
  ['1080p', 'ParalithCampaign1080p', 'paralith-brand-film-master-1080p.mp4', 4, 16, true],
  ['captioned', 'ParalithCampaignCaptioned', 'paralith-brand-film-captioned.mp4', 4, 16, true],
  ['60s', 'ParalithCampaign60', 'paralith-brand-film-60s.mp4', 4, 16, true],
  ['30s', 'ParalithCampaign30', 'paralith-brand-film-30s.mp4', 4, 16, true],
  ['15s', 'ParalithCampaign15', 'paralith-brand-film-15s-teaser.mp4', 4, 16, true],
  ['vertical', 'ParalithCampaignVertical30', 'paralith-brand-film-vertical-30s.mp4', 4, 16, true],
  // Silent by design: a website hero autoplays muted, so shipping it with a score is dead weight
  // in the page payload and a liability if a browser ever unmutes it.
  ['loop', 'ParalithCampaignLoop', 'paralith-website-hero-loop.mp4', 4, 18, false],
  ['4k', 'ParalithCampaign4K', 'paralith-brand-film-master-4k.mp4', 2, 14, true],
];

const requested = process.argv.slice(2);
const selected = requested.length
  ? RENDERS.filter(([key]) => requested.includes(key))
  : RENDERS;

if (requested.length && selected.length !== requested.length) {
  const known = RENDERS.map(([key]) => key).join(', ');
  throw new Error(`Unknown delivery key. Known keys: ${known}`);
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
 * Two-pass EBU R128 on everything that has an audio stream, with the video stream copied — the
 * loudness pass must never re-encode the picture.
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
    [remotionCli, 'still', 'ParalithCampaignPoster', path.join(output, 'paralith-brand-film-poster.png'), '--overwrite'],
    { cwd: root, stdio: 'inherit' },
  );
  if (poster.error) console.error(poster.error);
  if (poster.status !== 0) process.exit(poster.status ?? 1);

  console.log('\n== captions');
  const captions = spawnSync(process.execPath, ['scripts/generate-captions.mjs'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (captions.status !== 0) process.exit(captions.status ?? 1);
}

console.log('\ndone');
