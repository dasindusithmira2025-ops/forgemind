import { existsSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '..', '..', 'media', 'exports');
const expectedFilenames = [
  'paralith-hero-film-4k.mp4',
  'paralith-hero-film-1080p.mp4',
  'paralith-hero-film-vertical.mp4',
  'paralith-hero-film-square.mp4',
  'paralith-trailer-30s.mp4',
  'paralith-teaser-15s.mp4',
  'paralith-hero-captioned.mp4',
  'paralith-hero-clean.mp4',
  // Brand film masters; see docs/BRAND_FILM.md.
  'paralith-brand-film-4k.mp4',
  'paralith-brand-film-1080p.mp4',
  'paralith-brand-film-silent.mp4',
  // Campaign cut deliveries; see docs/CAMPAIGN_FILM.md. The website hero loop is absent on
  // purpose — it is rendered muted, and a loudness pass over a file with no audio stream would
  // fail on the measurement rather than skip.
  'paralith-brand-film-master-4k.mp4',
  'paralith-brand-film-master-1080p.mp4',
  'paralith-brand-film-captioned.mp4',
  'paralith-brand-film-60s.mp4',
  'paralith-brand-film-30s.mp4',
  'paralith-brand-film-15s-teaser.mp4',
  'paralith-brand-film-vertical-30s.mp4',
];
const requestedFilenames = process.argv.slice(2);
const filenames =
  requestedFilenames.length > 0 ? requestedFilenames : expectedFilenames;
for (const filename of filenames) {
  if (!expectedFilenames.includes(filename)) {
    throw new Error(`Unknown delivery filename: ${filename}`);
  }
}

const run = (args) =>
  spawnSync('ffmpeg', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

for (const filename of filenames) {
  const source = path.join(output, filename);
  if (!existsSync(source)) {
    throw new Error(`Cannot normalize missing export: ${filename}`);
  }

  const measurement = run([
    '-hide_banner',
    '-nostats',
    '-i',
    source,
    '-map',
    '0:a:0',
    '-af',
    'loudnorm=I=-16:LRA=7:TP=-1.5:print_format=json',
    '-f',
    'null',
    process.platform === 'win32' ? 'NUL' : '/dev/null',
  ]);
  const match = measurement.stderr.match(
    /\{\s*"input_i"[\s\S]*?"target_offset"\s*:\s*"[^"]+"\s*\}/,
  );
  if (measurement.status !== 0 || !match) {
    throw new Error(
      `Loudness measurement failed for ${filename}\n${measurement.stderr}`,
    );
  }

  const measured = JSON.parse(match[0]);
  const filter = [
    'loudnorm=I=-16',
    'LRA=7',
    'TP=-1.5',
    `measured_I=${measured.input_i}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    'linear=true',
    'print_format=summary',
  ].join(':');
  const temporary = path.join(output, `.${filename}.normalizing.mp4`);
  const normalized = run([
    '-hide_banner',
    '-y',
    '-i',
    source,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0',
    '-c:v',
    'copy',
    '-af',
    filter,
    '-c:a',
    'aac',
    '-b:a',
    '320k',
    '-ar',
    '48000',
    temporary,
  ]);
  if (normalized.status !== 0) {
    rmSync(temporary, { force: true });
    throw new Error(
      `Loudness normalization failed for ${filename}\n${normalized.stderr}`,
    );
  }

  rmSync(source);
  renameSync(temporary, source);
  console.log(`normalized ${filename}`);
}
