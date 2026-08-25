import type { ProviderAccountStatus, RemoteProjection } from '../../native/types'
import type { PullRequestView, RepositorySectionId } from './repositoryTypes'

/**
 * Contextual repository filters surfaced by Source Control and reusable repository components.
 * A filter never renders its own page — it selects a primary section and narrows that section to a backend-derived slice
 * (e.g. "Awaiting review" opens Pull Requests filtered to PRs that still need a review decision).
 * This keeps the experience one coordinated workspace instead of a set of disconnected screens.
 */
export type RepositoryFilterId =
  | 'needs-attention'
  | 'mine'
  | 'drafts'
  | 'failed-ci'
  | 'awaiting-review'
  | 'agent-worktrees'

/** Pull-request list scopes. `active` and `all` are the legacy scopes; the rest back the filters. */
export type PrFilterId = 'active' | 'all' | 'mine' | 'drafts' | 'awaiting-review' | 'agents'

/** Workflow-run scopes for the Actions surface. */
export type ActionsFilterId = 'all' | 'failed'

/** A coordinated navigation intent: which section to open, and how to scope it. */
export interface RepositoryNavTarget {
  section: RepositorySectionId
  prFilter?: PrFilterId
  actionsFilter?: ActionsFilterId
  filterId?: RepositoryFilterId
}

export type RepositoryNavigate = (target: RepositoryNavTarget) => void

export interface RepositoryFilterDef {
  id: RepositoryFilterId
  label: string
  section: RepositorySectionId
  /** Applied when the target section is Pull Requests. */
  prFilter?: PrFilterId
  /** Applied when the target section is Actions. */
  actionsFilter?: ActionsFilterId
}

export const REPOSITORY_FILTERS: RepositoryFilterDef[] = [
  { id: 'needs-attention', label: 'Needs attention', section: 'overview' },
  { id: 'mine', label: 'Mine', section: 'pull-requests', prFilter: 'mine' },
  { id: 'drafts', label: 'Drafts', section: 'pull-requests', prFilter: 'drafts' },
  { id: 'failed-ci', label: 'Failed CI', section: 'actions', actionsFilter: 'failed' },
  { id: 'awaiting-review', label: 'Awaiting review', section: 'pull-requests', prFilter: 'awaiting-review' },
  { id: 'agent-worktrees', label: 'Agent worktrees', section: 'branches' },
]

/**
 * Narrow a pull-request list to the scope a filter tab represents. The predicates are derived
 * from backend-provided fields only (state, review decision, author identity from the provider
 * account) — nothing here fabricates membership.
 */
export function applyPrFilter(prs: PullRequestView[], filter: PrFilterId, accountLogin?: string): PullRequestView[] {
  switch (filter) {
    case 'all':
      return prs
    case 'active':
      return prs.filter((pr) => pr.state === 'open' || pr.state === 'draft')
    case 'drafts':
      return prs.filter((pr) => pr.state === 'draft')
    case 'awaiting-review':
      return prs.filter((pr) => (pr.state === 'open' || pr.state === 'draft')
        && (pr.reviewDecision === 'review_required' || pr.reviewDecision === 'changes_requested'))
    case 'agents':
      return prs.filter((pr) => pr.authorKind === 'agent')
    case 'mine':
      // "Mine" means authored by the connected account when we know the login; otherwise fall back
      // to human-authored PRs (never agent-authored), which is the closest honest interpretation.
      return prs.filter((pr) => accountLogin
        ? pr.author.toLowerCase() === accountLogin.toLowerCase()
        : pr.authorKind === 'human')
  }
}

export const PR_FILTER_LABELS: Record<PrFilterId, string> = {
  active: 'Active',
  all: 'All',
  mine: 'Mine',
  drafts: 'Drafts',
  'awaiting-review': 'Awaiting review',
  agents: 'Agents',
}

// ---- Provider synchronization posture --------------------------------------------------------
// One accurate provider state, resolved from the projection's per-category sync statuses plus the
// live refresh flag. This replaces contradictory phrasing ("Stale" next to "Synced just now") with
// a single truthful posture and, when partial, names the affected categories.

export type ProviderPostureKind =
  | 'live'
  | 'refreshing'
  | 'synced'
  | 'partially-stale'
  | 'offline-cache'
  | 'permission-limited'
  | 'sync-failed'
  | 'not-synced'
  | 'disconnected'

export interface ProviderPosture {
  kind: ProviderPostureKind
  label: string
  tone: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' | 'pending'
  /** Human-readable detail, e.g. which categories are stale or which permission is missing. */
  detail: string
  /** Categories that could not be freshly synchronized, for the "partially stale" case. */
  affected: string[]
}

const CATEGORY_LABELS: Record<string, string> = {
  pull_request: 'Pull requests',
  workflow: 'Workflows',
  workflow_run: 'Workflow runs',
  issue: 'Issues',
  release: 'Releases',
  dependabot_alert: 'Dependabot',
  code_scanning_alert: 'Code scanning',
  secret_scanning_alert: 'Secret scanning',
  ruleset: 'Rulesets',
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll('_', ' ')
}

export function deriveProviderPosture(input: {
  projection?: RemoteProjection
  providerStatus?: ProviderAccountStatus
  remoteLoading: boolean
  remoteError?: string
}): ProviderPosture {
  const { projection, providerStatus, remoteLoading, remoteError } = input

  if (providerStatus && !providerStatus.authenticated) {
    return { kind: 'disconnected', label: 'Not connected', tone: 'neutral', detail: providerStatus.message || 'Connect a provider account to synchronize.', affected: [] }
  }
  if (remoteLoading) {
    return { kind: 'refreshing', label: 'Refreshing', tone: 'pending', detail: 'Synchronizing with the provider…', affected: [] }
  }
  if (remoteError && !projection) {
    return { kind: 'sync-failed', label: 'Sync failed', tone: 'danger', detail: remoteError, affected: [] }
  }
  if (!projection) {
    return { kind: 'not-synced', label: 'Not synced', tone: 'neutral', detail: 'No provider projection has been retrieved yet.', affected: [] }
  }

  const statuses = projection.syncStatuses ?? []
  const failed = statuses.filter((status) => status.status === 'failed')
  const permission = failed.filter((status) => status.errorCode === 'github_permission_missing')
  const stale = statuses.filter((status) => status.status === 'stale')
  const affected = [...failed, ...stale].map((status) => categoryLabel(status.category))

  if (permission.length > 0) {
    const missing = permission.map((status) => status.requiredPermission).filter(Boolean)
    return { kind: 'permission-limited', label: 'Permission limited', tone: 'warning', detail: missing.length ? `Missing: ${missing.join(', ')}` : 'A provider permission is missing for some categories.', affected }
  }
  if (failed.length > 0) {
    const hasData = (projection.objects?.length ?? 0) > 0
    return hasData
      ? { kind: 'partially-stale', label: 'Partially stale', tone: 'warning', detail: `Using cached data for: ${affected.join(', ')}`, affected }
      : { kind: 'sync-failed', label: 'Sync failed', tone: 'danger', detail: failed[0]?.errorMessage ?? 'The provider did not return data.', affected }
  }
  if (projection.stale || stale.length > 0) {
    return { kind: 'partially-stale', label: 'Partially stale', tone: 'warning', detail: affected.length ? `Awaiting refresh: ${affected.join(', ')}` : 'Cached data may be stale.', affected }
  }
  if (remoteError) {
    return { kind: 'offline-cache', label: 'Offline cache', tone: 'warning', detail: remoteError, affected }
  }
  return { kind: 'synced', label: 'Synced', tone: 'success', detail: projection.lastSuccessfulSync ? 'Provider data is current.' : 'Provider data is current.', affected: [] }
}
