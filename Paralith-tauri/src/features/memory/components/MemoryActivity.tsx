/**
 * Activity surface: what the automatic knowledge lifecycle actually did.
 *
 * Every row is a real `memory_jobs` row — never a synthesized feed. The surface exists because
 * the lifecycle writes to knowledge without being asked: a memory can become stale while nobody
 * is looking, and "why is this flagged?" needs an answer that is not "the system decided". So each
 * completed job shows its trigger, the paths it analyzed, what it marked, and — the part that
 * makes it auditable — what it saw and deliberately refused to mark.
 */
import { AlertTriangle, Ban, Check, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import type { AnalyzeImpactPayload, ImpactOutcome, KnowledgeJob } from '../memoryTypes'

/** Parse a JSON column, returning `null` rather than throwing: a job row must stay renderable
 * even if a future build writes a shape this one does not know. */
function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function StatusBadge({ status }: { status: KnowledgeJob['status'] }) {
  const icon = {
    queued: <Loader2 size={11} />,
    running: <Loader2 size={11} className="is-spinning" />,
    retrying: <RotateCcw size={11} />,
    complete: <Check size={11} />,
    failed: <AlertTriangle size={11} />,
    cancelled: <Ban size={11} />,
  }[status]
  return (
    <span className={`memory-job-status is-${status}`}>
      {icon}
      {status}
    </span>
  )
}

function timeOf(job: KnowledgeJob): string {
  const stamp = job.finishedAt ?? job.startedAt ?? job.createdAt
  const parsed = new Date(stamp)
  return Number.isNaN(parsed.getTime()) ? stamp : parsed.toLocaleTimeString()
}

function JobRow({ job }: { job: KnowledgeJob }) {
  const cancelJob = useMemoryStore((state) => state.cancelJob)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const items = useMemoryStore((state) => state.items)

  const payload = parseJson<AnalyzeImpactPayload>(job.payload)
  const outcome = parseJson<ImpactOutcome>(job.result)
  const cancellable = job.status === 'queued' || job.status === 'retrying'
  const titleOf = (itemId: string) =>
    items.find((item) => item.id === itemId)?.title ?? 'a memory not in this list'

  return (
    <li className={`memory-job${job.status === 'failed' ? ' is-failed' : ''}`}>
      <div className="memory-job-head">
        <StatusBadge status={job.status} />
        <span className="memory-job-trigger">{payload?.trigger ?? job.kind}</span>
        <span className="memory-job-spacer" />
        {job.attempts > 1 && (
          <span className="memory-job-attempts">
            attempt {job.attempts} of {job.maxAttempts}
          </span>
        )}
        <time className="memory-job-time" dateTime={job.finishedAt ?? job.createdAt}>
          {timeOf(job)}
        </time>
        {cancellable && (
          <Button variant="ghost" onClick={() => void cancelJob(job.id)}>
            Cancel
          </Button>
        )}
      </div>

      {payload && payload.paths.length > 0 && (
        <p className="memory-job-paths">
          {payload.paths.slice(0, 4).join(', ')}
          {payload.paths.length > 4 && ` and ${payload.paths.length - 4} more`}
        </p>
      )}

      {job.error && <p className="memory-job-error">{job.error}</p>}

      {outcome && (
        <div className="memory-job-outcome">
          {outcome.markedStale.length === 0 && outcome.skipped.length === 0 ? (
            <p className="memory-job-quiet">
              Analyzed {outcome.pathsAnalyzed} path{outcome.pathsAnalyzed === 1 ? '' : 's'}; no
              knowledge cites them.
            </p>
          ) : (
            <>
              {outcome.markedStale.length > 0 && (
                <div>
                  <h4>Flagged for re-verification</h4>
                  <ul>
                    {outcome.markedStale.map((itemId) => (
                      <li key={itemId}>
                        <button
                          type="button"
                          onClick={() => {
                            void open(itemId)
                            void setView('knowledge')
                          }}
                        >
                          {titleOf(itemId)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {outcome.skipped.length > 0 && (
                <div className="memory-job-skipped">
                  <h4>Seen and left alone</h4>
                  <ul>
                    {outcome.skipped.map((skipped) => (
                      <li key={`${skipped.itemId}-${skipped.reason}`}>
                        <span>{titleOf(skipped.itemId)}</span>
                        <span className="memory-job-reason">{skipped.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

export function MemoryActivity() {
  const jobs = useMemoryStore((state) => state.jobs)
  const loading = useMemoryStore((state) => state.jobsLoading)
  const refreshJobs = useMemoryStore((state) => state.refreshJobs)

  return (
    <section className="memory-activity" aria-label="Knowledge activity">
      <div className="memory-activity-bar">
        <p>
          Repository changes are analyzed automatically. Knowledge that cites a changed file and is
          load-bearing — supported or better — is flagged for re-verification.
        </p>
        <Button
          variant="secondary"
          icon={<RefreshCw size={13} />}
          onClick={() => void refreshJobs()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>
      <div className="memory-activity-body">
        {loading && jobs.length === 0 && <p className="memory-context-status">Loading activity…</p>}
        {!loading && jobs.length === 0 && (
          <p className="memory-context-empty">
            Nothing yet. The next change to a file this Project&rsquo;s knowledge cites will appear
            here.
          </p>
        )}
        {jobs.length > 0 && (
          <ul className="memory-job-list">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
