import { AlertTriangle, ChevronDown, Folder } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'
import { ProjectSwitcherPopover } from './ProjectSwitcherPopover'

/**
 * The Current Project header: identity + git branch + framework, and the entry point to the
 * Project switcher. The full path is never shown permanently — only via tooltip/popover.
 */
export function CurrentProjectBlock({
  project,
  recents,
  projectFolderMissing,
  actions,
}: Pick<ForgeSpaceSidebarProps, 'project' | 'recents' | 'projectFolderMissing' | 'actions'>) {
  const open = useSidebarStore((state) => state.projectSwitcherOpen)
  const setOpen = useSidebarStore((state) => state.setProjectSwitcherOpen)

  const meta = [project.gitBranch, project.detectedFramework].filter(Boolean).join(' · ')

  return (
    <div className="project-block">
      <span className="section-label">Current project</span>
      <div className="project-switcher-wrap">
        <button
          type="button"
          className={`project-trigger ${projectFolderMissing ? 'is-missing' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={project.rootPath}
          onClick={() => setOpen(!open)}
        >
          <span className="project-icon" aria-hidden>
            {projectFolderMissing ? <AlertTriangle size={16} /> : <Folder size={16} />}
          </span>
          <span className="project-identity">
            <strong className="project-name">{project.name}</strong>
            <span className="project-meta">
              {projectFolderMissing ? 'Folder unavailable' : meta || 'No git branch'}
            </span>
          </span>
          <ChevronDown size={15} className="project-chevron" aria-hidden />
        </button>

        {projectFolderMissing && (
          <button type="button" className="project-locate" onClick={actions.onLocateFolder}>
            Locate folder
          </button>
        )}

        {open && (
          <ProjectSwitcherPopover
            currentProjectId={project.id}
            recents={recents}
            actions={actions}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
