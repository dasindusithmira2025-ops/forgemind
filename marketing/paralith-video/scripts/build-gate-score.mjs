/**
 * The gate film's score.
 *
 *   node scripts/build-gate-score.mjs
 *
 * Entirely synthesised here, from oscillators and seeded noise. It uses no samples, no stems, no
 * library and no network — the campaign film's score was arranged from ElevenLabs stems and this
 * one deliberately shares nothing with it, not one texture and not one interval. `ffmpeg` is used
 * only to encode the finished buffer.
 *
 * The piece is in D, and it spends seventy of its seventy-eight seconds refusing to resolve. The
 * harmony is stacked fifths and seconds — D, A, E, G — which has no third in it and therefore no
 * mode: it is neither major nor minor, it is *undecided*, which is the state the change is in for
 * the whole film. The only third in the score arrives 57.4 seconds in, on the frame a person
 * approves the change, and it is a major one.
 *
 * The arrangement's job is to carry one structural event, and everything else is subordinate to it:
 *
 *   instruction   room tone and a low drone. The rail tick enters at 2s. Nothing else.
 *   split         the pulse enters at 100bpm and the open pad establishes the harmony.
 *   isolation     steady. Density without escalation — the sequence is deliberately not a build.
 *   verification  full through 41.2s, and then **everything stops.** At the frame the contract
 *                 check fails, the pulse, the pad, the ticks and the shimmer all cut — not fade,
 *                 cut — and four and a half seconds of the film play under a single detuned tone
 *                 over the bare drone. It is the loudest thing in the score and it is a silence.
 *   consent       thin, high, and still. One sustained tone; the pulse does not come back yet.
 *   through       the warm pad, the only major harmony in the piece, and the pulse resolving with it.
 *   close         a three-note figure over a decaying drone, and out.
 *
 * Derived cuts map output time back to master time for the *envelopes* only. The layers themselves
 * are generated continuously in output time, so a splice never lands mid-grain or produces a click.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'public', 'audio');
const TEMP = path.join(ROOT, 'out', 'audio-source');

const { BEATS, FPS, STARTS, DURATION, CUTS, CUT_FRAMES, REPAIR_AT } = await import(
  pathToFileURL(path.join(ROOT, 'src/gate/script.ts')).href
);

const RATE = 48_000;
const seconds = (frames) => frames / FPS;
const at = Object.fromEntries(Object.entries(STARTS).map(([id, frame]) => [id, seconds(frame)]));
const endOf = (id) => at[id] + seconds(BEATS.find((beat) => beat.id === id).duration);

/** The two frames the whole arrangement is built around, in master seconds. */
const STOPPED = at.verification + seconds(372);
const RELEASED = at.verification + seconds(REPAIR_AT);
const APPROVED = at.consent + seconds(566);

/* ---- primitives -------------------------------------------------------------------------------- */

const TAU = Math.PI * 2;

const smooth = (edge0, edge1, value) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Rises over `up`, holds, falls over `down`. Every envelope in the arrangement is one of these. */
const band = (t, from, to, up = 1.2, down = 1.2) =>
  smooth(from - up, from, t) * (1 - smooth(to, to + down, t));

/** A hard gate. No ramp at all — used once, for the stop, where a fade would be a lie. */
const gate = (t, from, to) => (t >= from && t < to ? 1 : 0);

/** Seeded white noise. Deterministic, so the score is byte-identical on every machine. */
const makeNoise = (seed) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state / 0xffffffff) * 2 - 1;
  };
};

/** A one-pole lowpass, stateful across a layer's buffer. */
const makeLowpass = (cutoff) => {
  const a = 1 - Math.exp((-TAU * cutoff) / RATE);
  let z = 0;
  return (x) => {
    z += a * (x - z);
    return z;
  };
};

/** A one-pole highpass, built from its complementary lowpass. */
const makeHighpass = (cutoff) => {
  const low = makeLowpass(cutoff);
  return (x) => x - low(x);
};

/* ---- the instrument ----------------------------------------------------------------------------
 *
 * Six generators. Each one writes a full-length stereo buffer in output time; the mix stage decides
 * when any of them is audible. Nothing here reads master time, which is what keeps a spliced cut
 * free of discontinuities.
 */

const D1 = 36.708;
const A1 = 55.0;
const D2 = 73.416;
const D3 = 146.832;
const A3 = 220.0;
const E4 = 329.628;
const G4 = 391.995;
const F3 = 174.614;
const C4 = 261.626;
const A4 = 440.0;

/**
 * A stack of sines with independent slow detune, summed and lowpassed.
 *
 * The detune is what stops this from sounding like a test tone: each partial drifts by a few cents
 * on its own very slow LFO, so the stack beats against itself at a rate that never quite repeats.
 */
const tonal = (total, freqs, { detune = 0.5, drift = 0.037, lowpass = 2400, gain = 1, spread = 1 }) => {
  const buffer = new Float32Array(total * 2);
  const left = makeLowpass(lowpass);
  const right = makeLowpass(lowpass);
  const phases = freqs.map(() => 0);
  const phasesR = freqs.map((_, i) => (i * 0.31) % 1);

  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    let l = 0;
    let r = 0;
    for (let f = 0; f < freqs.length; f++) {
      const cents = 1 + (Math.sin(t * TAU * (drift * (f + 1)) + f) * detune) / 1200;
      const step = (freqs[f] * cents) / RATE;
      phases[f] = (phases[f] + step) % 1;
      phasesR[f] = (phasesR[f] + step * (1 + 0.0002 * spread)) % 1;
      /** Amplitude falls with the partial index so the top of the stack never dominates. */
      const a = 1 / (1 + f * 0.75);
      l += Math.sin(phases[f] * TAU) * a;
      r += Math.sin(phasesR[f] * TAU) * a;
    }
    buffer[i * 2] = left(l * gain);
    buffer[i * 2 + 1] = right(r * gain);
  }
  return buffer;
};

/** Filtered noise with a slow amplitude wander. The room the film is in. */
const room = (total) => {
  const buffer = new Float32Array(total * 2);
  const nL = makeNoise(0x51f3a7);
  const nR = makeNoise(0x9c22e1);
  const lowL = makeLowpass(520);
  const lowR = makeLowpass(520);
  const highL = makeHighpass(60);
  const highR = makeHighpass(60);
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const wander = 0.7 + Math.sin(t * TAU * 0.043) * 0.2 + Math.sin(t * TAU * 0.017 + 1.1) * 0.1;
    buffer[i * 2] = highL(lowL(nL())) * wander;
    buffer[i * 2 + 1] = highR(lowR(nR())) * wander;
  }
  return buffer;
};

/**
 * The pulse: a mechanical downbeat at 100bpm.
 *
 * It is a body and a click — a 92Hz sine with a fast exponential decay for the weight, and a very
 * short band of filtered noise for the edge. There is no reverb tail on it. A dry pulse in a room
 * with no reverb is what a mechanism sounds like, and the film's subject is a mechanism.
 */
const pulse = (total, { period = 0.6, decay = 42, click = 0.35 } = {}) => {
  const buffer = new Float32Array(total * 2);
  const noise = makeNoise(0x2ba55d);
  const shape = makeHighpass(1600);
  const body = makeLowpass(180);
  const step = period * RATE;
  for (let i = 0; i < total; i++) {
    const since = (i % step) / RATE;
    const env = Math.exp(-since * decay);
    const tick = Math.sin(since * TAU * 92) * env;
    const edge = shape(noise()) * Math.exp(-since * 320) * click;
    const v = body(tick) * 1.6 + edge;
    buffer[i * 2] = v;
    buffer[i * 2 + 1] = v * 0.97;
  }
  return buffer;
};

/**
 * The rail tick: an eighth-note at the very top of the spectrum, panned narrow.
 *
 * This is the sound of the line the work travels on, and it is the only layer present in the first
 * sequence besides the drone. At -34dB it is under the threshold of conscious attention; what it
 * does is make the silence in the opening feel like a running machine rather than like a gap.
 */
const railTick = (total, { period = 0.3 } = {}) => {
  const buffer = new Float32Array(total * 2);
  const noise = makeNoise(0x7d10cf);
  const top = makeHighpass(5200);
  const step = period * RATE;
  for (let i = 0; i < total; i++) {
    const since = (i % step) / RATE;
    const v = top(noise()) * Math.exp(-since * 900);
    buffer[i * 2] = v;
    buffer[i * 2 + 1] = v * 0.6;
  }
  return buffer;
};

/** A high, slowly tremoloed cluster. Detail, not volume — used only where the frame is dense. */
const shimmer = (total) => {
  const buffer = tonal(total, [E4 * 2, G4 * 2, A4 * 2, D3 * 8], {
    detune: 1.6,
    drift: 0.11,
    lowpass: 9000,
    gain: 0.5,
    spread: 6,
  });
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const trem = 0.55 + Math.sin(t * TAU * 0.37) * 0.25 + Math.sin(t * TAU * 0.61 + 2.2) * 0.2;
    buffer[i * 2] *= trem;
    buffer[i * 2 + 1] *= trem * 0.94;
  }
  return buffer;
};

/* ---- one-shots ---------------------------------------------------------------------------------- */

/** A downward sine sweep with a noise transient. Placed on structural events, never as decoration. */
const impact = (fromHz, toHz, length, { noiseGain = 0.5, decay = 6 } = {}) => {
  const total = Math.floor(length * RATE);
  const buffer = new Float32Array(total * 2);
  const noise = makeNoise(0x4411aa);
  const low = makeLowpass(900);
  let phase = 0;
  for (let i = 0; i < total; i++) {
    const t = i / total;
    const env = Math.exp(-t * decay);
    const f = fromHz * Math.pow(toHz / fromHz, t);
    phase = (phase + f / RATE) % 1;
    const v = Math.sin(phase * TAU) * env + low(noise()) * env * env * noiseGain;
    buffer[i * 2] = v;
    buffer[i * 2 + 1] = v * 0.98;
  }
  return buffer;
};

/**
 * The stop tone.
 *
 * Two sines a quarter-tone apart, held for four seconds with no vibrato and no decay. The interval
 * is deliberately not a musical one: it is the only sound in the score that does not belong to the
 * harmony, which is what makes it read as a fault condition rather than as a chord change.
 */
const stopTone = (length) => {
  const total = Math.floor(length * RATE);
  const buffer = new Float32Array(total * 2);
  const low = makeLowpass(1800);
  const lowR = makeLowpass(1800);
  let p1 = 0;
  let p2 = 0;
  const f1 = 196.0;
  const f2 = 196.0 * Math.pow(2, 0.5 / 12);
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const env = smooth(0, 0.35, t) * (1 - smooth(length - 1.2, length, t));
    p1 = (p1 + f1 / RATE) % 1;
    p2 = (p2 + f2 / RATE) % 1;
    buffer[i * 2] = low(Math.sin(p1 * TAU) * 0.7 + Math.sin(p2 * TAU) * 0.5) * env;
    buffer[i * 2 + 1] = lowR(Math.sin(p1 * TAU) * 0.5 + Math.sin(p2 * TAU) * 0.7) * env;
  }
  return buffer;
};

/**
 * A struck tone: sine plus its own octave and twelfth, with the upper partials decaying first.
 *
 * Used three times in the film — on the approval, on the merge, and as the three notes of the close
 * — and nowhere else. It is the score's only warm sound and it is rationed on purpose.
 */
const bell = (freq, length, { gain = 1 } = {}) => {
  const total = Math.floor(length * RATE);
  const buffer = new Float32Array(total * 2);
  const partials = [
    { ratio: 1, decay: 1.6, amp: 1 },
    { ratio: 2, decay: 3.0, amp: 0.42 },
    { ratio: 3, decay: 4.6, amp: 0.2 },
    { ratio: 4.2, decay: 7.5, amp: 0.09 },
  ];
  const phases = partials.map(() => 0);
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    let v = 0;
    for (let p = 0; p < partials.length; p++) {
      const { ratio, decay, amp } = partials[p];
      phases[p] = (phases[p] + (freq * ratio) / RATE) % 1;
      v += Math.sin(phases[p] * TAU) * amp * Math.exp(-t * decay);
    }
    const strike = smooth(0, 0.004, t);
    buffer[i * 2] = v * gain * strike;
    buffer[i * 2 + 1] = v * gain * strike * 0.96;
  }
  return buffer;
};

/* ---- the arrangement ----------------------------------------------------------------------------
 *
 * Gains as functions of *master* time. Levels are set against each generator's own output, so the
 * coefficients differ by an order of magnitude between layers and none of them means anything on
 * its own.
 */

const LAYERS = {
  /** Present from the first frame to the last, at three different levels. */
  room: (t) =>
    0.055 * band(t, 0.3, at.split, 2.5, 1.4) +
    0.03 * band(t, at.split, STOPPED, 1.4, 0.05) +
    0.075 * gate(t, STOPPED, RELEASED) +
    0.03 * band(t, RELEASED, endOf('through'), 1.0, 1.4) +
    0.02 * band(t, at.close, at.close + 8.0, 1.4, 2.4),

  drone: (t) =>
    0.10 * band(t, 0.8, at.split, 3.0, 1.0) +
    0.20 * band(t, at.split, STOPPED, 2.0, 0.05) +
    /** The drone is the only thing that survives the stop. It does not even change level. */
    0.20 * gate(t, STOPPED, RELEASED) +
    0.22 * band(t, RELEASED, at.consent, 0.8, 1.2) +
    0.15 * band(t, at.consent, endOf('through'), 1.2, 1.4) +
    0.24 * band(t, at.close, at.close + 7.0, 1.2, 2.8),

  /** The undecided harmony. Stacked fifths and seconds, no third anywhere in it. */
  padOpen: (t) =>
    0.28 * band(t, at.split + 1.4, STOPPED, 2.6, 0.05) +
    0.26 * band(t, RELEASED, at.consent, 1.2, 1.6) +
    0.20 * band(t, at.consent + 1.0, APPROVED, 2.0, 0.9),

  /** The resolution. Every frame of this layer is after the approval. */
  padWarm: (t) =>
    0.30 * band(t, APPROVED, endOf('through'), 1.6, 1.6) +
    0.26 * band(t, at.close + 1.0, at.close + 8.4, 2.0, 2.2),

  pulse: (t) =>
    0.16 * band(t, at.split + 2.0, at.isolation, 2.8, 0.6) +
    0.22 * band(t, at.isolation, STOPPED, 0.8, 0.04) +
    /** Silent from the stop until the release, and silent again through the whole consent beat. */
    0.20 * band(t, RELEASED, at.consent, 0.5, 0.9) +
    0.24 * band(t, at.through, at.close, 1.2, 1.0),

  railTick: (t) =>
    0.055 * band(t, 2.0, at.split, 2.0, 0.8) +
    0.04 * band(t, at.split, STOPPED, 1.2, 0.04) +
    0.045 * band(t, RELEASED, endOf('through'), 1.0, 1.4),

  shimmer: (t) =>
    0.10 * band(t, at.isolation + 1.5, STOPPED, 2.4, 0.05) +
    0.09 * band(t, at.consent + 2.0, endOf('through'), 2.4, 1.6) +
    0.14 * band(t, at.close + 2.4, at.close + 8.6, 2.0, 2.2),
};

/**
 * One-shots, in master time.
 *
 * Every one of them is on a structural event and there are no others. `stop` is the largest gesture
 * in the score and it is placed a tenth of a second *after* the check fails on screen, not on it —
 * a sound that lands exactly with a cut is heard as part of the edit; one that lands just behind it
 * is heard as a consequence of what was shown.
 */
const ONESHOTS = [
  { voice: 'riser', at: at.split - 1.4, gain: 0.24 },
  { voice: 'mark', at: at.isolation, gain: 0.30 },
  { voice: 'stop', at: STOPPED + 0.1, gain: 0.42 },
  { voice: 'release', at: RELEASED, gain: 0.34 },
  { voice: 'approve', at: APPROVED, gain: 0.30 },
  { voice: 'commit', at: at.through + seconds(210), gain: 0.34 },
  /** The close figure: D, A, D an octave up. The only melodic phrase in seventy-eight seconds. */
  { voice: 'closeD', at: at.close + 2.6, gain: 0.26 },
  { voice: 'closeA', at: at.close + 3.9, gain: 0.22 },
  { voice: 'closeD2', at: at.close + 5.4, gain: 0.28 },
];

const VOICES = {
  riser: () => {
    /** Noise through a rising bandpass. Two and a half seconds, and it never gets loud. */
    const length = 2.5;
    const total = Math.floor(length * RATE);
    const buffer = new Float32Array(total * 2);
    const noise = makeNoise(0x1f77bb);
    let low = 0;
    for (let i = 0; i < total; i++) {
      const t = i / total;
      const cutoff = 220 + Math.pow(t, 2.4) * 5200;
      const a = 1 - Math.exp((-TAU * cutoff) / RATE);
      const x = noise();
      low += a * (x - low);
      const v = (x - low) * Math.pow(t, 1.6) * 0.8;
      buffer[i * 2] = v;
      buffer[i * 2 + 1] = v * 0.9;
    }
    return buffer;
  },
  mark: () => impact(180, 41, 2.2, { noiseGain: 0.35, decay: 5 }),
  stop: () => stopTone(4.1),
  release: () => impact(96, 220, 1.1, { noiseGain: 0.12, decay: 7 }),
  approve: () => bell(D3 * 1.5, 3.4, { gain: 0.9 }),
  commit: () => bell(D3, 3.8, { gain: 0.85 }),
  closeD: () => bell(D3, 4.2),
  closeA: () => bell(A3, 4.0),
  closeD2: () => bell(D3 * 2, 5.6),
};

/* ---- render -------------------------------------------------------------------------------------- */

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

/** Soft-knee limiter. Keeps the impacts from squaring off the master without pumping the pads. */
const limit = (x) => {
  const threshold = 0.8;
  const magnitude = Math.abs(x);
  if (magnitude <= threshold) return x;
  const over = magnitude - threshold;
  return Math.sign(x) * Math.min(0.995, threshold + over / (1 + (over / (1 - threshold)) * 2.4));
};

const voiceCache = new Map();
const voiceFor = (name) => {
  if (!voiceCache.has(name)) voiceCache.set(name, VOICES[name]());
  return voiceCache.get(name);
};

const render = (cutId, file) => {
  const mapper = buildMapper(cutId);
  const total = Math.floor(mapper.length * RATE);

  /** The continuous layers, generated once per cut length in output time. */
  const beds = {
    room: room(total),
    drone: tonal(total, [D1, A1, D2, D2 * 1.5], { detune: 0.8, drift: 0.021, lowpass: 320, gain: 0.9 }),
    padOpen: tonal(total, [D3, A3, E4, G4], { detune: 2.2, drift: 0.053, lowpass: 1700, gain: 0.6, spread: 3 }),
    padWarm: tonal(total, [F3, C4, A4, D3 * 2], { detune: 1.4, drift: 0.041, lowpass: 2600, gain: 0.6, spread: 4 }),
    pulse: pulse(total),
    railTick: railTick(total),
    shimmer: shimmer(total),
  };

  const shots = shotsFor(cutId).map((shot) => ({
    ...shot,
    start: Math.floor(shot.at * RATE),
    buffer: voiceFor(shot.voice),
  }));

  const out = new Float32Array(total * 2);
  const entries = Object.entries(LAYERS);

  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const m = mapper.toMaster(t);

    let left = 0;
    let right = 0;

    for (const [name, gainOf] of entries) {
      const g = gainOf(m);
      if (g <= 0.0004) continue;
      const bed = beds[name];
      left += bed[i * 2] * g;
      right += bed[i * 2 + 1] * g;
    }

    for (const shot of shots) {
      const pos = i - shot.start;
      if (pos < 0 || pos * 2 + 1 >= shot.buffer.length) continue;
      left += shot.buffer[pos * 2] * shot.gain;
      right += shot.buffer[pos * 2 + 1] * shot.gain;
    }

    /** Master fades. The loop gets short symmetrical ones so its wrap point is inaudible. */
    const inFade = smooth(0, cutId === 'loop' ? 0.7 : 1.4, t);
    const outFade = 1 - smooth(mapper.length - (cutId === 'loop' ? 0.7 : 2.8), mapper.length, t);
    const g = inFade * outFade;

    out[i * 2] = limit(left * g);
    out[i * 2 + 1] = limit(right * g);
  }

  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const normalise = 0.88 / Math.max(1e-6, peak);

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
      // No `loudnorm`. Its LRA target compresses exactly the dynamics this arrangement exists to
      // create — the four-second stop measures 14dB below the sequence around it, and a loudness
      // range target would pull it back up to within four. Levels are set by the arrangement, the
      // peak by the limiter above, and the delivered mix is normalised once, later, against the
      // finished video by `normalize-audio.mjs`.
      '-af', 'highpass=f=24,lowpass=f=17800,alimiter=limit=0.97:level=disabled',
      '-ar', String(RATE), '-ac', '2',
      '-codec:a', 'libmp3lame', '-b:a', '320k',
      mp3,
    ],
    { stdio: 'inherit' },
  );
  if (encode.status !== 0) throw new Error(`ffmpeg failed for ${file}`);

  console.log(`${file}: ${mapper.length.toFixed(3)}s, ${shots.length} one-shots -> ${path.relative(ROOT, mp3)}`);
};

console.log(
  `stop at ${STOPPED.toFixed(2)}s · release at ${RELEASED.toFixed(2)}s · approval at ${APPROVED.toFixed(2)}s`,
);

render('master', 'paralith-gate-score');
render('sixty', 'paralith-gate-score-60');
render('thirty', 'paralith-gate-score-30');
render('teaser', 'paralith-gate-score-15');
render('loop', 'paralith-gate-score-loop');

console.log(
  `\ncut lengths: master ${CUT_FRAMES.master}f, 60s ${CUT_FRAMES.sixty}f, 30s ${CUT_FRAMES.thirty}f, teaser ${CUT_FRAMES.teaser}f, loop ${CUT_FRAMES.loop}f`,
);
