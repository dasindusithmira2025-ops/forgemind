import { useMemo, useState } from 'react'
import { AlertTriangle, FolderOpen, RefreshCw, Rocket } from 'lucide-react'
import type { RecentWorkspace } from '../../../native/types'
import { relativeTime } from '../../../shared/layout'
import { groupRecentsByProject } from '../sidebarSelectors'
import type { SidebarActions } from '../sidebarTypes'

/**
 * Compact Project switcher. Recents are grouped by Project; selecting one routes to that
 * Project's most-recently-opened Workspace (never creating a Workspace silently).
 */
export function ProjectSwitcherPopover({
  currentProjectId,
  recents,
  actions,
  onClose,
}: {
  currentProjectId: string
  recents: RecentWorkspace[]
  actions: SidebarActions
  onClose: () => void
}) {
  const [query, setQuery] = useState('')

  const projects = useMemo(() => groupRecentsByProject(recents), [recents])
  const filtered = projects.filter(
    (row) =>
      row.name.toLowerCase().includes(query.toLowerCase()) ||
      row.path.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <>
      <button className="context-scrim" aria-label="Close project switcher" onClick={onClose} />
      <div className="project-popover" role="dialog" aria-label="Switch project">
        <header className="project-popover-head">Switch project</header>
        <input
          type="search"
          className="project-search"
          placeholder="Search projects"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="project-recent-list" role="list">
          {filtered.length === 0 && <li className="project-recent-empty">No matching projects.</li>}
          {filtered.map((row) => (
            <li key={row.projectId}>
              <button
                type="button"
                className={`project-recent-row ${row.projectId === currentProjectId ? 'is-current' : ''}`}
                disabled={row.missing}
                onClick={() => {
                  onClose()
                  actions.onSelectWorkspace(row.lastActiveWorkspaceId)
                }}
              >
                <span className="project-recent-body">
                  <strong>{row.name}</strong>
                  <span className="project-recent-path" title={row.path}>
                    {row.path}
                  </span>
                  <span className="project-recent-meta">
                    {row.branch ? `${row.branch} · ` : ''}
                    {row.workspaceCount} workspace{row.workspaceCount === 1 ? '' : 's'} ·{' '}
                    {relativeTime(row.lastOpenedAt)}
                  </span>
                </span>
                {row.missing && (
                  <span className="project-recent-warn" title="Folder unavailable">
                    <AlertTriangle size={13} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <footer className="project-popover-actions">
          <button type="button" onClick={() => { onClose(); actions.onOpenProjectFolder() }}>
            <FolderOpen size={14} />
            Open project folder
          </button>
          <button type="button" onClick={() => { onClose(); actions.onOpenLauncher() }}>
            <Rocket size={14} />
            Open project launcher
          </button>
          <button type="button" onClick={() => { onClose(); actions.onRefreshProject() }}>
            <RefreshCw size={14} />
            Refresh project metadata
          </button>
        </footer>
      </div>
    </>
  )
}
