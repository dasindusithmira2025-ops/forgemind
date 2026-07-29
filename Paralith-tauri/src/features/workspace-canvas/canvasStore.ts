import { create } from 'zustand'
import { bringFloatingToFront } from './layoutOperations'
import type {
  CanvasBounds,
  DockDropTarget,
  FloatingResizeSession,
  MagneticGuide,
  PaneDragSession,
  PixelRect,
  WorkspaceCanvasLayout,
} from './canvasTypes'

/**
 * Holds the docking canvas state for the *active* workspace. Two clearly separated concerns
 * live here:
 *   - persisted layout ({@link WorkspaceCanvasLayout} + revision): the source of truth that is
 *     written back through the typed Tauri command.
 *   - transient interaction state (drag / resize / guides / bounds): never persisted, discarded
 *     on drop or cancel.
 *
 * It deliberately knows nothing about terminal runtime, PTYs, or xterm output — those live in
 * {@link terminalRuntime}. Moving a pane here only ever changes geometry metadata.
 */
interface CanvasStoreState {
  workspaceId?: string
  revision: number
  layout: WorkspaceCanvasLayout | null
  bounds: CanvasBounds

  drag?: PaneDragSession
  resize?: FloatingResizeSession
  guides: MagneticGuide[]
  /** Panes currently animating from preview → committed rect (for the settle transition). */
  settlingPaneIds: string[]

  init: (workspaceId: string, layout: WorkspaceCanvasLayout, revision: number) => void
  reset: () => void
  setBounds: (bounds: CanvasBounds) => void
  setLayout: (layout: WorkspaceCanvasLayout, revision?: number) => void
  setRevision: (revision: number) => void
  setActivePane: (paneId?: string) => void
  bringToFront: (paneId: string) => void
  toggleMaximize: (paneId: string) => void

  startDrag: (session: PaneDragSession) => void
  updateDrag: (patch: { previewRect: PixelRect; activeDropTarget?: DockDropTarget; guides?: MagneticGuide[]; phase?: PaneDragSession['phase'] }) => void
  clearDrag: () => void

  startResize: (session: FloatingResizeSession) => void
  updateResize: (currentRect: PixelRect, guides?: MagneticGuide[]) => void
  clearResize: () => void

  markSettling: (paneIds: string[]) => void
  clearSettling: () => void
}

const INITIAL_BOUNDS: CanvasBounds = { width: 0, height: 0 }

export const useCanvasStore = create<CanvasStoreState>((set, get) => ({
  workspaceId: undefined,
  revision: 0,
  layout: null,
  bounds: INITIAL_BOUNDS,
  drag: undefined,
  resize: undefined,
  guides: [],
  settlingPaneIds: [],

  init: (workspaceId, layout, revision) =>
    set({ workspaceId, layout, revision, drag: undefined, resize: undefined, guides: [], settlingPaneIds: [] }),

  reset: () => set({ workspaceId: undefined, layout: null, revision: 0, drag: undefined, resize: undefined, guides: [], settlingPaneIds: [] }),

  setBounds: (bounds) => {
    const current = get().bounds
    if (current.width === bounds.width && current.height === bounds.height) return
    set({ bounds })
  },

  setLayout: (layout, revision) => set(revision === undefined ? { layout } : { layout, revision }),

  setRevision: (revision) => set({ revision }),

  setActivePane: (paneId) => {
    const layout = get().layout
    if (!layout || layout.activePaneId === paneId) return
    set({ layout: { ...layout, activePaneId: paneId } })
  },

  bringToFront: (paneId) => {
    const layout = get().layout
    if (!layout) return
    set({ layout: bringFloatingToFront(layout, paneId) })
  },

  toggleMaximize: (paneId) => {
    const layout = get().layout
    if (!layout) return
    set({ layout: { ...layout, maximizedPaneId: layout.maximizedPaneId === paneId ? undefined : paneId } })
  },

  startDrag: (drag) => set({ drag, guides: [] }),
  updateDrag: (patch) =>
    set((state) =>
      state.drag
        ? {
            drag: {
              ...state.drag,
              previewRect: patch.previewRect,
              activeDropTarget: patch.activeDropTarget,
              phase: patch.phase ?? state.drag.phase,
            },
            guides: patch.guides ?? state.guides,
          }
        : {},
    ),
  clearDrag: () => set({ drag: undefined, guides: [] }),

  startResize: (resize) => set({ resize, guides: [] }),
  updateResize: (currentRect, guides) =>
    set((state) => (state.resize ? { resize: { ...state.resize, currentRect }, guides: guides ?? state.guides } : {})),
  clearResize: () => set({ resize: undefined, guides: [] }),

  markSettling: (settlingPaneIds) => set({ settlingPaneIds }),
  clearSettling: () => set({ settlingPaneIds: [] }),
}))
