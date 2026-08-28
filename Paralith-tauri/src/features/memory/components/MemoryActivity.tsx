/**
 * Activity surface: what the automatic knowledge lifecycle actually did.
 *
 * Every row is a real `memory_jobs` row — never a synthesized feed. Job payloads and results are
 * opaque JSON columns, so decoding is deliberately selected by `job.kind` and every field remains
 * optional until its runtime shape has been checked.
 */
import { Component, type ReactNode } from 'react'
import { AlertTriangle, Ban, Check, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import type { KnowledgeJob } from '../memoryTypes'
import {
  hasCandidateDetails,
  hasImpactDetails,
  hasProjectDetails,
  normalizeAnalyzeImpactPayload,
  normalizeAnalyzeProjectOutcome,
  normalizeAnalyzeProjectPayload,
  normalizeCandidateOutcome,
  normalizeExtractHandoffPayload,
  normalizeImpactOutcome,
  type NormalizedAnalyzeImpactPayload,
  type NormalizedCandidateOutcome,
  type NormalizedChangeUnderstanding,
  type NormalizedImpactOutcome,
} from '../memoryJobPresentation'

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

function jobTitle(kind: string): string {
  switch (kind) {
    case 'analyze_impact':
      return 'Source change analyzed'
    case 'analyze_project':
      return 'Project understanding refreshed'
    case 'process_candidates':
      return 'Knowledge review processed'
    case 'extract_handoff':
      return 'Agent handoff captured'
    default:
      return 'Knowledge activity'
  }
}

function displayTrigger(kind: string, trigger: string | undefined): string {
  return trigger ?? kind
}

function CountSummary({ parts }: { parts: Array<string | undefined> }) {
  const visible = parts.filter((part): part is string => Boolean(part))
  if (visible.length === 0) return null
  return <p className="memory-job-quiet">{visible.join(' · ')}</p>
}

function MemoryLinks({
  heading,
  ids,
  titleOf,
  openMemory,
}: {
  heading: string
  ids: string[] | undefined
  titleOf: (id: string) => string
  openMemory: (id: string) => void
}) {
  if (!ids || ids.length === 0) return null
  return (
    <div>
      <h4>{heading}</h4>
      <ul>
        {ids.map((id) => (
          <li key={id}>
            <button type="button" onClick={() => openMemory(id)}>
              {titleOf(id)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TextList({ heading, values }: { heading: string; values: string[] | undefined }) {
  if (!values || values.length === 0) return null
  return (
    <div>
      <h4>{heading}</h4>
      <ul>
        {values.map((value, index) => (
          <li key={`${value}-${index}`}>
            <span>{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SkippedList({
  skipped,
  titleOf,
}: {
  skipped: NormalizedImpactOutcome['skipped']
  titleOf: (id: string) => string
}) {
  if (!skipped || skipped.length === 0) return null
  return (
    <div className="memory-job-skipped">
      <h4>Seen and left alone</h4>
      <ul>
        {skipped.map((item) => (
          <li key={`${item.itemId}-${item.reason}`}>
            <span>{titleOf(item.itemId)}</span>
            <span className="memory-job-reason">{item.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function UnderstandingList({ understandings }: { understandings: NormalizedChangeUnderstanding[] | undefined }) {
  if (!understandings || understandings.length === 0) return null
  return (
    <div>
      <h4>Change understanding</h4>
      <ul>
        {understandings.map((understanding, index) => (
          <li key={`${understanding.changeKind ?? 'change'}-${index}`}>
            <span>
              {understanding.changeKind ?? 'Change'}
              {understanding.changedPaths && understanding.changedPaths.length > 0
                ? ` · ${understanding.changedPaths.map((change) => change.path).join(', ')}`
                : ''}
              {understanding.beforeSummary ? ` · before: ${understanding.beforeSummary}` : ''}
              {understanding.afterSummary ? ` · after: ${understanding.afterSummary}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {understandings.map((understanding, index) => (
        <div key={`evidence-${index}`}>
          <TextList heading="Affected symbols" values={understanding.affectedSymbols} />
          <TextList heading="Project facts" values={understanding.affectedProjectFacts} />
          <TextList heading="Affected Memory" values={understanding.affectedMemoryIds} />
          <TextList heading="Contradicted Memory" values={understanding.contradictedMemoryIds} />
          <TextList heading="New knowledge candidates" values={understanding.candidateNewKnowledge} />
          <TextList heading="Evidence" values={understanding.evidence} />
          {understanding.confidence !== undefined && (
            <p className="memory-job-quiet">Confidence: {understanding.confidence}</p>
          )}
        </div>
      ))}
    </div>
  )
}

function ImpactDetails({
  payload,
  outcome,
  titleOf,
  openMemory,
}: {
  payload: NormalizedAnalyzeImpactPayload | null
  outcome: NormalizedImpactOutcome | null
  titleOf: (id: string) => string
  openMemory: (id: string) => void
}) {
  if (!outcome || !hasImpactDetails(outcome)) {
    return <p className="memory-job-quiet">Details unavailable for this historical job.</p>
  }
  const noKnowledgeCitesPaths =
    outcome.pathsAnalyzed !== undefined &&
    outcome.markedStale?.length === 0 &&
    outcome.skipped?.length === 0 &&
    (!outcome.learned || outcome.learned.length === 0) &&
    (!outcome.superseded || outcome.superseded.length === 0) &&
    (!outcome.needsReview || outcome.needsReview.length === 0)

  return (
    <div className="memory-job-outcome">
      {payload?.paths && payload.paths.length > 0 && (
        <p className="memory-job-paths">
          <span>Affected paths: </span>
          <span>{payload.paths.slice(0, 4).join(', ')}</span>
        </p>
      )}
      {noKnowledgeCitesPaths ? (
        <p className="memory-job-quiet">
          Analyzed {outcome.pathsAnalyzed} path{outcome.pathsAnalyzed === 1 ? '' : 's'}; no knowledge cites them.
        </p>
      ) : (
        <CountSummary
          parts={[
            outcome.pathsAnalyzed === undefined
              ? undefined
              : `${outcome.pathsAnalyzed} path${outcome.pathsAnalyzed === 1 ? '' : 's'} analyzed`,
            outcome.markedStale && `${outcome.markedStale.length} stale`,
            outcome.learned && `${outcome.learned.length} learned`,
            outcome.superseded && `${outcome.superseded.length} superseded`,
            outcome.needsReview && `${outcome.needsReview.length} needs review`,
            outcome.skipped && `${outcome.skipped.length} unchanged`,
          ]}
        />
      )}
      <MemoryLinks
        heading="Flagged for re-verification"
        ids={outcome.markedStale}
        titleOf={titleOf}
        openMemory={openMemory}
      />
      <MemoryLinks heading="Superseded Memory" ids={outcome.superseded} titleOf={titleOf} openMemory={openMemory} />
      <MemoryLinks heading="Learned Memory" ids={outcome.learned} titleOf={titleOf} openMemory={openMemory} />
      <TextList heading="Review candidates" values={outcome.needsReview} />
      <SkippedList skipped={outcome.skipped} titleOf={titleOf} />
      <UnderstandingList understandings={outcome.understandings} />
    </div>
  )
}

function ProjectDetails({
  outcome,
}: {
  outcome: ReturnType<typeof normalizeAnalyzeProjectOutcome>
}) {
  if (!outcome || !hasProjectDetails(outcome)) {
    return <p className="memory-job-quiet">Details unavailable for this historical job.</p>
  }
  return (
    <div className="memory-job-outcome">
      <CountSummary
        parts={[
          outcome.filesScanned === undefined ? undefined : `${outcome.filesScanned.toLocaleString()} files analyzed`,
          outcome.factsChanged === undefined ? undefined : `${outcome.factsChanged} facts changed`,
          outcome.factsFound === undefined ? undefined : `${outcome.factsFound} facts found`,
          outcome.candidatesQueued === undefined ? undefined : `${outcome.candidatesQueued} candidates queued`,
          outcome.revision === undefined ? undefined : `revision ${outcome.revision}`,
        ]}
      />
    </div>
  )
}

function CandidateDetails({ outcome }: { outcome: NormalizedCandidateOutcome | null }) {
  if (!outcome || !hasCandidateDetails(outcome)) {
    return <p className="memory-job-quiet">Details unavailable for this historical job.</p>
  }
  return (
    <div className="memory-job-outcome">
      <CountSummary
        parts={[
          outcome.processed === undefined ? undefined : `${outcome.processed} candidates processed`,
          outcome.autoAccepted === undefined ? undefined : `${outcome.autoAccepted} accepted`,
          outcome.queuedForReview === undefined ? undefined : `${outcome.queuedForReview} queued for review`,
          outcome.rejected === undefined ? undefined : `${outcome.rejected} rejected`,
          outcome.duplicatesIgnored === undefined ? undefined : `${outcome.duplicatesIgnored} duplicates ignored`,
          outcome.conflictsOpened === undefined
            ? undefined
            : `${outcome.conflictsOpened} conflict${outcome.conflictsOpened === 1 ? '' : 's'} detected`,
        ]}
      />
    </div>
  )
}

function JobDetails({
  job,
  titleOf,
  openMemory,
}: {
  job: KnowledgeJob
  titleOf: (id: string) => string
  openMemory: (id: string) => void
}) {
  const kind = job.kind as string
  if (kind === 'analyze_impact') {
    return (
      <ImpactDetails
        payload={normalizeAnalyzeImpactPayload(job.payload)}
        outcome={normalizeImpactOutcome(job.result)}
        titleOf={titleOf}
        openMemory={openMemory}
      />
    )
  }
  if (kind === 'analyze_project') {
    return <ProjectDetails outcome={normalizeAnalyzeProjectOutcome(job.result)} />
  }
  if (kind === 'process_candidates') {
    return <CandidateDetails outcome={normalizeCandidateOutcome(job.result)} />
  }
  if (kind === 'extract_handoff') {
    const payload = normalizeExtractHandoffPayload(job.payload)
    return (
      <>
        {payload?.handoffId && <p className="memory-job-paths">Handoff: {payload.handoffId}</p>}
        <CandidateDetails outcome={normalizeCandidateOutcome(job.result)} />
      </>
    )
  }
  return <p className="memory-job-quiet">Details unavailable for this historical job.</p>
}

interface ActivityRowBoundaryProps {
  children: ReactNode
}

interface ActivityRowBoundaryState {
  hasError: boolean
}

class ActivityRowBoundary extends Component<ActivityRowBoundaryProps, ActivityRowBoundaryState> {
  state: ActivityRowBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ActivityRowBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Memory Activity row could not be rendered', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <li className="memory-job is-failed">
          <p className="memory-job-error">Unable to display full details for this activity.</p>
        </li>
      )
    }
    return this.props.children
  }
}

function JobRow({ job }: { job: KnowledgeJob }) {
  const cancelJob = useMemoryStore((state) => state.cancelJob)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const items = useMemoryStore((state) => state.items)
  const kind = job.kind as string
  const impactPayload = kind === 'analyze_impact' ? normalizeAnalyzeImpactPayload(job.payload) : null
  const projectPayload = kind === 'analyze_project' ? normalizeAnalyzeProjectPayload(job.payload) : null
  const trigger = kind === 'analyze_impact' ? impactPayload?.trigger : projectPayload?.trigger
  const cancellable = job.status === 'queued' || job.status === 'retrying'
  const titleOf = (itemId: string) =>
    items.find((item) => item.id === itemId)?.title ?? 'a memory not in this list'
  const openMemory = (itemId: string) => {
    void open(itemId)
    void setView('knowledge')
  }

  return (
    <li className={`memory-job${job.status === 'failed' ? ' is-failed' : ''}`}>
      <div className="memory-job-head">
        <StatusBadge status={job.status} />
        <span className="memory-job-trigger">{jobTitle(kind)}</span>
        <span className="memory-job-trigger">{displayTrigger(kind, trigger)}</span>
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

      {job.error && <p className="memory-job-error">{job.error}</p>}
      {(job.result !== null || job.status === 'complete') && (
        <JobDetails job={job} titleOf={titleOf} openMemory={openMemory} />
      )}
      {job.result === null && job.status !== 'complete' && !job.error && kind === 'analyze_impact' && (
        <p className="memory-job-quiet">Analysis has not produced a result yet.</p>
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
              <ActivityRowBoundary key={job.id}>
                <JobRow job={job} />
              </ActivityRowBoundary>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
