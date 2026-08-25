import { create } from 'zustand'
import { isSurfaceKind, type SurfaceKind } from './surfaceRegistry'

/**
 * State for the docked Surface Workspace panel that sits beside the terminal canvas: a tab strip of
 * open tool surfaces (Files, Browser, Source Control, Agents), plus panel visibility/size. Kept in a
 * standalone store (not React component state) for two reasons:
 *   1. The terminal canvas must never remount when the panel opens/closes/resizes, so panel state
 *      cannot live in a component that also owns the canvas subtree.
 *   2. It is decoupled from any one screen so a future detached native window can host the same
 *      panel by reading the same per-workspace record.
 *
 * State is scoped and persisted per Workspace: switching Workspaces restores that Workspace's own
 * panel visibility, width and open tabs (independently of each surface's own internal state, e.g.
 * open editor tabs or browser URL, which live in their own stores).
 *
 * Every registered kind is currently a singleton, so a surface's stable identity is just its kind —
 * see `surfaceRegistry.ts` for why. `surfaces` is the open tab order; `activeSurface` is the visible
 * tab and is always a member of `surfaces` (or undefined when there are none, showing the chooser).
 */
export type { SurfaceKind }

const MIN_WIDTH = 320
const MAX_WIDTH = 1100
const DEFAULT_WIDTH = 520

export interface WorkspacePanelState {
  workspaceId: string
  /** Once the panel has been opened it stays mounted (hidden while closed) so surface state —
   * Monaco models, browser URL, scroll positions — survives a collapse. */
  mounted: boolean
  open: boolean
  width: number
  /** Temporarily fills the whole workspace, overlaying the still-mounted terminal canvas. */
  maximized: boolean
  surfaces: SurfaceKind[]
  activeSurface?: SurfaceKind

  init: (workspaceId: string) => void
  openPanel: () => void
  closePanel: () => void
  toggle: () => void
  toggleMaximized: () => void
  setWidth: (width: number) => void
  /** Opens a surface, or focuses it if already open (singleton enforcement lives here, not just in
   * the UI, so any caller — the picker, a future "open in right panel" action elsewhere — gets it
   * for free). */
  openSurface: (kind: SurfaceKind) => void
  focusSurface: (kind: SurfaceKind) => void
  closeSurface: (kind: SurfaceKind) => void
  reorderSurface: (kind: SurfaceKind, toIndex: number) => void
}

interface Persisted {
  open: boolean
  width: number
  maximized: boolean
  surfaces: SurfaceKind[]
  activeSurface?: SurfaceKind
}

function persistKey(workspaceId: string): string {
  return `paralith.toolpanel.${workspaceId}`
}

export function clampPanelWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))
}

/** Normalizes and validates persisted (or legacy) shapes so a corrupted/outdated record can never
 * brick the panel: unknown kinds are dropped, duplicates are collapsed, and an invalid active id
 * falls back to the first remaining surface. */
function normalize(parsed: Record<string, unknown>): Persisted {
  const width = clampPanelWidth(typeof parsed.width === 'number' ? parsed.width : DEFAULT_WIDTH)
  const open = parsed.open === true
  const maximized = parsed.maximized === true

  // Legacy single-tool shape (`{ tool: 'browser' }`) migrates to a one-item tab list.
  const rawSurfaces = Array.isArray(parsed.surfaces)
    ? parsed.surfaces
    : isSurfaceKind(parsed.tool) ? [parsed.tool] : []
  const surfaces = [...new Set(rawSurfaces.filter(isSurfaceKind))]

  const rawActive = parsed.activeSurface ?? parsed.tool
  const activeSurface = isSurfaceKind(rawActive) && surfaces.includes(rawActive) ? rawActive : surfaces[0]

  return { open, width, maximized: open ? maximized : false, surfaces, activeSurface }
}

function loadPersisted(workspaceId: string): Persisted | undefined {
  try {
    const raw = localStorage.getItem(persistKey(workspaceId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return normalize(parsed)
  } catch {
    return undefined
  }
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
function savePersisted(state: WorkspacePanelState): void {
  if (!state.workspaceId) return
  const snapshot: Persisted = {
    open: state.open,
    width: state.width,
    maximized: state.maximized,
    surfaces: state.surfaces,
    activeSurface: state.activeSurface,
  }
  const key = persistKey(state.workspaceId)
  // Debounced: resizing must not thrash localStorage on every pointer frame.
  const existing = saveTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    saveTimers.delete(key)
    try {
      localStorage.setItem(key, JSON.stringify(snapshot))
    } catch {
      /* localStorage is a best-effort UI cache; never block the workspace on it */
    }
  }, 200)
  saveTimers.set(key, timer)
}

export const useWorkspacePanelStore = create<WorkspacePanelState>((set, get) => {
  const commit = () => savePersisted(get())
  return {
    workspaceId: '',
    mounted: false,
    open: false,
    width: DEFAULT_WIDTH,
    maximized: false,
    surfaces: [],
    activeSurface: undefined,

    init: (workspaceId) => {
      if (get().workspaceId === workspaceId) return
      const persisted = loadPersisted(workspaceId)
      set({
        workspaceId,
        open: persisted?.open ?? false,
        // Mount immediately if it was left open, so its surfaces reappear without an interaction.
        mounted: persisted?.open ?? false,
        width: persisted?.width ?? DEFAULT_WIDTH,
        maximized: (persisted?.open ?? false) ? (persisted?.maximized ?? false) : false,
        surfaces: persisted?.surfaces ?? [],
        activeSurface: persisted?.activeSurface,
      })
    },

    openPanel: () => {
      set({ mounted: true, open: true })
      commit()
    },

    closePanel: () => {
      // Keep `mounted` true: the panel is only hidden, preserving surface state for reopening.
      set({ open: false, maximized: false })
      commit()
    },

    toggle: () => {
      if (get().open) get().closePanel()
      else get().openPanel()
    },

    toggleMaximized: () => {
      if (!get().open) return
      set({ maximized: !get().maximized })
      commit()
    },

    setWidth: (width) => {
      set({ width: clampPanelWidth(width) })
      commit()
    },

    openSurface: (kind) => {
      const { surfaces } = get()
      set({
        mounted: true,
        open: true,
        surfaces: surfaces.includes(kind) ? surfaces : [...surfaces, kind],
        activeSurface: kind,
      })
      commit()
    },

    focusSurface: (kind) => {
      if (!get().surfaces.includes(kind)) return
      set({ activeSurface: kind })
      commit()
    },

    closeSurface: (kind) => {
      const { surfaces, activeSurface } = get()
      const index = surfaces.indexOf(kind)
      if (index === -1) return
      const remaining = surfaces.filter((item) => item !== kind)
      const nextActive = activeSurface !== kind
        ? activeSurface
        // Prefer the previous neighbor, then the next one, then none — never a dangling id.
        : (remaining[index - 1] ?? remaining[index] ?? remaining[remaining.length - 1])
      set({ surfaces: remaining, activeSurface: nextActive })
      commit()
    },

    reorderSurface: (kind, toIndex) => {
      const { surfaces } = get()
      const from = surfaces.indexOf(kind)
      if (from === -1) return
      const next = [...surfaces]
      next.splice(from, 1)
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, kind)
      set({ surfaces: next })
      commit()
    },
  }
})
