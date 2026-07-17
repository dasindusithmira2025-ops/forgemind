import { useEffect } from 'react'
import {
  CheckCircle2, ChevronRight, CircleSlash, Clock, GitBranch, ShieldCheck, Tag, XCircle,
} from 'lucide-react'
import { useRepositoryStore } from '../repositoryStore'
import { formatDuration, relativeTime, remoteCategoryStatus } from '../repositorySelectors'
import type { RepositoryNavigate } from '../repositoryNav'
import type { RepositorySectionId, WorkflowRunState } from '../repositoryTypes'
import { StatusBadge, type BadgeTone } from './StatusBadge'

/**
 * The contextual intelligence rail. It keeps CI, repository health, releases and recent operations
 * in view beside whatever the operator is doing in the primary surface, so understanding one PR or
 * change never means leaving the current screen. It surfaces only what is relevant to the active
 * section — it never renders every possible panel at once.
 */
export function ContextRail({ section, selectedRunId, onSelectRun, onNavigate }: {
  section: RepositorySectionId
  selectedRunId?: number
  onSelectRun: (runId: number) => void
  onNavigate: RepositoryNavigate
}) {
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const releases = useRepositoryStore((state) => state.remoteViews.releases)
  const operations = useRepositoryStore((state) => state.operations)
  const projection = useRepositoryStore((state) => state.remoteProjection)
  const runDetails = useRepositoryStore((state) => state.workflowRunDetails)
  const runLoading = useRepositoryStore((state) => state.workflowRunLoading)
  const loadWorkflowRunDetail = useRepositoryStore((state) => state.loadWorkflowRunDetail)

  // Actions already owns the full CI surface in the primary work area; don't duplicate it here.
  const showCi = section !== 'actions'
  const selectedRun = selectedRunId != null ? (runDetails[selectedRunId] ?? runs.find((run) => run.id === selectedRunId)) : undefined

  useEffect(() => {
    if (selectedRunId != null && !runDetails[selectedRunId] && !runLoading[selectedRunId]) void loadWorkflowRunDetail(selectedRunId)
  }, [selectedRunId, runDetails, runLoading, loadWorkflowRunDetail])

  const health = [
    ['Dependabot', remoteCategoryStatus(projection, 'dependabot_alert')],
    ['Code scanning', remoteCategoryStatus(projection, 'code_scanning_alert')],
    ['Secret scanning', remoteCategoryStatus(projection, 'secret_scanning_alert')],
    ['Rulesets', remoteCategoryStatus(projection, 'ruleset')],
  ] as const
  const latestRelease = releases[0]

  return (
    <aside className="rcc-context" aria-label="Repository context">
      {showCi && (
        <section className="rcc-panel">
          <header>
            <strong>CI / Workflows</strong>
            <button className="rcc-panel-link" onClick={() => onNavigate({ section: 'actions' })}>View all</button>
          </header>
          {runs.length === 0
            ? <p className="rcc-panel-empty">No workflow runs synchronized.</p>
            : (
              <ul className="rcc-run-list">
                {runs.slice(0, 6).map((run) => (
                  <li key={run.id}>
                    <button className={selectedRunId === run.id ? 'active' : ''} onClick={() => onSelectRun(run.id)} title={run.commitMessage || run.name}>
                      <RunIcon state={run.state} />
                      <span className="rcc-run-main">
                        <span className="rcc-run-title">{run.commitMessage || run.name}</span>
                        <span className="rcc-run-sub"><GitBranch size={10} /> {run.branch || '—'} · {relativeTime(run.createdAt)}</span>
                      </span>
                      <ChevronRight size={13} className="rcc-run-chevron" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

          {selectedRun && (
            <div className="rcc-run-detail">
              <div className="rcc-run-detail-head">
                <RunIcon state={selectedRun.state} />
                <strong>{selectedRun.name}</strong>
                <StatusBadge tone={runTone(selectedRun.state)}>{runLabel(selectedRun.state)}</StatusBadge>
              </div>
              {runLoading[selectedRun.id] && <p className="rcc-panel-empty">Loading jobs and steps…</p>}
              {selectedRun.jobs.length > 0 && (
                <ul className="rcc-job-list">
                  {selectedRun.jobs.map((job) => (
                    <li key={job.id}>
                      <RunIcon state={job.state} />
                      <span className="rcc-job-name">{job.name}</span>
                      <span className="rcc-job-dur">{formatDuration(job.durationSeconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      <section className="rcc-panel">
        <header>
          <strong>Repository health</strong>
          <button className="rcc-panel-link" onClick={() => onNavigate({ section: 'security' })}>View all</button>
        </header>
        <div className="rcc-health-grid">
          {health.map(([label, status]) => (
            <div key={label} className="rcc-health-cell">
              <span className="rcc-health-label">{label}</span>
              <StatusBadge tone={healthTone(status)}>{healthLabel(status)}</StatusBadge>
            </div>
          ))}
        </div>
      </section>

      <section className="rcc-panel">
        <header>
          <strong>Latest release</strong>
          <button className="rcc-panel-link" onClick={() => onNavigate({ section: 'releases' })}>View all</button>
        </header>
        {latestRelease
          ? (
            <div className="rcc-release">
              <Tag size={14} />
              <div>
                <strong>{latestRelease.name}</strong>
                <span className="rcc-run-sub"><code>{latestRelease.tag}</code> · {latestRelease.draft ? 'draft' : latestRelease.prerelease ? 'prerelease' : 'published'}</span>
                <span className="rcc-run-sub">{latestRelease.assets.length} asset{latestRelease.assets.length === 1 ? '' : 's'} · {relativeTime(latestRelease.publishedAt)}</span>
              </div>
            </div>
          )
          : <p className="rcc-panel-empty">No releases published yet.</p>}
      </section>

      <section className="rcc-panel">
        <header>
          <strong>Recent operations</strong>
          <button className="rcc-panel-link" onClick={() => onNavigate({ section: 'overview' })}>History</button>
        </header>
        {operations.length === 0
          ? <p className="rcc-panel-empty">No repository operations this session.</p>
          : (
            <ul className="rcc-op-list">
              {operations.slice(0, 6).map((operation) => (
                <li key={operation.id}>
                  <ShieldCheck size={12} className={`tone-${opTone(operation.status)}`} />
                  <span className="rcc-op-kind">{operation.kind.replaceAll('_', ' ')}</span>
                  <span className="rcc-op-status">{operation.status.replaceAll('_', ' ')}</span>
                  <span className="rcc-op-time">{relativeTime(operation.completedAt ?? operation.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
      </section>
    </aside>
  )
}

function RunIcon({ state }: { state: WorkflowRunState }) {
  if (state === 'success') return <CheckCircle2 size={13} className="run-success" aria-label="passed" />
  if (state === 'failure') return <XCircle size={13} className="run-failure" aria-label="failed" />
  if (state === 'cancelled') return <CircleSlash size={13} className="run-cancelled" aria-label="cancelled" />
  return <Clock size={13} className="run-pending" aria-label={state} />
}
function runTone(state: WorkflowRunState): BadgeTone { return state === 'success' ? 'success' : state === 'failure' ? 'danger' : state === 'cancelled' ? 'warning' : 'pending' }
function runLabel(state: WorkflowRunState): string { return state === 'success' ? 'Passed' : state === 'failure' ? 'Failed' : state === 'cancelled' ? 'Cancelled' : state === 'in_progress' ? 'Running' : 'Queued' }
function opTone(status: string): string { return status === 'succeeded' ? 'success' : status === 'failed' || status === 'needs_recovery' ? 'danger' : status === 'awaiting_approval' ? 'warning' : 'accent' }

type Health = ReturnType<typeof remoteCategoryStatus>
function healthTone(status: Health): BadgeTone {
  if (!status) return 'neutral'
  if (status.status === 'healthy') return 'success'
  if (status.errorCode === 'github_permission_missing') return 'warning'
  return 'danger'
}
function healthLabel(status: Health): string {
  if (!status) return 'not synced'
  if (status.status === 'healthy') return 'available'
  if (status.errorCode === 'github_permission_missing') return 'permission required'
  return status.status
}
