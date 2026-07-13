import { create } from 'zustand'

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
  setDraftWidth: (width?: number) => void
  setResizing: (resizing: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  setLogoMenuOpen: (open: boolean) => void
  setDiagnosticsOpen: (open: boolean) => void
  setHoveredWorkspace: (id?: string) => void
  setDraggingWorkspace: (id?: string) => void
  setDropTarget: (id?: string) => void
  setMenuWorkspace: (id?: string, anchor?: { x: number; y: number }) => void
  closeOverlays: () => void
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  resizing: false,
  projectSwitcherOpen: false,
  logoMenuOpen: false,
  diagnosticsOpen: false,
  setDraftWidth: (draftWidth) => set({ draftWidth }),
  setResizing: (resizing) => set({ resizing }),
  setProjectSwitcherOpen: (projectSwitcherOpen) => set({ projectSwitcherOpen }),
  setLogoMenuOpen: (logoMenuOpen) => set({ logoMenuOpen }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setHoveredWorkspace: (hoveredWorkspaceId) => set({ hoveredWorkspaceId }),
  setDraggingWorkspace: (draggingWorkspaceId) => set({ draggingWorkspaceId }),
  setDropTarget: (dropTargetWorkspaceId) => set({ dropTargetWorkspaceId }),
  setMenuWorkspace: (menuWorkspaceId, menuAnchor) => set({ menuWorkspaceId, menuAnchor }),
  closeOverlays: () =>
    set({ projectSwitcherOpen: false, logoMenuOpen: false, menuWorkspaceId: undefined }),
}))
