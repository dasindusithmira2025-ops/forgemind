import { Easing, interpolate, spring } from 'remotion';

export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

export const progress = (frame: number, from: number, duration: number) =>
  clamp((frame - from) / duration);

export const ease = (frame: number, from: number, duration: number) =>
  interpolate(frame, [from, from + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });

export const fadeWindow = (
  frame: number,
  duration: number,
  fadeIn = 24,
  fadeOut = 24,
) =>
  interpolate(frame, [0, fadeIn, duration - fadeOut, duration], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

export const physical = (frame: number, fps: number, delay = 0) =>
  spring({
    fps,
    frame: Math.max(0, frame - delay),
    config: { damping: 26, stiffness: 140, mass: 0.9, overshootClamping: true },
  });

export const seeded = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
