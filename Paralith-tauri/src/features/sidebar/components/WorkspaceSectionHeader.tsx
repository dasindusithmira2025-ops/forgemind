import { useEffect, useRef } from 'react'
import { ChevronDown, FolderPlus, Plus, SlidersHorizontal } from 'lucide-react'
import type { RecentWorkspace } from '../../../native/types'
import { useSidebarStore, type SidebarGroupBy, type SidebarSortMode } from '../sidebarStore'
import type { SidebarActions, SidebarOpenProject } from '../sidebarTypes'
import { ProjectPopover } from './ProjectPopover'

/** The persisted collapse key for the whole Workspace section. Shares the group-collapse store, so
 *  it survives a restart exactly like every other section. */
export const WORKSPACE_SECTION_ID = 'workspaces-section'

const GROUP_BY_OPTIONS: { id: SidebarGroupBy; label: string; hint: string }[] = [
  { id: 'project', label: 'Projects', hint: 'Group Workspaces under their Project' },
  { id: 'flat', label: 'Workspaces', hint: 'One flat list across every open Project' },
]

const SORT_OPTIONS: { id: SidebarSortMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Manual', hint: 'The order you drag rows into' },
  { id: 'attention', label: 'Needs you', hint: 'Blocked and waiting Workspaces first' },
]

/**
 * The one section header the sidebar has: WORKSPACES, plus the controls scoped to that list.
 *
 * Two controls are permanent, because they are the two the list is worth having: add, and
 * collapse. Everything that *changes* the list rather than adding to it — grouping, order, opening
 * another Project — is revealed on hover or focus, so the resting sidebar is a label and a
 * plus sign rather than a row of chrome. Keyboard reach is unchanged: the buttons are always in
 * the tab order and appear the moment they take focus.
 */
export function WorkspaceSectionHeader({
  openProjects,
  recents,
  actions,
  collapsed,
  count,
}: {
  openProjects: SidebarOpenProject[]
  recents: RecentWorkspace[]
  actions: SidebarActions
  collapsed: boolean
  /** Workspaces in the list, shown only while it is collapsed — otherwise the rows say it. */
  count: number
}) {
  const groupBy = useSidebarStore((state) => state.groupBy)
  const setGroupBy = useSidebarStore((state) => state.setGroupBy)
  const sortMode = useSidebarStore((state) => state.sortMode)
  const setSortMode = useSidebarStore((state) => state.setSortMode)
  const optionsOpen = useSidebarStore((state) => state.listOptionsOpen)
  const setOptionsOpen = useSidebarStore((state) => state.setListOptionsOpen)
  const projectsOpen = useSidebarStore((state) => state.projectSwitcherOpen)
  const setProjectsOpen = useSidebarStore((state) => state.setProjectSwitcherOpen)
  const setGroupCollapsed = useSidebarStore((state) => state.setGroupCollapsed)
  const optionsRef = useRef<HTMLDivElement>(null)

  // Escape closes the options popover from anywhere inside it, matching every other overlay.
  useEffect(() => {
    if (!optionsOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOptionsOpen(false)
      }
    }
    const node = optionsRef.current
    node?.addEventListener('keydown', onKeyDown)
    return () => node?.removeEventListener('keydown', onKeyDown)
  }, [optionsOpen, setOptionsOpen])

  return (
    <div className={`sb-section-header ${optionsOpen || projectsOpen ? 'is-open' : ''}`}>
      <span className="sb-section-title">Workspaces</span>
      {collapsed && count > 0 && (
        <span className="sb-section-count" aria-hidden>
          {count}
        </span>
      )}

      <div className="sb-section-actions">
        <button
          type="button"
          className="sb-section-action is-secondary"
          aria-label="List options"
          aria-haspopup="dialog"
          aria-expanded={optionsOpen}
          title="Grouping and order"
          onClick={() => setOptionsOpen(!optionsOpen)}
        >
          <SlidersHorizontal size={14} />
        </button>
        <button
          type="button"
          className="sb-section-action is-secondary"
          aria-label="Open a Project"
          aria-haspopup="dialog"
          aria-expanded={projectsOpen}
          title="Open a Project"
          onClick={() => setProjectsOpen(!projectsOpen)}
        >
          <FolderPlus size={14} />
        </button>
        <button
          type="button"
          className="sb-section-action"
          aria-label="New workspace"
          title="New workspace"
          onClick={actions.onNewWorkspace}
        >
          <Plus size={15} />
        </button>
        <button
          type="button"
          className="sb-section-action sb-section-chevron"
          aria-expanded={!collapsed}
          aria-controls="sidebar-workspace-list"
          aria-label={collapsed ? 'Expand workspace list' : 'Collapse workspace list'}
          title={collapsed ? 'Expand workspace list' : 'Collapse workspace list'}
          onClick={() => setGroupCollapsed(WORKSPACE_SECTION_ID, !collapsed)}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {optionsOpen && (
        <>
          <button className="context-scrim" aria-label="Close list options" onClick={() => setOptionsOpen(false)} />
          <div className="sb-options-popover" role="dialog" aria-label="List options" ref={optionsRef}>
            <SegmentedChoice
              heading="Group by"
              options={GROUP_BY_OPTIONS}
              value={groupBy}
              onChange={setGroupBy}
            />
            <SegmentedChoice heading="Order" options={SORT_OPTIONS} value={sortMode} onChange={setSortMode} />
            {sortMode === 'attention' && (
              <p className="sb-options-note">Drag to reorder is paused while this order is active.</p>
            )}
          </div>
        </>
      )}

      {projectsOpen && (
        <ProjectPopover
          openProjects={openProjects}
          recents={recents}
          actions={actions}
          onClose={() => setProjectsOpen(false)}
        />
      )}
    </div>
  )
}

/** One labelled segmented control. Kept local: the sidebar is its only caller. */
function SegmentedChoice<T extends string>({
  heading,
  options,
  value,
  onChange,
}: {
  heading: string
  options: { id: T; label: string; hint: string }[]
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="sb-options-group">
      <h3 className="sb-options-heading">{heading}</h3>
      <div className="sb-segmented" role="radiogroup" aria-label={heading}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={value === option.id}
            className={`sb-segment ${value === option.id ? 'is-selected' : ''}`}
            title={option.hint}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
