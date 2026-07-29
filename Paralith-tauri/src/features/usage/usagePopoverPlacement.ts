/**
 * Viewport placement for the subscription-usage roster.
 *
 * The roster is anchored to a chip in the bottom status bar, so it must open upward and can never be
 * offset with a CSS transform: its pop-in animation ends on `transform: none`, and animation
 * declarations outrank inline styles, so a transform-based offset is silently dropped and the panel
 * renders downward past the window bottom, behind the Windows taskbar. Placement therefore returns
 * the popover's own top-left corner.
 */

export const POPOVER_WIDTH = 392
export const VIEWPORT_MARGIN = 12
const ANCHOR_GAP = 8

export type PopoverPosition = { left: number; top: number }

/** Prefer the gap above the trigger, flip below when it is too short, and clamp to the viewport. */
export function placeUsagePopover(
  anchor: { top: number; bottom: number; right: number },
  viewport: { width: number; height: number },
  size: { width: number; height: number },
): PopoverPosition {
  const maxLeft = viewport.width - size.width - VIEWPORT_MARGIN
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN)
  const above = anchor.top - ANCHOR_GAP - size.height
  const preferred = above >= VIEWPORT_MARGIN ? above : anchor.bottom + ANCHOR_GAP
  return {
    left: Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - size.width, maxLeft)),
    top: Math.max(VIEWPORT_MARGIN, Math.min(preferred, maxTop)),
  }
}
