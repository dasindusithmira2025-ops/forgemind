import type {
  RemoteProjectionObject,
  RepositoryActor,
  RepositoryFileStatus,
  RepositorySnapshot,
} from '../../native/types'

/**
 * The Repository Command Center sections. Ordering here drives the section rail. The core
 * development loop (Changes → Branches → Pull Requests → Actions) is prioritized; the
 * remaining sections render connected surfaces backed by the same remote projection contract.
 */
export type RepositorySectionId =
  | 'overview'
  | 'changes'
  | 'branches'
  | 'pull-requests'
  | 'actions'
  | 'issues'
  | 'releases'
  | 'security'

export interface RepositorySectionDef {
  id: RepositorySectionId
  label: string
  /** Sections whose backend contract is remote-projection driven and may be empty offline. */
  remote: boolean
}

export const REPOSITORY_SECTIONS: RepositorySectionDef[] = [
  { id: 'overview', label: 'Overview', remote: false },
  { id: 'changes', label: 'Changes', remote: false },
  { id: 'branches', label: 'Branches', remote: false },
  { id: 'pull-requests', label: 'Pull Requests', remote: true },
  { id: 'actions', label: 'Actions', remote: true },
  { id: 'issues', label: 'Issues', remote: true },
  { id: 'releases', label: 'Releases', remote: true },
  { id: 'security', label: 'Security', remote: true },
]

export type FileGroupKind = 'conflicted' | 'staged' | 'changed' | 'untracked'

export interface FileGroup {
  kind: FileGroupKind
  label: string
  files: RepositoryFileStatus[]
}

/** The working-tree sync posture, derived from the backend snapshot (never invented locally). */
export type SyncState = 'clean' | 'ahead' | 'behind' | 'diverged' | 'unpublished' | 'detached'

/** A parsed remote pull request, mapped defensively from a RemoteProjectionObject payload. */
export interface PullRequestView {
  number: number
  title: string
  state: 'draft' | 'open' | 'merged' | 'closed'
  author: string
  authorKind: 'human' | 'agent'
  baseBranch: string
  headBranch: string
  reviewDecision: 'approved' | 'changes_requested' | 'review_required' | 'none'
  checksState: 'passing' | 'failing' | 'pending' | 'none'
  mergeable: boolean | null
  changedFiles: number
  commits: number
  comments: number
  labels: string[]
  assignees: string[]
  linkedIssue?: string
  updatedAt: string
  headSha: string
  body: string
}

export type WorkflowRunState = 'queued' | 'in_progress' | 'success' | 'failure' | 'cancelled'

export interface WorkflowJobView {
  id: number
  name: string
  state: WorkflowRunState
  durationSeconds?: number
  steps: Array<{ name: string; state: WorkflowRunState }>
}

export interface WorkflowRunView {
  id: number
  name: string
  branch: string
  commitSha: string
  commitMessage: string
  state: WorkflowRunState
  event: string
  durationSeconds?: number
  createdAt: string
  jobs: WorkflowJobView[]
  failureSummary?: string
}

export interface IssueView {
  number: number
  title: string
  state: 'open' | 'closed'
  author: string
  labels: string[]
  comments: number
  updatedAt: string
}

export interface ReleaseView {
  tag: string
  name: string
  draft: boolean
  prerelease: boolean
  publishedAt?: string
  author: string
}

export interface SecurityAlertView {
  id: string
  kind: 'secret_scanning' | 'dependabot' | 'code_scanning'
  severity: 'critical' | 'high' | 'medium' | 'low'
  summary: string
  state: 'open' | 'resolved' | 'dismissed'
  updatedAt: string
}

export interface RemoteProjectionViews {
  pullRequests: PullRequestView[]
  workflowRuns: WorkflowRunView[]
  issues: IssueView[]
  releases: ReleaseView[]
  securityAlerts: SecurityAlertView[]
}

export const EMPTY_REMOTE_VIEWS: RemoteProjectionViews = {
  pullRequests: [],
  workflowRuns: [],
  issues: [],
  releases: [],
  securityAlerts: [],
}

/** The current human operator identity attached to every locally-initiated operation. */
export function humanActor(id = 'local-user', displayName = 'You'): RepositoryActor {
  return { kind: 'human', id, displayName }
}

export function isRemoteObject(object: RemoteProjectionObject, kind: string): boolean {
  return object.kind === kind && !object.deleted
}

export interface RepositoryLoadState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  errorCode?: string
  errorMessage?: string
}

export function fileCount(snapshot: RepositorySnapshot | undefined): number {
  return snapshot?.files.length ?? 0
}
