// Verifies the delivered brand-film masters against the cut they were rendered from.
//
// The expected duration is not a literal: it is imported from `src/film/script.ts`, so
// re-timing a beat and forgetting to re-render is caught here rather than in review.
//
//   node scripts/verify-brand.mjs

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPORTS = path.resolve(ROOT, '..', '..', 'media', 'exports');

const { DURATION, FPS } = await import(pathToFileURL(path.join(ROOT, 'src/film/script.ts')).href);
const EXPECTED_SECONDS = DURATION / FPS;

/** AAC pads the final packet, so an encode is allowed to run marginally long but never short. */
const TOLERANCE = { under: 0.02, over: 0.12 };

const TARGETS = [
  { file: 'paralith-brand-film-1080p.mp4', width: 1920, height: 1080, audio: true },
  { file: 'paralith-brand-film-4k.mp4', width: 3840, height: 2160, audio: true, optional: true },
];

const probe = (file) => {
  const result = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
};

let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failed = true;
};

for (const target of TARGETS) {
  const file = path.join(EXPORTS, target.file);

  if (!existsSync(file)) {
    if (target.optional) {
      console.log(`skip ${target.file} (not rendered)`);
      continue;
    }
    check(false, `${target.file} exists`);
    continue;
  }

  const info = probe(file);
  const duration = Number(info.format.duration);
  const video = info.streams.find((stream) => stream.codec_type === 'video');
  const audio = info.streams.find((stream) => stream.codec_type === 'audio');

  check(
    duration >= EXPECTED_SECONDS - TOLERANCE.under && duration <= EXPECTED_SECONDS + TOLERANCE.over,
    `${target.file} runs ${duration.toFixed(3)}s (cut is ${EXPECTED_SECONDS.toFixed(3)}s)`,
  );
  check(
    video?.width === target.width && video?.height === target.height,
    `${target.file} is ${video?.width}x${video?.height}`,
  );
  check(video?.codec_name === 'h264' && video?.pix_fmt === 'yuv420p', `${target.file} is H.264 yuv420p`);
  check(video?.r_frame_rate === `${FPS}/1`, `${target.file} is ${video?.r_frame_rate} fps`);

  if (target.audio) {
    check(
      audio?.codec_name === 'aac' && Number(audio?.sample_rate) === 48_000,
      `${target.file} carries 48 kHz AAC`,
    );
  }

  // Delivery loudness. EBU R128, matching what `normalize-audio.mjs` targets.
  const r128 = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8' },
  ).stderr;
  const integrated = Number(r128.match(/I:\s*(-?[\d.]+)\s*LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);
  const peak = Number(r128.match(/Peak:\s*(-?[\d.]+)\s*dBFS/g)?.pop()?.match(/-?[\d.]+/)?.[0]);

  check(
    Number.isFinite(integrated) && integrated >= -17.5 && integrated <= -14.5,
    `${target.file} integrated loudness ${integrated} LUFS`,
  );
  check(Number.isFinite(peak) && peak <= -1, `${target.file} true peak ${peak} dBTP`);
}

process.exit(failed ? 1 : 0);
