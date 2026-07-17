import { useState } from 'react'
import { Bot, ShieldQuestion } from 'lucide-react'
import { Modal } from '../../../components/ui/Modal'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'

export interface AgentActionRequest {
  title: string
  /** Plain description of the operation the agent is being asked to perform. */
  purpose: string
  defaultBranch: string
  /** Files the agent is expected to touch — becomes the worktree lease scope. */
  fileScope: string[]
  taskId: string
  /** Whether the repository policy is expected to require human approval for this operation. */
  requiresApproval: boolean
  permission: string
}

/**
 * Every agent-native action funnels through this dialog so the human always sees, before
 * anything runs: which agent will act, which branch/worktree it will use, what permission the
 * operation needs, and whether approval is required. Confirming dispatches a real, typed
 * `create_agent_worktree` operation — the frontend never synthesizes shell commands.
 */
export function AgentActionDialog({ request, agents, onClose, onDispatched }: {
  request: AgentActionRequest
  agents: Array<{ id: string; label: string }>
  onClose: () => void
  onDispatched?: () => void
}) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const pending = useRepositoryStore((state) => state.pending)
  const [agentId, setAgentId] = useState(agents[0]?.id ?? 'agent')
  const [branch, setBranch] = useState(request.defaultBranch)
  const busy = Boolean(pending['agent-dispatch'])

  const dispatch = async () => {
    if (!snapshot) return
    try {
      await runOperation({
        kind: 'create_agent_worktree',
        branch,
        baseCommit: snapshot.headSha,
        agentId,
        taskId: request.taskId,
        fileScope: request.fileScope,
      }, { key: 'agent-dispatch' })
      onDispatched?.()
      onClose()
    } catch { /* store surfaces the error banner */ }
  }

  return (
    <Modal title={request.title} onClose={onClose}>
      <div className="repo-agent-dialog">
        <p className="repo-agent-purpose">{request.purpose}</p>
        <label className="repo-field">
          <span>Agent</span>
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} data-autofocus>
            {agents.length === 0 && <option value="agent">Default agent</option>}
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          </select>
        </label>
        <label className="repo-field">
          <span>Worktree branch</span>
          <input value={branch} onChange={(event) => setBranch(event.target.value)} spellCheck={false} />
        </label>
        <dl className="repo-agent-meta">
          <div><dt><Bot size={13} /> Base commit</dt><dd><code>{snapshot?.headSha.slice(0, 10) ?? '—'}</code></dd></div>
          <div><dt>File scope</dt><dd>{request.fileScope.length ? request.fileScope.join(', ') : 'Whole worktree'}</dd></div>
          <div><dt>Task</dt><dd><code>{request.taskId}</code></dd></div>
          <div><dt><ShieldQuestion size={13} /> Permission</dt><dd>{request.permission}</dd></div>
          <div><dt>Approval</dt><dd>{request.requiresApproval ? 'Human approval required before it runs' : 'Runs under current policy'}</dd></div>
        </dl>
        <div className="repo-dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void dispatch()} disabled={busy || !branch.trim() || !snapshot}>
            {busy ? 'Dispatching…' : request.requiresApproval ? 'Request agent worktree' : 'Create agent worktree'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
