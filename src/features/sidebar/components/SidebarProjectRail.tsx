import { AlertTriangle, ChevronDown, Folder, X } from 'lucide-react'
import type { RecentWorkspace } from '../../../native/types'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions, SidebarOpenProject } from '../sidebarTypes'
import { ProjectPopover } from './ProjectPopover'

/**
 * The sidebar's identity zone, pinned directly under the brand header and above the scroll
 * region. It answers one question at a glance — "which Project am I in, and what else is still
 * running?" — in one row per Project instead of the previous three-line cards.
 *
 * The active Project is the primary row and doubles as the switcher trigger; every other open
 * Project follows as a single compact row so background sessions stay visible without a menu.
 * All the rarer Project actions (reveal, refresh, recents, open folder) live in the one
 * [[ProjectPopover]] this row opens, so no action has two entry points.
 */
export function SidebarProjectRail({
  openProjects,
  recents,
  actions,
}: {
  openProjects: SidebarOpenProject[]
  recents: RecentWorkspace[]
  actions: SidebarActions
}) {
  const switcherOpen = useSidebarStore((state) => state.projectSwitcherOpen)
  const setSwitcherOpen = useSidebarStore((state) => state.setProjectSwitcherOpen)

  const active = openProjects.find((entry) => entry.isActive) ?? openProjects[0]
  const background = openProjects.filter((entry) => entry !== active)
  if (!active) return null

  const branch = active.project.gitBranch
  const detail = [active.project.detectedFramework, active.runtimeSummary].filter(Boolean).join(' · ')

  return (
    <div className="sb-project-rail">
      <button
        type="button"
        className={`sb-project-current ${active.folderMissing ? 'is-missing' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={switcherOpen}
        aria-label={`Project ${active.project.name}. Switch project`}
        title={active.project.rootPath}
        onClick={() => setSwitcherOpen(!switcherOpen)}
      >
        <span className="sb-project-icon" aria-hidden>
          {active.folderMissing ? <AlertTriangle size={15} /> : <Folder size={15} />}
        </span>
        <span className="sb-project-identity">
          <span className="sb-project-name">{active.project.name}</span>
          <span className="sb-project-sub">
            {active.folderMissing ? 'Folder unavailable' : branch || detail || 'No git branch'}
          </span>
        </span>
        {background.length > 0 && (
          <span className="sb-project-more" title={`${background.length} more Project session(s) open`}>
            +{background.length}
          </span>
        )}
        <ChevronDown size={14} className="sb-project-chevron" aria-hidden />
      </button>

      {active.folderMissing && (
        <button type="button" className="sb-project-locate" onClick={actions.onLocateFolder}>
          Locate folder
        </button>
      )}

      {background.length > 0 && (
        <ul className="sb-project-background" role="list" aria-label="Background Project sessions">
          {background.map((entry) => (
            <li key={entry.project.id} className={entry.folderMissing ? 'is-missing' : undefined}>
              <button
                type="button"
                className="sb-project-background-main"
                aria-label={`Focus project ${entry.project.name}`}
                title={`${entry.project.rootPath} — click to focus`}
                onClick={() => actions.onSelectProject?.(entry.project.id)}
              >
                <span className={`sb-project-dot ${entry.folderMissing ? 'is-missing' : ''}`} aria-hidden />
                <span className="sb-project-background-name">{entry.project.name}</span>
                <span className="sb-project-background-state">
                  {entry.folderMissing ? 'Unavailable' : entry.runtimeSummary || 'Background'}
                </span>
              </button>
              <button
                type="button"
                className="sb-project-background-close"
                aria-label={`Close project ${entry.project.name}`}
                title="Close Project from session"
                onClick={() => actions.onCloseProject?.(entry.project.id)}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Anchored to the rail, which sits outside the scroll region — so it never clips. */}
      {switcherOpen && (
        <ProjectPopover
          openProjects={openProjects}
          recents={recents}
          actions={actions}
          onClose={() => setSwitcherOpen(false)}
        />
      )}
    </div>
  )
}
