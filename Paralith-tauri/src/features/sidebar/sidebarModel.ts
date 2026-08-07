import type { Project, TerminalSession, Workspace, WorkspacePlacement } from '../../native/types'
import type { PaneAgentState } from './sidebarAgentStatus'
import { sortByAttention } from './sidebarAttention'
import {
  deriveProviderSummary,
  deriveWorkspaceRuntimeSummary,
  matchesSidebarFilter,
} from './sidebarSelectors'
import type { SidebarGroupBy, SidebarSortMode } from './sidebarStore'
import type { SidebarProjectGroup, SidebarWorkspace } from './sidebarTypes'

/**
 * The sidebar's presentation pipeline.
 *
 * Everything the sidebar shows — which rows survive the filter, what order they are in, which
 * groups disappear entirely, what the counts say — is decided here, once, as a pure function of
 * its inputs. It used to be decided in render bodies: `ForgeSpaceSidebar` ran three `.filter()`
 * passes inline, and every `ProjectGroup` and `FlatList` re-filtered and re-sorted its own rows on
 * each render. With terminal output flowing that is a lot of work to redo for an answer that has
 * not changed, and worse, it meant no two surfaces were guaranteed to agree about what the list
 * contained — the "no match" fallback recomputed its own version of the same question.
 *
 * Adapted from Orca's `computeVisibleWorktreeIds` → `buildRows` pipeline, minus the flat row array:
 * that shape earns its keep by feeding a virtualizer and publishing a rendered order, neither of
 * which exists here, so the model keeps the group structure the DOM already has.
 */

/** Below this many combined Workspace + Swarm rows, scrolling is faster than filtering. */
export const MIN_ROWS_FOR_FILTER = 6

/** One Project's section of the primary list, fully resolved for rendering. */
export interface PresentedGroup {
  /** Stable identity for collapse persistence. Matches the id `SidebarGroup` is given. */
  groupId: string
  project: Project
  isActive: boolean
  folderMissing: boolean
  runtimeSummary?: string
  /** The rows to render: filtered, then ordered. */
  workspaces: SidebarWorkspace[]
  /**
   * The unfiltered, unordered list a reorder writes back to. Never the presented subset — a drop
   * index only means anything against the persisted order it is being written into.
   */
  orderSource: SidebarWorkspace[]
  /**
   * Whether rows in this group may be dragged. A drop index is only meaningful inside one
   * Project's persisted order, so dragging is offered only when nothing is reordering or hiding
   * rows underneath it: no filter, manual order, and the group's own Project is active.
   */
  reorderable: boolean
  /** Rows before filtering — what the header count shows when no filter is active. */
  totalCount: number
  /** Rows after filtering — what the header count shows while filtering. */
  visibleCount: number
  /** True when a filter is active and hid every row in this group, so it drops off the list. */
  hidden: boolean
}

export interface SidebarPresentation {
  /** One section per open Project. Populated for the `project` grouping. */
  groups: PresentedGroup[]
  /** Every Project's Workspaces in one section. Populated for the `flat` grouping. */
  flat: PresentedGroup
  /** Workspaces detached onto other monitors — their own section, never in the primary list. */
  detached: SidebarWorkspace[]
  /** Detached Workspaces surviving the filter. */
  visibleDetached: SidebarWorkspace[]
  /** True when a filter is active. */
  filtering: boolean
  /** True when at least one primary-list row survived the filter. */
  anyMatch: boolean
  /** Total rows across both primary lists and the detached section, before filtering. */
  totalRows: number
  /** Rows surviving the filter across every section — the count the filter field reports. */
  matchCount: number
  /** Whether the list is long enough to warrant the filter field. */
  showFilter: boolean
  /** Project id to display name, for the flat list where a row must name its own Project. */
  projectNameById: Map<string, string>
}

export interface SidebarPresentationInput {
  /** Every open Project with its Workspaces. */
  groups: SidebarProjectGroup[]
  groupBy: SidebarGroupBy
  sortMode: SidebarSortMode
  filterQuery: string
  /** Placement per Workspace; drives the this-window vs other-monitors split. */
  placements: readonly WorkspacePlacement[]
  /** Names shown on rows in the flat list; omitted when only one Project is open. */
  showProjectNames?: boolean
  /**
   * The frozen presentation order, by Workspace id. Rows named here keep their position even as
   * their runtime changes; anything unlisted is appended in its natural order. See `sortEpoch`.
   */
  frozenOrder?: readonly string[]
  /** Swarm names, so the filter field can report one honest total across every list it filters. */
  swarmNames?: readonly string[]
}

/** The cross-workspace runtime facts one row is derived from. */
export interface WorkspaceRuntimeInputs {
  sessionsByWorkspace: Map<string, TerminalSession[]>
  paneAgentStatesByWorkspace: Map<string, PaneAgentState[]>
}

const NO_SESSIONS: TerminalSession[] = []
const NO_AGENT_STATES: PaneAgentState[] = []

/**
 * Turn one persisted Workspace into a sidebar row.
 *
 * The single place a row's runtime is derived, for the Project on screen and every Project behind
 * it alike. There used to be two derivations — one for the active Project reading its live
 * subscription, one for background Projects reading a stale snapshot — which is exactly how the
 * two came to disagree.
 */
export function deriveSidebarWorkspace(
  workspace: Workspace,
  runtime: WorkspaceRuntimeInputs,
  deferredPaneIds: readonly string[],
): SidebarWorkspace {
  return {
    workspace,
    runtime: deriveWorkspaceRuntimeSummary({
      workspaceId: workspace.id,
      configuredPaneCount: workspace.panes.length,
      sessions: runtime.sessionsByWorkspace.get(workspace.id) ?? NO_SESSIONS,
      paneAgentStates: runtime.paneAgentStatesByWorkspace.get(workspace.id) ?? NO_AGENT_STATES,
      deferredPaneIds: [...deferredPaneIds],
    }),
    providers: deriveProviderSummary(workspace),
  }
}

/** Does this Workspace match the live filter? One matcher, so every list agrees. */
export function matchesWorkspace(query: string, entry: SidebarWorkspace): boolean {
  return matchesSidebarFilter(query, entry.workspace.name, entry.providers.text)
}

/**
 * Apply a frozen order to a list.
 *
 * Ordering that recomputes live reshuffles rows under the pointer: with the attention sort on, a
 * terminal exiting three rows down moves the row you were reaching for. Freezing the order and
 * re-deriving it only when something asks (see `sortEpoch`) keeps the list stable while still
 * letting each row's own status update in place.
 */
export function applyFrozenOrder(
  entries: SidebarWorkspace[],
  frozenOrder: readonly string[] | undefined,
): SidebarWorkspace[] {
  if (!frozenOrder || frozenOrder.length === 0) return entries
  const rank = new Map(frozenOrder.map((id, index) => [id, index]))
  // A Workspace created since the order was frozen has no rank yet. It goes to the end rather
  // than to an arbitrary position, and stays in its natural order relative to its peers.
  return [...entries].sort((a, b) => {
    const aRank = rank.get(a.workspace.id) ?? Number.POSITIVE_INFINITY
    const bRank = rank.get(b.workspace.id) ?? Number.POSITIVE_INFINITY
    return aRank - bRank
  })
}

/**
 * Filter then order one list of rows for display.
 *
 * `manual` order is never re-sorted: the persisted drag order *is* the user's answer to what
 * matters, and silently overriding it would make the drag handle look broken.
 */
export function presentWorkspaces(
  entries: SidebarWorkspace[],
  filterQuery: string,
  sortMode: SidebarSortMode,
  frozenOrder?: readonly string[],
): SidebarWorkspace[] {
  const matched = entries.filter((entry) => matchesWorkspace(filterQuery, entry))
  if (sortMode !== 'attention') return matched
  // The frozen order already encodes a previous attention sort; re-sorting on top of it would
  // defeat the freeze. Sort only when there is nothing frozen to honour.
  return frozenOrder && frozenOrder.length > 0 ? applyFrozenOrder(matched, frozenOrder) : sortByAttention(matched)
}

/**
 * Compute the order the attention sort would produce right now, across every group, as a flat list
 * of Workspace ids. This is what gets frozen when the sort epoch bumps.
 */
export function computeAttentionOrder(groups: SidebarProjectGroup[]): string[] {
  return sortByAttention(groups.flatMap((group) => group.workspaces)).map((entry) => entry.workspace.id)
}

/** Build the whole presentation in one pass. */
export function buildSidebarPresentation(input: SidebarPresentationInput): SidebarPresentation {
  const { groupBy, sortMode, filterQuery, placements, frozenOrder, swarmNames = [] } = input
  const filtering = filterQuery.trim().length > 0

  // Placements are authoritative (from the Rust window registry); when absent every Workspace is
  // attached to this window.
  const detachedIds = new Set(
    placements.filter((placement) => placement.mode === 'detached').map((placement) => placement.workspaceId),
  )

  // Detached Workspaces get their own section. Leaving them in the primary list too would
  // double-count them in every header, and offer a reorder that writes to the wrong list.
  const listGroups = input.groups
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter((entry) => !detachedIds.has(entry.workspace.id)),
    }))
    .filter((group) => group.workspaces.length > 0 || group.isActive)

  const groups = listGroups.map((group) =>
    presentGroup({
      groupId: `project:${group.project.id}`,
      source: group,
      orderSource: group.workspaces,
      filterQuery,
      sortMode,
      frozenOrder,
      filtering,
      // Only the active Project's persisted order is the one this screen writes back.
      reorderable: !filtering && sortMode === 'manual' && group.isActive,
    }),
  )

  const allWorkspaces = listGroups.flatMap((group) => group.workspaces)
  const activeGroup = listGroups.find((group) => group.isActive) ?? listGroups[0]
  const flat = presentGroup({
    groupId: 'workspaces',
    source: {
      project: activeGroup?.project as Project,
      isActive: true,
      folderMissing: false,
      workspaces: allWorkspaces,
    },
    orderSource: allWorkspaces,
    filterQuery,
    sortMode,
    frozenOrder,
    filtering,
    // The flat list mixes Projects, so a drop index has no single persisted order to write back to.
    reorderable: false,
  })

  const allDetached = input.groups.flatMap((group) =>
    group.workspaces.filter((entry) => detachedIds.has(entry.workspace.id)),
  )
  const visibleDetached = allDetached.filter((entry) => matchesWorkspace(filterQuery, entry))
  const visibleSwarmCount = swarmNames.filter((name) => matchesSidebarFilter(filterQuery, name)).length

  const primaryVisibleCount = groupBy === 'flat' ? flat.visibleCount : groups.reduce((sum, group) => sum + group.visibleCount, 0)
  const totalRows = allWorkspaces.length + allDetached.length + swarmNames.length

  return {
    groups,
    flat,
    detached: allDetached,
    visibleDetached,
    filtering,
    anyMatch: allWorkspaces.some((entry) => matchesWorkspace(filterQuery, entry)),
    totalRows,
    matchCount: primaryVisibleCount + visibleDetached.length + visibleSwarmCount,
    showFilter: totalRows >= MIN_ROWS_FOR_FILTER,
    projectNameById: new Map(input.groups.map((group) => [group.project.id, group.project.name])),
  }
}

function presentGroup(args: {
  groupId: string
  source: SidebarProjectGroup
  orderSource: SidebarWorkspace[]
  filterQuery: string
  sortMode: SidebarSortMode
  frozenOrder?: readonly string[]
  filtering: boolean
  reorderable: boolean
}): PresentedGroup {
  const workspaces = presentWorkspaces(args.source.workspaces, args.filterQuery, args.sortMode, args.frozenOrder)
  return {
    groupId: args.groupId,
    project: args.source.project,
    isActive: args.source.isActive,
    folderMissing: args.source.folderMissing,
    runtimeSummary: args.source.runtimeSummary,
    workspaces,
    orderSource: args.orderSource,
    reorderable: args.reorderable,
    totalCount: args.source.workspaces.length,
    visibleCount: workspaces.length,
    // A Project whose every Workspace is filtered out drops off the list rather than leaving an
    // empty header — the header would read as "this Project has nothing", not "nothing matched".
    hidden: args.filtering && workspaces.length === 0,
  }
}
