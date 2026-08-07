// The brand film's score. Original deterministic synthesis — no samples, loops, or libraries.
//
// The existing `paralith-score.mp3` was written for the narrated explainer's nine-scene shape, so
// over the brand cut its swells land in the middle of beats and its reveal cue arrives fifteen
// seconds after the mark. This score is built from the brand cut's own beat map, imported from
// `src/film/script.ts` rather than restated, so the music cannot drift out of sync with an edit.
//
// The structure follows the story rather than a template:
//
//   handoff   one voice, one slow pulse. Almost nothing.
//   multiply  the pulse subdivides at each split — 1.6s, then 0.8s, then 0.4s.
//   silence   the root drops a fourth, and the pulse starts *skipping beats*: the score loses an
//             agent at the same moment the fleet does, which is the one idea the whole film turns
//             on and the only place the music is allowed to be literal.
//   reveal    everything stops. A single low swell under the mark.
//   command   the root resolves upward and the pulse returns, steady and unhurried.
//   evidence  a high harmonic layer joins — detail, not volume.
//   authority the last build.
//   close     full chord, then decay to silence under the lockup.
//
//   node scripts/generate-brand-score.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'audio');
const TEMP = path.join(ROOT, 'out', 'audio-source');

const { BEATS, FPS, STARTS, DURATION } = await import(
  pathToFileURL(path.join(ROOT, 'src/film/script.ts')).href
);

const SAMPLE_RATE = 48_000;
const seconds = (frames) => frames / FPS;
const LENGTH = seconds(DURATION);

/** Beat boundaries in seconds, so every musical decision is stated in the edit's own terms. */
const at = Object.fromEntries(Object.entries(STARTS).map(([id, frame]) => [id, seconds(frame)]));
const endOf = (id) => at[id] + seconds(BEATS.find((beat) => beat.id === id).duration);

const smoothStep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-4, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 0 outside the beat, 1 inside, with `fade` seconds of crossfade at each edge. */
const window_ = (t, from, to, fade = 1.1) => smoothStep(from - fade, from + fade, t) * (1 - smoothStep(to - fade, to + fade, t));

const hashNoise = (index, seed) => {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

/**
 * The root note under each beat, crossfaded. A minor: A1 through the setup, down a fourth to E1
 * for the beat where an agent stops, then up to C2 as the product answers, and home to A1 for the
 * lockup.
 */
const ROOTS = [
  { id: 'handoff', hz: 55.0 },
  { id: 'multiply', hz: 55.0 },
  { id: 'silence', hz: 41.2 },
  { id: 'reveal', hz: 48.99 },
  { id: 'command', hz: 65.41 },
  { id: 'evidence', hz: 65.41 },
  { id: 'authority', hz: 73.42 },
  { id: 'close', hz: 55.0 },
];

const rootAt = (t) => {
  let hz = ROOTS[0].hz;
  for (const root of ROOTS) {
    hz += (root.hz - hz) * smoothStep(at[root.id] - 0.9, at[root.id] + 0.9, t);
  }
  return hz;
};

/**
 * The pulse interval, in seconds. Steps down through `multiply` in time with the canvas splits at
 * local frames 70, 190 and 320, so the score subdivides exactly when the frame does.
 */
const pulseIntervalAt = (t) => {
  const splits = [
    { at: at.multiply + seconds(70), interval: 1.2 },
    { at: at.multiply + seconds(190), interval: 0.8 },
    { at: at.multiply + seconds(320), interval: 0.5 },
  ];
  let interval = 1.6;
  for (const split of splits) if (t >= split.at) interval = split.interval;
  if (t >= at.silence) interval = 0.75;
  if (t >= at.command) interval = 0.75;
  return interval;
};

/**
 * The dropped beat. Through `silence`, one pulse in four is silent — and from halfway through the
 * beat, one in three — so the rhythm audibly loses a member while five panes keep scrolling.
 */
const pulseGate = (t, beatIndex) => {
  if (t < at.silence || t >= at.reveal) return 1;
  const every = t > at.silence + 6 ? 3 : 4;
  return beatIndex % every === every - 1 ? 0 : 1;
};

const samples = Math.floor(LENGTH * SAMPLE_RATE);
const floats = new Float32Array(samples * 2);
let peak = 0;

for (let index = 0; index < samples; index++) {
  const t = index / SAMPLE_RATE;
  const root = rootAt(t);

  // The mark gets near-silence to arrive into, and its own swell underneath it.
  const revealHush = 1 - 0.94 * window_(t, at.reveal - 0.5, at.reveal + 1.9, 0.55);
  const revealSwell = window_(t, at.reveal + 1.2, endOf('reveal') - 0.6, 1.5);

  const masterIn = smoothStep(0, 2.2, t);
  const masterOut = 1 - smoothStep(LENGTH - 3.4, LENGTH, t);

  // Density: how much of the arrangement is present. Grows with the story.
  const density =
    0.34 +
    0.2 * smoothStep(at.multiply, at.multiply + 4, t) +
    0.16 * smoothStep(at.command, at.command + 3, t) +
    0.16 * smoothStep(at.authority, at.authority + 4, t) +
    0.14 * smoothStep(at.close, at.close + 2.5, t);

  const pad =
    Math.sin(Math.PI * 2 * root * t) * 0.13 +
    Math.sin(Math.PI * 2 * root * 1.5 * t + 0.4) * 0.06 * density +
    Math.sin(Math.PI * 2 * root * 2 * t + 1.1) * 0.038 * density;
  const sidePad =
    Math.sin(Math.PI * 2 * root * 1.004 * t + 0.7) * 0.105 +
    Math.sin(Math.PI * 2 * root * 1.502 * t + 1.7) * 0.05 * density;

  const interval = pulseIntervalAt(t);
  const beatIndex = Math.floor(t / interval);
  const phase = t - beatIndex * interval;
  const pulse =
    Math.sin(Math.PI * 2 * root * 2 * t) *
    Math.exp(-phase * 9) *
    0.115 *
    pulseGate(t, beatIndex) *
    smoothStep(1.5, 3.5, t);

  // A high harmonic that only appears once the film is showing detail rather than scale.
  const detail = smoothStep(at.evidence, at.evidence + 2.5, t) * (1 - smoothStep(at.close, at.close + 2, t));
  const shimmer =
    Math.sin(Math.PI * 2 * root * 8 * t) * Math.exp(-((t - beatIndex * interval) * 20)) * 0.02 * detail;

  // Room tone. Barely audible; it stops the pad reading as a synthesiser held on a key.
  const air = hashNoise(index, 13) * 0.004 * density;

  const close = smoothStep(at.close, at.close + 3, t) * (1 - smoothStep(LENGTH - 4, LENGTH - 0.5, t));
  const chord =
    (Math.sin(Math.PI * 2 * root * 3 * t) * 0.03 +
      Math.sin(Math.PI * 2 * root * 4 * t) * 0.022 +
      Math.sin(Math.PI * 2 * root * 6 * t) * 0.013) *
    close;

  const swell = Math.sin(Math.PI * 2 * root * 1.5 * t) * 0.09 * revealSwell;

  const gain = masterIn * masterOut * revealHush;
  const left = (pad + pulse + shimmer + air + chord + swell) * gain;
  const right = (sidePad + pulse * 0.93 - shimmer * 0.7 + air * 0.8 + chord + swell * 0.96) * gain;

  floats[index * 2] = left;
  floats[index * 2 + 1] = right;
  peak = Math.max(peak, Math.abs(left), Math.abs(right));
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TEMP, { recursive: true });

const buffer = Buffer.alloc(44 + samples * 4);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + samples * 4, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(2, 22);
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 4, 28);
buffer.writeUInt16LE(4, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(samples * 4, 40);

const normalization = 0.8 / Math.max(1e-4, peak);
for (let index = 0; index < floats.length; index++) {
  const sample = Math.max(-1, Math.min(1, floats[index] * normalization));
  buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
}

const wav = path.join(TEMP, 'paralith-brand-score.wav');
const mp3 = path.join(OUT, 'paralith-brand-score.mp3');
writeFileSync(wav, buffer);

const result = spawnSync(
  'ffmpeg',
  [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', wav,
    '-af',
    'highpass=f=30,lowpass=f=16500,acompressor=threshold=-17dB:ratio=2:attack=25:release=260,loudnorm=I=-19:TP=-1.6:LRA=9',
    '-ar', String(SAMPLE_RATE), '-ac', '2',
    '-codec:a', 'libmp3lame', '-b:a', '320k',
    mp3,
  ],
  { stdio: 'inherit' },
);
if (result.status !== 0) throw new Error('ffmpeg failed for paralith-brand-score');

console.log(`paralith-brand-score: ${LENGTH.toFixed(3)}s -> ${path.relative(ROOT, mp3)}`);
