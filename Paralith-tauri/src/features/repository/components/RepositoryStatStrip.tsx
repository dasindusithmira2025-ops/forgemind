import type { ReactNode } from 'react'
import { CircleDot, GitMerge, GitPullRequest, RefreshCw, Users, XCircle } from 'lucide-react'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, syncStateLabel } from '../repositorySelectors'
import { deriveProviderPosture, type RepositoryNavigate } from '../repositoryNav'
import type { BadgeTone } from './StatusBadge'

/**
 * The persistent repository attention strip. Six backend-derived measures of repository health,
 * each a real navigation target into the relevant section — never a decorative number. It answers
 * "what state is this repository in right now?" before the user chooses where to work.
 */
export function RepositoryStatStrip({ onNavigate }: { onNavigate: RepositoryNavigate }) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const leases = useRepositoryStore((state) => state.leases)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const projection = useRepositoryStore((state) => state.remoteProjection)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const remoteLoading = useRepositoryStore((state) => state.remoteLoading)
  const remoteError = useRepositoryStore((state) => state.remoteError)

  const failedRuns = runs.filter((run) => run.state === 'failure')
  const activePrs = pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft')
  const draftPrs = activePrs.filter((pr) => pr.state === 'draft')
  const mergeReady = activePrs.filter((pr) => pr.state !== 'draft' && pr.mergeable === true && pr.checksState === 'passing' && pr.reviewDecision === 'approved')
  const awaitingReview = activePrs.filter((pr) => pr.reviewDecision === 'review_required' || pr.reviewDecision === 'changes_requested')
  const activeLeases = leases.filter((lease) => lease.status === 'active')
  const behindLeases = leases.filter((lease) => lease.status !== 'released' && lease.status !== 'active')
  const changes = snapshot?.files.length ?? 0
  const conflicts = snapshot?.files.filter((file) => file.conflicted).length ?? 0
  const sync = deriveSyncState(snapshot)
  const posture = deriveProviderPosture({ projection, providerStatus, remoteLoading, remoteError })

  return (
    <div className="rcc-stats" role="group" aria-label="Repository status">
      <Stat
        icon={<XCircle size={16} />}
        tone={failedRuns.length > 0 ? 'danger' : 'success'}
        label="Failed CI runs"
        value={String(failedRuns.length)}
        detail={failedRuns.length > 0 ? 'Needs attention' : 'None recent'}
        onClick={() => onNavigate({ section: 'actions', actionsFilter: 'failed', filterId: 'failed-ci' })}
      />
      <Stat
        icon={<GitPullRequest size={16} />}
        tone={activePrs.length > 0 ? 'accent' : 'neutral'}
        label="Open PRs"
        value={String(activePrs.length)}
        detail={`${draftPrs.length} draft`}
        onClick={() => onNavigate({ section: 'pull-requests', prFilter: 'active' })}
      />
      <Stat
        icon={<GitMerge size={16} />}
        tone={mergeReady.length > 0 ? 'success' : 'neutral'}
        label="Merge ready"
        value={String(mergeReady.length)}
        detail={awaitingReview.length > 0 ? `${awaitingReview.length} awaiting review` : 'None waiting'}
        onClick={() => onNavigate({ section: 'pull-requests', prFilter: awaitingReview.length > 0 ? 'awaiting-review' : 'active' })}
      />
      <Stat
        icon={<Users size={16} />}
        tone={activeLeases.length > 0 ? 'accent' : 'neutral'}
        label="Agent worktrees"
        value={String(activeLeases.length)}
        detail={behindLeases.length > 0 ? `${behindLeases.length} inactive` : 'active'}
        onClick={() => onNavigate({ section: 'branches', filterId: 'agent-worktrees' })}
      />
      <Stat
        icon={<RefreshCw size={16} className={posture.kind === 'refreshing' ? 'is-spinning' : ''} />}
        tone={posture.tone}
        label="Remote sync"
        value={posture.label}
        detail={snapshot?.upstream ?? syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}
        title={posture.detail}
        onClick={() => onNavigate({ section: 'overview' })}
      />
      <Stat
        icon={<CircleDot size={16} />}
        tone={conflicts > 0 ? 'danger' : changes > 0 ? 'warning' : 'success'}
        label="Working tree"
        value={changes === 0 ? 'Clean' : String(changes)}
        detail={conflicts > 0 ? `${conflicts} conflicted` : changes === 0 ? 'No changes' : `${changes === 1 ? 'change' : 'changes'}`}
        onClick={() => onNavigate({ section: 'changes' })}
      />
    </div>
  )
}

function Stat({ icon, tone, label, value, detail, title, onClick }: {
  icon: ReactNode
  tone: BadgeTone
  label: string
  value: string
  detail: string
  title?: string
  onClick: () => void
}) {
  return (
    <button className="rcc-stat" onClick={onClick} title={title ?? `${label}: ${value}`}>
      <span className={`rcc-stat-icon tone-${tone}`}>{icon}</span>
      <span className="rcc-stat-body">
        <span className="rcc-stat-label">{label}</span>
        <span className="rcc-stat-value">{value}</span>
        <span className="rcc-stat-detail">{detail}</span>
      </span>
    </button>
  )
}
