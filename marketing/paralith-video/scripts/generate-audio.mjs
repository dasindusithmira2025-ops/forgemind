import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public', 'audio');
const temporary = path.join(root, 'out', 'audio-source');
mkdirSync(output, { recursive: true });
mkdirSync(temporary, { recursive: true });

const sampleRate = 48_000;

const hashNoise = (index, seed) => {
  const value = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};

const decayPulse = (time, interval, decay) => {
  const phase = ((time % interval) + interval) % interval;
  return Math.exp(-phase * decay);
};

const smoothStep = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const segmentEnvelope = (time, from, to, fade = 0.8) =>
  smoothStep(from, from + fade, time) * (1 - smoothStep(to - fade, to, time));

const chordFor = (time, duration) => {
  const normalized = time / duration;
  const roots = normalized < 0.2
    ? [43.65, 51.91]
    : normalized < 0.55
      ? [55, 65.41, 73.42, 49]
      : normalized < 0.82
        ? [65.41, 73.42, 82.41, 55]
        : [55, 65.41, 82.41, 110];
  const index = Math.floor(time / 4) % roots.length;
  return roots[index];
};

const writeScore = (name, duration, revealAt) => {
  const samples = Math.floor(duration * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 4, 40);

  const cues = [
    duration * 0.04,
    duration * 0.11,
    duration * 0.19,
    revealAt,
    duration * 0.43,
    duration * 0.56,
    duration * 0.7,
    duration * 0.82,
    duration * 0.93,
  ];
  let peak = 0;
  const floats = new Float32Array(samples * 2);

  for (let index = 0; index < samples; index++) {
    const t = index / sampleRate;
    const n = t / duration;
    const root = chordFor(t, duration);
    const tension = segmentEnvelope(t, 0, revealAt, 1.1);
    const revealSilence = 1 - 0.88 * segmentEnvelope(t, revealAt - 0.32, revealAt + 0.52, 0.24);
    const feature = smoothStep(revealAt + 0.2, revealAt + 2.2, t);
    const close = smoothStep(duration * 0.83, duration * 0.93, t);
    const masterIn = smoothStep(0, 1.4, t);
    const masterOut = 1 - smoothStep(duration - 1.8, duration, t);

    const pad =
      Math.sin(Math.PI * 2 * root * t) * 0.115 +
      Math.sin(Math.PI * 2 * root * 1.5 * t + 0.4) * 0.055 +
      Math.sin(Math.PI * 2 * root * 2 * t + 1.1) * 0.035;
    const sidePad =
      Math.sin(Math.PI * 2 * root * 1.003 * t + 0.7) * 0.09 +
      Math.sin(Math.PI * 2 * root * 1.498 * t + 1.7) * 0.045;

    const pulseInterval = tension > 0.25 ? 0.72 : 0.54;
    const pulse = Math.sin(Math.PI * 2 * root * 2 * t) * decayPulse(t, pulseInterval, 8.5) * 0.12;
    const highPulse =
      Math.sin(Math.PI * 2 * root * 8 * t) *
      decayPulse(t + 0.16, feature > 0.4 ? 0.27 : 0.54, 22) *
      (0.015 + feature * 0.022);
    const mechanical =
      hashNoise(index, 13) *
      decayPulse(t + 0.05, 0.36, 62) *
      (0.008 + tension * 0.012);

    let cueSound = 0;
    for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
      const dt = t - cues[cueIndex];
      if (dt >= 0 && dt < 0.45) {
        cueSound +=
          Math.sin(Math.PI * 2 * (520 + cueIndex * 41) * dt) *
          Math.exp(-dt * (16 + cueIndex * 0.4)) *
          0.04;
      }
    }

    const endLift =
      (Math.sin(Math.PI * 2 * 220 * t) * 0.035 +
        Math.sin(Math.PI * 2 * 330 * t) * 0.025 +
        Math.sin(Math.PI * 2 * 440 * t) * 0.018) *
      close;

    const gain = masterIn * masterOut * revealSilence;
    const left = (pad + pulse + highPulse + mechanical + cueSound + endLift) * gain;
    const right = (sidePad + pulse * 0.92 - highPulse * 0.7 + mechanical * 0.75 + cueSound * 0.9 + endLift) * gain;
    floats[index * 2] = left;
    floats[index * 2 + 1] = right;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
  }

  const normalization = 0.78 / Math.max(0.0001, peak);
  for (let index = 0; index < floats.length; index++) {
    const sample = Math.max(-1, Math.min(1, floats[index] * normalization));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }

  const wav = path.join(temporary, `${name}.wav`);
  const mp3 = path.join(output, `${name}.mp3`);
  writeFileSync(wav, buffer);
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      wav,
      '-af',
      'highpass=f=34,lowpass=f=16500,acompressor=threshold=-16dB:ratio=2:attack=20:release=220,loudnorm=I=-18:TP=-1.4:LRA=8',
      '-ar',
      String(sampleRate),
      '-ac',
      '2',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '320k',
      mp3,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  console.log(`${name}: ${duration}s -> ${path.relative(root, mp3)}`);
};

writeScore('paralith-score', 82, 16);
writeScore('paralith-trailer-score', 30, 4);
writeScore('paralith-teaser-score', 15, 2.5);
