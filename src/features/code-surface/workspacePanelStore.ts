import { create } from 'zustand'

/**
 * State for the docked workspace-tool panel that sits beside the terminal canvas. It is kept in a
 * standalone store (not React component state) for two reasons:
 *   1. The terminal canvas must never remount when the panel opens/closes/resizes, so panel state
 *      cannot live in a component that also owns the canvas subtree.
 *   2. It is decoupled from any one screen so a future detached native window can host the same
 *      panel by reading the same per-workspace record.
 *
 * State is scoped and persisted per Workspace: switching Workspaces restores that Workspace's own
 * panel visibility, width, active tool and (independently) its open editor tabs.
 */
export type WorkspaceTool = 'files' | 'browser'

const KNOWN_TOOLS: WorkspaceTool[] = ['files', 'browser']

function normalizeTool(tool: unknown): WorkspaceTool {
  return KNOWN_TOOLS.includes(tool as WorkspaceTool) ? (tool as WorkspaceTool) : 'files'
}

const MIN_WIDTH = 320
const MAX_WIDTH = 1100
const DEFAULT_WIDTH = 520

export interface WorkspacePanelState {
  workspaceId: string
  /** Once the panel has been opened it stays mounted (hidden while closed) so Monaco models,
   * editor buffers, cursor and scroll survive a collapse. */
  mounted: boolean
  open: boolean
  width: number
  /** Temporarily fills the whole workspace, overlaying the still-mounted terminal canvas. */
  maximized: boolean
  tool: WorkspaceTool

  init: (workspaceId: string) => void
  openPanel: (tool?: WorkspaceTool) => void
  closePanel: () => void
  toggle: () => void
  toggleMaximized: () => void
  setTool: (tool: WorkspaceTool) => void
  setWidth: (width: number) => void
}

interface Persisted {
  open: boolean
  width: number
  maximized: boolean
  tool: WorkspaceTool
}

function persistKey(workspaceId: string): string {
  return `paralith.toolpanel.${workspaceId}`
}

export function clampPanelWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)))
}

function loadPersisted(workspaceId: string): Persisted | undefined {
  try {
    const raw = localStorage.getItem(persistKey(workspaceId))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<Persisted>
    if (typeof parsed.open !== 'boolean') return undefined
    return {
      open: parsed.open,
      width: clampPanelWidth(typeof parsed.width === 'number' ? parsed.width : DEFAULT_WIDTH),
      maximized: parsed.maximized === true,
      tool: normalizeTool(parsed.tool),
    }
  } catch {
    return undefined
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
function savePersisted(state: WorkspacePanelState): void {
  if (!state.workspaceId) return
  const snapshot: Persisted = { open: state.open, width: state.width, maximized: state.maximized, tool: state.tool }
  const key = persistKey(state.workspaceId)
  // Debounced: resizing must not thrash localStorage on every pointer frame.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(key, JSON.stringify(snapshot))
    } catch {
      /* localStorage is a best-effort UI cache; never block the workspace on it */
    }
  }, 200)
}

export const useWorkspacePanelStore = create<WorkspacePanelState>((set, get) => {
  const commit = () => savePersisted(get())
  return {
    workspaceId: '',
    mounted: false,
    open: false,
    width: DEFAULT_WIDTH,
    maximized: false,
    tool: 'files',

    init: (workspaceId) => {
      if (get().workspaceId === workspaceId) return
      const persisted = loadPersisted(workspaceId)
      set({
        workspaceId,
        open: persisted?.open ?? false,
        // Mount immediately if it was left open, so its files reappear without an interaction.
        mounted: persisted?.open ?? false,
        width: persisted?.width ?? DEFAULT_WIDTH,
        maximized: (persisted?.open ?? false) ? (persisted?.maximized ?? false) : false,
        tool: persisted?.tool ?? 'files',
      })
    },

    openPanel: (tool) => {
      set({ mounted: true, open: true, tool: tool ?? get().tool })
      commit()
    },

    closePanel: () => {
      // Keep `mounted` true: the panel is only hidden, preserving editor state for reopening.
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

    setTool: (tool) => {
      set({ tool })
      commit()
    },

    setWidth: (width) => {
      set({ width: clampPanelWidth(width) })
      commit()
    },
  }
})
