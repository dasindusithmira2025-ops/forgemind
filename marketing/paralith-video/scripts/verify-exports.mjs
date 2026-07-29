import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, '..', '..', 'media', 'exports');

const expected = [
  ['paralith-hero-film-4k.mp4', 3840, 2160, 82, true],
  ['paralith-hero-film-1080p.mp4', 1920, 1080, 82, true],
  ['paralith-hero-film-vertical.mp4', 1080, 1920, 82, true],
  ['paralith-hero-film-square.mp4', 1080, 1080, 82, true],
  ['paralith-trailer-30s.mp4', 1920, 1080, 30, true],
  ['paralith-teaser-15s.mp4', 1920, 1080, 15, true],
  ['paralith-hero-captioned.mp4', 1920, 1080, 82, true],
  ['paralith-hero-clean.mp4', 1920, 1080, 82, true],
];

let failed = false;
for (const [name, width, height, duration, audio] of expected) {
  const file = path.join(output, name);
  if (!existsSync(file)) {
    console.error(`missing: ${name}`);
    failed = true;
    continue;
  }
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels,pix_fmt',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    console.error(`ffprobe failed: ${name}`);
    failed = true;
    continue;
  }
  const data = JSON.parse(probe.stdout);
  const video = data.streams.find((stream) => stream.codec_type === 'video');
  const audioStream = data.streams.find((stream) => stream.codec_type === 'audio');
  const hasAudio = Boolean(audioStream);
  const actualDuration = Number(data.format.duration);
  const loudnessProbe = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-filter_complex',
      'ebur128=peak=true',
      '-f',
      'null',
      process.platform === 'win32' ? 'NUL' : '/dev/null',
    ],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const loudnessMatches = [
    ...loudnessProbe.stderr.matchAll(/I:\s+(-?\d+\.\d+) LUFS/g),
  ];
  const peakMatches = [
    ...loudnessProbe.stderr.matchAll(/Peak:\s+(-?\d+\.\d+) dBFS/g),
  ];
  const loudness = Number(loudnessMatches.at(-1)?.[1]);
  const truePeak = Number(peakMatches.at(-1)?.[1]);
  const valid =
    video?.codec_name === 'h264' &&
    video?.width === width &&
    video?.height === height &&
    video?.r_frame_rate === '60/1' &&
    video?.pix_fmt === 'yuv420p' &&
    audioStream?.codec_name === 'aac' &&
    audioStream?.sample_rate === '48000' &&
    audioStream?.channels === 2 &&
    Math.abs(actualDuration - duration) < 0.12 &&
    hasAudio === audio &&
    loudnessProbe.status === 0 &&
    Math.abs(loudness - -16) <= 0.3 &&
    truePeak <= -1;
  console.log(
    `${valid ? 'ok' : 'FAIL'} ${name} ${video?.width}x${video?.height} ${actualDuration.toFixed(3)}s ${loudness.toFixed(1)} LUFS ${truePeak.toFixed(1)} dBTP size=${data.format.size}`,
  );
  if (!valid) failed = true;
}

const poster = path.join(output, 'paralith-poster.png');
if (!existsSync(poster)) {
  console.error('missing: paralith-poster.png');
  failed = true;
}

if (failed) process.exit(1);
