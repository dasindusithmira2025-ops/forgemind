import { useEffect, useRef } from 'react'
import { FolderPlus, Plus, SlidersHorizontal } from 'lucide-react'
import type { RecentWorkspace } from '../../../native/types'
import { useSidebarStore, type SidebarGroupBy, type SidebarSortMode } from '../sidebarStore'
import type { SidebarActions, SidebarOpenProject } from '../sidebarTypes'
import { ProjectPopover } from './ProjectPopover'

const GROUP_BY_OPTIONS: { id: SidebarGroupBy; label: string; hint: string }[] = [
  { id: 'project', label: 'Projects', hint: 'Group Workspaces under their Project' },
  { id: 'flat', label: 'Workspaces', hint: 'One flat list across every open Project' },
]

const SORT_OPTIONS: { id: SidebarSortMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Manual', hint: 'The order you drag rows into' },
  { id: 'attention', label: 'Needs you', hint: 'Blocked and waiting Workspaces first' },
]

/**
 * The list's section header: what the list below is, and the controls that are scoped to it.
 *
 * The title is not decoration — it names the current grouping, so "Projects" vs "Workspaces" is
 * the one-word answer to "why is this list shaped like this". Everything that changes the list
 * (grouping, ordering) lives behind the one options popover; everything that adds to it (open a
 * Project, create a Workspace) is a direct control, because those are the two actions worth a
 * permanent target.
 */
export function SidebarListHeader({
  openProjects,
  recents,
  actions,
}: {
  openProjects: SidebarOpenProject[]
  recents: RecentWorkspace[]
  actions: SidebarActions
}) {
  const groupBy = useSidebarStore((state) => state.groupBy)
  const setGroupBy = useSidebarStore((state) => state.setGroupBy)
  const sortMode = useSidebarStore((state) => state.sortMode)
  const setSortMode = useSidebarStore((state) => state.setSortMode)
  const optionsOpen = useSidebarStore((state) => state.listOptionsOpen)
  const setOptionsOpen = useSidebarStore((state) => state.setListOptionsOpen)
  const projectsOpen = useSidebarStore((state) => state.projectSwitcherOpen)
  const setProjectsOpen = useSidebarStore((state) => state.setProjectSwitcherOpen)
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
    <div className="sb-list-header">
      <span className="sb-list-title" data-group-by={groupBy}>
        {groupBy === 'project' ? 'Projects' : 'Workspaces'}
      </span>

      <div className="sb-list-actions">
        <button
          type="button"
          className="sb-list-action"
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
          className="sb-list-action"
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
          className="sb-list-action"
          aria-label="New workspace"
          title="New workspace"
          onClick={actions.onNewWorkspace}
        >
          <Plus size={15} />
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
