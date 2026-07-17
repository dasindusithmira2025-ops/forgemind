import { useEffect, useMemo, useState } from 'react'
import { FolderGit2, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { native } from '../../native/commands'
import type { AgentProfile } from '../../native/types'
import { useRepositoryStore } from './repositoryStore'
import { REPOSITORY_SECTIONS, type RepositorySectionId } from './repositoryTypes'
import { RepositoryHeader } from './components/RepositoryHeader'
import { RepositorySectionNav } from './components/RepositorySectionNav'
import { OverviewSection } from './components/OverviewSection'
import { ChangesSection } from './components/ChangesSection'
import { BranchesSection } from './components/BranchesSection'
import { PullRequestsSection } from './components/PullRequestsSection'
import { ActionsSection } from './components/ActionsSection'
import { IssuesSection, ReleasesSection, SecuritySection } from './components/RemoteListSections'
import { AgentActionDialog, type AgentActionRequest } from './components/AgentActionDialog'

/**
 * The Repository Command Center, scoped to a single project. It owns section navigation and the
 * agent-action dialog; all repository data flows through the project-scoped store. Switching
 * projects (a new `projectId`) reloads the store and never leaks the previous repository's state.
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

  const [section, setSection] = useState<RepositorySectionId>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [agentRequest, setAgentRequest] = useState<AgentActionRequest>()
  const [agents, setAgents] = useState<AgentProfile[]>([])

  // Load the project's repository state and (re)subscribe to backend events for it. Re-runs when
  // the projectId changes so project switching is immediate and isolated.
  useEffect(() => {
    void loadProject(projectId)
    const stop = subscribe()
    return () => stop()
  }, [projectId, loadProject, subscribe])

  // Fetch the provider projection once local ownership is established. The bounded timer keeps
  // active collaboration state useful without polling individual endpoints or crossing projects.
  useEffect(() => {
    if (load.status !== 'ready' || activeProjectId !== projectId) return
    void refreshRemote()
    void native.listAgentProfiles().then(setAgents).catch(() => undefined)
    const timer = window.setInterval(() => { if (useRepositoryStore.getState().projectId === projectId) void refreshRemote() }, 120_000)
    return () => window.clearInterval(timer)
  }, [load.status, activeProjectId, projectId, refreshRemote])

  const counts = useRepositoryCounts()
  const agentOptions = useMemo(() => agents.map((agent) => ({ id: agent.id, label: `${agent.name} (${agent.provider})` })), [agents])
  const requestAgentWorktree = (request: AgentActionRequest) => setAgentRequest(request)

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
    <div className="repo-center">
      <RepositoryHeader projectName={projectName} menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((value) => !value)} />
      {menuOpen && (
        <>
          <button className="context-scrim" aria-label="Close repository menu" onClick={() => setMenuOpen(false)} />
          <div className="context-popover repo-action-popover" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); void refreshSnapshot() }}>Refresh working tree</button>
            <button role="menuitem" onClick={() => { setMenuOpen(false); void refreshRemote() }}>Sync remote projection</button>
          </div>
        </>
      )}

      <RepositorySectionNav active={section} counts={counts} onSelect={setSection} />

      {actionError && <div className="repo-action-error"><ErrorNotice message={actionError} onRetry={clearActionError} /></div>}

      <div className="repo-section-body" role="region" aria-label={REPOSITORY_SECTIONS.find((item) => item.id === section)?.label}>
        {section === 'overview' && <OverviewSection onNavigate={setSection} />}
        {section === 'changes' && <ChangesSection onNavigate={setSection} onRequestAgentWorktree={requestAgentWorktree} />}
        {section === 'branches' && <BranchesSection onRequestAgentWorktree={requestAgentWorktree} />}
        {section === 'pull-requests' && <PullRequestsSection onRequestAgentWorktree={requestAgentWorktree} />}
        {section === 'actions' && <ActionsSection onRequestAgentWorktree={requestAgentWorktree} />}
        {section === 'issues' && <IssuesSection />}
        {section === 'releases' && <ReleasesSection />}
        {section === 'security' && <SecuritySection />}
      </div>

      {agentRequest && <AgentActionDialog request={agentRequest} agents={agentOptions} onClose={() => setAgentRequest(undefined)} />}
    </div>
  )
}

function useRepositoryCounts(): Partial<Record<RepositorySectionId, number>> {
  const changes = useRepositoryStore((state) => state.snapshot?.files.length ?? 0)
  const branches = useRepositoryStore((state) => state.leases.length)
  const prs = useRepositoryStore((state) => state.remoteViews.pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft').length)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns.filter((run) => run.state === 'failure').length)
  const issues = useRepositoryStore((state) => state.remoteViews.issues.length)
  const security = useRepositoryStore((state) => state.remoteViews.securityAlerts.filter((alert) => alert.state === 'open').length)
  return { changes, branches, 'pull-requests': prs, actions: runs, issues, security }
}
