import type { ReactNode } from 'react'
import {
  Bot, CircleDot, FileDiff, GitBranch, GitPullRequest, History, LayoutDashboard, PanelLeftClose,
  PanelLeftOpen, PlayCircle, Plus, Radar, ShieldAlert, Tag,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useRepositoryStore } from '../repositoryStore'
import { deriveSyncState, syncStateLabel } from '../repositorySelectors'
import { REPOSITORY_FILTERS, type RepositoryFilterId, type RepositoryNavigate } from '../repositoryNav'
import { REPOSITORY_SECTIONS, type RepositorySectionId } from '../repositoryTypes'

const SECTION_ICONS: Record<RepositorySectionId, ReactNode> = {
  overview: <LayoutDashboard size={15} />,
  changes: <FileDiff size={15} />,
  history: <History size={15} />,
  intelligence: <Radar size={15} />,
  branches: <GitBranch size={15} />,
  'pull-requests': <GitPullRequest size={15} />,
  actions: <PlayCircle size={15} />,
  issues: <CircleDot size={15} />,
  releases: <Tag size={15} />,
  security: <ShieldAlert size={15} />,
}

/**
 * The compact repository navigation rail: primary sections, contextual filters, a live status
 * block, and the two repository-creation quick actions. It mirrors Paralith's application
 * navigation idiom (vertical, icon + label, count badges) rather than becoming a second oversized
 * sidebar; it can collapse to an icon rail on smaller displays.
 */
export function RepositorySidebar({ active, activeFilter, collapsed, onNavigate, onToggleCollapse, onCreateBranch, onCreateWorktree }: {
  active: RepositorySectionId
  activeFilter?: RepositoryFilterId
  collapsed: boolean
  onNavigate: RepositoryNavigate
  onToggleCollapse: () => void
  onCreateBranch: () => void
  onCreateWorktree: () => void
}) {
  const snapshot = useRepositoryStore((state) => state.snapshot)
  const branches = useRepositoryStore((state) => state.branches)
  const leases = useRepositoryStore((state) => state.leases)
  const runs = useRepositoryStore((state) => state.remoteViews.workflowRuns)
  const pullRequests = useRepositoryStore((state) => state.remoteViews.pullRequests)
  const issues = useRepositoryStore((state) => state.remoteViews.issues)
  const alerts = useRepositoryStore((state) => state.remoteViews.securityAlerts)
  const providerStatus = useRepositoryStore((state) => state.providerStatus)

  const activePrs = pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft')
  const sectionCounts: Partial<Record<RepositorySectionId, number>> = {
    changes: snapshot?.files.length ?? 0,
    branches: branches.length,
    'pull-requests': activePrs.length,
    actions: runs.filter((run) => run.state === 'failure').length,
    issues: issues.filter((issue) => issue.state === 'open').length,
    security: alerts.filter((alert) => alert.state === 'open').length,
  }

  const filterCounts: Record<RepositoryFilterId, number> = {
    'needs-attention': attentionCount({ snapshot, runs, activePrs, alerts, leases: leases.length }),
    mine: activePrs.filter((pr) => providerStatus?.accountLogin ? pr.author.toLowerCase() === providerStatus.accountLogin.toLowerCase() : pr.authorKind === 'human').length,
    drafts: activePrs.filter((pr) => pr.state === 'draft').length,
    'failed-ci': runs.filter((run) => run.state === 'failure').length,
    'awaiting-review': activePrs.filter((pr) => pr.reviewDecision === 'review_required' || pr.reviewDecision === 'changes_requested').length,
    'agent-worktrees': leases.filter((lease) => lease.status === 'active').length,
  }

  const sync = deriveSyncState(snapshot)
  const changes = snapshot?.files.length ?? 0

  return (
    <nav className={`rcc-rail ${collapsed ? 'collapsed' : ''}`} aria-label="Repository navigation">
      <div className="rcc-rail-scroll">
        <ul className="rcc-nav">
          {REPOSITORY_SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                className={active === section.id && !activeFilter ? 'active' : ''}
                aria-current={active === section.id ? 'page' : undefined}
                aria-label={section.label}
                title={collapsed ? section.label : undefined}
                onClick={() => onNavigate({ section: section.id })}
              >
                <span className="rcc-nav-icon" aria-hidden>{SECTION_ICONS[section.id]}</span>
                <span className="rcc-nav-label">{section.label}</span>
                {sectionCounts[section.id] ? <span className="rcc-nav-count">{sectionCounts[section.id]}</span> : null}
              </button>
            </li>
          ))}
        </ul>

        {!collapsed && (
          <>
            <div className="rcc-rail-heading">Filters</div>
            <ul className="rcc-nav rcc-nav-filters">
              {REPOSITORY_FILTERS.map((filter) => (
                <li key={filter.id}>
                  <button
                    className={activeFilter === filter.id ? 'active' : ''}
                    onClick={() => onNavigate({ section: filter.section, prFilter: filter.prFilter, actionsFilter: filter.actionsFilter, filterId: filter.id })}
                  >
                    <span className="rcc-nav-icon" aria-hidden><FilterDot id={filter.id} /></span>
                    <span className="rcc-nav-label">{filter.label}</span>
                    {filterCounts[filter.id] ? <span className="rcc-nav-count">{filterCounts[filter.id]}</span> : null}
                  </button>
                </li>
              ))}
            </ul>

            <div className="rcc-rail-heading">Repository status</div>
            <dl className="rcc-status">
              <div><dt>Current branch</dt><dd className="mono">{snapshot?.branch ?? 'Detached HEAD'}</dd></div>
              <div><dt>Ahead / behind</dt><dd>+{snapshot?.ahead ?? 0} / −{snapshot?.behind ?? 0}</dd></div>
              <div><dt>PRs open</dt><dd>{activePrs.length}</dd></div>
              <div><dt>Working tree</dt><dd>{changes === 0 ? 'Clean' : `${changes} changed`}</dd></div>
              <div><dt>Remote</dt><dd>{syncStateLabel(sync, snapshot?.ahead ?? 0, snapshot?.behind ?? 0)}</dd></div>
            </dl>
          </>
        )}
      </div>

      <div className="rcc-rail-actions">
        {!collapsed && <Button variant="secondary" icon={<Plus size={14} />} onClick={onCreateBranch}>Create branch</Button>}
        {!collapsed && <Button variant="secondary" icon={<Bot size={14} />} onClick={onCreateWorktree}>New worktree</Button>}
        <Button variant="ghost" icon={collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={onToggleCollapse} />
      </div>
    </nav>
  )
}

function FilterDot({ id }: { id: RepositoryFilterId }) {
  const tone = id === 'failed-ci' ? 'danger' : id === 'awaiting-review' || id === 'drafts' ? 'warning' : id === 'agent-worktrees' || id === 'mine' ? 'accent' : 'neutral'
  return <span className={`rcc-filter-dot tone-${tone}`} />
}

function attentionCount({ snapshot, runs, activePrs, alerts, leases }: {
  snapshot: ReturnType<typeof useRepositoryStore.getState>['snapshot']
  runs: ReturnType<typeof useRepositoryStore.getState>['remoteViews']['workflowRuns']
  activePrs: ReturnType<typeof useRepositoryStore.getState>['remoteViews']['pullRequests']
  alerts: ReturnType<typeof useRepositoryStore.getState>['remoteViews']['securityAlerts']
  leases: number
}): number {
  const conflicts = snapshot?.files.filter((file) => file.conflicted).length ?? 0
  const failed = runs.filter((run) => run.state === 'failure').length
  const reviewNeeded = activePrs.filter((pr) => pr.reviewDecision === 'review_required' || pr.reviewDecision === 'changes_requested').length
  const openAlerts = alerts.filter((alert) => alert.state === 'open').length
  return (conflicts > 0 ? 1 : 0) + (failed > 0 ? 1 : 0) + (reviewNeeded > 0 ? 1 : 0) + (openAlerts > 0 ? 1 : 0) + (leases > 0 ? 0 : 0)
}
