/**
 * Single source of truth for every docking-canvas interaction constant. Components and
 * controllers must import from here rather than hardcoding thresholds, so tuning the feel of
 * the docking environment happens in exactly one place.
 */

export const CANVAS_CONSTANTS = {
  /** Pointer travel (physical px) before a press on a pane header becomes a drag. */
  dragActivationThreshold: 6,
  /** Distance (px) from a canvas edge at which the edge-snap preview activates. */
  canvasEdgeSnapThreshold: 20,
  /** Distance (px) at which magnetic alignment guides engage against a nearby edge. */
  magneticAlignThreshold: 10,
  /**
   * A snap zone, once active, only releases when the pointer moves this many px past the
   * activation boundary. Larger than activation → hysteresis, preventing zone flicker.
   */
  snapReleaseThreshold: 9,

  /** Floating pane minimums (px). */
  minFloatingWidth: 360,
  minFloatingHeight: 220,

  /** Docked pane minimums (px). Used to guard split resize and dock insertion. */
  minDockedWidth: 280,
  minDockedHeight: 180,

  /** Fraction of a target pane's short side that the five-zone dock edges occupy. */
  dockEdgeZoneFraction: 0.28,

  /** Settle animation after a committed drop / snap. */
  settleAnimationMs: 150,
  reducedMotionSettleMs: 0,

  /** Throttle interval (ms) for xterm fit + PTY resize while actively resizing a pane. */
  resizeFitThrottleMs: 90,

  /** Default size (fraction of canvas) for a pane freshly floated onto empty canvas. */
  defaultFloatWidthFraction: 0.42,
  defaultFloatHeightFraction: 0.46,

  /** Minimum on-screen slice of a floating header that must always remain reachable (px). */
  minReachableHeaderPx: 48,

  /** Keyboard nudge step for floating panes (px). */
  keyboardNudgePx: 24,

  /** z-index values are renormalised to 1..N once the top index exceeds this. */
  zIndexNormalizeCeiling: 100_000,
} as const

export type CanvasConstants = typeof CANVAS_CONSTANTS

/** Current persisted schema version for {@link WorkspaceCanvasLayout}. */
export const WORKSPACE_CANVAS_LAYOUT_VERSION = 2
