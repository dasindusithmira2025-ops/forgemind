/**
 * Arranges the campaign score from the ElevenLabs stems.
 *
 *   node scripts/fetch-score-stems.mjs     # once, needs ELEVENLABS_API_KEY
 *   node scripts/build-campaign-score.mjs  # offline from here on
 *
 * The stems are textures, not music. What makes them a score is this file: every layer's gain is a
 * function of time expressed in the *edit's* own terms, imported from `src/campaign/script.ts`, so
 * the arrangement cannot drift out of sync with a re-timed sequence. Nothing here is a fade someone
 * drew on a timeline by eye.
 *
 * The shape follows the film:
 *
 *   fragments   room tone and a low drone, barely there. The quietest twelve seconds in the film.
 *   arrival     a riser into an impact on the mark, then the pad establishes the tonal identity.
 *   direct      the pulse enters and sparse percussion forms underneath it.
 *   parallel    the density peak — and then, at the exact frame one agent stops, the percussion
 *               thins to almost nothing and stays thin for eight seconds. The arrangement loses a
 *               member at the same moment the fleet does. It comes back when the Fleet Bar answers.
 *   repository  drive gives way to shimmer. Detail, not volume.
 *   proof       the floor drops out. Drone and pad only.
 *   continuity  the warm major-sixth pad, the only unambiguously warm bar in the piece.
 *   close       full resolve, decaying to silence under the mark.
 *
 * Derived cuts map output time back to master time for the *envelopes*, so a trailer sounds like
 * the sequence it is showing, while the stems themselves are read continuously in output time, so
 * a splice never produces a click or a half-played bar.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STEMS = path.join(ROOT, 'public', 'audio', 'stems');
const OUT = path.join(ROOT, 'public', 'audio');
const TEMP = path.join(ROOT, 'out', 'audio-source');

const { BEATS, FPS, STARTS, DURATION, CUTS, CUT_FRAMES } = await import(
  pathToFileURL(path.join(ROOT, 'src/campaign/script.ts')).href
);

const RATE = 48_000;
const seconds = (frames) => frames / FPS;
const at = Object.fromEntries(Object.entries(STARTS).map(([id, frame]) => [id, seconds(frame)]));
const endOf = (id) => at[id] + seconds(BEATS.find((beat) => beat.id === id).duration);

const smooth = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Rises over `up`, holds, falls over `down`. The shape of every layer in the arrangement. */
const band = (t, from, to, up = 1.2, down = 1.2) => smooth(from - up, from, t) * (1 - smooth(to, to + down, t));

/* ---- stems ---------------------------------------------------------------------------------- */

/** Decodes a stem to interleaved stereo float32 at the project rate. */
const decode = (name) => {
  const file = path.join(STEMS, `${name}.mp3`);
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`decode failed for ${name}: ${result.stderr}`);
  const raw = result.stdout;
  const data = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
  return { data, frames: Math.floor(data.length / 2) };
};

const NAMES = [
  'drone', 'pad', 'pad-warm', 'pulse', 'perc-sparse', 'perc-drive',
  'machine', 'riser', 'impact', 'shimmer', 'resolve', 'tick',
];
const stems = Object.fromEntries(NAMES.map((name) => [name, decode(name)]));
for (const name of NAMES) {
  console.log(`stem ${name.padEnd(13)} ${(stems[name].frames / RATE).toFixed(2)}s`);
}

const XFADE = Math.floor(0.4 * RATE);

/**
 * Reads a stem at sample `i`, looping seamlessly.
 *
 * The loop point is crossfaded equal-power over 0.4s rather than butt-joined. A 22-second texture
 * butt-joined to itself clicks audibly every 22 seconds, and once you have heard it you cannot
 * stop hearing it.
 */
const sample = (stem, i, channel) => {
  const period = Math.max(1, stem.frames - XFADE);
  const pos = ((i % period) + period) % period;
  const primary = stem.data[pos * 2 + channel] ?? 0;
  if (pos >= XFADE) return primary;
  const tail = stem.data[(pos + period) * 2 + channel] ?? 0;
  const w = pos / XFADE;
  return primary * Math.sqrt(w) + tail * Math.sqrt(1 - w);
};

/** Reads a stem once, without looping, offset so it starts at `startSample`. */
const once = (stem, i, startSample, channel) => {
  const pos = i - startSample;
  if (pos < 0 || pos >= stem.frames) return 0;
  return stem.data[pos * 2 + channel] ?? 0;
};

/* ---- the arrangement ------------------------------------------------------------------------ */

/**
 * Per-layer gain as a function of master time.
 *
 * Levels are set against each stem's measured loudness rather than by ear on a fader: `drone` came
 * back at -3 dB mean and `machine` at -46 dB, so their coefficients differ by two orders of
 * magnitude and neither number means anything on its own.
 */
const LAYERS = {
  /**
   * The opening's room tone. `machine` came back 46 dB down, so its coefficient is large and means
   * nothing on its own — what matters is that the first twelve seconds measure around -25 dB mean,
   * which is roughly ten below the body of the film. The opening has to feel like a room, not like
   * a track that has started.
   */
  machine: (t) => 6.0 * band(t, 0.4, at.arrival - 0.6, 2.0, 1.0),

  drone: (t) =>
    0.05 * band(t, 1.0, at.arrival - 0.4, 3.0, 0.8) +
    0.22 * band(t, at.arrival + 0.4, at.proof, 2.0, 1.5) +
    0.16 * band(t, at.proof, endOf('continuity'), 1.5, 1.5) +
    0.27 * band(t, at.close, at.close + 7.5, 1.0, 2.6),

  pad: (t) =>
    0.55 * band(t, at.arrival + 1.2, at.proof, 2.2, 1.2) +
    0.42 * band(t, at.proof, at.continuity, 1.4, 1.4) +
    0.40 * band(t, at.close + 2.6, at.close + 8.4, 1.4, 2.0),

  'pad-warm': (t) => 2.3 * band(t, at.continuity - 0.6, at.close + 1.0, 2.2, 1.4),

  /** Enters as the mission is typed and drives everything until the proof sequence empties out. */
  pulse: (t) =>
    0.18 * band(t, at.direct + 1.0, at.parallel, 2.4, 0.8) +
    0.30 * band(t, at.parallel, at.repository, 0.8, 0.8) +
    0.17 * band(t, at.repository, at.proof, 0.8, 1.6),

  'perc-sparse': (t) =>
    2.0 * band(t, at.direct + 3.0, at.parallel, 2.0, 0.8) +
    2.6 * band(t, at.repository, at.proof, 1.2, 1.6),

  /**
   * The drive, and the hole in it.
   *
   * It builds through the first six seconds of `parallel`, then collapses to a fifth of its level
   * for the eight seconds the film spends watching an agent that has quietly stopped, and returns
   * when the Fleet Bar names it. Those two frame numbers are the scene's own, not approximations:
   * local 360 is where the pane stops and local 850 is where the click lands.
   */
  'perc-drive': (t) => {
    const stopped = at.parallel + seconds(360);
    const answered = at.parallel + seconds(850);
    const present = 4.2 * band(t, at.parallel + 1.0, at.repository, 2.5, 1.5);
    const hole = 1 - 0.8 * band(t, stopped, answered, 0.9, 0.6);
    return present * hole;
  },

  shimmer: (t) =>
    1.4 * band(t, at.repository + 1.0, at.proof, 2.0, 1.5) +
    3.1 * band(t, at.close + 3.0, at.close + 8.6, 1.5, 2.2),

  /** The ending. Carries the close on its own once the pad and drone have thinned. */
  resolve: (t) => 2.7 * band(t, at.close + 2.8, at.close + 9.4, 1.6, 1.2),
};

/**
 * One-shots, in master time. These are placed, not looped.
 *
 * The riser runs into the mark and the impact lands on it. Everything else is a tactile accent on a
 * structural move — the canvas dividing, the fleet answering, the sessions coming back.
 */
const ONESHOTS = [
  { stem: 'riser', at: at.arrival - 2.6, gain: 0.22 },
  { stem: 'impact', at: at.arrival + 0.42, gain: 0.5 },
  { stem: 'tick', at: at.direct + seconds(210), gain: 0.5 },
  { stem: 'tick', at: at.parallel + seconds(60), gain: 0.45 },
  { stem: 'tick', at: at.parallel + seconds(150), gain: 0.45 },
  { stem: 'tick', at: at.parallel + seconds(250), gain: 0.45 },
  { stem: 'impact', at: at.parallel + seconds(850), gain: 0.2 },
  { stem: 'tick', at: at.proof + seconds(330), gain: 0.4 },
  { stem: 'tick', at: at.continuity + seconds(400), gain: 0.45 },
  { stem: 'impact', at: at.close + seconds(392) / 1, gain: 0.26 },
];

/* ---- render --------------------------------------------------------------------------------- */

const buildMapper = (cutId) => {
  if (cutId === 'master') return { toMaster: (t) => t, length: seconds(DURATION) };

  const spans = [];
  let cursor = 0;
  for (const excerpt of CUTS[cutId]) {
    spans.push({
      to: seconds(cursor + excerpt.length),
      from: seconds(cursor),
      masterFrom: seconds(STARTS[excerpt.beat] + excerpt.from),
    });
    cursor += excerpt.length;
  }
  return {
    length: seconds(cursor),
    toMaster: (t) => {
      for (const span of spans) if (t < span.to) return span.masterFrom + (t - span.from);
      const last = spans[spans.length - 1];
      return last.masterFrom + (last.to - last.from);
    },
  };
};

/** One-shot times re-expressed in a cut's own output time; a shot outside every excerpt is dropped. */
const shotsFor = (cutId) => {
  if (cutId === 'master') return ONESHOTS.map((shot) => ({ ...shot }));
  const out = [];
  let cursor = 0;
  for (const excerpt of CUTS[cutId]) {
    const from = seconds(STARTS[excerpt.beat] + excerpt.from);
    const to = from + seconds(excerpt.length);
    for (const shot of ONESHOTS) {
      if (shot.at >= from && shot.at < to) out.push({ ...shot, at: seconds(cursor) + (shot.at - from) });
    }
    cursor += excerpt.length;
  }
  return out;
};

/** Soft knee limiter. Keeps the impacts from squaring off the master without pumping the pads. */
const limit = (x) => {
  const threshold = 0.82;
  const magnitude = Math.abs(x);
  if (magnitude <= threshold) return x;
  const over = magnitude - threshold;
  const compressed = threshold + over / (1 + (over / (1 - threshold)) * 2.2);
  return Math.sign(x) * Math.min(0.995, compressed);
};

const render = (cutId, file) => {
  const mapper = buildMapper(cutId);
  const total = Math.floor(mapper.length * RATE);
  const shots = shotsFor(cutId).map((shot) => ({ ...shot, start: Math.floor(shot.at * RATE) }));
  const out = new Float32Array(total * 2);

  const entries = Object.entries(LAYERS);

  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const m = mapper.toMaster(t);

    let left = 0;
    let right = 0;

    for (const [name, gainOf] of entries) {
      const gain = gainOf(m);
      if (gain <= 0.0005) continue;
      const stem = stems[name];
      left += sample(stem, i, 0) * gain;
      right += sample(stem, i, 1) * gain;
    }

    for (const shot of shots) {
      const stem = stems[shot.stem];
      const l = once(stem, i, shot.start, 0);
      if (l === 0) {
        const r0 = once(stem, i, shot.start, 1);
        if (r0 === 0) continue;
      }
      left += l * shot.gain;
      right += once(stem, i, shot.start, 1) * shot.gain;
    }

    /** Master fades. The loop gets short symmetrical ones so its wrap point is inaudible. */
    const inFade = smooth(0, cutId === 'loop' ? 0.8 : 1.6, t);
    const outFade = 1 - smooth(mapper.length - (cutId === 'loop' ? 0.8 : 3.0), mapper.length, t);
    const gain = inFade * outFade;

    out[i * 2] = limit(left * gain);
    out[i * 2 + 1] = limit(right * gain);
  }

  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const normalise = 0.89 / Math.max(1e-6, peak);

  const buffer = Buffer.alloc(44 + total * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + total * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(total * 4, 40);
  for (let i = 0; i < out.length; i++) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * normalise)) * 32767), 44 + i * 2);
  }

  mkdirSync(TEMP, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const wav = path.join(TEMP, `${file}.wav`);
  const mp3 = path.join(OUT, `${file}.mp3`);
  writeFileSync(wav, buffer);

  const encode = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', wav,
      // No `loudnorm` here, deliberately. Its LRA target is a *loudness range* target, which means
      // it compresses exactly the dynamics this arrangement exists to create — with `LRA=10` the
      // near-silent opening measured within 4 dB of the density peak. Levels are set by the
      // arrangement and the peak by the limiter above; the delivered mix is normalised once, later,
      // by `normalize-audio.mjs` against the finished video.
      '-af', 'highpass=f=26,lowpass=f=17500,alimiter=limit=0.97:level=disabled',
      '-ar', String(RATE), '-ac', '2',
      '-codec:a', 'libmp3lame', '-b:a', '320k',
      mp3,
    ],
    { stdio: 'inherit' },
  );
  if (encode.status !== 0) throw new Error(`ffmpeg failed for ${file}`);

  console.log(`${file}: ${mapper.length.toFixed(3)}s, ${shots.length} one-shots -> ${path.relative(ROOT, mp3)}`);
};

render('master', 'paralith-campaign-score');
render('sixty', 'paralith-campaign-score-60');
render('thirty', 'paralith-campaign-score-30');
render('teaser', 'paralith-campaign-score-15');

console.log(
  `\ncut lengths: master ${CUT_FRAMES.master}f, 60s ${CUT_FRAMES.sixty}f, 30s ${CUT_FRAMES.thirty}f, teaser ${CUT_FRAMES.teaser}f`,
);
