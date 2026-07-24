import { create } from 'zustand'

/** localStorage key for the durable open/closed state of collapsible sidebar groups. */
const GROUP_STATE_KEY = 'paralith.sidebar.collapsedGroups'

/** Read the persisted collapsed-group map; tolerant of missing/corrupt storage (SSR, tests). */
function loadCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = globalThis.localStorage?.getItem(GROUP_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/**
 * UI-only sidebar state. This store deliberately owns *only* transient presentation state —
 * never terminal output, PTY handles, authoritative process state, or Workspace/Project
 * persistence. Durable collapse/width live in app settings; those are mirrored here for
 * responsive interaction and written back through the canonical settings command.
 */
interface SidebarStore {
  /** Live width during a drag, before it is clamped and persisted on pointer-up. */
  draftWidth?: number
  resizing: boolean
  projectSwitcherOpen: boolean
  logoMenuOpen: boolean
  diagnosticsOpen: boolean
  hoveredWorkspaceId?: string
  draggingWorkspaceId?: string
  dropTargetWorkspaceId?: string
  menuWorkspaceId?: string
  menuAnchor?: { x: number; y: number }
  /** Open/closed state per collapsible section group (true = collapsed). Durable per device. */
  collapsedGroups: Record<string, boolean>
  setDraftWidth: (width?: number) => void
  setResizing: (resizing: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  setLogoMenuOpen: (open: boolean) => void
  setDiagnosticsOpen: (open: boolean) => void
  setHoveredWorkspace: (id?: string) => void
  setDraggingWorkspace: (id?: string) => void
  setDropTarget: (id?: string) => void
  setMenuWorkspace: (id?: string, anchor?: { x: number; y: number }) => void
  setGroupCollapsed: (id: string, collapsed: boolean) => void
  closeOverlays: () => void
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  resizing: false,
  projectSwitcherOpen: false,
  logoMenuOpen: false,
  diagnosticsOpen: false,
  collapsedGroups: loadCollapsedGroups(),
  setDraftWidth: (draftWidth) => set({ draftWidth }),
  setResizing: (resizing) => set({ resizing }),
  setProjectSwitcherOpen: (projectSwitcherOpen) => set({ projectSwitcherOpen }),
  setLogoMenuOpen: (logoMenuOpen) => set({ logoMenuOpen }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setHoveredWorkspace: (hoveredWorkspaceId) => set({ hoveredWorkspaceId }),
  setDraggingWorkspace: (draggingWorkspaceId) => set({ draggingWorkspaceId }),
  setDropTarget: (dropTargetWorkspaceId) => set({ dropTargetWorkspaceId }),
  setMenuWorkspace: (menuWorkspaceId, menuAnchor) => set({ menuWorkspaceId, menuAnchor }),
  setGroupCollapsed: (id, collapsed) =>
    set((state) => {
      const collapsedGroups = { ...state.collapsedGroups, [id]: collapsed }
      try {
        globalThis.localStorage?.setItem(GROUP_STATE_KEY, JSON.stringify(collapsedGroups))
      } catch {
        // Non-fatal: state stays in memory for this session even if persistence is unavailable.
      }
      return { collapsedGroups }
    }),
  closeOverlays: () =>
    set({ projectSwitcherOpen: false, logoMenuOpen: false, menuWorkspaceId: undefined }),
}))
