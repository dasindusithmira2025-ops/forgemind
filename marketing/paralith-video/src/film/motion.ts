import { Easing, interpolate } from 'remotion';

/**
 * The film's motion vocabulary.
 *
 * There is exactly one easing curve, and it is not chosen for the film: `cubic-bezier(.16, 1,
 * .3, 1)` is `--ease-out` from PARALITH's own stylesheet, the curve every popover, pane settle
 * and hover in the product already moves on. Cutting the film on the product's curve is why the
 * camera moves feel like they belong to the same object as the interface inside them.
 *
 * Everything here is deterministic. Remotion renders frames out of order and in parallel, so any
 * motion that depends on wall-clock time or accumulated state renders differently in the studio
 * than in the encode.
 */

/** `--ease-out` from `index.css`. */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** A softer curve for camera moves, which read as mechanical on a curve this sharp. */
export const EASE_CAMERA = Easing.bezier(0.33, 0, 0.15, 1);

/**
 * 0 to 1 across `[from, from + duration)`, eased and clamped. A zero-length ramp is a step, which
 * `interpolate` will not accept as an input range — so it is answered directly.
 */
export const ramp = (frame: number, from: number, duration: number, easing = EASE): number => {
  if (duration <= 0) return frame >= from ? 1 : 0;
  return interpolate(frame, [from, from + duration], [0, 1], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

/** Rises, holds, falls. The shape of every piece of copy in the film. */
export const hold = (
  frame: number,
  { from, rise = 22, stay, fall = 16 }: { from: number; rise?: number; stay: number; fall?: number },
): number => Math.min(ramp(frame, from, rise), 1 - ramp(frame, from + rise + stay, fall, Easing.linear));

/** Linear interpolation with clamped ends. */
export const track = (frame: number, range: readonly [number, number], to: readonly [number, number], easing = EASE_CAMERA) =>
  interpolate(frame, range as [number, number], to as [number, number], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/**
 * The camera.
 *
 * Given a point in the 1440x900 window and a magnification, returns the transform that puts that
 * point in the middle of the frame. Scenes name what they are looking at — the Fleet Bar, a pane
 * header — rather than solving for offsets, so a change to the window layout moves the camera
 * with it instead of silently mis-aiming it.
 */
export interface Shot {
  scale: number;
  offset: { x: number; y: number };
}

export const shotOn = (
  focus: { x: number; y: number },
  scale: number,
  frame: { width: number; height: number },
): Shot => ({
  scale,
  offset: {
    x: frame.width / 2 - focus.x * scale,
    y: frame.height / 2 - focus.y * scale,
  },
});

/** Interpolates between two shots. */
export const between = (a: Shot, b: Shot, t: number): Shot => ({
  scale: a.scale + (b.scale - a.scale) * t,
  offset: {
    x: a.offset.x + (b.offset.x - a.offset.x) * t,
    y: a.offset.y + (b.offset.y - a.offset.y) * t,
  },
});

/**
 * Keeps the window covering the frame once it is large enough to.
 *
 * Without this, aiming at something near an edge of the window — the Fleet Bar lives 20px from
 * its top — centres that element and leaves half the frame as empty black, because there is no
 * window above it to show. The result looks like a floating panel rather than a magnified screen.
 * Clamping trades the exact centring for the thing a viewer actually expects: when you push into
 * a window, the window fills the view and the target sits where it really is, near the top.
 *
 * When the scaled window is smaller than the frame in an axis it is centred on that axis instead,
 * so wide shots are unaffected.
 */
export const contain = (shot: Shot, window: { width: number; height: number }, frame: { width: number; height: number }): Shot => {
  const scaled = { width: window.width * shot.scale, height: window.height * shot.scale };
  const axis = (offset: number, size: number, extent: number) =>
    size >= extent ? Math.min(0, Math.max(extent - size, offset)) : (extent - size) / 2;

  return {
    scale: shot.scale,
    offset: {
      x: axis(shot.offset.x, scaled.width, frame.width),
      y: axis(shot.offset.y, scaled.height, frame.height),
    },
  };
};
