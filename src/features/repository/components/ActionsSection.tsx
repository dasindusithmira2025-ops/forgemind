import { useState } from 'react'
import {
  Bot, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Clock, RotateCcw, XCircle,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { formatDuration, relativeTime } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { ConnectedPlaceholder } from './ConnectedPlaceholder'
import type { WorkflowRunState, WorkflowRunView } from '../repositoryTypes'
import type { AgentActionRequest } from './AgentActionDialog'

export function ActionsSection({ onRequestAgentWorktree }: { onRequestAgentWorktree: (request: AgentActionRequest) => void }) {
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const remoteLoading = useRepositoryStore((state) => state.remoteLoading)
  const remoteError = useRepositoryStore((state) => state.remoteError)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const refreshRemote = useRepositoryStore((state) => state.refreshRemote)
  const [expanded, setExpanded] = useState<number>()

  if (runs.length === 0) {
    return <ConnectedPlaceholder
      title="Workflow runs"
      message={remoteError ?? (providerStatus?.authenticated ? 'No workflow runs found for this repository yet.' : 'Connect a GitHub account to see GitHub Actions runs, jobs and failures here.')}
      onRetry={() => void refreshRemote()}
      loading={remoteLoading}
      authHint={!providerStatus?.authenticated}
    />
  }

  return (
    <div className="repo-actions">
      <ul className="repo-run-list">
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            open={expanded === run.id}
            onToggle={() => setExpanded((current) => current === run.id ? undefined : run.id)}
            onRequestAgentWorktree={onRequestAgentWorktree}
          />
        ))}
      </ul>
    </div>
  )
}

function RunRow({ run, open, onToggle, onRequestAgentWorktree }: {
  run: WorkflowRunView
  open: boolean
  onToggle: () => void
  onRequestAgentWorktree: (request: AgentActionRequest) => void
}) {
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const pending = useRepositoryStore((state) => state.pending)
  const failed = run.state === 'failure'
  const active = run.state === 'in_progress' || run.state === 'queued'

  const rerun = (failedOnly: boolean) => void runOperation({ kind: 'rerun_workflow', runId: run.id, failedOnly }, { key: `rerun:${run.id}` }).catch(() => undefined)
  const cancel = () => void runOperation({ kind: 'cancel_workflow', runId: run.id }, { key: `cancel:${run.id}` }).catch(() => undefined)
  const assign = () => onRequestAgentWorktree({
    title: `Assign CI failure to an agent`,
    purpose: `Give an agent a worktree to fix the failing "${run.name}" run on ${run.branch || 'this branch'}.${run.failureSummary ? ` Failure: ${run.failureSummary}` : ''}`,
    defaultBranch: `agent/fix-ci-${run.id}`,
    fileScope: [],
    taskId: `ci-${run.id}`,
    requiresApproval: false,
    permission: 'Create a worktree and push a fix branch',
  })

  return (
    <li className={`repo-run ${open ? 'open' : ''}`}>
      <div className="repo-run-head">
        <button className="repo-run-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <RunStateIcon state={run.state} />
          <span className="repo-run-name">{run.name}</span>
          <span className="repo-muted repo-run-commit">{run.branch} · {run.commitSha.slice(0, 7)} · {run.event}</span>
        </button>
        <div className="repo-run-meta">
          <StatusBadge tone={runTone(run.state)}>{runLabel(run.state)}</StatusBadge>
          <span className="repo-muted"><Clock size={11} /> {formatDuration(run.durationSeconds)} · {relativeTime(run.createdAt)}</span>
        </div>
      </div>

      {open && (
        <div className="repo-run-detail">
          {run.failureSummary && <p className="repo-inline-warning">{run.failureSummary}</p>}
          <ul className="repo-job-list">
            {run.jobs.map((job) => (
              <li key={job.id}>
                <div className="repo-job-head"><RunStateIcon state={job.state} /> <span>{job.name}</span> <span className="repo-muted">{formatDuration(job.durationSeconds)}</span></div>
                {job.steps.length > 0 && (
                  <ol className="repo-step-list">
                    {job.steps.map((step, index) => <li key={index} className={`step-${step.state}`}><RunStateIcon state={step.state} /> {step.name}</li>)}
                  </ol>
                )}
              </li>
            ))}
            {run.jobs.length === 0 && <li className="repo-muted">No job breakdown available in the projection.</li>}
          </ul>
          <div className="repo-run-actions">
            {failed && <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => rerun(true)} disabled={Boolean(pending[`rerun:${run.id}`])}>Rerun failed jobs</Button>}
            <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => rerun(false)} disabled={Boolean(pending[`rerun:${run.id}`])}>Rerun all</Button>
            {active && <Button variant="ghost" icon={<CircleSlash size={14} />} onClick={cancel} disabled={Boolean(pending[`cancel:${run.id}`])}>Cancel run</Button>}
            {failed && <Button variant="secondary" icon={<Bot size={14} />} onClick={assign}>Assign failure to agent</Button>}
          </div>
          <ConnectedPlaceholder inline title="Full logs" message="Job step summaries are shown above. Full log streaming loads incrementally from the provider and is windowed to avoid rendering enormous logs into the DOM." />
        </div>
      )}
    </li>
  )
}

function RunStateIcon({ state }: { state: WorkflowRunState }) {
  if (state === 'success') return <CheckCircle2 size={13} className="run-success" aria-label="passed" />
  if (state === 'failure') return <XCircle size={13} className="run-failure" aria-label="failed" />
  if (state === 'cancelled') return <CircleSlash size={13} className="run-cancelled" aria-label="cancelled" />
  return <Clock size={13} className="run-pending" aria-label={state} />
}
function runTone(state: WorkflowRunState): BadgeTone {
  return state === 'success' ? 'success' : state === 'failure' ? 'danger' : state === 'cancelled' ? 'warning' : 'pending'
}
function runLabel(state: WorkflowRunState): string {
  return state === 'success' ? 'Passed' : state === 'failure' ? 'Failed' : state === 'cancelled' ? 'Cancelled' : state === 'in_progress' ? 'Running' : 'Queued'
}
