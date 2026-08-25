/**
 * A deterministic pseudo-random source.
 *
 * Every visual on this site is generated rather than authored, and every one of
 * them has to draw the same thing on the server as in the browser — so nothing
 * anywhere calls Math.random().
 *
 * It lives in its own module, with no "use client" above it, because the
 * generators that use it run on both sides of the boundary.
 */
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
