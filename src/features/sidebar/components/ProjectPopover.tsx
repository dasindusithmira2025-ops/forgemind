import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  FolderOpen,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  X,
} from 'lucide-react'
import type { RecentWorkspace } from '../../../native/types'
import { relativeTime } from '../../../shared/layout'
import { groupRecentsByProject } from '../sidebarSelectors'
import type { SidebarActions, SidebarOpenProject } from '../sidebarTypes'

/**
 * The single Project surface. Everything Project-shaped lives here — switch between the sessions
 * already open, close one, act on the active one, search recents, or open a new folder — so the
 * sidebar body itself is free for the two lists people actually work in.
 *
 * It replaces the previous split between a "Current Projects" group, a "Switch Project" group,
 * a per-row overflow menu, and the brand-logo menu, all of which offered overlapping actions.
 */
export function ProjectPopover({
  openProjects,
  recents,
  actions,
  onClose,
}: {
  openProjects: SidebarOpenProject[]
  recents: RecentWorkspace[]
  actions: SidebarActions
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const active = openProjects.find((entry) => entry.isActive) ?? openProjects[0]
  const openIds = new Set(openProjects.map((entry) => entry.project.id))

  const recentRows = useMemo(() => groupRecentsByProject(recents), [recents])
  const needle = query.trim().toLowerCase()
  const filteredRecents = recentRows
    .filter((row) => !openIds.has(row.projectId))
    .filter((row) => !needle || `${row.name} ${row.path}`.toLowerCase().includes(needle))
    .slice(0, 8)

  // Escape closes from anywhere inside the popover, matching every other overlay in the app.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const node = ref.current
    node?.addEventListener('keydown', onKeyDown)
    return () => node?.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const run = (action?: () => void) => {
    onClose()
    action?.()
  }

  return (
    <>
      <button className="context-scrim" aria-label="Close project menu" onClick={onClose} />
      <div className="sb-project-popover" role="dialog" aria-label="Project" ref={ref}>
        <section className="sb-pop-section" aria-label="Open Project sessions">
          <h3 className="sb-pop-heading">Open sessions</h3>
          <ul className="sb-pop-list" role="list">
            {openProjects.map((entry) => (
              <li key={entry.project.id} className={entry.isActive ? 'is-current' : undefined}>
                <button
                  type="button"
                  className="sb-pop-row"
                  aria-current={entry.isActive ? 'true' : undefined}
                  title={entry.project.rootPath}
                  onClick={() => run(() => actions.onSelectProject?.(entry.project.id))}
                >
                  <span className="sb-pop-check" aria-hidden>
                    {entry.isActive ? <Check size={13} /> : null}
                  </span>
                  <span className="sb-pop-row-body">
                    <strong>{entry.project.name}</strong>
                    <small>
                      {entry.folderMissing
                        ? 'Folder unavailable'
                        : entry.runtimeSummary || (entry.isActive ? 'Active' : 'Background')}
                    </small>
                  </span>
                  {entry.folderMissing && <AlertTriangle size={13} className="sb-pop-warn" />}
                </button>
                <button
                  type="button"
                  className="sb-pop-row-close"
                  aria-label={`Close project ${entry.project.name}`}
                  title="Close Project from session"
                  onClick={() => run(() => actions.onCloseProject?.(entry.project.id))}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {active && (
          <section className="sb-pop-section" aria-label={`Actions for ${active.project.name}`}>
            <h3 className="sb-pop-heading">{active.project.name}</h3>
            <div className="sb-pop-actions">
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    actions.onCreateProjectWorkspace
                      ? actions.onCreateProjectWorkspace(active.project.id)
                      : actions.onNewWorkspace(),
                  )
                }
              >
                <Plus size={14} />
                New Workspace
              </button>
              <button
                type="button"
                disabled={active.folderMissing}
                onClick={() =>
                  run(() =>
                    actions.onRevealProject
                      ? actions.onRevealProject(active.project.id)
                      : actions.onOpenProjectFolder(),
                  )
                }
              >
                <FolderOpen size={14} />
                Reveal folder
              </button>
              <button
                type="button"
                onClick={() =>
                  run(() =>
                    actions.onRefreshProjectById
                      ? actions.onRefreshProjectById(active.project.id)
                      : actions.onRefreshProject(),
                  )
                }
              >
                <RefreshCw size={14} />
                Refresh metadata
              </button>
            </div>
          </section>
        )}

        <section className="sb-pop-section" aria-label="Recent Projects">
          <h3 className="sb-pop-heading">Recent</h3>
          <label className="sb-pop-search">
            <Search size={13} aria-hidden />
            <input
              type="search"
              value={query}
              autoFocus
              aria-label="Search recent Projects"
              placeholder="Search recent Projects"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <ul className="sb-pop-list" role="list">
            {filteredRecents.length === 0 ? (
              <li className="sb-pop-empty">{needle ? 'No matching Projects.' : 'No other recent Projects.'}</li>
            ) : (
              filteredRecents.map((row) => (
                <li key={row.projectId}>
                  <button
                    type="button"
                    className="sb-pop-row"
                    disabled={row.missing}
                    title={row.path}
                    onClick={() => run(() => actions.onOpenProject?.(row.projectId))}
                  >
                    <span className="sb-pop-check" aria-hidden />
                    <span className="sb-pop-row-body">
                      <strong>{row.name}</strong>
                      <small>
                        {row.workspaceCount} Workspace{row.workspaceCount === 1 ? '' : 's'} ·{' '}
                        {relativeTime(row.lastOpenedAt)}
                      </small>
                    </span>
                    {row.missing && <AlertTriangle size={13} className="sb-pop-warn" />}
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <footer className="sb-pop-footer">
          <button type="button" onClick={() => run(actions.onOpenLauncher)}>
            <Rocket size={14} />
            Project launcher
          </button>
          <button type="button" onClick={() => run(actions.onOpenProjectFolder)}>
            <FolderOpen size={14} />
            Open a folder…
          </button>
        </footer>
      </div>
    </>
  )
}
