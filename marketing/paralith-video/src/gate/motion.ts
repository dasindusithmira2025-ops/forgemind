import { interpolate } from 'remotion';

/**
 * The gate film's motion vocabulary.
 *
 * Four curves, and a rule about which one is allowed where. The rule is what keeps seventy-eight
 * seconds of straight-line travel from reading as a slideshow:
 *
 * - **`glide`** moves the world. It is the only easing the camera and the rail ever use, and it is
 *   asymmetric — slow out of rest, and then a very long tail into the next rest, so a move settles
 *   for roughly twice as long as it takes off. Symmetric easing makes a camera feel operated by a
 *   machine; this one feels operated by someone who knows where they are going.
 * - **`snap`** moves state. A check turning green, a lane stopping, a gate latching. It is nearly
 *   linear with a hard finish, because a state change that eases out looks like it is unsure.
 * - **`hold`** is the copy envelope: rise, stay, fall, on opacity.
 * - **`breathe`** is the only loop in the film, for things that idle rather than progress.
 */

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 across `[from, from + length]`, unrounded. */
export const ramp = (frame: number, from: number, length: number): number =>
  interpolate(frame, [from, from + Math.max(1, length)], [0, 1], clamp);

/**
 * The camera curve. A quintic ease-out with a small ease-in — 12% of the move is spent taking off
 * and the remaining 88% arriving.
 */
export const glide = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  const takeoff = x < 0.12 ? (x / 0.12) * 0.12 * 0.5 : 0;
  const body = 1 - Math.pow(1 - x, 5);
  return Math.max(body, takeoff);
};

/** `glide`, applied to a frame window. */
export const travel = (frame: number, from: number, length: number): number =>
  glide(ramp(frame, from, length));

/**
 * State change. Reaches 0.94 in the first third of its window and creeps the rest, which reads as
 * a thing landing rather than a thing arriving.
 */
export const snap = (frame: number, from: number, length = 12): number => {
  const x = ramp(frame, from, length);
  return 1 - Math.pow(1 - x, 3.2);
};

/** Rise, stay, fall — the copy and label envelope. */
export const hold = (
  frame: number,
  { from, rise = 16, stay, fall = 16 }: { from: number; rise?: number; stay: number; fall?: number },
): number =>
  interpolate(
    frame,
    [from, from + rise, from + rise + stay, from + rise + stay + fall],
    [0, 1, 1, 0],
    clamp,
  );

/** A slow sine, for idle states. `period` in frames. */
export const breathe = (frame: number, period = 150, depth = 0.14): number =>
  1 - depth + Math.sin((frame / period) * Math.PI * 2) * depth;

/**
 * A deterministic 0→1 hash. Every "random" value in the film comes from here keyed by a stable
 * string, so a re-render is frame-identical and a 4K pass matches its 1080p proof exactly.
 */
export const noise = (key: string): number => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
};

/** True once `frame` has passed `at`. Reads better than the inline comparison at call sites. */
export const past = (frame: number, at: number): boolean => frame >= at;
