import type {
  RemoteProjection,
  RemoteProjectionObject,
  RepositoryFileStatus,
  RepositorySnapshot,
} from '../../native/types'
import {
  EMPTY_REMOTE_VIEWS,
  type FileGroup,
  type IssueView,
  type PullRequestView,
  type ReleaseView,
  type RemoteProjectionViews,
  type SecurityAlertView,
  type SyncState,
  type WorkflowRunState,
  type WorkflowRunView,
} from './repositoryTypes'

/**
 * Split the snapshot's flat file list into the four working-tree groups the Changes surface
 * renders. A partially-staged file legitimately appears in both `staged` and `changed`; the
 * counts follow git's own index/worktree split rather than collapsing the file into one bucket.
 */
export function groupFiles(files: RepositoryFileStatus[]): FileGroup[] {
  const conflicted: RepositoryFileStatus[] = []
  const staged: RepositoryFileStatus[] = []
  const changed: RepositoryFileStatus[] = []
  const untracked: RepositoryFileStatus[] = []

  for (const file of files) {
    if (file.conflicted) { conflicted.push(file); continue }
    if (file.untracked) { untracked.push(file); continue }
    if (hasStatus(file.indexStatus)) staged.push(file)
    if (hasStatus(file.worktreeStatus)) changed.push(file)
  }

  return [
    { kind: 'conflicted', label: 'Conflicts', files: conflicted },
    { kind: 'staged', label: 'Staged', files: staged },
    { kind: 'changed', label: 'Changed', files: changed },
    { kind: 'untracked', label: 'Untracked', files: untracked },
  ]
}

function hasStatus(code: string): boolean {
  return code.trim().length > 0 && code !== '.' && code !== ' '
}

export function filterFiles(files: RepositoryFileStatus[], query: string): RepositoryFileStatus[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return files
  return files.filter((file) =>
    file.path.toLowerCase().includes(trimmed) || (file.originalPath?.toLowerCase().includes(trimmed) ?? false))
}

/** Human-facing single-letter status glyph for a file, favouring the most significant state. */
export function fileStatusGlyph(file: RepositoryFileStatus): string {
  if (file.conflicted) return 'U'
  if (file.untracked) return '?'
  if (file.renamed) return 'R'
  if (file.deleted) return 'D'
  const index = file.indexStatus.trim()
  const worktree = file.worktreeStatus.trim()
  return (index || worktree || 'M').charAt(0).toUpperCase()
}

export function fileStatusLabel(file: RepositoryFileStatus): string {
  if (file.conflicted) return 'Conflicted'
  if (file.untracked) return 'Untracked'
  if (file.renamed) return 'Renamed'
  if (file.deleted) return 'Deleted'
  if (file.submodule) return 'Submodule'
  return 'Modified'
}

/** Derive the sync posture from backend-provided counts. Never a business-critical decision. */
export function deriveSyncState(snapshot: RepositorySnapshot | undefined): SyncState {
  if (!snapshot) return 'clean'
  if (!snapshot.branch) return 'detached'
  if (!snapshot.upstream) return 'unpublished'
  if (snapshot.ahead > 0 && snapshot.behind > 0) return 'diverged'
  if (snapshot.ahead > 0) return 'ahead'
  if (snapshot.behind > 0) return 'behind'
  return 'clean'
}

export function syncStateLabel(state: SyncState, ahead: number, behind: number): string {
  switch (state) {
    case 'ahead': return `${ahead} ahead`
    case 'behind': return `${behind} behind`
    case 'diverged': return `${ahead} ahead · ${behind} behind`
    case 'unpublished': return 'Not published'
    case 'detached': return 'Detached HEAD'
    case 'clean': return 'Up to date'
  }
}

export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'meta'
  text: string
  oldLine?: number
  newLine?: number
}

export interface DiffStat { added: number; removed: number }

/**
 * Parse a unified diff into typed lines with old/new line numbers so the viewer can render both
 * unified and split modes without re-parsing, and window the output for very large diffs.
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  if (!text) return []
  const lines = text.split('\n')
  const out: DiffLine[] = []
  let oldLine = 0
  let newLine = 0
  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (match) { oldLine = Number(match[1]); newLine = Number(match[2]) }
      out.push({ kind: 'hunk', text: raw })
      continue
    }
    if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')
      || raw.startsWith('new file') || raw.startsWith('deleted file') || raw.startsWith('rename ')
      || raw.startsWith('similarity ') || raw.startsWith('Binary ')) {
      out.push({ kind: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('+')) { out.push({ kind: 'add', text: raw.slice(1), newLine }); newLine += 1; continue }
    if (raw.startsWith('-')) { out.push({ kind: 'del', text: raw.slice(1), oldLine }); oldLine += 1; continue }
    // A trailing empty element from split('\n') is not a real context line.
    if (raw === '' && out.length > 0 && out[out.length - 1]?.kind !== 'meta') continue
    out.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw, oldLine, newLine })
    oldLine += 1; newLine += 1
  }
  return out
}

export function diffStat(lines: DiffLine[]): DiffStat {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added += 1
    else if (line.kind === 'del') removed += 1
  }
  return { added, removed }
}

// ---- Remote projection parsing -----------------------------------------------------------
// Payloads are provider-shaped and typed as `unknown` on the contract, so every field access
// is defensive. Missing/unknown fields degrade to safe defaults rather than throwing; nothing
// here fabricates data — an absent projection simply yields empty views.

export function parseRemoteProjection(projection: RemoteProjection | undefined): RemoteProjectionViews {
  if (!projection) return EMPTY_REMOTE_VIEWS
  const views: RemoteProjectionViews = {
    pullRequests: [],
    workflowRuns: [],
    issues: [],
    releases: [],
    securityAlerts: [],
  }
  for (const object of projection.objects) {
    if (object.deleted) continue
    switch (object.kind) {
      case 'pull_request': { const pr = parsePullRequest(object); if (pr) views.pullRequests.push(pr); break }
      case 'workflow_run': { const run = parseWorkflowRun(object); if (run) views.workflowRuns.push(run); break }
      case 'issue': { const issue = parseIssue(object); if (issue) views.issues.push(issue); break }
      case 'release': { const release = parseRelease(object); if (release) views.releases.push(release); break }
      case 'security_alert': { const alert = parseSecurityAlert(object); if (alert) views.securityAlerts.push(alert); break }
    }
  }
  views.pullRequests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  views.workflowRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return views
}

function record(object: RemoteProjectionObject): Record<string, unknown> {
  return (object.payload && typeof object.payload === 'object' ? object.payload : {}) as Record<string, unknown>
}
function str(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function num(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function bool(value: unknown): boolean { return value === true }
function strArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }

function parsePullRequest(object: RemoteProjectionObject): PullRequestView | undefined {
  const data = record(object)
  const number = num(data.number, NaN)
  if (Number.isNaN(number)) return undefined
  const stateRaw = str(data.state, 'open')
  const state: PullRequestView['state'] = bool(data.draft) ? 'draft'
    : stateRaw === 'merged' ? 'merged' : stateRaw === 'closed' ? 'closed' : 'open'
  const reviewRaw = str(data.reviewDecision)
  const review: PullRequestView['reviewDecision'] = reviewRaw === 'approved' ? 'approved'
    : reviewRaw === 'changes_requested' ? 'changes_requested'
      : reviewRaw === 'review_required' ? 'review_required' : 'none'
  const checksRaw = str(data.checksState)
  const checks: PullRequestView['checksState'] = checksRaw === 'passing' || checksRaw === 'success' ? 'passing'
    : checksRaw === 'failing' || checksRaw === 'failure' ? 'failing'
      : checksRaw === 'pending' || checksRaw === 'in_progress' ? 'pending' : 'none'
  return {
    number,
    title: str(data.title, `#${number}`),
    state,
    author: str(data.author, 'unknown'),
    authorKind: str(data.authorKind) === 'agent' ? 'agent' : 'human',
    baseBranch: str(data.baseBranch, 'main'),
    headBranch: str(data.headBranch),
    reviewDecision: review,
    checksState: checks,
    mergeable: typeof data.mergeable === 'boolean' ? data.mergeable : null,
    changedFiles: num(data.changedFiles),
    commits: num(data.commits),
    comments: num(data.comments),
    labels: strArray(data.labels),
    assignees: strArray(data.assignees),
    linkedIssue: typeof data.linkedIssue === 'string' ? data.linkedIssue : undefined,
    updatedAt: str(data.updatedAt, object.fetchedAt),
    headSha: str(data.headSha),
    body: str(data.body),
  }
}

function normalizeRunState(value: unknown): WorkflowRunState {
  const raw = str(value)
  if (raw === 'success' || raw === 'completed') return 'success'
  if (raw === 'failure' || raw === 'failed') return 'failure'
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled'
  if (raw === 'in_progress' || raw === 'running') return 'in_progress'
  return 'queued'
}

function parseWorkflowRun(object: RemoteProjectionObject): WorkflowRunView | undefined {
  const data = record(object)
  const id = num(data.id, NaN)
  if (Number.isNaN(id)) return undefined
  const jobs = Array.isArray(data.jobs) ? data.jobs.map((job) => {
    const jobRecord = (job && typeof job === 'object' ? job : {}) as Record<string, unknown>
    return {
      id: num(jobRecord.id),
      name: str(jobRecord.name, 'job'),
      state: normalizeRunState(jobRecord.state ?? jobRecord.conclusion ?? jobRecord.status),
      durationSeconds: typeof jobRecord.durationSeconds === 'number' ? jobRecord.durationSeconds : undefined,
      steps: Array.isArray(jobRecord.steps) ? jobRecord.steps.map((step) => {
        const stepRecord = (step && typeof step === 'object' ? step : {}) as Record<string, unknown>
        return { name: str(stepRecord.name, 'step'), state: normalizeRunState(stepRecord.state ?? stepRecord.conclusion) }
      }) : [],
    }
  }) : []
  return {
    id,
    name: str(data.name, 'workflow'),
    branch: str(data.branch),
    commitSha: str(data.commitSha),
    commitMessage: str(data.commitMessage),
    state: normalizeRunState(data.state ?? data.conclusion ?? data.status),
    event: str(data.event, 'push'),
    durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : undefined,
    createdAt: str(data.createdAt, object.fetchedAt),
    jobs,
    failureSummary: typeof data.failureSummary === 'string' ? data.failureSummary : undefined,
  }
}

function parseIssue(object: RemoteProjectionObject): IssueView | undefined {
  const data = record(object)
  const number = num(data.number, NaN)
  if (Number.isNaN(number)) return undefined
  return {
    number,
    title: str(data.title, `#${number}`),
    state: str(data.state) === 'closed' ? 'closed' : 'open',
    author: str(data.author, 'unknown'),
    labels: strArray(data.labels),
    comments: num(data.comments),
    updatedAt: str(data.updatedAt, object.fetchedAt),
  }
}

function parseRelease(object: RemoteProjectionObject): ReleaseView | undefined {
  const data = record(object)
  const tag = str(data.tag, str(data.tagName))
  if (!tag) return undefined
  return {
    tag,
    name: str(data.name, tag),
    draft: bool(data.draft),
    prerelease: bool(data.prerelease),
    publishedAt: typeof data.publishedAt === 'string' ? data.publishedAt : undefined,
    author: str(data.author, 'unknown'),
  }
}

function parseSecurityAlert(object: RemoteProjectionObject): SecurityAlertView | undefined {
  const data = record(object)
  const id = str(data.id, object.externalId)
  if (!id) return undefined
  const severityRaw = str(data.severity, 'low')
  const severity: SecurityAlertView['severity'] = ['critical', 'high', 'medium', 'low'].includes(severityRaw)
    ? (severityRaw as SecurityAlertView['severity']) : 'low'
  const kindRaw = str(data.kind, 'code_scanning')
  const kind: SecurityAlertView['kind'] = kindRaw === 'secret_scanning' || kindRaw === 'dependabot' ? kindRaw : 'code_scanning'
  return {
    id,
    kind,
    severity,
    summary: str(data.summary, 'Security alert'),
    state: str(data.state) === 'resolved' ? 'resolved' : str(data.state) === 'dismissed' ? 'dismissed' : 'open',
    updatedAt: str(data.updatedAt, object.fetchedAt),
  }
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

export function relativeTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return '—'
  const delta = Math.max(0, now - time)
  const seconds = Math.floor(delta / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(time).toLocaleDateString()
}
