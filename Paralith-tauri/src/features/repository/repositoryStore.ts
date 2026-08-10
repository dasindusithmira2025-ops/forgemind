import { create } from 'zustand'
import { asNativeError, native } from '../../native/commands'
import {
  onRepositoryApprovalDecision,
  onRepositoryApprovalRequired,
  onRepositoryOperationProgress,
  onRepositoryStateChanged,
  onRepositorySyncHealth,
} from '../../native/events'
import type {
  ProviderAccountStatus,
  RemoteProjection,
  RepositoryApprovalRequest,
  RepositoryBranchSummary,
  RepositoryCommitDetail,
  RepositoryCommitSummary,
  RepositoryDiff,
  RepositoryOperation,
  RepositoryOperationEvent,
  RepositoryOperationRecord,
  RepositoryIntelligence,
  RepositorySnapshot,
  RepositoryWorktreeLease,
  WorktreeConflictRisk,
} from '../../native/types'
import {
  EMPTY_REMOTE_VIEWS,
  humanActor,
  type RemoteProjectionViews,
  type RepositoryLoadState,
  type PullRequestView,
  type WorkflowRunView,
} from './repositoryTypes'
import { parsePullRequest, parseRemoteProjection, parseWorkflowRun } from './repositorySelectors'

function uuid(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID()
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const MAX_LEDGER = 200
const HISTORY_PAGE = 50

/** The active History scope. `path` narrows the walk to one file; both filters come from the user. */
export interface HistoryScope {
  path?: string
  search?: string
}

export interface RunOperationOptions {
  /** Pending-key so the UI can disable exactly the control that triggered the operation. */
  key?: string
  baseCommit?: string
  expectedBranch?: string
  approvalId?: string
}

interface RepositoryState {
  projectId?: string
  loadToken: number
  load: RepositoryLoadState
  snapshot?: RepositorySnapshot
  leases: RepositoryWorktreeLease[]
  conflictRisks: WorktreeConflictRisk[]
  branches: RepositoryBranchSummary[]
  providerStatus?: ProviderAccountStatus
  remoteProjection?: RemoteProjection
  remoteViews: RemoteProjectionViews
  remoteLoading: boolean
  remoteError?: string
  workflowRunDetails: Record<number, WorkflowRunView>
  workflowRunLoading: Record<number, boolean>
  workflowRunErrors: Record<number, string>
  pullRequestDetails: Record<number, PullRequestView>
  pullRequestLoading: Record<number, boolean>
  pullRequestErrors: Record<number, string>
  approvals: RepositoryApprovalRequest[]
  operations: RepositoryOperationRecord[]
  progress: Record<string, RepositoryOperationEvent>
  pending: Record<string, boolean>
  actionError?: string
  /** Last persisted graph projection; `undefined` until loaded, `null` when never extracted. */
  intelligence?: RepositoryIntelligence | null
  intelligenceLoading: boolean
  intelligenceError?: string

  /** Commit history for the current scope. Empty until the History section is opened. */
  historyCommits: RepositoryCommitSummary[]
  historyScope: HistoryScope
  /** The resolved SHA the current listing walked from, so a moving ref is never mislabelled. */
  historyRevision?: string
  historyHasMore: boolean
  historyLoading: boolean
  historyPaging: boolean
  historyLoaded: boolean
  historyError?: string
  selectedCommit?: string
  commitDetails: Record<string, RepositoryCommitDetail>
  commitDetailLoading: Record<string, boolean>
  commitDetailErrors: Record<string, string>

  reset: () => void
  loadProject: (projectId: string) => Promise<void>
  refreshSnapshot: () => Promise<void>
  refreshLeases: () => Promise<void>
  refreshBranches: () => Promise<void>
  refreshRemote: () => Promise<void>
  loadWorkflowRunDetail: (runId: number) => Promise<void>
  loadPullRequestDetail: (number: number) => Promise<void>
  fetchDiff: (path: string | undefined, staged: boolean, offset?: number, limit?: number) => Promise<RepositoryDiff>
  runOperation: (operation: RepositoryOperation, options?: RunOperationOptions) => Promise<RepositoryOperationRecord>
  decideApproval: (approvalId: string, approved: boolean, reason?: string) => Promise<void>
  clearActionError: () => void
  subscribe: () => () => void
  reloadApprovals: () => Promise<void>
  loadIntelligence: () => Promise<void>
  refreshIntelligence: () => Promise<void>
  loadHistory: (scope?: HistoryScope) => Promise<void>
  loadMoreHistory: () => Promise<void>
  selectCommit: (sha?: string) => void
  loadCommitDetail: (sha: string) => Promise<void>
}

export const useRepositoryStore = create<RepositoryState>((set, get) => ({
  loadToken: 0,
  load: { status: 'idle' },
  leases: [],
  conflictRisks: [],
  branches: [],
  remoteViews: EMPTY_REMOTE_VIEWS,
  remoteLoading: false,
  workflowRunDetails: {},
  workflowRunLoading: {},
  workflowRunErrors: {},
  pullRequestDetails: {},
  pullRequestLoading: {},
  pullRequestErrors: {},
  approvals: [],
  operations: [],
  progress: {},
  pending: {},
  intelligenceLoading: false,
  historyCommits: [],
  historyScope: {},
  historyHasMore: false,
  historyLoading: false,
  historyPaging: false,
  historyLoaded: false,
  commitDetails: {},
  commitDetailLoading: {},
  commitDetailErrors: {},

  reset: () => set({
    projectId: undefined,
    load: { status: 'idle' },
    snapshot: undefined,
    leases: [],
    conflictRisks: [],
    branches: [],
    providerStatus: undefined,
    remoteProjection: undefined,
    remoteViews: EMPTY_REMOTE_VIEWS,
    remoteLoading: false,
    remoteError: undefined,
    workflowRunDetails: {},
    workflowRunLoading: {},
    workflowRunErrors: {},
    pullRequestDetails: {},
    pullRequestLoading: {},
    pullRequestErrors: {},
    approvals: [],
    operations: [],
    progress: {},
    pending: {},
    actionError: undefined,
    intelligence: undefined,
    intelligenceLoading: false,
    intelligenceError: undefined,
    historyCommits: [],
    historyScope: {},
    historyRevision: undefined,
    historyHasMore: false,
    historyLoading: false,
    historyPaging: false,
    historyLoaded: false,
    historyError: undefined,
    selectedCommit: undefined,
    commitDetails: {},
    commitDetailLoading: {},
    commitDetailErrors: {},
  }),

  loadProject: async (projectId) => {
    // Switching projects must never leak the previous repository's state onto the new screen.
    if (get().projectId !== projectId) get().reset()
    const token = get().loadToken + 1
    set({ projectId, loadToken: token, load: { status: 'loading' } })
    try {
      const snapshot = await native.inspectRepository(projectId)
      if (get().loadToken !== token) return
      set({ snapshot, load: { status: 'ready' } })
      // Secondary, non-blocking context. Failures here never fail the whole surface.
      void get().refreshLeases()
      void get().refreshBranches()
      void native.getGitHubProviderStatus(projectId)
        .then((providerStatus) => { if (get().loadToken === token) set({ providerStatus }) })
        .catch(() => undefined)
      void native.listRepositoryApprovals(projectId, true)
        .then((approvals) => { if (get().loadToken === token) set({ approvals }) })
        .catch(() => undefined)
    } catch (caught) {
      if (get().loadToken !== token) return
      const error = asNativeError(caught)
      set({ load: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  refreshSnapshot: async () => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      const snapshot = await native.inspectRepository(projectId)
      if (get().projectId === projectId) set({ snapshot })
    } catch (caught) {
      set({ actionError: asNativeError(caught).message })
    }
  },

  refreshLeases: async () => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      const [leases, conflictRisks] = await Promise.all([
        native.listRepositoryWorktreeLeases(projectId),
        native.getWorktreeConflictRisks(projectId).catch(() => [] as WorktreeConflictRisk[]),
      ])
      if (get().projectId === projectId) set({ leases, conflictRisks })
    } catch { /* lease view is non-essential; keep the surface alive */ }
  },

  refreshBranches: async () => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      const branches = await native.listRepositoryBranches(projectId)
      if (get().projectId === projectId) set({ branches })
    } catch (caught) {
      if (get().projectId === projectId) set({ actionError: asNativeError(caught).message })
    }
  },

  refreshRemote: async () => {
    const projectId = get().projectId
    if (!projectId) return
    set({ remoteLoading: true, remoteError: undefined })
    try {
      const projection = await native.refreshRepositoryRemoteProjection({ projectId })
      if (get().projectId !== projectId) return
      set({ remoteProjection: projection, remoteViews: parseRemoteProjection(projection), remoteLoading: false })
    } catch (caught) {
      if (get().projectId !== projectId) return
      set({ remoteLoading: false, remoteError: asNativeError(caught).message })
    }
  },

  /**
   * Read the stored projection. Cheap (one indexed query, no Git), so the Intelligence section
   * calls it on mount. A `null` result means the extractor has never run — an empty state, not an
   * error.
   */
  loadIntelligence: async () => {
    const projectId = get().projectId
    if (!projectId) return
    set({ intelligenceLoading: true, intelligenceError: undefined })
    try {
      const intelligence = await native.getRepositoryIntelligence(projectId)
      if (get().projectId !== projectId) return
      set({ intelligence, intelligenceLoading: false })
    } catch (caught) {
      if (get().projectId !== projectId) return
      set({ intelligenceLoading: false, intelligenceError: asNativeError(caught).message })
    }
  },

  /**
   * Re-extract the graph from Git. This shells out repeatedly and is bounded but not instant, so
   * it is only ever user-initiated — never polled.
   */
  refreshIntelligence: async () => {
    const projectId = get().projectId
    if (!projectId || get().intelligenceLoading) return
    set({ intelligenceLoading: true, intelligenceError: undefined })
    try {
      const intelligence = await native.refreshRepositoryIntelligence({ projectId })
      if (get().projectId !== projectId) return
      set({ intelligence, intelligenceLoading: false })
    } catch (caught) {
      if (get().projectId !== projectId) return
      set({ intelligenceLoading: false, intelligenceError: asNativeError(caught).message })
    }
  },

  /**
   * Load the first page of commit history for a scope. This walks Git, so it is only ever called
   * when the History section is opened or the user changes the scope — never polled. Changing the
   * scope discards the previous listing and selection rather than blending two different walks.
   */
  loadHistory: async (scope) => {
    const projectId = get().projectId
    if (!projectId) return
    const next = scope ?? get().historyScope
    const token = get().loadToken
    // A scope change is a different walk, so its selection cannot carry over. A plain refresh of
    // the same scope keeps the user where they were.
    const previous = scope ? undefined : get().selectedCommit
    set({
      historyScope: next,
      historyLoading: true,
      historyError: undefined,
      historyCommits: [],
      historyHasMore: false,
      selectedCommit: undefined,
    })
    try {
      const page = await native.getRepositoryHistory({ projectId, path: next.path, search: next.search, limit: HISTORY_PAGE })
      if (get().projectId !== projectId || get().loadToken !== token) return
      set({
        historyCommits: page.commits,
        historyHasMore: page.hasMore,
        historyRevision: page.revision || undefined,
        historyLoading: false,
        historyLoaded: true,
        // Opening straight into the newest commit means the Inspector is never blank on arrival.
        selectedCommit: previous && page.commits.some((commit) => commit.sha === previous)
          ? previous
          : page.commits[0]?.sha,
      })
    } catch (caught) {
      if (get().projectId !== projectId || get().loadToken !== token) return
      set({ historyLoading: false, historyLoaded: true, historyError: asNativeError(caught).message })
    }
  },

  /**
   * Append the next page. Paging is by commit count against the same resolved revision, so a
   * commit landing mid-scroll cannot shift the walk and duplicate rows.
   */
  loadMoreHistory: async () => {
    const state = get()
    const projectId = state.projectId
    if (!projectId || !state.historyHasMore || state.historyPaging || state.historyLoading) return
    const token = state.loadToken
    const skip = state.historyCommits.length
    set({ historyPaging: true })
    try {
      const page = await native.getRepositoryHistory({
        projectId,
        revision: state.historyRevision,
        path: state.historyScope.path,
        search: state.historyScope.search,
        skip,
        limit: HISTORY_PAGE,
      })
      if (get().projectId !== projectId || get().loadToken !== token) return
      const known = new Set(get().historyCommits.map((commit) => commit.sha))
      set({
        historyCommits: [...get().historyCommits, ...page.commits.filter((commit) => !known.has(commit.sha))],
        historyHasMore: page.hasMore,
        historyPaging: false,
      })
    } catch (caught) {
      if (get().projectId !== projectId || get().loadToken !== token) return
      set({ historyPaging: false, historyError: asNativeError(caught).message })
    }
  },

  selectCommit: (sha) => set({ selectedCommit: sha }),

  /** Commit contents are immutable, so a successful detail read is cached for the session. */
  loadCommitDetail: async (sha) => {
    const projectId = get().projectId
    if (!projectId || get().commitDetails[sha] || get().commitDetailLoading[sha]) return
    set({
      commitDetailLoading: { ...get().commitDetailLoading, [sha]: true },
      commitDetailErrors: { ...get().commitDetailErrors, [sha]: '' },
    })
    try {
      const detail = await native.getRepositoryCommitDetail({ projectId, revision: sha })
      if (get().projectId !== projectId) return
      set({ commitDetails: { ...get().commitDetails, [sha]: detail } })
    } catch (caught) {
      if (get().projectId === projectId) set({ commitDetailErrors: { ...get().commitDetailErrors, [sha]: asNativeError(caught).message } })
    } finally {
      if (get().projectId === projectId) set({ commitDetailLoading: { ...get().commitDetailLoading, [sha]: false } })
    }
  },

  loadWorkflowRunDetail: async (runId) => {
    const projectId = get().projectId
    if (!projectId || get().workflowRunLoading[runId]) return
    set({
      workflowRunLoading: { ...get().workflowRunLoading, [runId]: true },
      workflowRunErrors: { ...get().workflowRunErrors, [runId]: '' },
    })
    try {
      const object = await native.getRepositoryWorkflowRunDetail({ projectId, runId })
      if (get().projectId !== projectId) return
      const detail = parseWorkflowRun(object)
      if (!detail) throw new Error('GitHub returned an invalid workflow run detail.')
      set({ workflowRunDetails: { ...get().workflowRunDetails, [runId]: detail } })
    } catch (caught) {
      if (get().projectId === projectId) set({ workflowRunErrors: { ...get().workflowRunErrors, [runId]: asNativeError(caught).message } })
    } finally {
      if (get().projectId === projectId) set({ workflowRunLoading: { ...get().workflowRunLoading, [runId]: false } })
    }
  },

  loadPullRequestDetail: async (number) => {
    const projectId = get().projectId
    if (!projectId || get().pullRequestLoading[number]) return
    set({ pullRequestLoading: { ...get().pullRequestLoading, [number]: true }, pullRequestErrors: { ...get().pullRequestErrors, [number]: '' } })
    try {
      const object = await native.getRepositoryPullRequestDetail({ projectId, number })
      if (get().projectId !== projectId) return
      const detail = parsePullRequest(object)
      if (!detail) throw new Error('GitHub returned an invalid pull request detail.')
      set({ pullRequestDetails: { ...get().pullRequestDetails, [number]: detail } })
    } catch (caught) {
      if (get().projectId === projectId) set({ pullRequestErrors: { ...get().pullRequestErrors, [number]: asNativeError(caught).message } })
    } finally {
      if (get().projectId === projectId) set({ pullRequestLoading: { ...get().pullRequestLoading, [number]: false } })
    }
  },

  fetchDiff: async (path, staged, offset, limit) => {
    const projectId = get().projectId
    if (!projectId) throw new Error('No repository loaded')
    return native.getRepositoryDiff({ projectId, path, staged, offset, limit })
  },

  runOperation: async (operation, options = {}) => {
    const state = get()
    const projectId = state.projectId
    if (!projectId) throw new Error('No repository loaded')
    const key = options.key ?? operation.kind
    set({ pending: { ...get().pending, [key]: true }, actionError: undefined })
    try {
      const record = await native.executeRepositoryOperation({
        context: {
          projectId,
          repositoryPath: state.snapshot?.repositoryPath,
          worktreePath: state.snapshot?.worktreePath,
          actor: humanActor(),
          baseCommit: options.baseCommit ?? state.snapshot?.headSha,
          expectedBranch: options.expectedBranch ?? state.snapshot?.branch,
          approvalId: options.approvalId,
          idempotencyKey: uuid(),
        },
        operation,
      })
      ingestRecord(set, get, record)
      if (record.status === 'awaiting_approval') void get().reloadApprovals()
      // Any mutation that changes local git state warrants a fresh snapshot.
      if (record.status === 'succeeded' || record.status === 'needs_recovery') {
        void get().refreshSnapshot()
        void get().refreshLeases()
        void get().refreshBranches()
        if (refreshesRemote(operation.kind)) void get().refreshRemote()
      }
      if (record.status === 'failed') {
        set({ actionError: record.errorMessage ?? `Operation ${record.kind} failed.` })
      }
      return record
    } catch (caught) {
      set({ actionError: asNativeError(caught).message })
      throw caught
    } finally {
      const next = { ...get().pending }
      delete next[key]
      set({ pending: next })
    }
  },

  decideApproval: async (approvalId, approved, reason) => {
    const projectId = get().projectId
    if (!projectId) return
    set({ pending: { ...get().pending, [`approval:${approvalId}`]: true } })
    try {
      const outcome = await native.decideRepositoryApproval({ projectId, approvalId, approved, humanId: 'local-user', reason })
      set({ approvals: get().approvals.map((item) => item.id === approvalId ? outcome.approval : item) })
      if (outcome.operation) ingestRecord(set, get, outcome.operation)
      void get().refreshSnapshot()
    } catch (caught) {
      set({ actionError: asNativeError(caught).message })
    } finally {
      const next = { ...get().pending }
      delete next[`approval:${approvalId}`]
      set({ pending: next })
    }
  },

  clearActionError: () => set({ actionError: undefined }),

  subscribe: () => {
    const unlisteners: Array<Promise<() => void>> = [
      onRepositoryStateChanged((projectId) => {
        if (projectId !== get().projectId) return
        void get().refreshSnapshot()
        // A commit or branch change invalidates the listing, but only re-walk Git for a user who
        // already has History open. Never run it behind the user's back.
        if (get().historyLoaded) void get().loadHistory()
      }),
      onRepositoryOperationProgress((event) => {
        if (event.projectId !== get().projectId) return
        set({ progress: { ...get().progress, [event.operationId]: event } })
      }),
      onRepositoryApprovalRequired((record) => {
        if (record.projectId !== get().projectId) return
        ingestRecord(set, get, record)
        void get().reloadApprovals()
      }),
      onRepositoryApprovalDecision((approval) => {
        if (approval.projectId !== get().projectId) return
        const existing = get().approvals.some((item) => item.id === approval.id)
        set({ approvals: existing ? get().approvals.map((item) => item.id === approval.id ? approval : item) : [approval, ...get().approvals] })
      }),
      onRepositorySyncHealth((projection) => {
        if (projection.projectId !== get().projectId) return
        set({ remoteProjection: projection, remoteViews: parseRemoteProjection(projection) })
      }),
    ]
    let cancelled = false
    const resolved: Array<() => void> = []
    for (const promise of unlisteners) {
      void promise.then((fn) => { if (cancelled) fn(); else resolved.push(fn) })
    }
    return () => { cancelled = true; resolved.forEach((fn) => fn()) }
  },

  // Internal helper exposed on the store so both the event path and the action path can reuse it.
  reloadApprovals: async () => {
    const projectId = get().projectId
    if (!projectId) return
    try {
      const approvals = await native.listRepositoryApprovals(projectId, true)
      if (get().projectId === projectId) set({ approvals })
    } catch { /* approval list refresh is best-effort */ }
  },
}))

type SetState = (partial: Partial<RepositoryState>) => void
type GetState = () => RepositoryState

function ingestRecord(set: SetState, get: GetState, record: RepositoryOperationRecord) {
  const existing = get().operations
  const filtered = existing.filter((item) => item.id !== record.id)
  set({ operations: [record, ...filtered].slice(0, MAX_LEDGER) })
}

function refreshesRemote(kind: RepositoryOperation['kind']): boolean {
  return ['fetch_remote', 'push_branch', 'publish_branch', 'open_draft_pull_request', 'update_pull_request', 'mark_pull_request_ready', 'request_review', 'submit_review', 'resolve_review_thread', 'rerun_workflow', 'cancel_workflow', 'merge_pull_request', 'delete_remote_branch', 'create_release'].includes(kind)
}
