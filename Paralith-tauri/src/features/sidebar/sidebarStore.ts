import { create } from 'zustand'

/** localStorage key for the durable open/closed state of collapsible sidebar groups. */
const GROUP_STATE_KEY = 'paralith.sidebar.collapsedGroups'
/** localStorage key for how the primary list is grouped (by Project, or one flat list). */
const GROUP_BY_KEY = 'paralith.sidebar.groupBy'
/** localStorage key for the primary list's ordering mode. */
const SORT_MODE_KEY = 'paralith.sidebar.sortMode'

/**
 * How the primary list is grouped.
 *   `project` — one collapsible section per open Project (the default; mirrors the old rail).
 *   `flat`    — every Workspace from every open Project in one ungrouped list.
 */
export type SidebarGroupBy = 'project' | 'flat'

/**
 * How the primary list is ordered.
 *   `manual`    — the persisted per-Project order the user drags into place (the default).
 *   `attention` — Workspaces that need a human first. See `compareByAttention`.
 */
export type SidebarSortMode = 'manual' | 'attention'

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

/** Read one persisted string preference, falling back when storage is absent or holds junk. */
function loadChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    return allowed.includes(raw as T) ? (raw as T) : fallback
  } catch {
    return fallback
  }
}

/** Best-effort persistence: a device that refuses storage still gets the change for this session. */
function persist(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Non-fatal: state stays in memory for this session even if persistence is unavailable.
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
  /** The list header's Project popover — the sidebar's single Project surface. */
  projectSwitcherOpen: boolean
  /** The list header's grouping/order popover. */
  listOptionsOpen: boolean
  diagnosticsOpen: boolean
  hoveredWorkspaceId?: string
  draggingWorkspaceId?: string
  dropTargetWorkspaceId?: string
  menuWorkspaceId?: string
  menuAnchor?: { x: number; y: number }
  /**
   * Live filter over the two primary lists (Workspaces and Swarms). Deliberately transient: a
   * filter that survived a restart would hide entities the user has forgotten they filtered.
   */
  filterQuery: string
  /** Open/closed state per collapsible section group (true = collapsed). Durable per device. */
  collapsedGroups: Record<string, boolean>
  /** How the primary list is grouped. Durable per device. */
  groupBy: SidebarGroupBy
  /** How the primary list is ordered. Durable per device. */
  sortMode: SidebarSortMode
  setDraftWidth: (width?: number) => void
  setResizing: (resizing: boolean) => void
  setProjectSwitcherOpen: (open: boolean) => void
  setListOptionsOpen: (open: boolean) => void
  setDiagnosticsOpen: (open: boolean) => void
  setHoveredWorkspace: (id?: string) => void
  setDraggingWorkspace: (id?: string) => void
  setDropTarget: (id?: string) => void
  setMenuWorkspace: (id?: string, anchor?: { x: number; y: number }) => void
  setFilterQuery: (query: string) => void
  setGroupCollapsed: (id: string, collapsed: boolean) => void
  setGroupBy: (groupBy: SidebarGroupBy) => void
  setSortMode: (sortMode: SidebarSortMode) => void
  closeOverlays: () => void
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  resizing: false,
  projectSwitcherOpen: false,
  listOptionsOpen: false,
  diagnosticsOpen: false,
  filterQuery: '',
  collapsedGroups: loadCollapsedGroups(),
  groupBy: loadChoice(GROUP_BY_KEY, ['project', 'flat'] as const, 'project'),
  sortMode: loadChoice(SORT_MODE_KEY, ['manual', 'attention'] as const, 'manual'),
  setDraftWidth: (draftWidth) => set({ draftWidth }),
  setResizing: (resizing) => set({ resizing }),
  setProjectSwitcherOpen: (projectSwitcherOpen) => set({ projectSwitcherOpen }),
  setListOptionsOpen: (listOptionsOpen) => set({ listOptionsOpen }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setHoveredWorkspace: (hoveredWorkspaceId) => set({ hoveredWorkspaceId }),
  setDraggingWorkspace: (draggingWorkspaceId) => set({ draggingWorkspaceId }),
  setDropTarget: (dropTargetWorkspaceId) => set({ dropTargetWorkspaceId }),
  setMenuWorkspace: (menuWorkspaceId, menuAnchor) => set({ menuWorkspaceId, menuAnchor }),
  setFilterQuery: (filterQuery) => set({ filterQuery }),
  setGroupCollapsed: (id, collapsed) =>
    set((state) => {
      const collapsedGroups = { ...state.collapsedGroups, [id]: collapsed }
      persist(GROUP_STATE_KEY, JSON.stringify(collapsedGroups))
      return { collapsedGroups }
    }),
  setGroupBy: (groupBy) => {
    persist(GROUP_BY_KEY, groupBy)
    set({ groupBy })
  },
  setSortMode: (sortMode) => {
    persist(SORT_MODE_KEY, sortMode)
    set({ sortMode })
  },
  closeOverlays: () =>
    set({ projectSwitcherOpen: false, listOptionsOpen: false, menuWorkspaceId: undefined }),
}))
