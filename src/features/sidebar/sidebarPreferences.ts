/** Sidebar dimensional contract, shared by the resize handle, store, and Settings fallback. */
export const SIDEBAR_MIN_WIDTH = 260
export const SIDEBAR_MAX_WIDTH = 360
export const SIDEBAR_DEFAULT_WIDTH = 300
export const SIDEBAR_COLLAPSED_WIDTH = 52

/** Clamp any proposed width into the supported expanded range. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}
