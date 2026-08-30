import { normalizeSplitSizes } from './geometryEngine'
import { dockedPaneIds, normalizeSplitTree } from './layoutOperations'
import type { DockedLayoutNode, WorkspaceCanvasLayout } from './canvasTypes'

/**
 * Deterministic workspace compositions.
 *
 * The docking canvas can express any tree; what it lacked was an opinion. Splitting N panes
 * evenly turns six live agents into six identical rectangles, which says the six are equally
 * important — they never are. Each preset here encodes one working shape instead: a lead
 * context that gets the room, and supporting contexts sized to what they actually show.
 *
 * Every function is pure (ordered pane ids → tree) and independent of pixels, so a preset
 * composes at any window size and the same input always yields the same layout.
 */

export type LayoutPresetId = 'focus' | 'pair' | 'workbench' | 'review' | 'swarm' | 'tidy'

export interface LayoutPreset {
  id: LayoutPresetId
  label: string
  description: string
  /** Smallest pane count at which the preset produces a shape distinct from `focus`. */
  minPanes: number
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  { id: 'tidy', label: 'Tidy', description: 'Rearrange into the best shape for this many panes', minPanes: 1 },
  { id: 'focus', label: 'Focus', description: 'One lead context, supporting panes in a rail', minPanes: 1 },
  { id: 'pair', label: 'Pair', description: 'Two columns of equal weight', minPanes: 2 },
  { id: 'workbench', label: 'Workbench', description: 'Primary agent beside a stack of short-output panes', minPanes: 2 },
  { id: 'review', label: 'Review', description: 'Implementation on top, review surfaces beneath', minPanes: 2 },
  { id: 'swarm', label: 'Swarm', description: 'Dense composition for many concurrent agents', minPanes: 3 },
]

const pane = (paneId: string): DockedLayoutNode => ({ type: 'pane', paneId })

/** Build a split, collapsing the degenerate single-child case its callers keep producing. */
function split(direction: 'horizontal' | 'vertical', children: DockedLayoutNode[], sizes: number[]): DockedLayoutNode {
  if (children.length === 1) return children[0]
  return { type: 'split', direction, sizes: normalizeSplitSizes(sizes, children.length), children }
}

/** Stack panes along one axis, sharing the extent equally. */
function stack(direction: 'horizontal' | 'vertical', paneIds: string[]): DockedLayoutNode {
  return split(direction, paneIds.map(pane), paneIds.map(() => 100 / paneIds.length))
}

/**
 * Deal panes into `columns` roughly equal groups, preserving order. Used by the dense presets so
 * an odd pane count leans the extra pane into the earlier (larger) column rather than orphaning
 * a lone pane in a thin one.
 */
function deal(paneIds: string[], columns: number): string[][] {
  const groups: string[][] = Array.from({ length: columns }, () => [])
  const perGroup = Math.ceil(paneIds.length / columns)
  paneIds.forEach((paneId, index) => {
    groups[Math.min(columns - 1, Math.floor(index / perGroup))].push(paneId)
  })
  return groups.filter((group) => group.length > 0)
}

/**
 * Focus: the lead pane takes the room, everything else becomes a narrow right-hand rail. This is
 * the shape for "one agent is doing the work and the rest are context I glance at".
 */
function focusLayout(paneIds: string[]): DockedLayoutNode {
  const [lead, ...rest] = paneIds
  if (rest.length === 0) return pane(lead)
  return split('vertical', [pane(lead), stack('horizontal', rest)], [74, 26])
}

/** Pair: two equal columns. Extra panes stack inside whichever column keeps the split even. */
function pairLayout(paneIds: string[]): DockedLayoutNode {
  const [left, right] = deal(paneIds, 2)
  if (!right) return stack('horizontal', left)
  return split('vertical', [stack('horizontal', left), stack('horizontal', right)], [50, 50])
}

/**
 * Workbench: a wide primary column for the agent being read, and a right column of short-output
 * panes (shells, test runners) that only ever need a handful of lines each.
 */
function workbenchLayout(paneIds: string[]): DockedLayoutNode {
  const [lead, ...rest] = paneIds
  if (rest.length === 0) return pane(lead)
  return split('vertical', [pane(lead), stack('horizontal', rest)], [62, 38])
}

/**
 * Review: the implementation pane spans the full width on top; the review surfaces share a
 * shorter row beneath it. Reading a diff wants width far more than it wants height.
 */
function reviewLayout(paneIds: string[]): DockedLayoutNode {
  const [lead, ...rest] = paneIds
  if (rest.length === 0) return pane(lead)
  return split('horizontal', [pane(lead), stack('vertical', rest)], [58, 42])
}

/**
 * Swarm: many concurrent agents, still readable. One lead column keeps the agent under active
 * supervision legible; the remainder fill a two-column grid at equal weight. Asymmetry is what
 * stops eight agents from becoming eight anonymous cells.
 */
function swarmLayout(paneIds: string[]): DockedLayoutNode {
  const [lead, ...rest] = paneIds
  if (rest.length === 0) return pane(lead)
  if (rest.length <= 2) return split('vertical', [pane(lead), stack('horizontal', rest)], [56, 44])
  const columns = deal(rest, 2).map((group) => stack('horizontal', group))
  return split('vertical', [pane(lead), split('vertical', columns, columns.map(() => 100 / columns.length))], [42, 58])
}

/**
 * Tidy: pick the preset that suits the current pane count. This is the single control most
 * workspaces need — the user rarely wants "review" by name, they want the mess cleaned up.
 */
export function tidyPresetFor(paneCount: number): Exclude<LayoutPresetId, 'tidy'> {
  if (paneCount <= 1) return 'focus'
  if (paneCount === 2) return 'pair'
  if (paneCount === 3) return 'workbench'
  if (paneCount === 4) return 'review'
  return 'swarm'
}

/** Compose an ordered pane list into a preset's docked tree. Returns null for an empty list. */
export function buildPresetTree(preset: LayoutPresetId, paneIds: string[]): DockedLayoutNode | null {
  const ids = paneIds.filter((id, index) => id && paneIds.indexOf(id) === index)
  if (ids.length === 0) return null
  const resolved = preset === 'tidy' ? tidyPresetFor(ids.length) : preset
  switch (resolved) {
    case 'focus':
      return focusLayout(ids)
    case 'pair':
      return pairLayout(ids)
    case 'workbench':
      return workbenchLayout(ids)
    case 'review':
      return reviewLayout(ids)
    case 'swarm':
      return swarmLayout(ids)
  }
}

/**
 * Apply a preset to a whole layout. Panes keep their identity — this only rewrites placement, so
 * every terminal stays mounted and no PTY is touched. The active pane is promoted to lead so
 * "Focus" focuses what the user is actually looking at, and floating panes are folded back into
 * the tree (the presets describe a complete composition, not a partial one).
 */
export function applyLayoutPreset(layout: WorkspaceCanvasLayout, preset: LayoutPresetId): WorkspaceCanvasLayout {
  const ordered = orderPanesForPreset(layout)
  const dockedRoot = normalizeSplitTree(buildPresetTree(preset, ordered))
  if (!dockedRoot) return layout
  return {
    ...layout,
    dockedRoot,
    floatingPanes: [],
    // A preset is an explicit request to see the whole composition; staying maximized would hide it.
    maximizedPaneId: undefined,
  }
}

/**
 * Pane order fed to a preset: the active pane leads, then the remaining docked panes in their
 * existing left-to-right / top-to-bottom order, then any floating panes. Preserving tree order
 * for the tail means Tidy reads as "straighten this up", not "shuffle my workspace".
 */
export function orderPanesForPreset(layout: WorkspaceCanvasLayout): string[] {
  const docked = dockedPaneIds(layout.dockedRoot)
  const floating = layout.floatingPanes.map((item) => item.paneId)
  const all = [...docked, ...floating.filter((id) => !docked.includes(id))]
  const active = layout.activePaneId
  if (!active || !all.includes(active)) return all
  return [active, ...all.filter((id) => id !== active)]
}
