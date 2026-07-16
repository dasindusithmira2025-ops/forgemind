import { useState } from 'react'
import { AlertTriangle, Folder, FolderOpen, MoreHorizontal, Plus, RefreshCw, X } from 'lucide-react'
import type { SidebarActions, SidebarOpenProject } from '../sidebarTypes'

/**
 * The "Current Projects" section: every Project open in the main PARALITH window. Several may
 * be open simultaneously; exactly one is active (focused). Clicking a Project focuses it —
 * which restores that Project's last-active Workspace/Pane — without closing the others, so
 * their background terminals keep running. The active row exposes Locate when its folder is
 * unavailable; each row can be closed independently.
 */
export function CurrentProjectsSection({
  openProjects,
  actions,
}: {
  openProjects: SidebarOpenProject[]
  actions: SidebarActions
}) {
  const[menu,setMenu]=useState<string>()
  return (
    <section className="project-block current-projects" aria-label="Current projects">
      <header className="ws-section-head">
        <span className="section-label">Current Projects</span>
        {openProjects.length > 1 && <span className="ws-section-count">{openProjects.length}</span>}
      </header>
      <ul className="open-projects-list" role="list">
        {openProjects.map((entry) => {
          const meta = [entry.project.gitBranch, entry.project.detectedFramework].filter(Boolean).join(' · ')
          return (
            <li
              key={entry.project.id}
              className={`open-project-row ${entry.isActive ? 'is-active' : ''} ${entry.folderMissing ? 'is-missing' : ''}`}
            >
              <button
                type="button"
                className="open-project-main"
                aria-current={entry.isActive ? 'true' : undefined}
                title={entry.project.rootPath}
                onClick={() => actions.onSelectProject?.(entry.project.id)}
              >
                <span className="project-icon" aria-hidden>
                  {entry.folderMissing ? <AlertTriangle size={15} /> : <Folder size={15} />}
                </span>
                <span className="project-identity">
                  <strong className="project-name">{entry.project.name}</strong>
                  <span className="project-meta">{entry.folderMissing ? 'Folder unavailable' : meta || 'No git branch'}</span>
                  <span className="project-meta">{entry.runtimeSummary??(entry.isActive?'Active canvas':'Background · terminals retained')}</span>
                </span>
              </button>
              {entry.isActive && entry.folderMissing && (
                <button type="button" className="project-locate" onClick={actions.onLocateFolder}>
                  Locate
                </button>
              )}
              <button type="button" className="open-project-close" aria-label={`Project actions for ${entry.project.name}`} title="Project actions" onClick={()=>setMenu(menu===entry.project.id?undefined:entry.project.id)}><MoreHorizontal size={13}/></button>
              {menu===entry.project.id&&<div className="context-popover project-row-actions" role="menu"><button onClick={()=>actions.onSelectProject?.(entry.project.id)}>Focus Project</button><button onClick={()=>actions.onCreateProjectWorkspace?.(entry.project.id)}><Plus size={13}/> Create Workspace</button><button disabled={entry.folderMissing} onClick={()=>actions.onRevealProject?.(entry.project.id)}><FolderOpen size={13}/> Reveal Folder</button><button onClick={()=>actions.onRefreshProjectById?.(entry.project.id)}><RefreshCw size={13}/> Refresh Metadata</button><button className="danger-item" onClick={()=>actions.onCloseProject?.(entry.project.id)}><X size={13}/> Close Project from Session</button></div>}
              <button
                type="button"
                className="open-project-close"
                aria-label={`Close project ${entry.project.name}`}
                title="Close Project from Session"
                onClick={() => actions.onCloseProject?.(entry.project.id)}
              >
                <X size={13} />
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" className="open-project-add" onClick={actions.onOpenLauncher}>
        <Plus size={13} /> Open another Project
      </button>
    </section>
  )
}
