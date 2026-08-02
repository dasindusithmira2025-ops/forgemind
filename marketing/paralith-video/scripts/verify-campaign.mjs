/**
 * Delivery verification for the campaign cut.
 *
 *   node scripts/verify-campaign.mjs
 *
 * Successful encoding is not delivery. This asserts, per file, that the container is what was
 * asked for and — crucially — that the duration matches the cut length imported from
 * `src/campaign/script.ts`. That import is the point: a re-timed sequence that has not been
 * re-rendered fails here rather than shipping, which is the failure mode a human reviewer is
 * least likely to catch by watching.
 */

import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exports_ = path.resolve(root, '..', '..', 'media', 'exports');

const { CUT_FRAMES, FPS } = await import(pathToFileURL(path.join(root, 'src/campaign/script.ts')).href);

const seconds = (frames) => frames / FPS;

/** Remotion writes one extra frame's worth of container time; a tenth of a second is the tolerance. */
const TOLERANCE = 0.12;

const EXPECTED = [
  { file: 'paralith-brand-film-master-4k.mp4', width: 3840, height: 2160, cut: 'master', audio: true },
  { file: 'paralith-brand-film-master-1080p.mp4', width: 1920, height: 1080, cut: 'master', audio: true },
  { file: 'paralith-brand-film-captioned.mp4', width: 1920, height: 1080, cut: 'master', audio: true },
  { file: 'paralith-brand-film-60s.mp4', width: 1920, height: 1080, cut: 'sixty', audio: true },
  { file: 'paralith-brand-film-30s.mp4', width: 1920, height: 1080, cut: 'thirty', audio: true },
  { file: 'paralith-brand-film-15s-teaser.mp4', width: 1920, height: 1080, cut: 'teaser', audio: true },
  { file: 'paralith-brand-film-vertical-30s.mp4', width: 1080, height: 1920, cut: 'thirty', audio: true },
  { file: 'paralith-website-hero-loop.mp4', width: 1920, height: 1080, cut: 'loop', audio: false },
];

const SIDECARS = [
  'paralith-brand-film-poster.png',
  'paralith-brand-film-captions.srt',
  'paralith-brand-film-captions.vtt',
  'paralith-brand-film-60s-captions.srt',
  'paralith-brand-film-30s-captions.srt',
  'paralith-brand-film-15s-captions.srt',
];

const probe = (file, args) => {
  const result = spawnSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path.basename(file)}: ${result.stderr}`);
  return JSON.parse(result.stdout);
};

/** Integrated loudness and true peak, measured rather than assumed. */
const loudness = (file) => {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const start = text.lastIndexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) return undefined;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return { lufs: Number(parsed.input_i), peak: Number(parsed.input_tp) };
  } catch {
    return undefined;
  }
};

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

for (const entry of EXPECTED) {
  const file = path.join(exports_, entry.file);
  if (!existsSync(file)) {
    failures.push(`${entry.file}: missing`);
    continue;
  }

  const info = probe(file, ['-show_streams', '-show_format']);
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');
  const duration = Number(info.format.duration);
  const expected = seconds(CUT_FRAMES[entry.cut]);
  const size = (statSync(file).size / 1024 / 1024).toFixed(1);

  check(video?.codec_name === 'h264', `${entry.file}: codec ${video?.codec_name}, expected h264`);
  check(video?.width === entry.width, `${entry.file}: width ${video?.width}, expected ${entry.width}`);
  check(video?.height === entry.height, `${entry.file}: height ${video?.height}, expected ${entry.height}`);
  check(video?.pix_fmt === 'yuv420p', `${entry.file}: pixel format ${video?.pix_fmt}, expected yuv420p`);
  check(
    video?.r_frame_rate === '60/1',
    `${entry.file}: frame rate ${video?.r_frame_rate}, expected 60/1`,
  );
  check(
    Math.abs(duration - expected) <= TOLERANCE + 1 / FPS,
    `${entry.file}: duration ${duration.toFixed(3)}s, expected ${expected.toFixed(3)}s — re-render, the cut was re-timed`,
  );

  let level = '';
  if (entry.audio) {
    check(audio?.codec_name === 'aac', `${entry.file}: audio ${audio?.codec_name}, expected aac`);
    check(Number(audio?.sample_rate) === 48_000, `${entry.file}: sample rate ${audio?.sample_rate}, expected 48000`);
    check(audio?.channels === 2, `${entry.file}: ${audio?.channels} channel(s), expected 2`);

    const measured = loudness(file);
    if (!measured) {
      failures.push(`${entry.file}: loudness could not be measured`);
    } else {
      level = `  ${measured.lufs.toFixed(1)} LUFS / ${measured.peak.toFixed(1)} dBTP`;
      check(
        Math.abs(measured.lufs + 16) <= 1.5,
        `${entry.file}: ${measured.lufs.toFixed(1)} LUFS, expected -16 ±1.5`,
      );
      check(measured.peak <= -1.0, `${entry.file}: true peak ${measured.peak.toFixed(1)} dBTP, expected <= -1.0`);
    }
  } else {
    check(audio === undefined, `${entry.file}: expected no audio stream`);
    level = '  silent';
  }

  console.log(`ok  ${entry.file.padEnd(42)} ${video?.width}x${video?.height}  ${duration.toFixed(3)}s  ${size} MB${level}`);
}

for (const name of SIDECARS) {
  const file = path.join(exports_, name);
  if (!existsSync(file)) failures.push(`${name}: missing`);
  else console.log(`ok  ${name}`);
}

if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('\nall campaign deliveries verified');
