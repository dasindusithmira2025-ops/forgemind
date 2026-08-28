import { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  CircleStop,
  Check,
  FolderGit2,
  Layers,
  Play,
  RotateCcw,
  ShieldQuestion,
  X,
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { useRunStore } from './runStore'
import {
  formatDuration,
  isRunActive,
  isRunTerminal,
  runElapsedMs,
  runIsolationLabel,
  runNeedsAttention,
  runStatusLabel,
  runStatusTone,
} from './runTypes'
import type { CreateRunRequest, Run, RunChangedEvent, RunDetail } from './runTypes'

/**
 * The Runs surface: every structured agent execution in one Project, and one Run's detail.
 *
 * This surface *observes*. The Rust Run Engine owns lifecycle, so nothing here computes or
 * advances a status — it renders persisted state and refetches on the backend's `run-changed`
 * event. That is why leaving this screen, or closing the window entirely, does not affect a Run.
 */
export function RunsPanel({ projectId }: { projectId: string }) {
  const runs = useRunStore((state) => state.runsByProject[projectId])
  const summary = useRunStore((state) => state.summaryByProject[projectId])
  const loading = useRunStore((state) => state.loadingProject === projectId)
  const error = useRunStore((state) => state.error)
  const pendingByRun = useRunStore((state) => state.pendingByRun)
  const loadRuns = useRunStore((state) => state.loadRuns)
  const loadSummary = useRunStore((state) => state.loadSummary)
  const applyChange = useRunStore((state) => state.applyChange)
  const clearError = useRunStore((state) => state.clearError)

  const [filter, setFilter] = useState<'all' | 'active' | 'attention'>('all')
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [composerOpen, setComposerOpen] = useState(false)

  const query = useMemo(
    () => ({
      projectId,
      activeOnly: filter === 'active',
      needsAttentionOnly: filter === 'attention',
      limit: 100,
    }),
    [filter, projectId],
  )

  const refresh = useCallback(() => {
    void loadRuns(query)
    void loadSummary(projectId)
  }, [loadRuns, loadSummary, projectId, query])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The backend is the only source of change. One subscription for the whole surface; the store
  // decides what actually needs refetching so an event for an unopened Run costs nothing.
  useEffect(() => {
    const unlisten = listen<RunChangedEvent>('run-changed', (event) => {
      if (event.payload.projectId !== projectId) return
      void applyChange(event.payload)
    })
    return () => {
      void unlisten.then((dispose) => dispose())
    }
  }, [applyChange, projectId])

  const selected = runs?.find((run) => run.id === selectedRunId)

  return (
    <div className="runs-shell">
      <header className="runs-header">
        <div className="runs-identity">
          <h2>Runs</h2>
          <p>Every structured agent execution in this Project.</p>
        </div>
        <RunInboxStrip
          summary={summary}
          active={filter}
          onFilter={setFilter}
        />
        <div className="runs-header-actions">
          <Button variant="primary" icon={<Play size={14} />} onClick={() => setComposerOpen(true)}>
            New Run
          </Button>
        </div>
      </header>

      {error && <ErrorNotice message={error} onRetry={() => { clearError(); refresh() }} />}

      {composerOpen && (
        <RunComposer
          projectId={projectId}
          onClose={() => setComposerOpen(false)}
          onCreated={(run) => {
            setComposerOpen(false)
            setSelectedRunId(run.id)
          }}
        />
      )}

      <div className={`runs-body ${selectedRunId ? 'has-detail' : ''}`}>
        <RunList
          runs={runs}
          loading={loading}
          filter={filter}
          selectedRunId={selectedRunId}
          pendingByRun={pendingByRun}
          onSelect={setSelectedRunId}
        />
        {selectedRunId && (
          <RunDetailPanel runId={selectedRunId} run={selected} onClose={() => setSelectedRunId(undefined)} />
        )}
      </div>
    </div>
  )
}

/**
 * The Agent Inbox strip: the counts that mean "a person is needed". Each count is also the
 * filter that shows those Runs, so the number is never a dead ornament.
 */
function RunInboxStrip({
  summary,
  active,
  onFilter,
}: {
  summary?: { running: number; waitingApproval: number; reviewReady: number; failed: number; interrupted: number }
  active: 'all' | 'active' | 'attention'
  onFilter: (filter: 'all' | 'active' | 'attention') => void
}) {
  const attention = (summary?.waitingApproval ?? 0) + (summary?.reviewReady ?? 0)
  return (
    <div className="runs-inbox" role="group" aria-label="Run filters">
      <button
        type="button"
        className={`runs-inbox-chip ${active === 'all' ? 'is-active' : ''}`}
        onClick={() => onFilter('all')}
      >
        <span>All</span>
      </button>
      <button
        type="button"
        className={`runs-inbox-chip ${active === 'active' ? 'is-active' : ''}`}
        onClick={() => onFilter('active')}
      >
        <strong>{summary?.running ?? 0}</strong>
        <span>Running</span>
      </button>
      <button
        type="button"
        className={`runs-inbox-chip ${active === 'attention' ? 'is-active' : ''} ${attention > 0 ? 'is-attention' : ''}`}
        onClick={() => onFilter('attention')}
      >
        <strong>{attention}</strong>
        <span>Needs you</span>
      </button>
      {(summary?.interrupted ?? 0) > 0 && (
        <span className="runs-inbox-note" title="Runs interrupted by a restart or a lost process">
          {summary?.interrupted} interrupted
        </span>
      )}
    </div>
  )
}

function RunList({
  runs,
  loading,
  filter,
  selectedRunId,
  pendingByRun,
  onSelect,
}: {
  runs?: Run[]
  loading: boolean
  filter: 'all' | 'active' | 'attention'
  selectedRunId?: string
  pendingByRun: Record<string, string | undefined>
  onSelect: (runId: string) => void
}) {
  if (!runs && loading) {
    return <div className="runs-list-state" role="status">Loading Runs…</div>
  }
  if (runs && runs.length === 0) {
    return (
      <div className="runs-empty">
        <Layers size={20} />
        <p>
          {filter === 'attention'
            ? 'Nothing is waiting on you.'
            : filter === 'active'
              ? 'No Run is executing right now.'
              : 'No Runs yet. Start one to give an agent a bounded objective.'}
        </p>
      </div>
    )
  }
  return (
    <ul className="runs-list">
      {(runs ?? []).map((run) => (
        <RunRow
          key={run.id}
          run={run}
          selected={run.id === selectedRunId}
          pending={pendingByRun[run.id]}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}

function RunRow({
  run,
  selected,
  pending,
  onSelect,
}: {
  run: Run
  selected: boolean
  pending?: string
  onSelect: (runId: string) => void
}) {
  const cancelRun = useRunStore((state) => state.cancelRun)
  const retryRun = useRunStore((state) => state.retryRun)
  const elapsed = runElapsedMs(run)

  return (
    <li className={`runs-row ${selected ? 'is-selected' : ''} ${runNeedsAttention(run.status) ? 'is-attention' : ''}`}>
      <button
        type="button"
        className="runs-row-main"
        aria-current={selected}
        onClick={() => onSelect(run.id)}
      >
        <span className={`runs-status-dot tone-${runStatusTone(run.status)}`} aria-hidden />
        <span className="runs-row-objective" title={run.objective}>{run.objective}</span>
        <span className="runs-row-meta">
          <span>{runStatusLabel(run.status)}</span>
          {run.providerId && <span>{run.providerId}</span>}
          <span>{runIsolationLabel(run.isolation)}</span>
          {run.branchName && (
            <span title={run.worktreePath ?? undefined}>
              <FolderGit2 size={11} aria-hidden /> {run.branchName}
            </span>
          )}
          {elapsed !== undefined && <span>{formatDuration(elapsed)}</span>}
        </span>
      </button>
      <span className="runs-row-actions">
        {isRunActive(run.status) && (
          <Button
            variant="ghost"
            icon={<CircleStop size={14} />}
            disabled={Boolean(pending)}
            aria-label={`Stop ${run.objective}`}
            onClick={() => void cancelRun(run.id, false)}
          >
            Stop
          </Button>
        )}
        {(isRunTerminal(run.status) || run.status === 'interrupted') && (
          <Button
            variant="ghost"
            icon={<RotateCcw size={14} />}
            disabled={Boolean(pending)}
            aria-label={`Retry ${run.objective}`}
            onClick={() => void retryRun(run.id).catch(() => undefined)}
          >
            Retry
          </Button>
        )}
      </span>
    </li>
  )
}

/** One Run's durable detail: what it is, what it did, what it is blocked on, and what changed. */
function RunDetailPanel({
  runId,
  run,
  onClose,
}: {
  runId: string
  run?: Run
  onClose: () => void
}) {
  const detail = useRunStore((state) => state.detailById[runId])
  const loading = useRunStore((state) => state.loadingDetailById[runId])
  const loadDetail = useRunStore((state) => state.loadDetail)

  useEffect(() => {
    void loadDetail(runId)
  }, [loadDetail, runId])

  const current: RunDetail | undefined = detail
  const subject = current?.run ?? run

  return (
    <aside className="runs-detail" aria-label="Run details">
      <header className="runs-detail-header">
        <div>
          <h3>{subject?.objective ?? 'Run'}</h3>
          {subject && (
            <p>
              {runStatusLabel(subject.status)}
              {subject.statusReason ? ` · ${subject.statusReason}` : ''}
            </p>
          )}
        </div>
        <Button variant="ghost" icon={<X size={14} />} aria-label="Close Run details" onClick={onClose} />
      </header>

      {loading && !current && <div className="runs-detail-state" role="status">Loading Run…</div>}

      {current && (
        <div className="runs-detail-body">
          {current.approvals.filter((approval) => approval.status === 'open').map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}

          <section className="runs-detail-section">
            <h4>Overview</h4>
            <dl className="runs-detail-facts">
              <div><dt>Type</dt><dd>{current.run.runType.replace(/_/g, ' ')}</dd></div>
              <div><dt>Strategy</dt><dd>{current.run.executionStrategy.replace(/_/g, ' ')}</dd></div>
              <div><dt>Isolation</dt><dd>{runIsolationLabel(current.run.isolation)}</dd></div>
              <div><dt>Agent</dt><dd>{current.run.providerId ?? '—'}{current.run.modelId ? ` · ${current.run.modelId}` : ''}</dd></div>
              <div><dt>Branch</dt><dd title={current.run.worktreePath ?? undefined}>{current.run.branchName ?? '—'}</dd></div>
              <div><dt>Working directory</dt><dd title={current.run.workingDirectory ?? undefined}>{current.run.workingDirectory ?? '—'}</dd></div>
              <div><dt>Context pack</dt><dd>{current.run.contextPackId ? 'Compiled' : 'Not compiled'}</dd></div>
              <div><dt>Started</dt><dd>{current.run.startedAt ?? 'Not started'}</dd></div>
            </dl>
          </section>

          {current.run.errorMessage && (
            <section className="runs-detail-section">
              <h4>Failure</h4>
              <p className="runs-detail-error">
                <strong>{current.run.errorCode}</strong> {current.run.errorMessage}
              </p>
            </section>
          )}

          {current.children.length > 0 && (
            <section className="runs-detail-section">
              <h4>Child Runs</h4>
              <ul className="runs-children">
                {current.children.map((child) => (
                  <li key={child.id}>
                    <span className={`runs-status-dot tone-${runStatusTone(child.status)}`} aria-hidden />
                    <span title={child.objective}>{child.objective}</span>
                    <span>{runStatusLabel(child.status)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="runs-detail-section">
            <h4>Activity</h4>
            <ol className="runs-timeline">
              {current.events.map((event) => (
                <li key={event.id} className={`level-${event.level}`}>
                  <span className="runs-timeline-kind">{event.kind.replace(/_/g, ' ')}</span>
                  <span className="runs-timeline-summary">{event.summary}</span>
                  <span className="runs-timeline-time">{event.createdAt.slice(11, 19)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
  )
}

function ApprovalCard({
  approval,
}: {
  approval: { id: string; kind: string; summary: string }
}) {
  const resolveApproval = useRunStore((state) => state.resolveApproval)
  return (
    <section className="runs-approval" role="alertdialog" aria-label="Approval required">
      <ShieldQuestion size={16} aria-hidden />
      <div>
        <strong>{approval.summary}</strong>
        <span>This Run is paused until you decide. The request survives closing this panel.</span>
      </div>
      <div className="runs-approval-actions">
        <Button variant="primary" icon={<Check size={14} />} onClick={() => void resolveApproval(approval.id, true)}>
          Approve
        </Button>
        <Button variant="danger" icon={<X size={14} />} onClick={() => void resolveApproval(approval.id, false)}>
          Deny
        </Button>
      </div>
    </section>
  )
}

/**
 * Start a Run. Deliberately small: an objective, an agent, and whether the Run may write.
 * Isolation follows from that last choice rather than being a separate decision the user has to
 * understand — write-capable work gets its own worktree.
 */
function RunComposer({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated: (run: Run) => void
}) {
  const createRun = useRunStore((state) => state.createRun)
  const [objective, setObjective] = useState('')
  const [provider, setProvider] = useState('claude')
  const [mayWrite, setMayWrite] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!objective.trim() || submitting) return
    setSubmitting(true)
    const request: CreateRunRequest = {
      projectId,
      objective: objective.trim(),
      runType: 'agent_task',
      executionStrategy: 'single_agent',
      isolation: mayWrite ? 'isolated_worktree' : 'shared_read_only',
      providerId: provider,
      reasoningEffort: 'medium',
      triggerSource: 'manual',
    }
    try {
      onCreated(await createRun(request))
    } catch {
      // The store surfaces the message; keep the composer open so the objective is not lost.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="runs-composer" aria-label="Start a Run">
      <label className="runs-composer-objective">
        <span>Objective</span>
        <textarea
          value={objective}
          rows={3}
          autoFocus
          placeholder="What should the agent accomplish?"
          onChange={(event) => setObjective(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
            if (event.key === 'Escape') onClose()
          }}
        />
      </label>
      <div className="runs-composer-options">
        <label>
          <span>Agent</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex CLI</option>
          </select>
        </label>
        <label className="runs-composer-toggle">
          <input type="checkbox" checked={mayWrite} onChange={(event) => setMayWrite(event.target.checked)} />
          <span>Allow changes</span>
        </label>
        <p className="runs-composer-hint">
          {mayWrite
            ? 'Runs in its own Git worktree. Your working tree is untouched.'
            : 'Read-only. The agent cannot modify any file.'}
        </p>
      </div>
      <div className="runs-composer-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Play size={14} />} disabled={!objective.trim() || submitting} onClick={() => void submit()}>
          {submitting ? 'Starting…' : 'Start Run'}
        </Button>
      </div>
    </section>
  )
}
