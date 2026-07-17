import { useMemo } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, CircleDot, Cloud, CloudOff, GitBranch,
  Loader2, RefreshCw, Users,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, syncStateLabel } from '../repositorySelectors'
import { StatusBadge, type BadgeTone } from './StatusBadge'

/**
 * The persistent repository header. It stays compact — one dense row of backend-authoritative
 * status plus the fetch/sync and repository-action controls — so it never eats vertical space
 * that belongs to the diff or review content below.
 */
export function RepositoryHeader({ projectName, menuOpen, onToggleMenu }: {
  projectName: string
  menuOpen: boolean
  onToggleMenu: () => void
}) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)
  const leases = useRepositoryStore((state) => state.leases)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const pending = useRepositoryStore((state) => state.pending)
  const runOperation = useRepositoryStore((state) => state.runOperation)

  const sync = deriveSyncState(snapshot)
  const syncTone: BadgeTone = sync === 'clean' ? 'success' : sync === 'diverged' ? 'warning' : 'accent'
  const changeCount = snapshot?.files.length ?? 0
  const conflicts = snapshot?.files.filter((file) => file.conflicted).length ?? 0
  const activeAgentBranches = leases.filter((lease) => lease.status !== 'released').length
  const remote = snapshot?.remotes[0] ?? 'no remote'
  const provider = providerStatus?.provider ?? (snapshot?.remotes.length ? 'git remote' : 'local only')

  const latestRun = runs[0]
  const ciTone: BadgeTone = !latestRun ? 'neutral'
    : latestRun.state === 'success' ? 'success'
      : latestRun.state === 'failure' ? 'danger'
        : latestRun.state === 'cancelled' ? 'warning' : 'pending'
  const openPrs = pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft').length

  const fetchBusy = Boolean(pending['fetch'])
  const doFetch = () => { void runOperation({ kind: 'fetch_remote', remote, prune: true }, { key: 'fetch' }).catch(() => undefined) }

  const branchLabel = useMemo(() => snapshot?.branch ?? (snapshot?.headSha ? `detached @ ${snapshot.headSha.slice(0, 7)}` : '—'), [snapshot])

  return (
    <div className="repo-header">
      <div className="repo-header-identity">
        <GitBranch size={16} aria-hidden />
        <div>
          <strong title={snapshot?.repositoryPath}>{projectName}</strong>
          <span className="repo-header-branch" title="Current branch">{branchLabel}</span>
        </div>
      </div>

      <div className="repo-header-status" role="group" aria-label="Repository status">
        <StatusBadge tone={providerStatus?.authenticated ? 'accent' : 'neutral'} icon={providerStatus?.authenticated ? <Cloud size={12} /> : <CloudOff size={12} />} title={providerStatus?.message}>
          {provider}
        </StatusBadge>
        <StatusBadge tone={syncTone} title="Ahead / behind upstream">
          {syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}
        </StatusBadge>
        <StatusBadge tone={conflicts > 0 ? 'danger' : changeCount > 0 ? 'warning' : 'success'} icon={conflicts > 0 ? <AlertTriangle size={12} /> : changeCount > 0 ? <CircleDot size={12} /> : <CheckCircle2 size={12} />}>
          {conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : changeCount > 0 ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : 'Working tree clean'}
        </StatusBadge>
        {openPrs > 0 && <StatusBadge tone="accent">{openPrs} open PR{openPrs === 1 ? '' : 's'}</StatusBadge>}
        {latestRun && <StatusBadge tone={ciTone} title={`Latest workflow: ${latestRun.name}`}>{ciLabel(latestRun.state)}</StatusBadge>}
        {activeAgentBranches > 0 && <StatusBadge tone="accent" icon={<Users size={12} />} title="Active agent worktrees">{activeAgentBranches} agent branch{activeAgentBranches === 1 ? '' : 'es'}</StatusBadge>}
      </div>

      <div className="repo-header-actions">
        <Button variant="secondary" icon={fetchBusy ? <Loader2 size={14} className="is-spinning" /> : <RefreshCw size={14} />} onClick={doFetch} disabled={fetchBusy || !snapshot}>
          {fetchBusy ? 'Fetching' : 'Fetch'}
        </Button>
        <div className="repo-menu-wrap">
          <Button variant="ghost" icon={<ChevronDown size={14} />} aria-haspopup="menu" aria-expanded={menuOpen} onClick={onToggleMenu}>Repository</Button>
        </div>
      </div>
    </div>
  )
}

function ciLabel(state: string): string {
  switch (state) {
    case 'success': return 'CI passing'
    case 'failure': return 'CI failing'
    case 'in_progress': return 'CI running'
    case 'cancelled': return 'CI cancelled'
    default: return 'CI queued'
  }
}
