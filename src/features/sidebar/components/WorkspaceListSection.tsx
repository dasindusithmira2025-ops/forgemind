import { useCallback } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { sortByAttention } from '../sidebarAttention'
import { matchesSidebarFilter } from '../sidebarSelectors'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions, SidebarProjectGroup, SidebarWorkspace } from '../sidebarTypes'
import { SidebarGroup } from './SidebarGroup'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { WorkspaceRow } from './WorkspaceRow'

/**
 * The sidebar's primary list: every Workspace of every open Project.
 *
 * This replaced the old single-Project list plus the separate Project rail. Those two surfaces
 * disagreed about what the sidebar was for — the rail said "you are in one Project", the list
 * said "here are its Workspaces" — and switching Projects meant a round trip through a popover
 * before the thing you wanted was even on screen. One list spanning every open session removes
 * the round trip: a background Project's Workspace is one click, exactly like a foreground one.
 *
 * Grouping is a view over the same rows, never a different data set:
 *   `project` — a collapsible section per Project, each with its own count and create action
 *   `flat`    — one list, each row naming its Project
 *
 * Reordering stays deliberately narrow. A drop index is only meaningful inside one Project's
 * persisted order, so dragging is offered only in the Project grouping, only in manual order,
 * only when no filter is hiding rows the drop would silently jump.
 */
export function WorkspaceListSection({
  groups,
  activeWorkspaceId,
  switchingWorkspaceId,
  loading,
  actions,
}: {
  groups: SidebarProjectGroup[]
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  loading?: boolean
  actions: SidebarActions
}) {
  const groupBy = useSidebarStore((state) => state.groupBy)
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  const menuWorkspaceId = useSidebarStore((state) => state.menuWorkspaceId)
  const menuAnchor = useSidebarStore((state) => state.menuAnchor)
  const setMenu = useSidebarStore((state) => state.setMenuWorkspace)
  const filtering = filterQuery.trim().length > 0

  const totalWorkspaces = groups.reduce((sum, group) => sum + group.workspaces.length, 0)

  if (loading && totalWorkspaces === 0) {
    return (
      <SidebarGroup id="workspaces" label="Workspaces">
        <WorkspaceSkeletons />
      </SidebarGroup>
    )
  }

  if (totalWorkspaces === 0) {
    return (
      <SidebarGroup id="workspaces" label="Workspaces">
        <div className="ws-empty">
          <p>No Workspaces yet for this Project.</p>
          <button type="button" className="button button-secondary" onClick={actions.onNewWorkspace}>
            <Plus size={14} />
            Create a Workspace
          </button>
        </div>
      </SidebarGroup>
    )
  }

  return (
    <>
      {groupBy === 'project' ? (
        groups.map((group) => (
          <ProjectGroup
            key={group.project.id}
            group={group}
            activeWorkspaceId={activeWorkspaceId}
            switchingWorkspaceId={switchingWorkspaceId}
            actions={actions}
          />
        ))
      ) : (
        <FlatList
          groups={groups}
          activeWorkspaceId={activeWorkspaceId}
          switchingWorkspaceId={switchingWorkspaceId}
          actions={actions}
        />
      )}

      {menuWorkspaceId && (
        <WorkspaceContextMenu
          workspaceId={menuWorkspaceId}
          anchor={menuAnchor}
          actions={actions}
          onClose={() => setMenu(undefined)}
        />
      )}

      {/* Only the Project grouping needs this: it drops non-matching groups entirely, so with no
          match anywhere the list would otherwise render nothing at all. The flat list already
          says so inside its own single group. */}
      {groupBy === 'project' && filtering && <FilterFallback groups={groups} filterQuery={filterQuery} />}
    </>
  )
}

/** One open Project and its Workspaces. */
function ProjectGroup({
  group,
  activeWorkspaceId,
  switchingWorkspaceId,
  actions,
}: {
  group: SidebarProjectGroup
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  actions: SidebarActions
}) {
  const sortMode = useSidebarStore((state) => state.sortMode)
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  const filtering = filterQuery.trim().length > 0

  const visible = presentWorkspaces(group.workspaces, filterQuery, sortMode)
  // A Project whose every Workspace is filtered out drops off the list entirely rather than
  // leaving an empty header — the header would read as "this Project has nothing", not "nothing
  // here matched".
  if (filtering && visible.length === 0) return null

  const reorderable = !filtering && sortMode === 'manual' && group.isActive
  const branch = group.project.gitBranch

  return (
    <SidebarGroup
      id={`project:${group.project.id}`}
      label={group.project.name}
      active={group.isActive}
      count={filtering ? visible.length : group.workspaces.length}
      forceExpanded={filtering}
      className="sb-project-group"
      meta={
        group.folderMissing ? (
          <span className="sb-group-warn">
            <AlertTriangle size={12} aria-hidden /> Folder unavailable
          </span>
        ) : (
          branch || group.runtimeSummary
        )
      }
      actions={
        <button
          type="button"
          className="ws-section-add"
          aria-label={`New workspace in ${group.project.name}`}
          title={`New workspace in ${group.project.name}`}
          onClick={() =>
            actions.onCreateProjectWorkspace
              ? actions.onCreateProjectWorkspace(group.project.id)
              : actions.onNewWorkspace()
          }
        >
          <Plus size={15} />
        </button>
      }
    >
      {group.workspaces.length === 0 ? (
        <p className="sb-no-match">No Workspaces in this Project yet.</p>
      ) : (
        <WorkspaceRows
          entries={visible}
          orderSource={group.workspaces}
          activeWorkspaceId={activeWorkspaceId}
          switchingWorkspaceId={switchingWorkspaceId}
          reorderable={reorderable}
          actions={actions}
        />
      )}
    </SidebarGroup>
  )
}

/** Every Workspace of every open Project in one ungrouped list. */
function FlatList({
  groups,
  activeWorkspaceId,
  switchingWorkspaceId,
  actions,
}: {
  groups: SidebarProjectGroup[]
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  actions: SidebarActions
}) {
  const sortMode = useSidebarStore((state) => state.sortMode)
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  const filtering = filterQuery.trim().length > 0
  // Only name the Project on a row when more than one is open; with a single Project the label
  // would repeat on every row and say nothing.
  const showProjectName = groups.length > 1
  const projectNameById = new Map(groups.map((group) => [group.project.id, group.project.name]))

  const all = groups.flatMap((group) => group.workspaces)
  const visible = presentWorkspaces(all, filterQuery, sortMode)

  return (
    <SidebarGroup
      id="workspaces"
      label="Workspaces"
      count={filtering ? visible.length : all.length}
      forceExpanded={filtering}
    >
      {visible.length === 0 ? (
        <p className="sb-no-match">No Workspace matches the filter.</p>
      ) : (
        <WorkspaceRows
          entries={visible}
          orderSource={all}
          activeWorkspaceId={activeWorkspaceId}
          switchingWorkspaceId={switchingWorkspaceId}
          // The flat list mixes Projects, so a drop index has no single persisted order to
          // write back to. Reordering stays in the Project grouping.
          reorderable={false}
          projectNameFor={showProjectName ? (entry) => projectNameById.get(entry.workspace.projectId) : undefined}
          actions={actions}
        />
      )}
    </SidebarGroup>
  )
}

/** The shared `<ul>` of Workspace rows, including drag bookkeeping. */
function WorkspaceRows({
  entries,
  orderSource,
  activeWorkspaceId,
  switchingWorkspaceId,
  reorderable,
  projectNameFor,
  actions,
}: {
  entries: SidebarWorkspace[]
  /** The unfiltered, unsorted list a reorder writes back — never the presented subset. */
  orderSource: SidebarWorkspace[]
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  reorderable: boolean
  projectNameFor?: (entry: SidebarWorkspace) => string | undefined
  actions: SidebarActions
}) {
  const draggingWorkspaceId = useSidebarStore((state) => state.draggingWorkspaceId)
  const dropTargetWorkspaceId = useSidebarStore((state) => state.dropTargetWorkspaceId)
  const menuWorkspaceId = useSidebarStore((state) => state.menuWorkspaceId)
  const setDragging = useSidebarStore((state) => state.setDraggingWorkspace)
  const setDropTarget = useSidebarStore((state) => state.setDropTarget)
  const setMenu = useSidebarStore((state) => state.setMenuWorkspace)

  const commitDrop = useCallback(
    (targetId: string) => {
      const sourceId = draggingWorkspaceId
      setDragging(undefined)
      setDropTarget(undefined)
      if (!sourceId || sourceId === targetId) return
      const ids = orderSource.map((entry) => entry.workspace.id)
      const from = ids.indexOf(sourceId)
      const to = ids.indexOf(targetId)
      if (from < 0 || to < 0) return
      const next = [...ids]
      next.splice(from, 1)
      next.splice(to, 0, sourceId)
      // Persist only after the drop settles — never on every pointer move.
      actions.onReorder(next)
    },
    [draggingWorkspaceId, orderSource, actions, setDragging, setDropTarget],
  )

  return (
    <ul className="ws-list" role="list">
      {entries.map((entry) => (
        <WorkspaceRow
          key={entry.workspace.id}
          entry={entry}
          active={entry.workspace.id === activeWorkspaceId}
          switching={entry.workspace.id === switchingWorkspaceId}
          dragging={entry.workspace.id === draggingWorkspaceId}
          dropTarget={entry.workspace.id === dropTargetWorkspaceId}
          menuOpen={entry.workspace.id === menuWorkspaceId}
          reorderable={reorderable}
          projectName={projectNameFor?.(entry)}
          actions={actions}
          onOpenMenu={setMenu}
          onDragStart={setDragging}
          onDragEnter={setDropTarget}
          onDragEnd={() => {
            setDragging(undefined)
            setDropTarget(undefined)
          }}
          onDrop={commitDrop}
        />
      ))}
    </ul>
  )
}

/** Shown when a filter matched nothing anywhere, so the list isn't silently empty. */
function FilterFallback({ groups, filterQuery }: { groups: SidebarProjectGroup[]; filterQuery: string }) {
  const anyMatch = groups.some((group) =>
    group.workspaces.some((entry) => matchesSidebarFilter(filterQuery, entry.workspace.name, entry.providers.text)),
  )
  if (anyMatch) return null
  return <p className="sb-no-match">No Workspace matches the filter.</p>
}

function WorkspaceSkeletons() {
  return (
    <ul className="ws-list" aria-hidden>
      {[0, 1, 2].map((key) => (
        <li key={key} className="ws-row ws-row-skeleton">
          <span className="ws-skel-dot" />
          <span className="ws-skel-lines">
            <span className="ws-skel-line" />
            <span className="ws-skel-line short" />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Filter then order one Project's rows for display. Pure so the list stays testable. */
function presentWorkspaces(
  entries: SidebarWorkspace[],
  filterQuery: string,
  sortMode: 'manual' | 'attention',
): SidebarWorkspace[] {
  const matched = entries.filter((entry) =>
    matchesSidebarFilter(filterQuery, entry.workspace.name, entry.providers.text),
  )
  return sortMode === 'attention' ? sortByAttention(matched) : matched
}
