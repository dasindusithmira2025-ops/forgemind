import { useMemo, useState } from 'react'
import {
  Bot, GitBranch, Loader2, Plus, RefreshCw, Trash2, TriangleAlert,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { confirm } from '../../../components/ui/confirm'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, relativeTime, syncStateLabel } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import type { AgentActionRequest } from './AgentActionDialog'

/**
 * Branch and worktree surface built for parallel agents. The current branch is authoritative
 * from the snapshot; each active agent worktree lease renders as its own lane with owner, task,
 * base commit, activity and conflict risk. (Full local/remote branch enumeration is gated on a
 * backend `list_branches` contract; until then this focuses on the agent worktree lifecycle,
 * which the operation contract fully supports.)
 */
export function BranchesSection({ onRequestAgentWorktree }: { onRequestAgentWorktree: (request: AgentActionRequest) => void }) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const leases = useRepositoryStore((state) => state.leases)
  const conflictRisks = useRepositoryStore((state) => state.conflictRisks)
  const branches = useRepositoryStore((state) => state.branches)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const pending = useRepositoryStore((state) => state.pending)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const refreshLeases = useRepositoryStore((state) => state.refreshLeases)
  const refreshBranches = useRepositoryStore((state) => state.refreshBranches)
  const [newBranch, setNewBranch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const sync = deriveSyncState(snapshot)
  const dirty = (snapshot?.files.length ?? 0) > 0
  const riskByLease = useMemo(() => {
    const map = new Map<string, number>()
    for (const risk of conflictRisks) {
      map.set(risk.leftLeaseId, (map.get(risk.leftLeaseId) ?? 0) + risk.overlappingPaths.length)
      map.set(risk.rightLeaseId, (map.get(risk.rightLeaseId) ?? 0) + risk.overlappingPaths.length)
    }
    return map
  }, [conflictRisks])

  const createBranch = () => {
    const name = newBranch.trim()
    if (!name) return
    void runOperation({ kind: 'create_branch', name, startPoint: snapshot?.headSha }, { key: 'create-branch' })
      .then((record) => { if (record.status === 'succeeded') { setNewBranch(''); setCreateOpen(false) } })
      .catch(() => undefined)
  }
  const removeWorktree = (leaseId: string, branchName: string) => {
    void confirm({
      title: `Remove the agent worktree for ${branchName}?`,
      details: ['The lease is released.', 'The worktree directory is removed.', 'The branch itself is kept.'],
      confirmLabel: 'Remove worktree',
      intent: 'danger',
    }).then((confirmed) => {
      if (confirmed) void runOperation({ kind: 'remove_worktree', leaseId }, { key: `remove:${leaseId}` }).catch(() => undefined)
    })
  }

  const requestAgentWorktree = () => onRequestAgentWorktree({
    title: 'Create agent worktree',
    purpose: 'Give an agent an isolated worktree and branch to work in parallel without touching your current tree.',
    defaultBranch: `agent/${Date.now().toString(36)}`,
    fileScope: [],
    taskId: `task-${Date.now().toString(36)}`,
    requiresApproval: false,
    permission: 'Create a git worktree and branch',
  })

  return (
    <div className="repo-branches">
      <div className="repo-branch-toolbar">
        <div className="repo-branch-summary"><strong>{branches.filter((branch) => branch.kind === 'local').length} local</strong><span>{branches.filter((branch) => branch.kind === 'remote').length} remote refs</span></div>
        <div className="repo-branch-toolbar-actions">
          <Button variant="secondary" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>Create branch</Button>
          <Button variant="secondary" icon={<Bot size={14} />} onClick={requestAgentWorktree}>New agent worktree</Button>
          <Button variant="ghost" icon={<RefreshCw size={14} />} aria-label="Refresh branches" onClick={() => { void refreshLeases(); void refreshBranches() }} />
        </div>
      </div>

      {(['local', 'remote'] as const).map((kind) => <div key={kind} className="repo-branch-group">
        <div className="repo-section-subhead"><span>{kind === 'local' ? 'Local branches' : 'Remote branches'}</span><span className="repo-count">{branches.filter((branch) => branch.kind === kind && !branch.current).length}</span></div>
        <ul className="repo-lane-list">{branches.filter((branch) => branch.kind === kind && !branch.current).map((branch) => {
          const lease = leases.find((item) => item.branchName === branch.name)
          const pr = pullRequests.find((item) => item.headBranch === branch.name || branch.name.endsWith(`/${item.headBranch}`))
          const ci = pr ? runs.find((run) => run.commitSha === pr.headSha) : undefined
          const switchTo = () => void runOperation({ kind: 'switch_branch', name: branch.name }, { key: `switch:${branch.name}` }).catch(() => undefined)
          const deleteBranch = () => {
            void confirm({
              title: `Delete local branch ${branch.name}?`,
              details: ['Only the local branch is deleted.', 'Protected, active and unmerged branches are refused.'],
              confirmLabel: 'Delete branch',
              intent: 'danger',
            }).then((confirmed) => {
              if (confirmed) void runOperation({ kind: 'delete_branch', name: branch.name }, { key: `delete:${branch.name}` }).catch(() => undefined)
            })
          }
          return <li key={branch.fullRef} className="repo-branch-lane">
            <div className="repo-branch-lane-main"><GitBranch size={14} /><div><strong>{branch.name}</strong><span className="repo-muted">{branch.latestSubject || 'No commit subject'} · {relativeTime(branch.latestCommitAt)}</span></div></div>
            <div className="repo-branch-lane-status">{lease ? <StatusBadge tone="accent"><Bot size={11} /> {lease.agentId}</StatusBadge> : <StatusBadge tone="neutral">Human</StatusBadge>}{branch.upstream && <span className="repo-muted">{branch.ahead} ahead · {branch.behind} behind</span>}{pr && <StatusBadge tone="accent">PR #{pr.number}</StatusBadge>}{ci && <StatusBadge tone={ci.state === 'success' ? 'success' : ci.state === 'failure' ? 'danger' : 'pending'}>{ci.state}</StatusBadge>}{kind === 'local' && <Button variant="ghost" onClick={switchTo} disabled={dirty}>Switch</Button>}{kind === 'local' && !lease && <button className="repo-icon-btn danger" aria-label={`Delete ${branch.name}`} onClick={deleteBranch}><Trash2 size={13} /></button>}</div>
          </li>
        })}</ul>
      </div>)}

      <div className="repo-branch-lane current">
        <div className="repo-branch-lane-main">
          <GitBranch size={15} aria-hidden />
          <div>
            <strong>{snapshot?.branch ?? 'detached HEAD'}</strong>
            <span className="repo-muted">Current branch · {snapshot?.headSha.slice(0, 10) ?? '—'}</span>
          </div>
        </div>
        <div className="repo-branch-lane-status">
          <StatusBadge tone={sync === 'clean' ? 'success' : 'accent'}>{syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}</StatusBadge>
          {dirty && <StatusBadge tone="warning">{snapshot?.files.length} uncommitted</StatusBadge>}
          <StatusBadge tone="neutral">You</StatusBadge>
        </div>
      </div>

      <div className="repo-section-subhead">
        <span>Agent worktrees</span>
        <span className="repo-count">{leases.length}</span>
      </div>

      {leases.length === 0 && <p className="repo-empty">No active agent worktrees. Create one to let an agent work on an isolated branch in parallel.</p>}

      <ul className="repo-lane-list">
        {leases.map((lease) => {
          const overlaps = riskByLease.get(lease.id) ?? 0
          const tone: BadgeTone = lease.status === 'active' ? 'accent' : lease.status === 'released' ? 'neutral' : 'warning'
          return (
            <li key={lease.id} className="repo-branch-lane agent">
              <div className="repo-branch-lane-main">
                <Bot size={15} aria-hidden />
                <div>
                  <strong>{lease.branchName}</strong>
                  <span className="repo-muted" title={lease.worktreePath}>{lease.agentId} · task {lease.taskId} · base {lease.baseCommit.slice(0, 8)}</span>
                </div>
              </div>
              <div className="repo-branch-lane-status">
                <StatusBadge tone={tone}>{lease.status}</StatusBadge>
                {overlaps > 0 && <StatusBadge tone="danger" icon={<TriangleAlert size={12} />} title="File-scope overlap with another agent worktree">{overlaps} conflict risk</StatusBadge>}
                <span className="repo-muted">{relativeTime(lease.lastActivityAt)}</span>
                <button className="repo-icon-btn danger" title="Request cleanup" aria-label={`Request cleanup of ${lease.branchName}`} disabled={Boolean(pending[`remove:${lease.id}`])} onClick={() => removeWorktree(lease.id, lease.branchName)}><Trash2 size={13} /></button>
              </div>
            </li>
          )
        })}
      </ul>

      {conflictRisks.length > 0 && (
        <div className="repo-conflict-note" role="note">
          <TriangleAlert size={14} />
          <span>{conflictRisks.length} worktree pair{conflictRisks.length === 1 ? '' : 's'} share file scope. Coordinate or rebase before merging to avoid conflicts.</span>
        </div>
      )}
      {createOpen && <div className="repo-modal-backdrop" role="presentation" onMouseDown={() => setCreateOpen(false)}><div className="repo-branch-dialog" role="dialog" aria-modal="true" aria-labelledby="create-branch-title" onMouseDown={(event) => event.stopPropagation()}><header><div><strong id="create-branch-title">Create branch</strong><span>Start from {snapshot?.headSha.slice(0, 10)}</span></div></header><label>Branch name<input autoFocus value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="feature/short-description" spellCheck={false} /></label><p>PARALITH validates the ref name and creates it from the current commit. Switching remains a separate action.</p><footer><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" icon={pending['create-branch'] ? <Loader2 size={14} className="is-spinning" /> : <GitBranch size={14} />} onClick={createBranch} disabled={!newBranch.trim() || Boolean(pending['create-branch'])}>Create branch</Button></footer></div></div>}
    </div>
  )
}
