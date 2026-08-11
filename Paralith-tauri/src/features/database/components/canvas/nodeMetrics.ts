/**
 * Shared table-card geometry constants. `TableNode` and the layout inputs (`DiagramSection`,
 * `SchemaCanvas`) must agree on these or the box the layout engine reserves for a table drifts
 * from what actually renders — the exact bug this module exists to prevent: a table with many
 * columns rendered taller than its reserved slot, visually overlapping the node laid out below it.
 *
 * Layout runs once per schema fingerprint and is reused across every zoom level (UI-SPEC.md §3.1 —
 * positions must not jump when the user zooms), so the reserved height for a node must be safe for
 * the *tallest* tier it can ever render at, not the tier currently on screen. `near` shows the most
 * rows, so `estimateTableNodeHeight` always sizes for `near`'s row cap — at far/medium zoom the
 * rendered card is shorter than its reserved slot, which leaves harmless whitespace; the reverse
 * (rendering taller than reserved) is the collision this fixes.
 *
 * Row/header pixel constants intentionally use a generous fixed estimate rather than reading CSS
 * custom properties (`--row-h`, `--ui-scale`) at layout time — layout is computed off the render
 * path from plain data, before any node has mounted, so there is nothing to measure yet. The
 * constants are sized above the "roomy" density theme's actual metrics with headroom, so a taller
 * render (larger density/ui-scale) still fits inside the reserved box.
 */

export const NODE_WIDTH = 220
export const DOMAIN_NODE_WIDTH = 200

/** Rows shown at medium LOD (PK/FK plus a bounded number of scalar fields) — mission §1/§2. */
export const MEDIUM_ROW_CAP = 7
/** Rows shown at near LOD. Still bounded (mission §2: "do not expose ugly raw ORM declaration
 * strings" / inspector owns exhaustive detail) so a 40-column table never grows a card without
 * limit — it collapses into "+N more fields" like every other tier. */
export const NEAR_ROW_CAP = 16

const HEADER_H = 40
const ROW_H = 32
const MORE_ROW_H = 24
const VERTICAL_PADDING = 10
/** Fixed height of the LOD0 "compact" card (name + relation count only). */
export const COMPACT_NODE_HEIGHT = 40

function estimateHeightForRowCount(shownRows: number, hasMore: boolean): number {
  return HEADER_H + shownRows * ROW_H + (hasMore ? MORE_ROW_H : 0) + VERTICAL_PADDING
}

/** Worst-case rendered height for a table with `columnCount` columns, safe across every LOD tier. */
export function estimateTableNodeHeight(columnCount: number): number {
  const shown = Math.min(columnCount, NEAR_ROW_CAP)
  return estimateHeightForRowCount(shown, columnCount > shown)
}
