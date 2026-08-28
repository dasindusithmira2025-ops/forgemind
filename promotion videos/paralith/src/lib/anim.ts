import { Easing, interpolate, spring } from "remotion";

export const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);
export const EASE_IN = Easing.bezier(0.55, 0, 1, 0.45);

/** 0 -> 1 ramp starting at `start`, lasting `duration` frames. */
export const ramp = (
  frame: number,
  start: number,
  duration: number,
  easing = EASE_OUT,
): number =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

/** 1 while inside [inAt, outAt], with eased fade edges. */
export const window_ = (
  frame: number,
  inAt: number,
  outAt: number,
  fade = 14,
): number => ramp(frame, inAt, fade) * (1 - ramp(frame, outAt, fade, EASE_IN_OUT));

export const track = (frame: number, fps: number, delay: number, damping = 200) =>
  spring({ frame, fps, delay, config: { damping, mass: 1, stiffness: 110 } });

/** Soft overshoot spring for physical, non-cartoonish motion. */
export const settle = (frame: number, fps: number, delay: number) =>
  spring({
    frame,
    fps,
    delay,
    config: { damping: 26, mass: 0.9, stiffness: 130 },
  });

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Deterministic pseudo-random in [0,1) from an integer seed. */
export const rand = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
