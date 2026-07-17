import { useMemo, useState } from 'react'
import {
  Bot, GitBranch, GitMerge, Loader2, Plus, RefreshCw, Trash2, TriangleAlert,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
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
  const pending = useRepositoryStore((state) => state.pending)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const refreshLeases = useRepositoryStore((state) => state.refreshLeases)
  const [newBranch, setNewBranch] = useState('')

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
      .then((record) => { if (record.status === 'succeeded') setNewBranch('') })
      .catch(() => undefined)
  }
  const switchBranch = () => {
    const name = window.prompt('Switch to which branch?')?.trim()
    if (!name) return
    void runOperation({ kind: 'switch_branch', name }, { key: 'switch-branch' }).catch(() => undefined)
  }
  const removeWorktree = (leaseId: string, branchName: string) => {
    if (!window.confirm(`Request cleanup of the agent worktree for ${branchName}? The lease is released and the worktree removed.`)) return
    void runOperation({ kind: 'remove_worktree', leaseId }, { key: `remove:${leaseId}` }).catch(() => undefined)
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
        <div className="repo-inline-form">
          <input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="new-branch-name" aria-label="New branch name" spellCheck={false} />
          <Button variant="secondary" icon={pending['create-branch'] ? <Loader2 size={14} className="is-spinning" /> : <Plus size={14} />} onClick={createBranch} disabled={Boolean(pending['create-branch']) || !newBranch.trim()}>Create branch</Button>
        </div>
        <div className="repo-branch-toolbar-actions">
          <Button variant="ghost" icon={<GitMerge size={14} />} onClick={switchBranch} disabled={dirty || Boolean(pending['switch-branch'])} title={dirty ? 'Commit, stash or discard changes before switching' : 'Switch the current branch'}>Switch</Button>
          <Button variant="secondary" icon={<Bot size={14} />} onClick={requestAgentWorktree}>New agent worktree</Button>
          <Button variant="ghost" icon={<RefreshCw size={14} />} aria-label="Refresh branches" onClick={() => void refreshLeases()} />
        </div>
      </div>

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
    </div>
  )
}
