import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { native } from '../../native/commands'
import type { AgentProfile } from '../../native/types'
import { useRepositoryStore } from './repositoryStore'
import { REPOSITORY_SECTIONS, type RepositorySectionId } from './repositoryTypes'
import { type ActionsFilterId, type PrFilterId, type RepositoryFilterId, type RepositoryNavTarget } from './repositoryNav'
import { RepositoryHeader } from './components/RepositoryHeader'
import { RepositorySidebar } from './components/RepositorySidebar'
import { RepositoryStatStrip } from './components/RepositoryStatStrip'
import { ContextRail } from './components/ContextRail'
import { OverviewSection } from './components/OverviewSection'
import { ChangesSection } from './components/ChangesSection'
import { IntelligenceSection } from './components/IntelligenceSection'
import { BranchesSection } from './components/BranchesSection'
import { PullRequestsSection } from './components/PullRequestsSection'
import { ActionsSection } from './components/ActionsSection'
import { IssuesSection, ReleasesSection, SecuritySection } from './components/RemoteListSections'
import { AgentActionDialog, type AgentActionRequest } from './components/AgentActionDialog'
import { CreateBranchDialog } from './components/CreateBranchDialog'

interface NavState {
  section: RepositorySectionId
  filterId?: RepositoryFilterId
  prFilter: PrFilterId
  actionsFilter: ActionsFilterId
  selectedPr?: number
}

const DEFAULT_NAV: NavState = { section: 'overview', prFilter: 'active', actionsFilter: 'all' }
const CONTEXT_MIN = 248
const CONTEXT_MAX = 560
const CONTEXT_DEFAULT = 328

/**
 * The Repository Command Center — one persistent, project-scoped workspace. It composes four
 * coordinated regions (header + attention strip, navigation rail, primary work surface, and the
 * contextual intelligence rail) so an operator can understand and drive the whole repository
 * lifecycle without switching between disconnected full-page tabs. Selection changes context
 * inside the surface and rail while the header, navigation, project scope and sync state persist.
 */
export function RepositoryCommandCenter({ projectId, projectName }: { projectId: string; projectName: string }) {
  const load = useRepositoryStore((state) => state.load)
  const activeProjectId = useRepositoryStore((state) => state.projectId)
  const actionError = useRepositoryStore((state) => state.actionError)
  const clearActionError = useRepositoryStore((state) => state.clearActionError)
  const loadProject = useRepositoryStore((state) => state.loadProject)
  const subscribe = useRepositoryStore((state) => state.subscribe)
  const refreshSnapshot = useRepositoryStore((state) => state.refreshSnapshot)
  const refreshRemote = useRepositoryStore((state) => state.refreshRemote)
  const loadIntelligence = useRepositoryStore((state) => state.loadIntelligence)

  const [nav, setNav] = useState<NavState>(() => loadNav(projectId))
  const [selectedRun, setSelectedRun] = useState<number>()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [contextCollapsed, setContextCollapsed] = useState(false)
  const [contextWidth, setContextWidth] = useState(() => loadContextWidth())
  const [syncing, setSyncing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [agentRequest, setAgentRequest] = useState<AgentActionRequest>()
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const workspaceRef = useRef<HTMLDivElement>(null)

  // Load the project's repository state and (re)subscribe to backend events for it. Re-runs when
  // the projectId changes so project switching is immediate and isolated.
  useEffect(() => {
    void loadProject(projectId)
    setNav(loadNav(projectId))
    setSelectedRun(undefined)
    const stop = subscribe()
    return () => stop()
  }, [projectId, loadProject, subscribe])

  // Persist the navigation intent per project so a refresh or restart reopens the same context.
  useEffect(() => { saveNav(projectId, nav) }, [projectId, nav])
  useEffect(() => { try { window.localStorage.setItem('rcc:contextWidth', String(contextWidth)) } catch { /* best-effort */ } }, [contextWidth])

  // Fetch the provider projection once local ownership is established. The bounded timer keeps
  // active collaboration state useful without polling individual endpoints or crossing projects.
  useEffect(() => {
    if (load.status !== 'ready' || activeProjectId !== projectId) return
    void refreshRemote()
    void native.listAgentProfiles().then(setAgents).catch(() => undefined)
    const timer = window.setInterval(() => { if (useRepositoryStore.getState().projectId === projectId) void refreshRemote() }, 120_000)
    return () => window.clearInterval(timer)
  }, [load.status, activeProjectId, projectId, refreshRemote])

  // Read the stored graph only when the Intelligence section is actually opened. It is one
  // indexed query rather than an extraction, so re-reading on entry keeps the view current
  // without ever running Git behind the user's back.
  useEffect(() => {
    if (nav.section !== 'intelligence' || load.status !== 'ready' || activeProjectId !== projectId) return
    void loadIntelligence()
  }, [nav.section, load.status, activeProjectId, projectId, loadIntelligence])

  const navigate = (target: RepositoryNavTarget) => setNav((prev) => ({
    section: target.section,
    filterId: target.filterId,
    prFilter: target.prFilter ?? prev.prFilter,
    actionsFilter: target.actionsFilter ?? prev.actionsFilter,
    selectedPr: prev.selectedPr,
  }))
  const goSection = (section: RepositorySectionId) => navigate({ section })
  const requestAgentWorktree = (request: AgentActionRequest) => setAgentRequest(request)
  const requestDefaultWorktree = () => requestAgentWorktree({
    title: 'Create agent worktree',
    purpose: 'Give an agent an isolated worktree and branch to work in parallel without touching your current tree.',
    defaultBranch: `agent/${Date.now().toString(36)}`,
    fileScope: [],
    taskId: `task-${Date.now().toString(36)}`,
    requiresApproval: false,
    permission: 'Create a git worktree and branch',
  })
  const doSync = () => {
    setSyncing(true)
    void Promise.allSettled([refreshRemote(), refreshSnapshot()]).finally(() => setSyncing(false))
  }

  const clampWidth = (value: number) => Math.min(CONTEXT_MAX, Math.max(CONTEXT_MIN, value))
  const startResize = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => {
      const rect = workspaceRef.current?.getBoundingClientRect()
      if (rect) setContextWidth(clampWidth(rect.right - moveEvent.clientX))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])
  const resizeKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setContextWidth((width) => clampWidth(width + 24)) }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setContextWidth((width) => clampWidth(width - 24)) }
  }

  const agentOptions = useMemo(() => agents.map((agent) => ({ id: agent.id, label: `${agent.name} (${agent.provider})` })), [agents])
  const sectionLabel = REPOSITORY_SECTIONS.find((item) => item.id === nav.section)?.label

  if (load.status === 'loading' || load.status === 'idle') {
    return <div className="repo-center-loading"><Loader2 size={20} className="is-spinning" /><span>Inspecting repository…</span></div>
  }
  if (load.status === 'error') {
    const notRepo = load.errorCode === 'not_a_repository' || /not a (git )?repo/i.test(load.errorMessage ?? '')
    return (
      <div className="repo-center-error">
        <FolderGit2 size={28} />
        <h2>{notRepo ? 'No git repository here' : 'Repository unavailable'}</h2>
        <p>{load.errorMessage ?? 'The repository could not be inspected.'}</p>
        <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void loadProject(projectId)}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="repo-center rcc">
      <RepositoryHeader projectName={projectName} menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((value) => !value)} onSync={doSync} syncing={syncing} />
      {menuOpen && (
        <>
          <button className="context-scrim" aria-label="Close repository menu" onClick={() => setMenuOpen(false)} />
          <div className="context-popover repo-action-popover" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); void refreshSnapshot() }}>Refresh working tree</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void refreshRemote() }}>Sync remote projection</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); setContextCollapsed((value) => !value) }}>{contextCollapsed ? 'Show' : 'Hide'} context rail</button>
          </div>
        </>
      )}

      <RepositoryStatStrip onNavigate={navigate} />

      {actionError && <div className="repo-action-error"><ErrorNotice message={actionError} onRetry={clearActionError} /></div>}

      <div className="rcc-body">
        <RepositorySidebar
          active={nav.section}
          activeFilter={nav.filterId}
          collapsed={railCollapsed}
          onNavigate={navigate}
          onToggleCollapse={() => setRailCollapsed((value) => !value)}
          onCreateBranch={() => setCreateBranchOpen(true)}
          onCreateWorktree={requestDefaultWorktree}
        />

        <div className="rcc-workspace" ref={workspaceRef}>
          <div className="rcc-surface" role="region" aria-label={sectionLabel}>
            {nav.section === 'overview' && <OverviewSection onNavigate={goSection} />}
            {nav.section === 'changes' && <ChangesSection onNavigate={goSection} onRequestAgentWorktree={requestAgentWorktree} />}
            {nav.section === 'intelligence' && <IntelligenceSection />}
            {nav.section === 'branches' && <BranchesSection onRequestAgentWorktree={requestAgentWorktree} />}
            {nav.section === 'pull-requests' && (
              <PullRequestsSection
                filter={nav.prFilter}
                selected={nav.selectedPr}
                onFilterChange={(filter) => setNav((prev) => ({ ...prev, prFilter: filter, filterId: undefined }))}
                onSelect={(number) => setNav((prev) => ({ ...prev, selectedPr: number }))}
                onRequestAgentWorktree={requestAgentWorktree}
              />
            )}
            {nav.section === 'actions' && <ActionsSection runFilter={nav.actionsFilter} onRequestAgentWorktree={requestAgentWorktree} />}
            {nav.section === 'issues' && <IssuesSection />}
            {nav.section === 'releases' && <ReleasesSection />}
            {nav.section === 'security' && <SecuritySection />}
          </div>

          {!contextCollapsed && (
            <>
              <div
                className="rcc-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize context rail"
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={resizeKey}
              />
              <div className="rcc-context-holder" style={{ width: contextWidth }}>
                <ContextRail section={nav.section} selectedRunId={selectedRun} onSelectRun={setSelectedRun} onNavigate={navigate} />
              </div>
            </>
          )}
        </div>
      </div>

      {agentRequest && <AgentActionDialog request={agentRequest} agents={agentOptions} onClose={() => setAgentRequest(undefined)} />}
      {createBranchOpen && <CreateBranchDialog onClose={() => setCreateBranchOpen(false)} />}
    </div>
  )
}

function loadNav(projectId: string): NavState {
  try {
    const raw = window.localStorage.getItem(`rcc:nav:${projectId}`)
    if (!raw) return DEFAULT_NAV
    const parsed = JSON.parse(raw) as Partial<NavState>
    const section = REPOSITORY_SECTIONS.some((item) => item.id === parsed.section) ? parsed.section! : 'overview'
    return {
      section,
      filterId: parsed.filterId,
      prFilter: parsed.prFilter ?? 'active',
      actionsFilter: parsed.actionsFilter ?? 'all',
      selectedPr: typeof parsed.selectedPr === 'number' ? parsed.selectedPr : undefined,
    }
  } catch {
    return DEFAULT_NAV
  }
}

function saveNav(projectId: string, nav: NavState) {
  try { window.localStorage.setItem(`rcc:nav:${projectId}`, JSON.stringify(nav)) } catch { /* storage is best-effort */ }
}

function loadContextWidth(): number {
  try {
    const value = Number(window.localStorage.getItem('rcc:contextWidth'))
    if (Number.isFinite(value) && value >= CONTEXT_MIN && value <= CONTEXT_MAX) return value
  } catch { /* best-effort */ }
  return CONTEXT_DEFAULT
}
