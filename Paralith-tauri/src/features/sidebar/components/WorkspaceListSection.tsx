import { useCallback } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import type { PresentedGroup, SidebarPresentation } from '../sidebarModel'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions, SidebarWorkspace } from '../sidebarTypes'
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
 * This component holds no derivation. Which rows survive the filter, what order they are in, and
 * which groups drop out entirely are decided by `buildSidebarPresentation` and arrive finished —
 * so the list and the counts describing it can never disagree.
 */
export function WorkspaceListSection({
  presentation,
  activeWorkspaceId,
  switchingWorkspaceId,
  loading,
  actions,
}: {
  presentation: SidebarPresentation
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  loading?: boolean
  actions: SidebarActions
}) {
  const groupBy = useSidebarStore((state) => state.groupBy)
  const menuWorkspaceId = useSidebarStore((state) => state.menuWorkspaceId)
  const menuAnchor = useSidebarStore((state) => state.menuAnchor)
  const setMenu = useSidebarStore((state) => state.setMenuWorkspace)

  const totalWorkspaces = presentation.flat.totalCount

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
        presentation.groups
          .filter((group) => !group.hidden)
          .map((group) => (
            <ProjectGroup
              key={group.project.id}
              group={group}
              filtering={presentation.filtering}
              activeWorkspaceId={activeWorkspaceId}
              switchingWorkspaceId={switchingWorkspaceId}
              actions={actions}
            />
          ))
      ) : (
        <FlatList
          group={presentation.flat}
          filtering={presentation.filtering}
          projectNameById={presentation.groups.length > 1 ? presentation.projectNameById : undefined}
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
      {groupBy === 'project' && presentation.filtering && !presentation.anyMatch && (
        <p className="sb-no-match">No Workspace matches the filter.</p>
      )}
    </>
  )
}

/** One open Project and its Workspaces. */
function ProjectGroup({
  group,
  filtering,
  activeWorkspaceId,
  switchingWorkspaceId,
  actions,
}: {
  group: PresentedGroup
  filtering: boolean
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  actions: SidebarActions
}) {
  const branch = group.project.gitBranch

  return (
    <SidebarGroup
      id={group.groupId}
      label={group.project.name}
      active={group.isActive}
      count={filtering ? group.visibleCount : group.totalCount}
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
      {group.totalCount === 0 ? (
        <p className="sb-no-match">No Workspaces in this Project yet.</p>
      ) : (
        <WorkspaceRows
          entries={group.workspaces}
          orderSource={group.orderSource}
          activeWorkspaceId={activeWorkspaceId}
          switchingWorkspaceId={switchingWorkspaceId}
          reorderable={group.reorderable}
          actions={actions}
        />
      )}
    </SidebarGroup>
  )
}

/** Every Workspace of every open Project in one ungrouped list. */
function FlatList({
  group,
  filtering,
  projectNameById,
  activeWorkspaceId,
  switchingWorkspaceId,
  actions,
}: {
  group: PresentedGroup
  filtering: boolean
  /** Only name the Project on a row when more than one is open; otherwise it repeats and says nothing. */
  projectNameById?: Map<string, string>
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  actions: SidebarActions
}) {
  return (
    <SidebarGroup
      id={group.groupId}
      label="Workspaces"
      count={filtering ? group.visibleCount : group.totalCount}
      forceExpanded={filtering}
    >
      {group.workspaces.length === 0 ? (
        <p className="sb-no-match">No Workspace matches the filter.</p>
      ) : (
        <WorkspaceRows
          entries={group.workspaces}
          orderSource={group.orderSource}
          activeWorkspaceId={activeWorkspaceId}
          switchingWorkspaceId={switchingWorkspaceId}
          reorderable={group.reorderable}
          projectNameFor={
            projectNameById ? (entry) => projectNameById.get(entry.workspace.projectId) : undefined
          }
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
