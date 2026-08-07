import { create } from 'zustand'
import { native } from '../../native/commands'
import type { SidebarGroupBy, SidebarPreferences, SidebarSortMode } from '../../native/types'

export type { SidebarGroupBy, SidebarSortMode } from '../../native/types'

/**
 * Legacy renderer-local keys. Read once to carry an existing installation's choices across to the
 * settings database, then cleared. Never written again.
 */
const LEGACY_GROUP_STATE_KEY = 'paralith.sidebar.collapsedGroups'
const LEGACY_GROUP_BY_KEY = 'paralith.sidebar.groupBy'
const LEGACY_SORT_MODE_KEY = 'paralith.sidebar.sortMode'

/** How long a burst of preference changes is allowed to settle before it reaches the database. */
const PERSIST_DEBOUNCE_MS = 250

const GROUP_BY_VALUES: readonly SidebarGroupBy[] = ['project', 'flat']
const SORT_MODE_VALUES: readonly SidebarSortMode[] = ['manual', 'attention']

/**
 * UI-only sidebar state.
 *
 * This store owns transient presentation state and mirrors the durable view preferences. It never
 * owns terminal output, PTY handles, authoritative process state, or Workspace/Project
 * persistence. The durable half — grouping, order, collapsed sections, plus collapse/width — lives
 * in the settings database and is written back through the canonical commands; what is held here
 * is a mirror kept for responsive interaction, not a second source of truth.
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
  /** Open/closed state per collapsible section (true = collapsed). Durable. */
  collapsedGroups: Record<string, boolean>
  /** How the primary list is grouped. Durable. */
  groupBy: SidebarGroupBy
  /** How the primary list is ordered. Durable. */
  sortMode: SidebarSortMode
  /** False until the durable half has been read back, so a first paint cannot overwrite it. */
  preferencesHydrated: boolean
  /**
   * The presentation order the list is currently pinned to, by Workspace id.
   *
   * The attention sort ranks by live runtime state, which changes constantly — so recomputing it
   * on every render means rows move while a person is reaching for one. Pinning the order and
   * re-deriving it only at the moments below keeps each row's *status* live while its *position*
   * holds still.
   */
  frozenOrder: string[]
  /** Bumped to request a re-derivation of `frozenOrder`. */
  sortEpoch: number
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
  /** Apply preferences read from (or broadcast by) the settings authority. Never writes back. */
  applyPreferences: (preferences: SidebarPreferences) => void
  /** Pin the list to this order. */
  freezeOrder: (orderedIds: string[]) => void
  /** Ask for a fresh order at the next opportunity. */
  bumpSortEpoch: () => void
}

export const useSidebarStore = create<SidebarStore>((set, get) => ({
  resizing: false,
  projectSwitcherOpen: false,
  listOptionsOpen: false,
  diagnosticsOpen: false,
  filterQuery: '',
  collapsedGroups: {},
  groupBy: 'project',
  sortMode: 'manual',
  preferencesHydrated: false,
  frozenOrder: [],
  sortEpoch: 0,
  setDraftWidth: (draftWidth) => set({ draftWidth }),
  setResizing: (resizing) => set({ resizing }),
  setProjectSwitcherOpen: (projectSwitcherOpen) => set({ projectSwitcherOpen }),
  setListOptionsOpen: (listOptionsOpen) => set({ listOptionsOpen }),
  setDiagnosticsOpen: (diagnosticsOpen) => set({ diagnosticsOpen }),
  setHoveredWorkspace: (hoveredWorkspaceId) => set({ hoveredWorkspaceId }),
  setDraggingWorkspace: (draggingWorkspaceId) => set({ draggingWorkspaceId }),
  setDropTarget: (dropTargetWorkspaceId) => set({ dropTargetWorkspaceId }),
  setMenuWorkspace: (menuWorkspaceId, menuAnchor) => set({ menuWorkspaceId, menuAnchor }),
  // Changing what the list contains invalidates the pinned order: rows the filter just revealed
  // have no position in it, and would otherwise all pile up at the end.
  setFilterQuery: (filterQuery) => set((state) => ({ filterQuery, sortEpoch: state.sortEpoch + 1 })),
  setGroupCollapsed: (id, collapsed) =>
    set((state) => {
      const collapsedGroups = { ...state.collapsedGroups, [id]: collapsed }
      persistSoon(get)
      return { collapsedGroups }
    }),
  setGroupBy: (groupBy) => {
    persistSoon(get)
    set({ groupBy })
  },
  setSortMode: (sortMode) => {
    persistSoon(get)
    // Switching to the attention order is an explicit request to be re-sorted now.
    set((state) => ({ sortMode, sortEpoch: state.sortEpoch + 1 }))
  },
  closeOverlays: () =>
    set({ projectSwitcherOpen: false, listOptionsOpen: false, menuWorkspaceId: undefined }),
  applyPreferences: (preferences) =>
    set((state) => ({
      groupBy: GROUP_BY_VALUES.includes(preferences.groupBy) ? preferences.groupBy : 'project',
      sortMode: SORT_MODE_VALUES.includes(preferences.sortMode) ? preferences.sortMode : 'manual',
      collapsedGroups: Object.fromEntries(preferences.collapsedGroups.map((id) => [id, true])),
      preferencesHydrated: true,
      sortEpoch: state.sortEpoch + 1,
    })),
  freezeOrder: (frozenOrder) => set({ frozenOrder }),
  bumpSortEpoch: () => set((state) => ({ sortEpoch: state.sortEpoch + 1 })),
}))

/** The durable subset of the current state, in the shape the settings authority stores. */
export function currentSidebarPreferences(state: {
  groupBy: SidebarGroupBy
  sortMode: SidebarSortMode
  collapsedGroups: Record<string, boolean>
}): SidebarPreferences {
  return {
    groupBy: state.groupBy,
    sortMode: state.sortMode,
    // Only the collapsed ids are persisted. An expanded section is the default, so recording it
    // would just accumulate entries for sections that no longer exist.
    collapsedGroups: Object.entries(state.collapsedGroups)
      .filter(([, collapsed]) => collapsed)
      .map(([id]) => id),
  }
}

let persistTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Write the durable half back, coalescing bursts.
 *
 * Debounced because collapsing three sections in a row is three state writes but one intent, and
 * each write rewrites the settings blob. Best-effort: a device that refuses the write still gets
 * the change for this session rather than a sidebar that refuses to respond.
 */
function persistSoon(get: () => SidebarStore): void {
  if (!get().preferencesHydrated) return
  if (persistTimer !== undefined) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = undefined
    void native.setSidebarPreferences(currentSidebarPreferences(get())).catch(() => undefined)
  }, PERSIST_DEBOUNCE_MS)
}

/** Flush any pending preference write immediately. Tests, and shutdown paths. */
export function flushSidebarPreferences(): Promise<void> {
  if (persistTimer === undefined) return Promise.resolve()
  clearTimeout(persistTimer)
  persistTimer = undefined
  return native.setSidebarPreferences(currentSidebarPreferences(useSidebarStore.getState())).catch(() => undefined)
}

/**
 * Read whatever the previous renderer-local storage held, once.
 *
 * These preferences used to live in `localStorage`, which meant they were per-window and invisible
 * to the settings database that already owned the sidebar's collapse and width — the same surface
 * persisted through two authorities that could disagree. Returns undefined when there is nothing
 * to carry over.
 */
export function readLegacySidebarPreferences(): SidebarPreferences | undefined {
  try {
    const storage = globalThis.localStorage
    if (!storage) return undefined
    const rawGroupBy = storage.getItem(LEGACY_GROUP_BY_KEY)
    const rawSortMode = storage.getItem(LEGACY_SORT_MODE_KEY)
    const rawCollapsed = storage.getItem(LEGACY_GROUP_STATE_KEY)
    if (rawGroupBy === null && rawSortMode === null && rawCollapsed === null) return undefined
    // Parsed in its own guard: a corrupt collapse map must not discard the grouping and order
    // choices sitting beside it, which parse fine and are the ones the user actually notices.
    let collapsedGroups: string[] = []
    if (rawCollapsed) {
      try {
        const parsed: unknown = JSON.parse(rawCollapsed)
        if (parsed && typeof parsed === 'object') {
          collapsedGroups = Object.entries(parsed as Record<string, unknown>)
            .filter(([, collapsed]) => collapsed === true)
            .map(([id]) => id)
        }
      } catch {
        collapsedGroups = []
      }
    }
    return {
      groupBy: GROUP_BY_VALUES.includes(rawGroupBy as SidebarGroupBy) ? (rawGroupBy as SidebarGroupBy) : 'project',
      sortMode: SORT_MODE_VALUES.includes(rawSortMode as SidebarSortMode) ? (rawSortMode as SidebarSortMode) : 'manual',
      collapsedGroups,
    }
  } catch {
    return undefined
  }
}

/** Drop the legacy keys once their values are safely in the settings database. */
export function clearLegacySidebarPreferences(): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    for (const key of [LEGACY_GROUP_BY_KEY, LEGACY_SORT_MODE_KEY, LEGACY_GROUP_STATE_KEY]) {
      storage.removeItem(key)
    }
  } catch {
    // Non-fatal: the migration is idempotent, so a failed clear only means it runs again.
  }
}

/**
 * Hydrate the durable half from the settings authority, carrying over renderer-local values from
 * before the move. Idempotent and safe to call from every mount.
 */
export async function hydrateSidebarPreferences(): Promise<void> {
  const stored = await native.getSidebarPreferences()
  const legacy = readLegacySidebarPreferences()
  // Legacy values only win while the database still holds untouched defaults: once a preference
  // has been set through the new authority, a stale localStorage entry must never override it.
  const isPristine =
    stored.groupBy === 'project' && stored.sortMode === 'manual' && stored.collapsedGroups.length === 0
  const effective = legacy && isPristine ? legacy : stored
  useSidebarStore.getState().applyPreferences(effective)
  if (legacy) {
    if (isPristine) await native.setSidebarPreferences(effective).catch(() => undefined)
    clearLegacySidebarPreferences()
  }
}
