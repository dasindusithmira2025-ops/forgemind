import { useEffect, useMemo, useState } from 'react'
import {
  Bot, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Clock, FileCode2,
  GitBranch, Package, RotateCcw, Workflow, XCircle,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { formatDuration, relativeTime, remoteCategoryStatus } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { ConnectedPlaceholder } from './ConnectedPlaceholder'
import type { ActionsFilterId } from '../repositoryNav'
import type { WorkflowDefinitionView, WorkflowRunState, WorkflowRunView } from '../repositoryTypes'
import type { AgentActionRequest } from './AgentActionDialog'

export function ActionsSection({ runFilter = 'all', onRequestAgentWorktree }: { runFilter?: ActionsFilterId; onRequestAgentWorktree: (request: AgentActionRequest) => void }) {
  const workflows = useRepositoryStore((state) => state.remoteViews.workflows)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const projection = useRepositoryStore((state) => state.remoteProjection)
  const remoteLoading = useRepositoryStore((state) => state.remoteLoading)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const refreshRemote = useRepositoryStore((state) => state.refreshRemote)
  const [workflowId, setWorkflowId] = useState<number | 'all'>('all')
  const [expanded, setExpanded] = useState<number>()
  const workflowStatus = remoteCategoryStatus(projection, 'workflow')
  const runStatus = remoteCategoryStatus(projection, 'workflow_run')
  const problem = workflowStatus?.status !== 'healthy' ? workflowStatus : runStatus?.status !== 'healthy' ? runStatus : undefined

  const visibleRuns = useMemo(() => {
    const byWorkflow = workflowId === 'all' ? runs : runs.filter((run) => run.workflowId === workflowId)
    return runFilter === 'failed' ? byWorkflow.filter((run) => run.state === 'failure') : byWorkflow
  }, [runs, workflowId, runFilter])

  if (!providerStatus?.authenticated && workflows.length === 0 && runs.length === 0) {
    return <ConnectedPlaceholder title="GitHub Actions authorization required" message={providerStatus?.message ?? 'Reconnect the repository account to retrieve workflow definitions and runs.'} onRetry={() => void refreshRemote()} loading={remoteLoading} authHint />
  }
  if (problem && workflows.length === 0 && runs.length === 0) {
    return <ConnectedPlaceholder title="Actions synchronization failed" message={problem.errorMessage ?? 'GitHub did not return Actions data.'} detail={syncDetail(problem)} onRetry={() => void refreshRemote()} loading={remoteLoading} />
  }
  if (workflowStatus?.status === 'healthy' && workflows.length === 0) {
    return <ConnectedPlaceholder title="No workflow files exist" message="GitHub found no Actions workflow definitions on the repository default branch." detail={syncDetail(workflowStatus)} onRetry={() => void refreshRemote()} loading={remoteLoading} />
  }

  return (
    <div className="repo-actions-layout">
      {problem && <div className="repo-sync-warning" role="status"><strong>Using cached Actions data.</strong><span>{problem.errorMessage} {problem.recoveryAction}</span></div>}
      <aside className="repo-workflow-list" aria-label="Workflow definitions">
        <header><div><strong>Workflows</strong><span>{workflows.length} on default branch</span></div><Button variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void refreshRemote()} disabled={remoteLoading} aria-label="Refresh Actions" /></header>
        <button className={workflowId === 'all' ? 'active' : ''} onClick={() => setWorkflowId('all')}>
          <Workflow size={14} /><span><strong>All workflows</strong><small>{runs.length} runs synchronized</small></span>
        </button>
        {workflows.map((workflow) => <WorkflowRow key={workflow.id} workflow={workflow} runs={runs} active={workflowId === workflow.id} onSelect={() => setWorkflowId(workflow.id)} />)}
      </aside>
      <section className="repo-workflow-runs" aria-label="Workflow runs">
        <header className="repo-content-header"><div><strong>{workflowId === 'all' ? 'Repository runs' : workflows.find((item) => item.id === workflowId)?.name}</strong><span>{visibleRuns.length} synchronized run{visibleRuns.length === 1 ? '' : 's'}</span></div></header>
        {visibleRuns.length === 0
          ? <ConnectedPlaceholder inline title={runs.length === 0 ? 'Workflows exist but have never run' : 'No runs match this workflow'} message={runs.length === 0 ? 'The definitions are available, but GitHub has no run history for them.' : 'Choose All workflows or another definition to inspect its run history.'} detail={syncDetail(runStatus)} />
          : <ul className="repo-run-list">{visibleRuns.map((run) => <RunRow key={run.id} run={run} open={expanded === run.id} onToggle={() => setExpanded((value) => value === run.id ? undefined : run.id)} onRequestAgentWorktree={onRequestAgentWorktree} />)}</ul>}
      </section>
    </div>
  )
}

function WorkflowRow({ workflow, runs, active, onSelect }: { workflow: WorkflowDefinitionView; runs: WorkflowRunView[]; active: boolean; onSelect: () => void }) {
  const latest = runs.find((run) => run.workflowId === workflow.id)
  return <button className={active ? 'active' : ''} onClick={onSelect} title={workflow.path}>
    <FileCode2 size={14} />
    <span><strong>{workflow.name}</strong><small>{workflow.path}</small><small>{workflow.triggerKinds.length ? workflow.triggerKinds.map(triggerLabel).join(' · ') : 'Trigger metadata unavailable'}</small></span>
    <span className="repo-workflow-state"><StatusBadge tone={workflow.state === 'active' ? 'success' : 'warning'}>{workflow.state}</StatusBadge>{latest && <RunStateIcon state={latest.state} />}</span>
  </button>
}

function RunRow({ run: summary, open, onToggle, onRequestAgentWorktree }: { run: WorkflowRunView; open: boolean; onToggle: () => void; onRequestAgentWorktree: (request: AgentActionRequest) => void }) {
  const detail = useRepositoryStore((state) => state.workflowRunDetails[summary.id])
  const loading = useRepositoryStore((state) => state.workflowRunLoading[summary.id])
  const detailError = useRepositoryStore((state) => state.workflowRunErrors[summary.id])
  const loadDetail = useRepositoryStore((state) => state.loadWorkflowRunDetail)
  const runOperation = useRepositoryStore((state) => state.runOperation)
  const pending = useRepositoryStore((state) => state.pending)
  const run = detail ? { ...summary, ...detail, actor: detail.actor === 'Unavailable' ? summary.actor : detail.actor, workflowId: summary.workflowId } : summary
  const failed = run.state === 'failure'
  const active = run.state === 'in_progress' || run.state === 'queued'

  useEffect(() => { if (open && !detail && !loading && !detailError) void loadDetail(summary.id) }, [detail, detailError, loadDetail, loading, open, summary.id])

  const rerun = (failedOnly: boolean) => void runOperation({ kind: 'rerun_workflow', runId: run.id, failedOnly }, { key: `rerun:${run.id}` }).catch(() => undefined)
  const cancel = () => void runOperation({ kind: 'cancel_workflow', runId: run.id }, { key: `cancel:${run.id}` }).catch(() => undefined)
  const assign = () => onRequestAgentWorktree({ title: 'Assign CI failure to an agent', purpose: `Continue on ${run.branch || 'the failed run branch'} at ${run.commitSha.slice(0, 12)} and repair the failing ${run.name} run.`, defaultBranch: run.branch || `agent/fix-ci-${run.id}`, fileScope: [], taskId: `ci-${run.id}`, requiresApproval: false, permission: 'Create or reopen the branch worktree and push a validated repair' })

  return <li className={`repo-run ${open ? 'open' : ''}`}>
    <div className="repo-run-head"><button className="repo-run-toggle" onClick={onToggle} aria-expanded={open}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<RunStateIcon state={run.state} /><span className="repo-run-name">{run.commitMessage || run.name}</span><span className="repo-muted repo-run-commit"><GitBranch size={11} /> {run.branch || 'branch unavailable'} · {run.commitSha.slice(0, 7) || 'SHA unavailable'} · {run.event}</span></button><div className="repo-run-meta"><StatusBadge tone={runTone(run.state)}>{runLabel(run.state)}</StatusBadge><span className="repo-muted"><Clock size={11} /> {formatDuration(run.durationSeconds)} · {relativeTime(run.createdAt)}</span></div></div>
    {open && <div className="repo-run-detail">
      <div className="repo-run-facts"><span>Actor <strong>{run.actor}</strong></span><span>Attempt <strong>{run.attempt}</strong></span>{run.pullRequests.map((number) => <span key={number}>PR <strong>#{number}</strong></span>)}</div>
      {loading && <p className="repo-muted">Loading jobs and steps from GitHub…</p>}
      {detailError && <ConnectedPlaceholder inline title="Run detail failed" message={detailError} onRetry={() => void loadDetail(run.id)} />}
      <ul className="repo-job-list">{run.jobs.map((job) => <li key={job.id}><div className="repo-job-head"><RunStateIcon state={job.state} /><span>{job.name}</span><span className="repo-muted">{formatDuration(job.durationSeconds)}</span></div>{job.steps.length > 0 && <ol className="repo-step-list">{job.steps.map((step, index) => <li key={index} className={`step-${step.state}`}><RunStateIcon state={step.state} /> {step.name}</li>)}</ol>}</li>)}</ul>
      {run.artifacts.length > 0 && <div className="repo-run-artifacts"><strong>Artifacts</strong>{run.artifacts.map((artifact) => <div key={artifact.id}><Package size={13} /><span>{artifact.name}</span><span className="repo-muted">{formatBytes(artifact.size)}{artifact.expired ? ' · expired' : ''}</span></div>)}</div>}
      <div className="repo-run-actions">{failed && <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => rerun(true)} disabled={Boolean(pending[`rerun:${run.id}`])}>Rerun failed jobs</Button>}<Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => rerun(false)} disabled={Boolean(pending[`rerun:${run.id}`])}>Rerun workflow</Button>{active && <Button variant="ghost" icon={<CircleSlash size={14} />} onClick={cancel}>Cancel</Button>}{failed && <Button variant="secondary" icon={<Bot size={14} />} onClick={assign}>Assign failure to agent</Button>}</div>
    </div>}
  </li>
}

function syncDetail(status: ReturnType<typeof remoteCategoryStatus>): string | undefined {
  if (!status) return undefined
  const parts = [status.requiredPermission && `Permission: ${status.requiredPermission}`, status.lastSuccessfulSync && `Last successful sync: ${new Date(status.lastSuccessfulSync).toLocaleString()}`, status.recoveryAction]
  return parts.filter(Boolean).join(' · ') || undefined
}
function triggerLabel(value: string): string { return value.replaceAll('_', ' ') }
function RunStateIcon({ state }: { state: WorkflowRunState }) { if (state === 'success') return <CheckCircle2 size={13} className="run-success" aria-label="passed" />; if (state === 'failure') return <XCircle size={13} className="run-failure" aria-label="failed" />; if (state === 'cancelled') return <CircleSlash size={13} className="run-cancelled" aria-label="cancelled" />; return <Clock size={13} className="run-pending" aria-label={state} /> }
function runTone(state: WorkflowRunState): BadgeTone { return state === 'success' ? 'success' : state === 'failure' ? 'danger' : state === 'cancelled' ? 'warning' : 'pending' }
function runLabel(state: WorkflowRunState): string { return state === 'success' ? 'Passed' : state === 'failure' ? 'Failed' : state === 'cancelled' ? 'Cancelled' : state === 'in_progress' ? 'Running' : 'Queued' }
function formatBytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / (1024 * 1024)).toFixed(1)} MB` }
