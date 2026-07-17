import { AlertTriangle, ArrowRight, CheckCircle2, GitBranch, GitPullRequest, PlayCircle, ShieldAlert, Users } from 'lucide-react'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, relativeTime, syncStateLabel } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'
import { OperationLedger } from './OperationLedger'
import type { RepositorySectionId } from '../repositoryTypes'

export function OverviewSection({ onNavigate }: { onNavigate: (section: RepositorySectionId) => void }) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const leases = useRepositoryStore((state) => state.leases)
  const conflicts = useRepositoryStore((state) => state.conflictRisks)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const alerts = useRepositoryStore((state) => state.remoteViews.securityAlerts)
  const approvals = useRepositoryStore((state) => state.approvals)
  const projection = useRepositoryStore((state) => state.remoteProjection)
  const sync = deriveSyncState(snapshot)
  const changes = snapshot?.files.length ?? 0
  const fileConflicts = snapshot?.files.filter((file) => file.conflicted).length ?? 0
  const failedRuns = runs.filter((run) => run.state === 'failure')
  const activeRuns = runs.filter((run) => run.state === 'in_progress' || run.state === 'queued')
  const activePrs = pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft')
  const reviewNeeded = activePrs.filter((pr) => pr.reviewDecision === 'review_required' || pr.reviewDecision === 'changes_requested')
  const mergeReady = activePrs.filter((pr) => !pr.state.includes('draft') && pr.mergeable === true && pr.checksState === 'passing' && pr.reviewDecision === 'approved')
  const warnings = snapshot?.health.warnings ?? []
  const inProgress = snapshot?.health.mergeInProgress || snapshot?.health.rebaseInProgress || snapshot?.health.cherryPickInProgress || snapshot?.health.revertInProgress
  const attention = [
    fileConflicts > 0 && { label: `${fileConflicts} local conflict${fileConflicts === 1 ? '' : 's'} require resolution`, section: 'changes' as const, tone: 'danger' as const },
    failedRuns.length > 0 && { label: `${failedRuns.length} failed CI run${failedRuns.length === 1 ? '' : 's'}`, section: 'actions' as const, tone: 'danger' as const },
    reviewNeeded.length > 0 && { label: `${reviewNeeded.length} pull request${reviewNeeded.length === 1 ? '' : 's'} need review attention`, section: 'pull-requests' as const, tone: 'warning' as const },
    approvals.length > 0 && { label: `${approvals.length} repository approval${approvals.length === 1 ? '' : 's'} pending`, section: 'overview' as const, tone: 'warning' as const },
    conflicts.length > 0 && { label: `${conflicts.length} overlapping agent worktree scope${conflicts.length === 1 ? '' : 's'}`, section: 'branches' as const, tone: 'warning' as const },
    alerts.filter((alert) => alert.state === 'open').length > 0 && { label: `${alerts.filter((alert) => alert.state === 'open').length} open security alert${alerts.filter((alert) => alert.state === 'open').length === 1 ? '' : 's'}`, section: 'security' as const, tone: 'danger' as const },
  ].filter(Boolean) as Array<{ label: string; section: RepositorySectionId; tone: BadgeTone }>

  return <div className="repo-overview">
    {(warnings.length > 0 || inProgress) && <div className="repo-overview-alert" role="note"><AlertTriangle size={15} /><span>{inProgress && 'A Git operation is in progress. '}{warnings.join(' ')}</span></div>}
    <section className="repo-overview-state">
      <div><span>Current branch</span><strong><GitBranch size={14} />{snapshot?.branch ?? 'Detached HEAD'}</strong><small>{snapshot?.headSha.slice(0, 12)}</small></div>
      <div><span>Remote synchronization</span><strong>{syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}</strong><small>{snapshot?.upstream ?? 'No upstream branch'}</small></div>
      <div><span>Working tree</span><strong>{changes === 0 ? 'Clean' : `${changes} changed file${changes === 1 ? '' : 's'}`}</strong><small>{fileConflicts ? `${fileConflicts} conflicted` : 'No unresolved conflicts'}</small></div>
      <div><span>Provider projection</span><strong>{projection?.stale ? 'Stale' : 'Current'}</strong><small>{projection?.lastSuccessfulSync ? `Synced ${relativeTime(projection.lastSuccessfulSync)}` : 'Not synchronized'}</small></div>
    </section>

    <div className="repo-overview-columns">
      <section className="repo-attention"><header><strong>Needs attention</strong><span>{attention.length}</span></header>{attention.length === 0 ? <div className="repo-attention-clear"><CheckCircle2 size={15} /><span>No known repository blockers. Review recent activity or start a branch/worktree.</span></div> : attention.map((item) => <button key={item.label} onClick={() => onNavigate(item.section)}><StatusBadge tone={item.tone}>Attention</StatusBadge><span>{item.label}</span><ArrowRight size={13} /></button>)}</section>
      <section className="repo-attention"><header><strong>Collaboration</strong><span>Live projection</span></header>
        <button onClick={() => onNavigate('pull-requests')}><GitPullRequest size={14} /><span><strong>{activePrs.length} open</strong> · {reviewNeeded.length} need review · {mergeReady.length} merge ready</span><ArrowRight size={13} /></button>
        <button onClick={() => onNavigate('actions')}><PlayCircle size={14} /><span><strong>{failedRuns.length} failed</strong> · {activeRuns.length} running · {runs.length} recent runs</span><ArrowRight size={13} /></button>
        <button onClick={() => onNavigate('branches')}><Users size={14} /><span><strong>{leases.filter((lease) => lease.status === 'active').length} active</strong> agent worktrees · {conflicts.length} scope risks</span><ArrowRight size={13} /></button>
        <button onClick={() => onNavigate('security')}><ShieldAlert size={14} /><span><strong>{alerts.filter((alert) => alert.state === 'open').length} open</strong> provider security alerts</span><ArrowRight size={13} /></button>
      </section>
    </div>

    {changes === 0 && attention.length === 0 && <section className="repo-next-actions"><strong>Suggested next actions</strong><button onClick={() => onNavigate('branches')}>Create an isolated agent worktree</button><button onClick={() => onNavigate('pull-requests')}>Review open pull requests</button><button onClick={() => onNavigate('actions')}>Inspect recent CI</button></section>}
    <OperationLedger />
  </div>
}
