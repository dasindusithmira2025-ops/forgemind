import { useEffect, useMemo, useState } from 'react'
import { GitBranch, Loader2 } from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { asNativeError, native } from '../../../native/commands'
import type { AgentProfile, Workspace } from '../../../native/types'
import { useRepositoryStore } from '../../repository/repositoryStore'
import { deriveSyncState, syncStateLabel } from '../../repository/repositorySelectors'
import { ChangesSection } from '../../repository/components/ChangesSection'
import { HistorySection } from '../../repository/components/HistorySection'
import { PullRequestsSection } from '../../repository/components/PullRequestsSection'
import { AgentActionDialog, type AgentActionRequest } from '../../repository/components/AgentActionDialog'

type SourceControlView = 'changes' | 'graph' | 'review'

const VIEWS: { id: SourceControlView; label: string }[] = [
  { id: 'changes', label: 'Changes' },
  { id: 'graph', label: 'Graph' },
  { id: 'review', label: 'Review' },
]

/**
 * Workspace-scoped Source Control. The persisted surface kind is still `diff` for compatibility,
 * but the behavior is Source Control: status, diff, stage, commit, push and PR context are resolved
 * from the active Workspace pane's worktree path, not from a global Project repository.
 *
 * The surface owns one chrome row — repository state on the left, view tabs on the right — so the
 * workspace toolbar, the surface header and the view switch read as a single band instead of three
 * stacked toolbars.
 */
export function DiffSurface({ projectId, projectRootPath, workspaceId }: { projectId: string; projectRootPath: string; workspaceId: string }) {
  const loadProject = useRepositoryStore((state) => state.loadProject)
  const activeProjectId = useRepositoryStore((state) => state.projectId)
  const activeWorktreePath = useRepositoryStore((state) => state.worktreePath)
  const load = useRepositoryStore((state) => state.load)
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const historyLoaded = useRepositoryStore((state) => state.historyLoaded)
  const historyLoading = useRepositoryStore((state) => state.historyLoading)
  const loadHistory = useRepositoryStore((state) => state.loadHistory)
  const [workspace, setWorkspace] = useState<Workspace>()
  const [workspaceError, setWorkspaceError] = useState('')
  const [agentRequest, setAgentRequest] = useState<AgentActionRequest>()
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [view, setView] = useState<SourceControlView>('changes')

  useEffect(() => {
    let live = true
    setWorkspaceError('')
    void native.getWorkspace(workspaceId)
      .then((value) => { if (live) setWorkspace(value) })
      .catch((caught) => { if (live) setWorkspaceError(asNativeError(caught).message) })
    void native.listAgentProfiles().then((value) => { if (live) setAgents(value) }).catch(() => undefined)
    return () => { live = false }
  }, [workspaceId])

  const worktreePath = useMemo(() => {
    const active = workspace?.panes.find((pane) => pane.id === workspace.activePaneId)
    return active?.workingDirectory ?? workspace?.panes[0]?.workingDirectory ?? projectRootPath
  }, [projectRootPath, workspace])

  useEffect(() => {
    if (!worktreePath) return
    void loadProject(projectId, { repositoryPath: projectRootPath, worktreePath })
  }, [projectId, projectRootPath, worktreePath, loadProject])

  // History is a Git walk, so it is paid for only when the Graph view is actually opened. The
  // store clears `historyLoaded` whenever the project or worktree changes, which is what makes a
  // worktree switch re-read rather than leaving another branch's commits on screen.
  const ready = activeProjectId === projectId && activeWorktreePath === worktreePath && load.status === 'ready'
  useEffect(() => {
    if (view !== 'graph' || !ready || historyLoaded || historyLoading) return
    void loadHistory()
  }, [view, ready, historyLoaded, historyLoading, loadHistory])

  if (workspaceError) {
    return <div className="surface-status"><ErrorNotice message={workspaceError} /></div>
  }
  if (activeProjectId !== projectId || activeWorktreePath !== worktreePath || load.status === 'loading' || !workspace) {
    return <div className="surface-status"><Loader2 size={16} className="spin" aria-hidden /><span>Loading source control...</span></div>
  }
  if (load.status === 'error') {
    return <div className="surface-status"><ErrorNotice message={load.errorMessage ?? 'Could not load source control.'} onRetry={() => void loadProject(projectId, { repositoryPath: projectRootPath, worktreePath })} /></div>
  }

  const changed = snapshot?.files.length ?? 0
  const sync = deriveSyncState(snapshot)

  return (
    <div className="diff-surface">
      <div className="source-control-bar">
        <div className="source-control-state" title={snapshot?.worktreePath}>
          <GitBranch size={12} aria-hidden />
          <code className="sc-branch">{snapshot?.branch ?? 'detached HEAD'}</code>
          <span className={changed > 0 ? 'sc-dirty' : 'sc-clean'}>
            {changed > 0 ? `${changed} changed` : 'clean'}
          </span>
          {sync !== 'clean' && <span className="sc-sync">{syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}</span>}
        </div>
        <div className="source-control-tabs" role="tablist" aria-label="Source Control views">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={view === entry.id}
              className={view === entry.id ? 'active' : ''}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'changes' && <ChangesSection onNavigate={(section) => { if (section === 'pull-requests') setView('review') }} onRequestAgentWorktree={setAgentRequest} />}
      {view === 'graph' && <HistorySection />}
      {view === 'review' && <PullRequestsSection onRequestAgentWorktree={setAgentRequest} />}
      {agentRequest && (
        <AgentActionDialog
          request={agentRequest}
          agents={agents.map((agent) => ({ id: agent.id, label: `${agent.name} (${agent.provider})` }))}
          onClose={() => setAgentRequest(undefined)}
        />
      )}
    </div>
  )
}
