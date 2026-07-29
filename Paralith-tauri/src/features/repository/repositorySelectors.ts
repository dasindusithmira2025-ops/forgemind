import type {
  RemoteProjection,
  RemoteProjectionObject,
  RemoteSyncStatus,
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
  type WorkflowDefinitionView,
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
    workflows: [],
    workflowRuns: [],
    issues: [],
    releases: [],
    securityAlerts: [],
  }
  for (const object of projection.objects) {
    if (object.deleted) continue
    switch (object.kind) {
      case 'pull_request': { const pr = parsePullRequest(object); if (pr) views.pullRequests.push(pr); break }
      case 'workflow': { const workflow = parseWorkflowDefinition(object); if (workflow) views.workflows.push(workflow); break }
      case 'workflow_run': { const run = parseWorkflowRun(object); if (run) views.workflowRuns.push(run); break }
      case 'issue': { const issue = parseIssue(object); if (issue) views.issues.push(issue); break }
      case 'release': { const release = parseRelease(object); if (release) views.releases.push(release); break }
      case 'security_alert': case 'dependabot_alert': case 'code_scanning_alert': case 'secret_scanning_alert': { const alert = parseSecurityAlert(object); if (alert) views.securityAlerts.push(alert); break }
    }
  }
  views.pullRequests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  views.workflowRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return views
}

export function remoteCategoryStatus(projection: RemoteProjection | undefined, ...categories: string[]): RemoteSyncStatus | undefined {
  const statuses = projection?.syncStatuses ?? []
  const failed = statuses.find((status) => categories.includes(status.category) && status.status !== 'healthy')
  return failed ?? statuses.find((status) => categories.includes(status.category))
}

function record(object: RemoteProjectionObject): Record<string, unknown> {
  return (object.payload && typeof object.payload === 'object' ? object.payload : {}) as Record<string, unknown>
}
function str(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function num(value: unknown, fallback = 0): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function bool(value: unknown): boolean { return value === true }
function strArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] }
function field(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) if (data[key] !== undefined && data[key] !== null) return data[key]
  return undefined
}
function login(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return str((value as Record<string, unknown>).login, fallback)
  return fallback
}
function namedArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => typeof item === 'string' ? item : item && typeof item === 'object' ? str((item as Record<string, unknown>).name, str((item as Record<string, unknown>).login)) : '').filter(Boolean)
}

export function parsePullRequest(object: RemoteProjectionObject): PullRequestView | undefined {
  const data = record(object)
  const number = num(data.number, NaN)
  if (Number.isNaN(number)) return undefined
  const stateRaw = str(data.state, 'open').toLowerCase()
  const state: PullRequestView['state'] = bool(field(data, 'draft', 'isDraft')) ? 'draft'
    : stateRaw === 'merged' ? 'merged' : stateRaw === 'closed' ? 'closed' : 'open'
  const reviewRaw = str(data.reviewDecision).toLowerCase()
  const review: PullRequestView['reviewDecision'] = reviewRaw === 'approved' ? 'approved'
    : reviewRaw === 'changes_requested' ? 'changes_requested'
      : reviewRaw === 'review_required' ? 'review_required' : 'none'
  const checkRows = Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : []
  const checkConclusions = checkRows.map((item) => item && typeof item === 'object' ? str((item as Record<string, unknown>).conclusion).toLowerCase() : '')
  const checkStatuses = checkRows.map((item) => item && typeof item === 'object' ? str((item as Record<string, unknown>).status).toLowerCase() : '')
  const checksRaw = str(data.checksState) || (checkConclusions.some((item) => ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(item)) ? 'failing'
    : checkStatuses.some((item) => item && item !== 'completed') ? 'pending'
      : checkRows.length > 0 && checkConclusions.every((item) => ['success', 'neutral', 'skipped'].includes(item)) ? 'passing' : '')
  const checks: PullRequestView['checksState'] = checksRaw === 'passing' || checksRaw === 'success' ? 'passing'
    : checksRaw === 'failing' || checksRaw === 'failure' ? 'failing'
      : checksRaw === 'pending' || checksRaw === 'in_progress' ? 'pending' : 'none'
  return {
    number,
    title: str(data.title, `#${number}`),
    state,
    author: login(data.author, 'Unavailable'),
    authorKind: str(data.authorKind) === 'agent' ? 'agent' : 'human',
    baseBranch: str(field(data, 'baseBranch', 'baseRefName')),
    headBranch: str(field(data, 'headBranch', 'headRefName')),
    reviewDecision: review,
    checksState: checks,
    mergeable: typeof data.mergeable === 'boolean' ? data.mergeable : null,
    changedFiles: num(data.changedFiles),
    // Summary projection deliberately avoids the unbounded GraphQL commits connection. The
    // selected PR replaces this sentinel with an authoritative count from its detail request.
    commits: Array.isArray(data.commits) ? data.commits.length : data.commits === undefined ? -1 : num(data.commits),
    comments: Array.isArray(data.comments) ? data.comments.length : data.comments === undefined ? -1 : num(data.comments),
    labels: namedArray(data.labels),
    assignees: namedArray(data.assignees),
    linkedIssue: typeof data.linkedIssue === 'string' ? data.linkedIssue : undefined,
    updatedAt: str(data.updatedAt, object.fetchedAt),
    headSha: str(field(data, 'headSha', 'headRefOid')),
    body: str(data.body),
    additions: num(data.additions),
    deletions: num(data.deletions),
    url: str(data.url),
    reviews: Array.isArray(data.reviews) ? data.reviews.map((review) => {
      const value = (review && typeof review === 'object' ? review : {}) as Record<string, unknown>
      return { author: login(value.author, 'Unavailable'), state: str(value.state).toLowerCase(), body: str(value.body), submittedAt: str(value.submittedAt) }
    }) : [],
    checks: checkRows.map((check) => {
      const value = (check && typeof check === 'object' ? check : {}) as Record<string, unknown>
      return { name: str(value.name, 'Check'), workflowName: str(value.workflowName), status: str(value.status).toLowerCase(), conclusion: str(value.conclusion).toLowerCase(), url: str(value.detailsUrl) }
    }),
    files: Array.isArray(data.files) ? data.files.map((file) => {
      const value = (file && typeof file === 'object' ? file : {}) as Record<string, unknown>
      return { path: str(value.filename), status: str(value.status), additions: num(value.additions), deletions: num(value.deletions), changes: num(value.changes), patch: typeof value.patch === 'string' ? value.patch : undefined }
    }) : [],
    reviewThreads: Array.isArray(data.reviewThreads) ? data.reviewThreads.map((thread) => {
      const value = (thread && typeof thread === 'object' ? thread : {}) as Record<string, unknown>
      return { id: num(value.id), path: str(value.path), line: typeof value.line === 'number' ? value.line : undefined, side: typeof value.side === 'string' ? value.side : undefined, author: login(value.user, 'Unavailable'), body: str(value.body), createdAt: str(value.created_at), replyTo: typeof value.in_reply_to_id === 'number' ? value.in_reply_to_id : undefined }
    }) : [],
  }
}

function parseWorkflowDefinition(object: RemoteProjectionObject): WorkflowDefinitionView | undefined {
  const data = record(object)
  const id = num(field(data, 'id', 'databaseId'), NaN)
  if (Number.isNaN(id)) return undefined
  return {
    id,
    name: str(data.name, `Workflow ${id}`),
    path: str(data.path),
    state: str(data.state, 'state unavailable'),
    url: str(field(data, 'html_url', 'url')),
    updatedAt: str(field(data, 'updated_at', 'updatedAt'), object.fetchedAt),
    triggerKinds: strArray(data.triggerKinds),
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

export function parseWorkflowRun(object: RemoteProjectionObject): WorkflowRunView | undefined {
  const data = record(object)
  const id = num(field(data, 'id', 'databaseId'), NaN)
  if (Number.isNaN(id)) return undefined
  const jobs = Array.isArray(data.jobs) ? data.jobs.map((job) => {
    const jobRecord = (job && typeof job === 'object' ? job : {}) as Record<string, unknown>
    return {
      id: num(field(jobRecord, 'id', 'databaseId')),
      name: str(jobRecord.name, 'job'),
      state: normalizeRunState(jobRecord.state ?? jobRecord.conclusion ?? jobRecord.status),
      durationSeconds: typeof jobRecord.durationSeconds === 'number' ? jobRecord.durationSeconds : elapsedSeconds(str(jobRecord.startedAt), str(jobRecord.completedAt)),
      steps: Array.isArray(jobRecord.steps) ? jobRecord.steps.map((step) => {
        const stepRecord = (step && typeof step === 'object' ? step : {}) as Record<string, unknown>
        return { name: str(stepRecord.name, 'step'), state: normalizeRunState(stepRecord.state ?? stepRecord.conclusion) }
      }) : [],
    }
  }) : []
  return {
    id,
    name: str(data.name, 'workflow'),
    branch: str(field(data, 'branch', 'head_branch', 'headBranch')),
    commitSha: str(field(data, 'commitSha', 'head_sha', 'headSha')),
    commitMessage: str(field(data, 'commitMessage', 'display_title', 'displayTitle')),
    state: normalizeRunState(data.state ?? data.conclusion ?? data.status),
    event: str(data.event, 'push'),
    durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : elapsedSeconds(str(field(data, 'startedAt', 'started_at', 'createdAt', 'created_at')), str(field(data, 'updatedAt', 'updated_at'))),
    createdAt: str(field(data, 'createdAt', 'created_at'), object.fetchedAt),
    jobs,
    failureSummary: typeof data.failureSummary === 'string' ? data.failureSummary : undefined,
    workflowId: num(field(data, 'workflowId', 'workflow_id'), 0) || undefined,
    actor: login(data.actor, 'Unavailable'),
    attempt: num(field(data, 'attempt', 'run_attempt'), 1),
    url: str(field(data, 'html_url', 'url')),
    pullRequests: Array.isArray(data.pull_requests) ? data.pull_requests.map((item) => item && typeof item === 'object' ? num((item as Record<string, unknown>).number, NaN) : NaN).filter(Number.isFinite) : [],
    artifacts: Array.isArray(data.artifacts) ? data.artifacts.map((artifact) => {
      const value = (artifact && typeof artifact === 'object' ? artifact : {}) as Record<string, unknown>
      return {
        id: num(value.id),
        name: str(value.name, 'artifact'),
        size: num(field(value, 'size_in_bytes', 'size')),
        expired: bool(value.expired),
        createdAt: str(field(value, 'created_at', 'createdAt')),
        url: str(field(value, 'archive_download_url', 'url')),
      }
    }) : [],
  }
}

function elapsedSeconds(start: string, end: string): number | undefined {
  const started = Date.parse(start)
  const completed = Date.parse(end)
  return Number.isFinite(started) && Number.isFinite(completed) && completed >= started ? Math.round((completed - started) / 1000) : undefined
}

function parseIssue(object: RemoteProjectionObject): IssueView | undefined {
  const data = record(object)
  const number = num(data.number, NaN)
  if (Number.isNaN(number)) return undefined
  return {
    number,
    title: str(data.title, `#${number}`),
    state: str(data.state) === 'closed' ? 'closed' : 'open',
    author: login(data.author, 'Unavailable'),
    labels: namedArray(data.labels),
    comments: Array.isArray(data.comments) ? data.comments.length : num(data.comments),
    updatedAt: str(data.updatedAt, object.fetchedAt),
  }
}

function parseRelease(object: RemoteProjectionObject): ReleaseView | undefined {
  const data = record(object)
  const tag = str(data.tag, str(field(data, 'tagName', 'tag_name')))
  if (!tag) return undefined
  return {
    tag,
    name: str(data.name, tag),
    draft: bool(field(data, 'draft', 'isDraft')),
    prerelease: bool(field(data, 'prerelease', 'isPrerelease')),
    publishedAt: str(field(data, 'publishedAt', 'published_at')) || undefined,
    author: login(data.author, 'Unavailable'),
    target: str(field(data, 'target', 'target_commitish')),
    body: str(data.body),
    url: str(field(data, 'html_url', 'url')),
    assets: Array.isArray(data.assets) ? data.assets.map((asset) => {
      const value = (asset && typeof asset === 'object' ? asset : {}) as Record<string, unknown>
      return { id: num(value.id), name: str(value.name), size: num(value.size), downloadCount: num(value.download_count), url: str(value.browser_download_url) }
    }) : [],
  }
}

function parseSecurityAlert(object: RemoteProjectionObject): SecurityAlertView | undefined {
  const data = record(object)
  const id = str(data.id, object.externalId)
  if (!id) return undefined
  const severityRaw = str(data.severity, 'low')
  const severity: SecurityAlertView['severity'] = ['critical', 'high', 'medium', 'low'].includes(severityRaw)
    ? (severityRaw as SecurityAlertView['severity']) : 'low'
  const kindRaw = object.kind === 'secret_scanning_alert' ? 'secret_scanning' : object.kind === 'dependabot_alert' ? 'dependabot' : str(data.kind, 'code_scanning')
  const kind: SecurityAlertView['kind'] = kindRaw === 'secret_scanning' || kindRaw === 'dependabot' ? kindRaw : 'code_scanning'
  return {
    id,
    kind,
    severity,
    summary: str(data.summary, str((data.rule && typeof data.rule === 'object' ? (data.rule as Record<string, unknown>).description : undefined), str((data.security_advisory && typeof data.security_advisory === 'object' ? (data.security_advisory as Record<string, unknown>).summary : undefined), str(data.secret_type_display_name, 'Security alert')))),
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
