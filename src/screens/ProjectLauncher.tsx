import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { AlertTriangle, Clock3, FolderGit2, FolderOpen, FolderSearch, MoreHorizontal, Play, Plus, RotateCcw, Settings, Sparkles } from 'lucide-react'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Modal } from '../components/ui/Modal'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { Project, ProjectOverview, Workspace } from '../native/types'
import { relativeTime, workspaceSummary } from '../shared/layout'
import { useAppStore } from '../stores/appStore'

export function ProjectLauncher() {
  const navigate = useNavigate()
  const setProject = useAppStore((state) => state.setProject)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const [overviews, setOverviews] = useState<ProjectOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pendingId, setPendingId] = useState<string>()
  const [error, setError] = useState('')
  const [projectMenu, setProjectMenu] = useState<string>()
  const [workspaceMenu, setWorkspaceMenu] = useState<string>()
  const [chooser, setChooser] = useState<ProjectOverview>()
  const [rename, setRename] = useState<{ workspace: Workspace }>()

  const refresh = useCallback(async () => {
    setRefreshing(true); setError('')
    try { setOverviews(await native.listProjectsOverview()) }
    catch (caught) { setError(asNativeError(caught).message) }
    finally { setRefreshing(false); setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Opening a folder never guesses a workspace: it finds/creates exactly one Project, then
  // branches on how many Workspaces that Project owns.
  const resolveFlow = useCallback(async (project: Project) => {
    setProject(project)
    const workspaces = await native.listWorkspacesForProject(project.id)
    if (workspaces.length === 0) { navigate(`/setup/${project.id}`); return }
    if (workspaces.length === 1) { openWorkspace(project, workspaces[0]); return }
    setChooser({ project, workspaces, folderMissing: false })
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, refresh, setProject])

  const chooseFolder = async () => {
    setError('')
    const selected = await open({ directory: true, multiple: false, title: 'Open project folder' })
    if (!selected || Array.isArray(selected)) return
    setBusy(true)
    try { await resolveFlow(await native.openProject(selected)) }
    catch (caught) { setError(asNativeError(caught).message) }
    finally { setBusy(false) }
  }

  const openProjectFolder = async (overview: ProjectOverview) => {
    setError(''); setPendingId(overview.project.id)
    try { await resolveFlow(await native.openProject(overview.project.rootPath)) }
    catch (caught) { setError(asNativeError(caught).message) }
    finally { setPendingId(undefined) }
  }

  const openWorkspace = (project: Project, workspace: Workspace, fresh = false) => {
    setProject(project); setWorkspace(workspace)
    navigate(fresh ? `/workspace/${workspace.id}?fresh=1` : `/workspace/${workspace.id}`)
  }

  const createWorkspace = (project: Project) => { setProject(project); navigate(`/setup/${project.id}`) }
  const reconfigure = (project: Project, workspace: Workspace) => { setProject(project); navigate(`/workspace/${workspace.id}/configure`) }
  const duplicate = (project: Project, workspace: Workspace) => { setProject(project); navigate(`/setup/${project.id}?duplicate=${workspace.id}`) }

  const removeWorkspace = async (workspace: Workspace) => {
    setWorkspaceMenu(undefined)
    try { await native.removeRecentWorkspace(workspace.id); await refresh() }
    catch (caught) { setError(asNativeError(caught).message) }
  }

  const deleteWorkspace = async (workspace: Workspace) => {
    setWorkspaceMenu(undefined)
    if (!window.confirm(`Delete the saved configuration for “${workspace.name}”? Project files are never deleted.`)) return
    try { await native.deleteWorkspaceConfiguration(workspace.id); await refresh() }
    catch (caught) { setError(asNativeError(caught).message) }
  }

  const removeProject = async (project: Project) => {
    setProjectMenu(undefined)
    try { await native.removeRecentProject(project.id); await refresh() }
    catch (caught) { setError(asNativeError(caught).message) }
  }

  const locateFolder = async (project: Project) => {
    setProjectMenu(undefined); setError('')
    const selected = await open({ directory: true, multiple: false, title: `Locate ${project.name}` })
    if (!selected || Array.isArray(selected)) return
    try { await native.relocateProject(project.id, selected); await refresh() }
    catch (caught) { setError(asNativeError(caught).message) }
  }

  const confirmRename = async (value: string) => {
    const target = rename
    setRename(undefined)
    if (!target || !value.trim() || value === target.workspace.name) return
    try { await native.renameWorkspace(target.workspace.id, value.trim()); await refresh() }
    catch (caught) { setError(asNativeError(caught).message) }
  }

  return <main className="launcher-shell">
    <header className="launcher-topbar">
      <Brand />
      <Button variant="ghost" icon={<Settings size={16} />} onClick={() => navigate('/settings')}>Settings</Button>
    </header>
    <section className="launcher-content">
      <div className="launcher-heading">
        <div>
          <p className="section-label">Terminal workspaces</p>
          <h1>Open a project.<br />Build your workspace.</h1>
          <p>Launch coding agents and shells inside one focused terminal environment.</p>
        </div>
        <div className="launcher-primary-actions"><Button variant="primary" icon={<FolderOpen size={17} />} onClick={chooseFolder} disabled={busy}>{busy ? 'Opening…' : 'Open Project Folder'}</Button><Button variant="secondary" icon={<Play size={15} />} disabled={!overviews.some((item) => !item.folderMissing && item.workspaces.length)} onClick={() => { const candidate = overviews.flatMap((item) => item.workspaces.map((workspace) => ({ project: item.project, workspace, missing: item.folderMissing }))).filter((item) => !item.missing).sort((a, b) => b.workspace.lastOpenedAt.localeCompare(a.workspace.lastOpenedAt))[0]; if (candidate) openWorkspace(candidate.project, candidate.workspace) }}>Reopen Last Workspace</Button></div>
      </div>
      {error && <ErrorNotice message={error} onRetry={chooseFolder} />}
      {!loading && overviews.length > 0 && <div className="recent-toolbar">
        <h2>Recent projects</h2>
        <Button variant="ghost" icon={<RotateCcw className={refreshing ? 'is-spinning' : ''} size={14} />} onClick={() => void refresh()} disabled={refreshing}>{refreshing ? 'Refreshing' : 'Refresh'}</Button>
      </div>}
      {loading ? <div className="launcher-loading" aria-label="Loading recent projects"><span /><span /><span /></div>
        : overviews.length === 0 ? <div className="launcher-empty">
          <FolderOpen size={24} strokeWidth={1.4} />
          <h2>No recent projects yet.</h2>
          <p>Open a folder to get started. ForgeMind remembers the projects you work in and the workspaces inside them.</p>
          <Button variant="primary" onClick={chooseFolder}>Open a project folder</Button>
        </div> : <div className="project-list">
          {overviews.map((overview) => {
            const { project, workspaces, folderMissing } = overview
            return <article className={`project-card ${folderMissing ? 'missing' : ''}`} key={project.id}>
              <header className="project-card-head">
                <div className="project-card-icon"><FolderOpen size={18} /></div>
                <div className="project-card-title">
                  <div className="project-name-row"><strong>{project.name}</strong><span className="entity-tag">Project</span>{project.gitBranch && <span className="branch-chip"><FolderGit2 size={11} />{project.gitBranch}</span>}</div>
                  <span className="path-text" title={project.rootPath}>{project.rootPath}</span>
                  {folderMissing && <span className="missing-note"><AlertTriangle size={12} /> Folder is missing — locate it to reopen its workspaces.</span>}
                </div>
                <div className="project-card-actions">
                  {folderMissing
                    ? <Button variant="secondary" icon={<FolderSearch size={14} />} onClick={() => void locateFolder(project)}>Locate folder</Button>
                    : <Button variant="secondary" icon={<Plus size={14} />} onClick={() => createWorkspace(project)}>New workspace</Button>}
                  <div className="menu-wrap">
                    <Button variant="ghost" icon={<MoreHorizontal size={16} />} aria-label={`More actions for project ${project.name}`} onClick={() => setProjectMenu(projectMenu === project.id ? undefined : project.id)} />
                    {projectMenu === project.id && <><button className="context-scrim" aria-label="Close project actions" onClick={() => setProjectMenu(undefined)} /><div className="context-popover" role="menu">
                      <button role="menuitem" disabled={folderMissing} onClick={() => { setProjectMenu(undefined); void openProjectFolder(overview) }}>Refresh metadata</button>
                      <button role="menuitem" onClick={() => { setProjectMenu(undefined); createWorkspace(project) }}>Create new workspace</button>
                      <button role="menuitem" disabled={folderMissing} onClick={() => { setProjectMenu(undefined); void revealItemInDir(project.rootPath) }}>Reveal project folder</button>
                      <button role="menuitem" onClick={() => void locateFolder(project)}>Locate moved folder…</button>
                      <span className="menu-separator" />
                      <button role="menuitem" className="danger-item" onClick={() => void removeProject(project)}>Remove project from recents</button>
                    </div></>}
                  </div>
                </div>
              </header>
              <div className="workspace-rows">
                {workspaces.length === 0 ? <div className="workspace-empty">
                  <span>No workspaces yet.</span>
                  <Button variant="ghost" icon={<Plus size={13} />} onClick={() => createWorkspace(project)}>Create the first workspace</Button>
                </div> : workspaces.map((workspace) => <div className="workspace-row" key={workspace.id}>
                  <div className="workspace-row-primary">
                    <div className="workspace-name-row"><strong>{workspace.name}</strong><span className="entity-tag subtle">Workspace</span></div>
                    <span className="workspace-summary">{workspaceSummary(workspace)}<span className="dot-sep">·</span><span className="workspace-time"><Clock3 size={11} />{relativeTime(workspace.lastOpenedAt)}</span></span>
                  </div>
                  <div className="workspace-row-actions">
                    <Button variant="primary" icon={<Play size={14} />} disabled={folderMissing || Boolean(pendingId)} title={folderMissing ? 'Project folder is missing' : `Open ${workspace.name}`} onClick={() => openWorkspace(project, workspace)}>Open</Button>
                    <div className="menu-wrap">
                      <Button variant="ghost" icon={<MoreHorizontal size={16} />} aria-label={`More actions for workspace ${workspace.name}`} onClick={() => setWorkspaceMenu(workspaceMenu === workspace.id ? undefined : workspace.id)} />
                      {workspaceMenu === workspace.id && <><button className="context-scrim" aria-label="Close workspace actions" onClick={() => setWorkspaceMenu(undefined)} /><div className="context-popover" role="menu">
                        <button role="menuitem" disabled={folderMissing} onClick={() => { setWorkspaceMenu(undefined); openWorkspace(project, workspace) }}>Open workspace</button>
                        <button role="menuitem" disabled={folderMissing} onClick={() => { setWorkspaceMenu(undefined); openWorkspace(project, workspace, true) }}><Sparkles size={13} />Open with fresh terminals</button>
                        <button role="menuitem" onClick={() => { setWorkspaceMenu(undefined); setRename({ workspace }) }}>Rename workspace</button>
                        <button role="menuitem" disabled={folderMissing} onClick={() => { setWorkspaceMenu(undefined); reconfigure(project, workspace) }}>Reconfigure workspace</button>
                        <button role="menuitem" disabled={folderMissing} onClick={() => { setWorkspaceMenu(undefined); duplicate(project, workspace) }}>Duplicate workspace</button>
                        <span className="menu-separator" />
                        <button role="menuitem" onClick={() => void removeWorkspace(workspace)}>Remove workspace from recents</button>
                        <button role="menuitem" className="danger-item" onClick={() => void deleteWorkspace(workspace)}>Delete workspace configuration…</button>
                      </div></>}
                    </div>
                  </div>
                </div>)}
              </div>
            </article>
          })}
        </div>}
    </section>

    {chooser && <Modal title={`Open a workspace in ${chooser.project.name}`} onClose={() => setChooser(undefined)}>
      <div className="workspace-chooser">
        {chooser.workspaces.map((workspace) => <button key={workspace.id} className="workspace-chooser-item" onClick={() => { const project = chooser.project; setChooser(undefined); openWorkspace(project, workspace) }}>
          <div><strong>{workspace.name}</strong><span>{workspaceSummary(workspace)}</span></div>
          <span className="workspace-time"><Clock3 size={11} />{relativeTime(workspace.lastOpenedAt)}</span>
        </button>)}
        <button className="workspace-chooser-item create" onClick={() => { const project = chooser.project; setChooser(undefined); createWorkspace(project) }}>
          <div><strong><Plus size={14} /> Create new workspace</strong><span>Start a fresh terminal layout in this project</span></div>
        </button>
      </div>
    </Modal>}

    {rename && <TextPromptDialog title="Rename workspace" label="Workspace name" initialValue={rename.workspace.name} confirmLabel="Rename" onClose={() => setRename(undefined)} onConfirm={(value) => void confirmRename(value)} />}
  </main>
}
