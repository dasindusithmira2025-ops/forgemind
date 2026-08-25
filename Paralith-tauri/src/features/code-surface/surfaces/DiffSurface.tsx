import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { asNativeError, native } from '../../../native/commands'
import type { AgentProfile, Workspace } from '../../../native/types'
import { useRepositoryStore } from '../../repository/repositoryStore'
import { ChangesSection } from '../../repository/components/ChangesSection'
import { PullRequestsSection } from '../../repository/components/PullRequestsSection'
import { AgentActionDialog, type AgentActionRequest } from '../../repository/components/AgentActionDialog'

/**
 * Workspace-scoped Source Control. The persisted surface kind is still `diff` for compatibility,
 * but the behavior is Source Control: status, diff, stage, commit, push and PR context are resolved
 * from the active Workspace pane's worktree path, not from a global Project repository.
 */
export function DiffSurface({ projectId, projectRootPath, workspaceId }: { projectId: string; projectRootPath: string; workspaceId: string }) {
  const loadProject = useRepositoryStore((state) => state.loadProject)
  const activeProjectId = useRepositoryStore((state) => state.projectId)
  const activeWorktreePath = useRepositoryStore((state) => state.worktreePath)
  const load = useRepositoryStore((state) => state.load)
  const [workspace, setWorkspace] = useState<Workspace>()
  const [workspaceError, setWorkspaceError] = useState('')
  const [agentRequest, setAgentRequest] = useState<AgentActionRequest>()
  const [agents, setAgents] = useState<AgentProfile[]>([])
  const [view, setView] = useState<'changes' | 'review'>('changes')

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

  if (workspaceError) {
    return <div className="surface-status"><ErrorNotice message={workspaceError} /></div>
  }
  if (activeProjectId !== projectId || activeWorktreePath !== worktreePath || load.status === 'loading' || !workspace) {
    return <div className="surface-status"><Loader2 size={16} className="spin" aria-hidden /><span>Loading source control...</span></div>
  }
  if (load.status === 'error') {
    return <div className="surface-status"><ErrorNotice message={load.errorMessage ?? 'Could not load source control.'} onRetry={() => void loadProject(projectId, { repositoryPath: projectRootPath, worktreePath })} /></div>
  }

  return (
    <div className="diff-surface">
      <div className="source-control-tabs" role="tablist" aria-label="Source Control views">
        <button type="button" role="tab" aria-selected={view === 'changes'} className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}>Changes</button>
        <button type="button" role="tab" aria-selected={view === 'review'} className={view === 'review' ? 'active' : ''} onClick={() => setView('review')}>Review</button>
      </div>
      {view === 'changes'
        ? <ChangesSection onNavigate={(section) => { if (section === 'pull-requests') setView('review') }} onRequestAgentWorktree={setAgentRequest} />
        : <PullRequestsSection onRequestAgentWorktree={setAgentRequest} />}
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
