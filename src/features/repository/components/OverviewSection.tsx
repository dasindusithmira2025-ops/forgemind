import { AlertTriangle, ArrowRight, GitPullRequest, PlayCircle, Users } from 'lucide-react'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, relativeTime, syncStateLabel } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { OperationLedger } from './OperationLedger'
import type { RepositorySectionId } from '../repositoryTypes'

/**
 * A restrained overview: a few dense summary tiles that reflect backend state and route into the
 * working sections — deliberately not a wall of oversized dashboard cards.
 */
export function OverviewSection({ onNavigate }: { onNavigate: (section: RepositorySectionId) => void }) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const leases = useRepositoryStore((state) => state.leases)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)

  const sync = deriveSyncState(snapshot)
  const changeCount = snapshot?.files.length ?? 0
  const conflicts = snapshot?.files.filter((file) => file.conflicted).length ?? 0
  const warnings = snapshot?.health.warnings ?? []
  const inProgress = snapshot?.health.mergeInProgress || snapshot?.health.rebaseInProgress || snapshot?.health.cherryPickInProgress || snapshot?.health.revertInProgress
  const latestRun = runs[0]
  const openPrs = pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft')

  return (
    <div className="repo-overview">
      {(warnings.length > 0 || inProgress) && (
        <div className="repo-overview-alert" role="note">
          <AlertTriangle size={15} />
          <span>
            {inProgress && 'An in-progress git operation (merge/rebase/cherry-pick/revert) is active. '}
            {warnings.join(' ')}
          </span>
        </div>
      )}

      <div className="repo-tile-grid">
        <button className="repo-tile" onClick={() => onNavigate('changes')}>
          <span className="repo-tile-label">Working tree</span>
          <span className="repo-tile-value">{changeCount === 0 ? 'Clean' : `${changeCount} change${changeCount === 1 ? '' : 's'}`}</span>
          <span className="repo-tile-foot">{conflicts > 0 ? <StatusBadge tone="danger">{conflicts} conflicts</StatusBadge> : <StatusBadge tone="accent">{syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}</StatusBadge>}<ArrowRight size={13} /></span>
        </button>

        <button className="repo-tile" onClick={() => onNavigate('branches')}>
          <span className="repo-tile-label"><Users size={13} /> Agent worktrees</span>
          <span className="repo-tile-value">{leases.length}</span>
          <span className="repo-tile-foot"><span className="repo-muted">{leases.filter((lease) => lease.status === 'active').length} active</span><ArrowRight size={13} /></span>
        </button>

        <button className="repo-tile" onClick={() => onNavigate('pull-requests')}>
          <span className="repo-tile-label"><GitPullRequest size={13} /> Pull requests</span>
          <span className="repo-tile-value">{openPrs.length}</span>
          <span className="repo-tile-foot"><span className="repo-muted">open / draft</span><ArrowRight size={13} /></span>
        </button>

        <button className="repo-tile" onClick={() => onNavigate('actions')}>
          <span className="repo-tile-label"><PlayCircle size={13} /> Latest CI</span>
          <span className="repo-tile-value">{latestRun ? runWord(latestRun.state) : '—'}</span>
          <span className="repo-tile-foot">{latestRun ? <><StatusBadge tone={runTone(latestRun.state)}>{latestRun.name}</StatusBadge><span className="repo-muted">{relativeTime(latestRun.createdAt)}</span></> : <span className="repo-muted">No runs</span>}<ArrowRight size={13} /></span>
        </button>
      </div>

      <OperationLedger />
    </div>
  )
}

function runWord(state: string): string {
  return state === 'success' ? 'Passing' : state === 'failure' ? 'Failing' : state === 'cancelled' ? 'Cancelled' : 'Running'
}
function runTone(state: string): BadgeTone {
  return state === 'success' ? 'success' : state === 'failure' ? 'danger' : state === 'cancelled' ? 'warning' : 'pending'
}
