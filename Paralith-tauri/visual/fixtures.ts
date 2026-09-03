/**
 * Fixture data for the visual harness (see `visual/README.md`).
 *
 * These shapes mirror `src/native/types.ts` closely enough for the real screens to render a
 * representative, *populated* state — the states that actually stress the design system. They are
 * deliberately hand-written rather than generated: a screenshot of an empty app proves nothing
 * about density, truncation or hierarchy.
 */

const NOW = '2026-08-12T09:41:00Z'
const PRODUCT_MODE = new URLSearchParams(globalThis.location?.search ?? '').get('mode') === 'agent' ? 'agent' : 'code'

export const project = {
  id: 'proj-paralith',
  name: 'paralith',
  rootPath: 'C:\\dev\\paralith',
  canonicalRootPath: 'C:\\dev\\paralith',
  gitBranch: 'feat/database-studio',
  detectedFramework: 'Tauri',
  packageManager: 'npm',
  majorLanguages: ['TypeScript', 'Rust'],
  isGitRepository: true,
  hasPackageJson: true,
  hasLockfile: true,
  createdAt: NOW,
  updatedAt: NOW,
  lastOpenedAt: NOW,
}

const project2 = { ...project, id: 'proj-corelith-web', name: 'corelith-web', rootPath: 'C:\\dev\\corelith-web', canonicalRootPath: 'C:\\dev\\corelith-web', gitBranch: 'main', majorLanguages: ['TypeScript'] }

function pane(id: string, title: string, provider: string, order: number) {
  return {
    id, workspaceId: 'ws-main', title, provider,
    executablePath: provider === 'claude' ? 'C:\\bin\\claude.exe' : 'C:\\bin\\codex.exe',
    args: [], workingDirectory: 'C:\\dev\\paralith', workingDirectoryMode: 'project_relative',
    positionOrder: order,
  }
}

/** The roster the harness deals from. `?panes=N` takes the first N; N above the list repeats it. */
const PANE_ROSTER: Array<[string, string]> = [
  ['Architect', 'claude'],
  ['Builder', 'codex'],
  ['Reviewer', 'claude'],
  ['Shell', 'powershell'],
  ['Memory Backend', 'codex'],
  ['Test Runner', 'powershell'],
  ['Migration Agent', 'claude'],
  ['Docs Sweep', 'codex'],
]

/**
 * `?panes=N` (1..8) renders the Workspace with N terminals so the pane system can be checked at
 * the counts that actually stress it — one lead agent, a pair, and a six-agent swarm. Without the
 * param the fixture stays the hand-authored 2x2 it has always been, so every existing harness URL
 * and screenshot keeps rendering exactly what it did before.
 */
const paneCount = (() => {
  const raw = Number(new URLSearchParams(globalThis.location?.search ?? '').get('panes'))
  return Number.isInteger(raw) && raw >= 1 && raw <= 8 ? raw : 0
})()

const panes = paneCount
  ? Array.from({ length: paneCount }, (_, index) =>
      pane(`pane-${index + 1}`, PANE_ROSTER[index % PANE_ROSTER.length][0], PANE_ROSTER[index % PANE_ROSTER.length][1], index),
    )
  : [
      pane('pane-1', 'Architect', 'claude', 0),
      pane('pane-2', 'Builder', 'codex', 1),
      pane('pane-3', 'Reviewer', 'claude', 2),
      pane('pane-4', 'Shell', 'powershell', 3),
    ]

/** An even split tree, deliberately naive — it is the "before" shape the presets improve on. */
function evenLayout(ids: string[]): unknown {
  if (ids.length === 1) return { type: 'pane', paneId: ids[0] }
  const half = Math.ceil(ids.length / 2)
  const children = [evenLayout(ids.slice(0, half)), evenLayout(ids.slice(half))]
  return { type: 'split', direction: ids.length > 2 ? 'horizontal' : 'vertical', sizes: [50, 50], children }
}

const layout = paneCount
  ? evenLayout(panes.map((item) => item.id))
  : {
      type: 'split', direction: 'horizontal', sizes: [50, 50],
      children: [
        { type: 'split', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', paneId: 'pane-1' }, { type: 'pane', paneId: 'pane-3' }] },
        { type: 'split', direction: 'vertical', sizes: [50, 50], children: [{ type: 'pane', paneId: 'pane-2' }, { type: 'pane', paneId: 'pane-4' }] },
      ],
    }

export const workspace = {
  id: 'ws-main', projectId: project.id, name: 'Database Studio', normalizedName: 'database-studio',
  layout, activePaneId: 'pane-1', restoreBehavior: 'inherit', panes,
  createdAt: NOW, updatedAt: NOW, lastOpenedAt: NOW,
}

const workspace2 = { ...workspace, id: 'ws-review', name: 'Review + CI', normalizedName: 'review-ci', panes: panes.slice(0, 2) }
const workspace3 = { ...workspace, id: 'ws-web', projectId: project2.id, name: 'Marketing site', normalizedName: 'marketing-site', panes: panes.slice(0, 1) }

function session(paneId: string, title: string, provider: string, status: string) {
  return {
    id: `sess-${paneId}`, projectId: project.id, workspaceId: 'ws-main', paneId, provider,
    executable: 'C:\\bin\\claude.exe', arguments: [], title,
    workingDirectory: 'C:\\dev\\paralith', status, processId: 4242,
    startedAt: NOW, outputTail: [], nextSequence: 1,
    restorationState: 'restored', hardBlockers: [],
  }
}

export const sessions = paneCount
  ? panes.map((item) => session(item.id, item.title, item.provider, 'running'))
  : [
      session('pane-1', 'Architect', 'claude', 'running'),
      session('pane-2', 'Builder', 'codex', 'running'),
      session('pane-3', 'Reviewer', 'claude', 'running'),
      session('pane-4', 'Shell', 'powershell', 'running'),
    ]

export const settings = {
  sidebarOpen: true, sidebarWidth: 252, sidebarGroupBy: 'project', sidebarSortMode: 'manual',
  sidebarCollapsedGroups: [], uiScale: 1, uiDensity: 'standard', themeId: 'paralith-dark',
  terminalFontSize: 13, terminalFontFamily: 'Cascadia Code', terminalLineHeight: 1.2,
  cursorStyle: 'bar', scrollbackSize: 5000, copyOnSelect: false, confirmMultilinePaste: true,
  confirmClosePane: true, reopenLastWorkspace: true, restoreBehavior: 'ask',
  outputLogRetention: 'tail_only', restorationLaunchBudget: 4, defaultLayout: 'grid',
  defaultPaneCount: 4, inactiveWorkspaceProcesses: 'keep_running',
  inactiveWorkspaceRendering: 'hibernate', automaticUpdateChecks: true, settingsVersion: 4,
}

const agents = [
  { provider: 'claude', available: true, executablePath: 'C:\\bin\\claude.exe', version: '2.4.0', detectedAt: NOW },
  { provider: 'codex', available: true, executablePath: 'C:\\bin\\codex.exe', version: '0.51.0', detectedAt: NOW },
  { provider: 'opencode', available: false, errorCode: 'not_found', errorMessage: 'Not on PATH', detectedAt: NOW },
]

const shells = [
  { id: 'pwsh', name: 'PowerShell 7', executablePath: 'C:\\pwsh.exe', args: [], available: true, source: 'detected' },
  { id: 'cmd', name: 'Command Prompt', executablePath: 'C:\\cmd.exe', args: [], available: true, source: 'detected' },
]

function swarm(id: string, name: string, mission: string, lifecycle: string, phase: string, progress: number) {
  return {
    id, projectId: project.id, projectRoot: project.rootPath, name, mission, lifecycle, phase,
    teamPreset: 'balanced', maxParallel: 4, instructions: '', progress, priority: 1, archived: false,
    gitState: {}, safeguards: [], attachments: [], revision: 3,
    roles: [
      { role: 'coordinator', provider: 'claude', model: 'opus-5', instances: 1 },
      { role: 'builder', provider: 'codex', model: 'gpt-5.6', instances: 2 },
      { role: 'reviewer', provider: 'claude', model: 'sonnet-5', instances: 1 },
    ],
    createdAt: NOW, updatedAt: NOW, startedAt: NOW,
  }
}

const swarms = [
  { swarm: swarm('swarm-1', 'Schema migration', 'Migrate the schema to v12 and regenerate typed clients', 'building', 'building', 0.62),
    activity: { activeAgents: 3, totalAgents: 4, tasksTotal: 11, tasksDone: 6, tasksRunning: 3 } },
  { swarm: swarm('swarm-2', 'Flake triage', 'Isolate the three intermittent terminal tests', 'decision_required', 'verifying', 0.34),
    activity: { activeAgents: 1, totalAgents: 2, tasksTotal: 6, tasksDone: 2, tasksRunning: 1 } },
]

function agent(id: string, role: string, runtime: string, model: string, displayName: string, status: string, taskId: string | null, worktree: string) {
  return {
    id, swarmId: 'swarm-1', role, runtime,
    modelConfig: { providerId: runtime, providerDisplayName: runtime === 'codex' ? 'Codex' : 'Claude', modelId: model, modelDisplayName: model === 'opus-5' ? 'Opus 5' : model === 'sonnet-5' ? 'Sonnet 5' : 'GPT 5.6', reasoningEffort: 'high', contextStrategy: 'balanced', permissionMode: 'ask' },
    displayName, status, currentTaskId: taskId, terminalSessionId: null,
    runtimeSessionState: status === 'active' ? 'working' : 'idle',
    workingDirectory: worktree, worktree, permissions: [], changedFiles: [],
    testProgress: { total: 0, passed: 0, failed: 0 },
    createdAt: NOW, updatedAt: NOW,
  }
}

const swarmAgents = [
  agent('a1', 'coordinator', 'claude', 'opus-5', 'Coordinator', 'active', 't1', 'C:\\dev\\paralith'),
  agent('a2', 'builder', 'codex', 'gpt-5.6', 'Builder 1', 'active', 't2', 'C:\\dev\\paralith-b1'),
  agent('a3', 'builder', 'codex', 'gpt-5.6', 'Builder 2', 'waiting', 't3', 'C:\\dev\\paralith-b2'),
  agent('a4', 'reviewer', 'claude', 'sonnet-5', 'Reviewer', 'idle', null, 'C:\\dev\\paralith'),
]

function task(id: string, title: string, state: string, agentId: string | null, dependsOn: string[]) {
  return {
    id, swarmId: 'swarm-1', title, description: title, state, role: 'builder',
    assignedAgentId: agentId, dependsOn, blockedBy: [], order: 0,
    createdAt: NOW, updatedAt: NOW,
  }
}

const swarmDetail = {
  swarm: swarms[0].swarm,
  activity: swarms[0].activity,
  agents: swarmAgents,
  tasks: [
    task('t1', 'Inventory the current schema', 'completed', 'a1', []),
    task('t2', 'Write migration 0042', 'running', 'a2', ['t1']),
    task('t3', 'Regenerate typed clients', 'blocked', 'a3', ['t2']),
    task('t4', 'Review the migration diff', 'ready', 'a4', ['t2', 't3']),
  ],
  events: [], messages: [], connections: [], lifecycleHistory: [], runtimeSessions: [],
  evidence: [], tests: [], memories: [], reviews: [], runs: [], agentRuns: [],
  attentionRequests: [],
}



const repositorySnapshot = {
  projectId: project.id, repositoryPath: project.rootPath, worktreePath: project.rootPath,
  currentBranch: 'feat/database-studio', upstream: 'origin/feat/database-studio',
  ahead: 3, behind: 0, isDirty: true, isDetached: false,
  staged: [
    { path: 'src/index.css', status: 'modified', insertions: 214, deletions: 190 },
    { path: 'src/theme/themes.ts', status: 'modified', insertions: 96, deletions: 84 },
  ],
  unstaged: [
    { path: 'src/theme/tokens.ts', status: 'modified', insertions: 41, deletions: 6 },
    { path: 'src/features/swarms/SwarmOverview.tsx', status: 'modified', insertions: 12, deletions: 30 },
  ],
  untracked: [{ path: 'visual/fixtures.ts', status: 'untracked', insertions: 0, deletions: 0 }],
  conflicts: [], stashCount: 1, lastFetchedAt: NOW,
}

function usageWindow(kind: string, usedPercent: number, resetLabel: string) {
  return {
    kind, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: '2026-08-12T14:00:00Z',
    resetLabel, source: 'local_session_state', confidence: 'high',
    isWarning: usedPercent >= 75, isCritical: usedPercent >= 90,
  }
}

const usageSnapshots = [
  { provider: 'claude', collectedAt: NOW, freshness: 'live', source: 'supported_endpoint', status: 'ready',
    windows: [usageWindow('session', 38, 'in 3h'), usageWindow('weekly', 54, 'Mon')],
    tokenSummary: { inputTokens: 812_400, outputTokens: 96_210, cachedInputTokens: 640_100, cacheCreationTokens: 41_020, reasoningTokens: 12_400, totalTokens: 1_602_130 } },
  { provider: 'codex', collectedAt: NOW, freshness: 'live', source: 'provider_cli', status: 'ready',
    windows: [usageWindow('session', 61, 'in 7h')] },
]

/**
 * 90 days of daily usage buckets, shaped like the real `ai_usage_daily` table: cache reads
 * dominate input, Codex reports reasoning, and one model is deliberately absent from the pricing
 * table so the "unpriced but still counted" path is visible in a screenshot. Deterministic — a
 * harness screenshot has to be comparable between runs.
 */
const usageHistory = (() => {
  const models = [
    { provider: 'claude', model: 'claude-opus-5', weight: 1 },
    { provider: 'claude', model: 'claude-sonnet-5', weight: 0.35 },
    { provider: 'codex', model: 'gpt-5.6-sol', weight: 0.7 },
    { provider: 'codex', model: 'gpt-5.4-mini', weight: 0.12 },
    { provider: 'codex', model: 'new-unknown-model', weight: 0.05 },
  ]
  const end = Date.parse('2026-08-13T00:00:00Z')
  const rows: unknown[] = []
  for (let day = 0; day < 90; day += 1) {
    const date = new Date(end - (89 - day) * 86_400_000).toISOString().slice(0, 10)
    // A deterministic pseudo-random weekday-weighted shape; weekends dip.
    const wobble = 0.55 + 0.45 * Math.abs(Math.sin(day * 1.7))
    const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) ? 0.35 : 1
    for (const entry of models) {
      const scale = wobble * weekend * entry.weight
      if (scale < 0.06) continue
      rows.push({
        date,
        provider: entry.provider,
        model: entry.model,
        tokens: {
          inputTokens: Math.round(340_000 * scale),
          cachedInputTokens: Math.round(34_000_000 * scale),
          cacheCreationTokens: Math.round(300_000 * scale),
          outputTokens: Math.round(120_000 * scale),
          reasoningTokens: entry.provider === 'codex' ? Math.round(11_000 * scale) : 0,
          totalTokens: Math.round(34_760_000 * scale),
        },
      })
    }
  }
  return rows
})()

/**
 * Command fixtures, keyed by the Rust command name. Anything absent falls through to
 * `defaultFor`, which returns the empty shape the calling screen expects.
 */

// ---- Memory (Context Fabric) ---------------------------------------------------
// A small but *representative* knowledge base: a canonical decision with evidence and a verified
// claim, a supported component note, and a superseded ADR - so the quality ladder, the claim
// states, an unresolved link and a stale memory are all visible in one screenshot.
const memorySummaries = [
  { id: 'mem-1', projectId: project.id, slug: 'adr-14-token-rotation', title: 'ADR 14: Token Rotation', memoryType: 'decision', state: 'active', quality: 'canonical', importance: 0.9, confidence: 0.9, summary: 'Refresh tokens rotate after every use and the whole family is invalidated on reuse.', pinned: true, tags: ['auth', 'security'], workspaceId: null, branchName: null, verifiedAt: NOW, staleReason: null, revisionNumber: 4, createdAt: NOW, updatedAt: NOW },
  { id: 'mem-2', projectId: project.id, slug: 'auth-service', title: 'Auth Service', memoryType: 'component', state: 'active', quality: 'supported', importance: 0.7, confidence: 0.6, summary: 'Owns login, refresh, and session revocation. Talks to TokenRepository only.', pinned: false, tags: ['auth'], workspaceId: null, branchName: null, verifiedAt: null, staleReason: null, revisionNumber: 2, createdAt: NOW, updatedAt: NOW },
  { id: 'mem-3', projectId: project.id, slug: 'adr-9-static-sessions', title: 'ADR 9: Static Sessions', memoryType: 'decision', state: 'active', quality: 'superseded', importance: 0.3, confidence: 0.4, summary: 'Sessions were fixed-lifetime with no rotation. Replaced by ADR 14.', pinned: false, tags: ['auth'], workspaceId: null, branchName: null, verifiedAt: null, staleReason: 'AuthService.rotate() changed since this was verified', revisionNumber: 1, createdAt: NOW, updatedAt: NOW },
  { id: 'mem-4', projectId: project.id, slug: 'terminal-lifecycle', title: 'Terminal Lifecycle', memoryType: 'convention', state: 'active', quality: 'working', importance: 0.5, confidence: 0.5, summary: 'Process lifetime is separate from React component lifetime. A rerender never kills a PTY.', pinned: false, tags: ['terminals'], workspaceId: null, branchName: null, verifiedAt: null, staleReason: null, revisionNumber: 1, createdAt: NOW, updatedAt: NOW },
]

const memoryDetail = {
  ...memorySummaries[0],
  body: '## Decision\n\nRefresh tokens rotate after every use. Reuse of a consumed token invalidates the entire token family.\n\nImplemented by [[Auth Service]] against [[Token Repository]], which does not exist as a memory yet.\n\n## Consequences\n\nSupersedes [[ADR 9 Static Sessions]].',
  properties: [
    { key: 'component', value: 'AuthService' },
    { key: 'status', value: 'accepted' },
    { key: 'decided', value: '2026-07-02' },
  ],
  outgoingLinks: [
    { targetSlug: 'auth-service', targetText: 'Auth Service', targetItemId: 'mem-2', anchor: null, alias: null },
    { targetSlug: 'token-repository', targetText: 'Token Repository', targetItemId: null, anchor: null, alias: null },
    { targetSlug: 'adr-9-static-sessions', targetText: 'ADR 9 Static Sessions', targetItemId: 'mem-3', anchor: null, alias: null },
  ],
  claims: [
    { id: 'claim-1', itemId: 'mem-1', ordinal: 0, statement: 'Refresh tokens are rotated after use.', status: 'verified', confidence: 0.95, validFrom: NOW, validUntil: null, supersededByClaimId: null, verifiedAt: NOW, sources: [{ id: 'src-1', sourceType: 'file', uri: 'file:src/auth/token.rs#L142-L188', filePath: 'src/auth/token.rs', lineStart: 142, lineEnd: 188, gitCommit: null, branchName: null, excerpt: null, capturedAt: NOW }], createdAt: NOW, updatedAt: NOW },
    { id: 'claim-2', itemId: 'mem-1', ordinal: 1, statement: 'Refresh tokens are stored hashed, never in plaintext.', status: 'supported', confidence: 0.7, validFrom: NOW, validUntil: null, supersededByClaimId: null, verifiedAt: null, sources: [{ id: 'src-2', sourceType: 'file', uri: 'file:src/auth/store.rs#L61', filePath: 'src/auth/store.rs', lineStart: 61, lineEnd: null, gitCommit: null, branchName: null, excerpt: null, capturedAt: NOW }], createdAt: NOW, updatedAt: NOW },
    { id: 'claim-3', itemId: 'mem-1', ordinal: 2, statement: 'Access tokens expire after 15 minutes.', status: 'contradicted', confidence: 0.4, validFrom: NOW, validUntil: null, supersededByClaimId: null, verifiedAt: null, sources: [], createdAt: NOW, updatedAt: NOW },
  ],
  sources: [
    { id: 'src-1', sourceType: 'file', uri: 'file:src/auth/token.rs#L142-L188', filePath: 'src/auth/token.rs', lineStart: 142, lineEnd: 188, gitCommit: null, branchName: null, excerpt: null, capturedAt: NOW },
    { id: 'src-2', sourceType: 'file', uri: 'file:src/auth/store.rs#L61', filePath: 'src/auth/store.rs', lineStart: 61, lineEnd: null, gitCommit: null, branchName: null, excerpt: null, capturedAt: NOW },
    { id: 'src-3', sourceType: 'commit', uri: 'commit:91df2ab', filePath: null, lineStart: null, lineEnd: null, gitCommit: '91df2ab', branchName: 'main', excerpt: null, capturedAt: NOW },
    { id: 'src-4', sourceType: 'command', uri: 'command:cargo test -- auth_refresh', filePath: null, lineStart: null, lineEnd: null, gitCommit: null, branchName: null, excerpt: null, capturedAt: NOW },
  ],
  relations: [
    { id: 'rel-1', relationType: 'supersedes', fromItemId: 'mem-1', toItemId: 'mem-3', toSlug: 'adr-9-static-sessions', toTitle: 'ADR 9: Static Sessions', confidence: 1, createdBy: 'user', createdAt: NOW },
    // `toSlug`/`toTitle` name the *other* end as the backend resolves it for the memory being
    // viewed, so an inbound relation reads as its source rather than as the open memory itself.
    { id: 'rel-2', relationType: 'implements', fromItemId: 'mem-2', toItemId: 'mem-1', toSlug: 'auth-service', toTitle: 'Auth Service', confidence: 0.9, createdBy: 'user', createdAt: NOW },
  ],
  revisionId: 'rev-4',
  filePath: '.paralith/memory/adr-14-token-rotation.md',
}

// ---- Knowledge intelligence ------------------------------------------------------------------
// The Memory workspace reads from two Rust services, both reached through one command each with
// the operation in the arguments (see `stub-core.ts`). Ages are relative to now so the surfaces
// render the recency wording they actually ship with rather than a frozen "4mo ago" everywhere.

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const knowledgeGraph = {
  focusId: null,
  truncated: false,
  nodes: [
    { id: 'memory:mem-1', kind: 'memory', label: 'ADR 14: Token Rotation', sublabel: 'decision', itemId: 'mem-1', memoryType: 'decision', quality: 'canonical', importance: 0.9, stale: false, degree: 5, distance: null },
    { id: 'memory:mem-2', kind: 'memory', label: 'Auth Service', sublabel: 'component', itemId: 'mem-2', memoryType: 'component', quality: 'supported', importance: 0.7, stale: false, degree: 4, distance: null },
    { id: 'memory:mem-3', kind: 'memory', label: 'ADR 9: Static Sessions', sublabel: 'decision', itemId: 'mem-3', memoryType: 'decision', quality: 'superseded', importance: 0.3, stale: true, degree: 2, distance: null },
    { id: 'memory:mem-4', kind: 'memory', label: 'Terminal Lifecycle', sublabel: 'convention', itemId: 'mem-4', memoryType: 'convention', quality: 'working', importance: 0.5, stale: false, degree: 2, distance: null },
    { id: 'memory:mem-5', kind: 'memory', label: 'Context Fabric', sublabel: 'component', itemId: 'mem-5', memoryType: 'component', quality: 'verified', importance: 0.85, stale: false, degree: 4, distance: null },
    { id: 'memory:mem-6', kind: 'memory', label: 'Project-scoped filesystem guard', sublabel: 'security', itemId: 'mem-6', memoryType: 'security', quality: 'canonical', importance: 0.8, stale: false, degree: 3, distance: null },
    { id: 'memory:mem-7', kind: 'memory', label: 'Agent Runtime', sublabel: 'component', itemId: 'mem-7', memoryType: 'component', quality: 'supported', importance: 0.75, stale: false, degree: 3, distance: null },
    { id: 'memory:mem-8', kind: 'memory', label: 'Updater channel separation', sublabel: 'constraint', itemId: 'mem-8', memoryType: 'constraint', quality: 'verified', importance: 0.6, stale: false, degree: 1, distance: null },
  ],
  edges: [
    { id: 'g1', source: 'memory:mem-1', target: 'memory:mem-3', kind: 'relation', label: 'supersedes', confidence: 1, directed: true },
    { id: 'g2', source: 'memory:mem-2', target: 'memory:mem-1', kind: 'relation', label: 'implements', confidence: 0.9, directed: true },
    { id: 'g3', source: 'memory:mem-5', target: 'memory:mem-7', kind: 'relation', label: 'supports', confidence: 0.8, directed: true },
    { id: 'g4', source: 'memory:mem-5', target: 'memory:mem-1', kind: 'link', label: '', confidence: 0.6, directed: true },
    { id: 'g5', source: 'memory:mem-6', target: 'memory:mem-2', kind: 'relation', label: 'constrains', confidence: 0.9, directed: true },
    { id: 'g6', source: 'memory:mem-7', target: 'memory:mem-4', kind: 'link', label: '', confidence: 0.5, directed: true },
    { id: 'g7', source: 'memory:mem-5', target: 'memory:mem-8', kind: 'link', label: '', confidence: 0.5, directed: true },
    { id: 'g8', source: 'memory:mem-1', target: 'memory:mem-6', kind: 'link', label: '', confidence: 0.4, directed: true },
  ],
}

const knowledgeHealth = {
  total: 186,
  byQuality: [['canonical', 24], ['verified', 41], ['supported', 62], ['observed', 42], ['superseded', 17]],
  byType: [['component', 48], ['decision', 31], ['convention', 27], ['constraint', 22]],
  stale: 2,
  orphans: 6,
  missingEvidence: 9,
  brokenLinks: 3,
  contradictedClaims: 1,
  staleCanonical: 1,
}

const knowledgeHealthReport = {
  ...knowledgeHealth,
  understandingRevision: 12,
  understandingGeneratedAt: NOW,
  metrics: [
    { key: 'stale_canonical', label: 'Stale canonical knowledge', count: 1, query: 'is:memory quality:canonical stale:true', severity: 'alert' },
    { key: 'open_conflicts', label: 'Unresolved conflicts', count: 1, query: 'is:conflict', severity: 'alert' },
    { key: 'missing_evidence', label: 'Knowledge without evidence', count: 9, query: 'is:memory evidence:none', severity: 'warn' },
    { key: 'orphans', label: 'Unconnected knowledge', count: 6, query: 'is:memory is:orphan', severity: 'neutral' },
    { key: 'contradicted_claims', label: 'Contradicted claims', count: 1, query: 'is:claim status:contradicted', severity: 'warn' },
    { key: 'broken_links', label: 'Broken links', count: 3, query: 'is:memory links:broken', severity: 'neutral' },
  ],
}

const knowledgeUnderstanding = {
  projectId: project.id,
  revision: 12,
  generatedAt: NOW,
  filesScanned: 9063,
  groups: [
    { dimension: 'desktop_runtime', facts: [{ dimension: 'desktop_runtime', value: 'Tauri', detail: '2.11', confidence: 0.98, evidence: [{ path: 'src-tauri/tauri.conf.json', kind: 'config', excerpt: null }] }] },
    { dimension: 'language', facts: [
      { dimension: 'language', value: 'TypeScript', detail: '5.9', confidence: 0.97, evidence: [{ path: 'tsconfig.json', kind: 'manifest', excerpt: null }, { path: 'src/main.tsx', kind: 'file', excerpt: null }] },
      { dimension: 'language', value: 'Rust', detail: '2021 edition', confidence: 0.96, evidence: [{ path: 'src-tauri/Cargo.toml', kind: 'manifest', excerpt: 'edition = 2021' }] },
    ] },
    { dimension: 'framework', facts: [{ dimension: 'framework', value: 'React', detail: '19.0.0', confidence: 0.95, evidence: [{ path: 'package.json', kind: 'manifest', excerpt: 'react: 19.0.0' }] }] },
    { dimension: 'database', facts: [{ dimension: 'database', value: 'SQLite', detail: 'rusqlite', confidence: 0.93, evidence: [{ path: 'src-tauri/src/db/mod.rs', kind: 'file', excerpt: null }] }] },
    { dimension: 'test_system', facts: [{ dimension: 'test_system', value: 'Vitest', detail: null, confidence: 0.9, evidence: [{ path: 'package.json', kind: 'manifest', excerpt: null }] }] },
    { dimension: 'build_system', facts: [{ dimension: 'build_system', value: 'Vite', detail: '7', confidence: 0.9, evidence: [{ path: 'vite.config.ts', kind: 'config', excerpt: null }] }] },
    { dimension: 'ci_system', facts: [{ dimension: 'ci_system', value: 'GitHub Actions', detail: '4 workflows', confidence: 0.88, evidence: [{ path: '.github/workflows/release.yml', kind: 'config', excerpt: null }] }] },
  ],
}

const knowledgeTimeline = [
  { id: 'tl-1', projectId: project.id, at: ago(14), kind: 'quality_changed', summary: 'JWT localStorage superseded by HTTP-only sessions', detail: 'src/auth/session.rs changed', actor: 'system', itemId: 'mem-3', itemTitle: null, entityId: null, memoryType: 'decision', branchName: 'main', taskId: null },
  { id: 'tl-2', projectId: project.id, at: ago(18), kind: 'candidate_accepted', summary: 'Project-session watcher owns Memory lifecycle', detail: null, actor: 'system', itemId: 'mem-6', itemTitle: 'Project-session watcher owns Memory lifecycle', entityId: null, memoryType: 'component', branchName: 'main', taskId: null },
  { id: 'tl-3', projectId: project.id, at: ago(42), kind: 'candidate_accepted', summary: 'ContextCompiler excludes superseded truth', detail: null, actor: 'system', itemId: 'mem-5', itemTitle: 'ContextCompiler excludes superseded truth', entityId: null, memoryType: 'component', branchName: 'main', taskId: null },
  { id: 'tl-4', projectId: project.id, at: ago(58), kind: 'marked_stale', summary: 'ADR 9: Static Sessions', detail: 'file change: src/auth/token.rs', actor: 'system', itemId: 'mem-3', itemTitle: 'ADR 9: Static Sessions', entityId: null, memoryType: 'decision', branchName: 'main', taskId: null },
  { id: 'tl-5', projectId: project.id, at: ago(75), kind: 'memory_revised', summary: 'ADR 14: Token Rotation', detail: 'rev 4', actor: 'user', itemId: 'mem-1', itemTitle: 'ADR 14: Token Rotation', entityId: null, memoryType: 'decision', branchName: 'main', taskId: null },
  { id: 'tl-6', projectId: project.id, at: ago(96), kind: 'understanding_updated', summary: 'Project re-read', detail: 'revision 12, 9,063 files', actor: 'system', itemId: null, itemTitle: null, entityId: null, memoryType: null, branchName: 'main', taskId: null },
  { id: 'tl-7', projectId: project.id, at: ago(140), kind: 'conflict_opened', summary: 'Database version', detail: 'PostgreSQL 16 vs PostgreSQL 17', actor: 'system', itemId: null, itemTitle: null, entityId: 'ent-db', memoryType: null, branchName: 'main', taskId: null },
  { id: 'tl-8', projectId: project.id, at: ago(1520), kind: 'verified', summary: 'Updater channel separation', detail: 'canonical', actor: 'user', itemId: 'mem-8', itemTitle: 'Updater channel separation', entityId: null, memoryType: 'constraint', branchName: 'main', taskId: null },
  { id: 'tl-9', projectId: project.id, at: ago(1610), kind: 'claim_changed', summary: 'Access tokens expire after 15 minutes.', detail: 'contradicted', actor: 'system', itemId: 'mem-1', itemTitle: 'ADR 14: Token Rotation', entityId: null, memoryType: 'decision', branchName: 'main', taskId: null },
]

const knowledgeCandidate = {
  id: 'cand-1',
  projectId: project.id,
  kind: 'api_surface',
  subject: 'Session middleware',
  predicate: 'uses',
  object: 'HTTP-only cookies',
  statement: 'Session cookies may have replaced bearer tokens in the auth middleware.',
  suggestedMemoryType: 'decision',
  confidence: 0.62,
  origin: 'model',
  riskClass: 'high',
  status: 'pending',
  entityId: null,
  itemId: null,
  branchName: 'main',
  createdBy: 'analyzer',
  dedupHash: 'h1',
  decisionReason: 'High-risk architecture change: confirmed by a person before it becomes project truth.',
  evidence: [
    { path: 'src/auth/session.rs', kind: 'file', excerpt: 'set_cookie(SameSite::Strict, HttpOnly)' },
    { path: 'src/auth/middleware.rs', kind: 'file', excerpt: null },
  ],
  createdAt: NOW,
  decidedAt: null,
}

const knowledgeReviewQueue = {
  total: 4,
  truncated: false,
  sections: [
    {
      section: 'conflict',
      label: 'Conflicting understanding',
      bulkActionable: false,
      items: [{
        section: 'conflict', id: 'conf-1', title: 'Database version', detail: '', riskClass: 'high', candidate: null, itemId: null, createdAt: NOW,
        conflict: {
          id: 'conf-1', projectId: project.id, subjectEntityId: 'ent-db', subject: 'Database', predicate: 'version',
          leftItemId: 'mem-5', leftClaimId: null, leftLabel: 'Current knowledge', leftValue: 'PostgreSQL 16',
          rightItemId: null, rightClaimId: null, rightLabel: 'New evidence', rightValue: 'PostgreSQL 17',
          classification: 'direct_contradiction', confidence: 0.81, status: 'open', resolution: null,
          detail: 'Both were classified as the active database version fact, and neither is scoped to a branch.',
          createdAt: NOW, resolvedAt: null,
        },
      }],
    },
    {
      section: 'high_risk_candidate',
      label: 'Waiting on a person',
      bulkActionable: false,
      items: [{ section: 'high_risk_candidate', id: 'cand-1', title: knowledgeCandidate.statement, detail: '', riskClass: 'high', candidate: knowledgeCandidate, conflict: null, itemId: null, createdAt: NOW }],
    },
    {
      section: 'stale_canonical',
      label: 'Stale canonical knowledge',
      bulkActionable: false,
      items: [{ section: 'stale_canonical', id: 'mem-3', title: 'ADR 9: Static Sessions', detail: 'AuthService.rotate() changed since this was verified', riskClass: 'high', candidate: null, conflict: null, itemId: 'mem-3', createdAt: NOW }],
    },
    {
      section: 'candidate',
      label: 'New knowledge',
      bulkActionable: true,
      items: [
        { section: 'candidate', id: 'cand-2', title: '', detail: '', riskClass: 'routine', conflict: null, itemId: null, createdAt: NOW, candidate: { ...knowledgeCandidate, id: 'cand-2', statement: 'GET /api/sessions is an API surface exposed by the auth router.', riskClass: 'routine', origin: 'deterministic', confidence: 0.88, decisionReason: null, evidence: [{ path: 'src/routes.ts', kind: 'file', excerpt: null }] } },
        { section: 'candidate', id: 'cand-3', title: '', detail: '', riskClass: 'routine', conflict: null, itemId: null, createdAt: NOW, candidate: { ...knowledgeCandidate, id: 'cand-3', statement: 'The release workflow signs updater artifacts before publishing.', riskClass: 'routine', origin: 'deterministic', confidence: 0.84, decisionReason: null, evidence: [{ path: '.github/workflows/release.yml', kind: 'config', excerpt: null }] } },
      ],
    },
  ],
}

const knowledgeJobs = [
  { id: 'job-1', projectId: project.id, kind: 'analyze_impact', status: 'complete', payload: JSON.stringify({ paths: ['src/auth/session.rs'], trigger: 'file change' }), attempts: 1, maxAttempts: 3, dedupKey: null, result: JSON.stringify({ pathsAnalyzed: 1, understandings: [], markedStale: ['mem-3'], superseded: [], learned: ['mem-2'], needsReview: [], skipped: [{ itemId: 'mem-4', reason: 'not yet load-bearing: quality below supported' }] }), error: null, createdAt: NOW, startedAt: NOW, finishedAt: NOW },
  { id: 'job-2', projectId: project.id, kind: 'analyze_project', status: 'complete', payload: JSON.stringify({ trigger: 'session start' }), attempts: 1, maxAttempts: 3, dedupKey: null, result: JSON.stringify({ filesScanned: 9063, factsFound: 41, factsChanged: 3, candidatesQueued: 5, revision: 12 }), error: null, createdAt: NOW, startedAt: NOW, finishedAt: NOW },
  { id: 'job-3', projectId: project.id, kind: 'process_candidates', status: 'complete', payload: '{}', attempts: 1, maxAttempts: 3, dedupKey: null, result: JSON.stringify({ processed: 5, autoAccepted: 2, queuedForReview: 3, rejected: 0, duplicatesIgnored: 1, conflictsOpened: 1 }), error: null, createdAt: NOW, startedAt: NOW, finishedAt: NOW },
  { id: 'job-4', projectId: project.id, kind: 'analyze_impact', status: 'failed', payload: JSON.stringify({ paths: ['src/db/schema.rs'], trigger: 'commit 91df2ab' }), attempts: 3, maxAttempts: 3, dedupKey: null, result: null, error: 'The Project folder is unavailable.', createdAt: NOW, startedAt: NOW, finishedAt: NOW },
  { id: 'job-5', projectId: project.id, kind: 'analyze_impact', status: 'queued', payload: JSON.stringify({ paths: ['src/features/memory/api.ts'], trigger: 'file change' }), attempts: 0, maxAttempts: 3, dedupKey: null, result: null, error: null, createdAt: NOW, startedAt: null, finishedAt: null },
]

const contextPack = {
  projectId: project.id,
  task: 'Fix authentication middleware',
  budgetTokens: 12000,
  usedTokens: 6482,
  candidatesConsidered: 41,
  elapsedMs: 38,
  compiledAt: NOW,
  cached: false,
  semanticUsed: false,
  compilerVersion: '3',
  handoffs: [],
  conflicts: [{ leftItemId: 'mem-1', leftTitle: 'ADR 14: Token Rotation', rightItemId: 'mem-3', rightTitle: 'ADR 9: Static Sessions' }],
  sections: [
    { kind: 'task_contract', label: 'Task contract', entries: [
      { itemId: 'ctx-1', title: 'Fix authentication middleware', memoryType: 'note', quality: 'working', section: 'task_contract', text: '', tokens: 320, score: 3.2, stale: false, reasons: [{ source: 'explicit', detail: 'the task as written', weight: 3.2 }], sourceType: 'task', sourceUris: [] },
    ] },
    { kind: 'architecture', label: 'Architecture', entries: [
      { itemId: 'mem-2', title: 'Auth Service', memoryType: 'component', quality: 'supported', section: 'architecture', text: '', tokens: 1410, score: 2.4, stale: false, confidence: 0.6, reasons: [{ source: 'file', detail: 'cites src/auth/session.rs', weight: 1.5 }, { source: 'lexical', detail: 'matches "authentication"', weight: 0.9 }], sourceType: 'memory', sourceUris: ['src/auth/service.rs'] },
      { itemId: 'mem-5', title: 'Context Fabric', memoryType: 'component', quality: 'verified', section: 'architecture', text: '', tokens: 980, score: 1.6, stale: false, confidence: 0.9, reasons: [{ source: 'relation', detail: 'related to Auth Service', weight: 1.6 }], sourceType: 'memory', sourceUris: [] },
    ] },
    { kind: 'constraints', label: 'Constraints', entries: [
      { itemId: 'mem-6', title: 'Project-scoped filesystem guard', memoryType: 'security', quality: 'canonical', section: 'constraints', text: '', tokens: 1103, score: 2.1, stale: false, confidence: 0.95, reasons: [{ source: 'standing', detail: 'canonical project knowledge', weight: 2.1 }], sourceType: 'memory', sourceUris: [] },
    ] },
    { kind: 'code', label: 'Relevant code', entries: [
      { itemId: 'ctx-2', title: 'src/auth/middleware.rs', memoryType: 'note', quality: 'observed', section: 'code', text: '', tokens: 1928, score: 1.9, stale: false, reasons: [{ source: 'file', detail: 'named by the task', weight: 1.9 }], sourceType: 'file', sourceUris: ['src/auth/middleware.rs'] },
    ] },
    { kind: 'predecessors', label: 'Decisions', entries: [
      { itemId: 'mem-1', title: 'ADR 14: Token Rotation', memoryType: 'decision', quality: 'canonical', section: 'predecessors', text: '', tokens: 741, score: 1.87, stale: false, confidence: 0.9, reasons: [{ source: 'file', detail: 'cites src/auth/token.rs', weight: 0.9 }, { source: 'lexical', detail: 'matches "authentication"', weight: 0.97 }], sourceType: 'memory', sourceUris: [] },
    ] },
  ],
  rejected: [
    { itemId: 'mem-3', title: 'ADR 9: Static Sessions', score: 1.2, reason: 'superseded' },
    { itemId: 'mem-9', title: 'Legacy token-budget rule', score: 0.9, reason: 'stale' },
    { itemId: 'mem-10', title: 'Browser rendering notes', score: 0.4, reason: 'budget' },
    { itemId: 'mem-11', title: 'Release assembly runbook', score: 0.3, reason: 'budget' },
  ],
  diagnostics: {
    providerCandidates: { lexical: 28, relation: 9, file: 4 },
    deduplicatedCandidates: 3,
    staleCandidates: 2,
    truncatedEntries: 0,
    semanticStatus: 'disabled',
    providerErrors: [],
  },
}

const knowledgeSearchResponse = {
  total: 4,
  truncated: false,
  elapsedMs: 7,
  semanticUsed: false,
  parsed: { expression: { node: 'all' }, diagnostics: [] },
  results: [
    { domain: 'memory', id: 'mem-1', itemId: 'mem-1', title: 'ADR 14: Token Rotation', excerpt: 'Refresh tokens rotate after every use and the whole family is invalidated on reuse.', matchReason: 'lexical', score: 2.4, memoryType: 'decision', quality: 'canonical', stale: false, confidence: 0.9, branchName: null, updatedAt: NOW },
    { domain: 'memory', id: 'mem-3', itemId: 'mem-3', title: 'ADR 9: Static Sessions', excerpt: 'Sessions were fixed-lifetime with no rotation. Replaced by ADR 14.', matchReason: 'lexical', score: 1.1, memoryType: 'decision', quality: 'superseded', stale: true, confidence: 0.4, branchName: null, updatedAt: NOW },
    { domain: 'fact', id: 'fact-1', itemId: null, title: 'Rust — 2021 edition', excerpt: 'src-tauri/Cargo.toml', matchReason: 'filter', score: 0.9, memoryType: null, quality: null, stale: false, confidence: 0.96, branchName: null, updatedAt: NOW },
    { domain: 'conflict', id: 'conf-1', itemId: null, title: 'Database — version', excerpt: 'PostgreSQL 16 vs PostgreSQL 17', matchReason: 'filter', score: 0.8, memoryType: null, quality: null, stale: false, confidence: 0.81, branchName: null, updatedAt: NOW },
  ],
}

/** Explorer + editor fixtures. Deliberately dot-folder heavy: the system-folder pile-up at the top
 * of the tree is exactly the hierarchy problem the Files surface has to solve. */
function fileEntry(name: string, kind: 'file' | 'directory', extra: Record<string, unknown> = {}) {
  return { name, relativePath: name, kind, size: 2048, modifiedMs: 1_760_000_000_000, isSymlink: false, symlinkBroken: false, isHidden: false, readonly: false, ...extra }
}

const projectListing = {
  projectId: project.id,
  relativePath: '',
  truncated: false,
  totalEntries: 12,
  entries: [
    fileEntry('.agents', 'directory'),
    fileEntry('.claude', 'directory'),
    fileEntry('.git', 'directory', { isHidden: true }),
    fileEntry('.github', 'directory'),
    fileEntry('.paralith', 'directory'),
    fileEntry('src', 'directory'),
    fileEntry('src-tauri', 'directory'),
    fileEntry('scripts', 'directory'),
    fileEntry('CLAUDE.md', 'file'),
    fileEntry('package.json', 'file'),
    fileEntry('vite.config.ts', 'file'),
    fileEntry('tsconfig.app.json', 'file', { readonly: true }),
  ],
}

const projectFile = {
  projectId: project.id,
  relativePath: 'package.json',
  content: JSON.stringify({ name: 'paralith', version: '0.4.17' }, null, 2),
  sha256: 'f1e2d3',
  size: 52,
  encoding: 'utf8',
  lineEnding: 'lf',
  binary: false,
  readonly: false,
}

export const FIXTURES: Record<string, unknown> = {
  get_agent_organization: {
    agents: [
      { id: 'atlas', name: 'Atlas', role: 'Chief of Staff', brief: 'Coordinate priorities and bounded delegation.', responsibilities: ['Coordinate priorities'], avatarSeed: 'atlas', intelligencePreference: 'automatic', workState: 'idle', pinned: true, position: 0, createdAt: NOW, updatedAt: NOW },
      { id: 'forge', name: 'Forge', role: 'Engineering Lead', brief: 'Own implementation and verification.', responsibilities: ['Engineering delivery'], avatarSeed: 'forge', intelligencePreference: 'automatic', workState: 'working', workStateDetail: 'Running tests', pinned: false, position: 1, createdAt: NOW, updatedAt: NOW },
      { id: 'scout', name: 'Scout', role: 'Researcher', brief: 'Return sourced findings.', responsibilities: ['Research'], avatarSeed: 'scout', intelligencePreference: 'subscription_first', workState: 'complete', workStateDetail: 'Research complete', pinned: false, position: 2, createdAt: NOW, updatedAt: NOW },
    ],
    conversations: [
      { id: 'atlas-general', agentId: 'atlas', title: 'General', position: 0, createdAt: NOW, updatedAt: NOW },
      { id: 'atlas-product', agentId: 'atlas', title: 'Product direction', position: 1, runtimePreference: 'codex/gpt-5.5', createdAt: NOW, updatedAt: NOW },
      { id: 'forge-general', agentId: 'forge', title: 'General', position: 0, createdAt: NOW, updatedAt: NOW },
      { id: 'scout-general', agentId: 'scout', title: 'General', position: 0, createdAt: NOW, updatedAt: NOW },
    ],
    entries: [
      { id: 'entry-1', conversationId: 'atlas-general', kind: 'event', authorAgentId: 'atlas', body: 'Atlas joined the team as Chief of Staff.', metadata: {}, state: 'complete', createdAt: NOW, updatedAt: NOW },
      { id: 'entry-2', conversationId: 'atlas-general', kind: 'user', body: 'Turn the approved notification direction into a bounded engineering task.', metadata: {}, state: 'complete', createdAt: NOW, updatedAt: NOW },
      { id: 'entry-3', conversationId: 'atlas-general', kind: 'agent', authorAgentId: 'atlas', body: 'Forge should own it. The Activity system already normalizes agent state, so the work is a delivery path into it rather than a second notification engine.\n\nI would bound the task to the existing surface and require a passing test run before review.', metadata: {}, state: 'complete', runtimeProvider: 'claude', runtimeModel: 'sonnet', parentEntryId: 'entry-2', createdAt: NOW, updatedAt: NOW },
      { id: 'entry-4', conversationId: 'atlas-general', kind: 'user', body: 'Draft the delegation.', metadata: {}, state: 'complete', createdAt: NOW, updatedAt: NOW },
      { id: 'entry-5', conversationId: 'atlas-general', kind: 'agent', authorAgentId: 'atlas', body: 'Drafting the bounded delegation for Forge', metadata: {}, state: 'streaming', runtimeProvider: 'claude', runtimeModel: 'sonnet', parentEntryId: 'entry-4', createdAt: NOW, updatedAt: NOW },
    ],
    delegations: [{ id: 'delegation-1', ownerAgentId: 'atlas', recipientAgentId: 'forge', objective: 'Implement the approved notification system using the existing Activity architecture.', relevantContext: 'Approved in product direction.', constraints: 'Preserve existing terminals and do not publish.', expectedResult: 'Verified implementation.', authorityBoundary: 'Approved workspace only.', projectId: project.id, workspaceId: workspace.id, status: 'ready', createdAt: NOW, updatedAt: NOW }],
    authorities: [{ agentId: 'forge', projectId: project.id, workspaceId: workspace.id, access: 'read_write', grantedAt: NOW }],
    productState: { selectedMode: PRODUCT_MODE, selectedAgentId: 'atlas', selectedConversationId: 'atlas-general' },
  },
  // One connected runtime family and one that is installed but not signed in, so the picker's
  // honest-unavailability path is visible in the harness rather than only in theory.
  list_agent_runtimes: [
    { id: 'claude/opus', providerId: 'claude', providerName: 'Claude', modelId: 'opus', displayName: 'Opus', description: 'Deep planning and architecture work.', installed: true, authenticated: true, available: true, version: '2.4.0' },
    { id: 'claude/sonnet', providerId: 'claude', providerName: 'Claude', modelId: 'sonnet', displayName: 'Sonnet', description: 'Balanced coding, review, and implementation.', installed: true, authenticated: true, available: true, version: '2.4.0' },
    { id: 'codex/gpt-5.5', providerId: 'codex', providerName: 'Codex', modelId: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Strong general coding and repository work.', installed: true, authenticated: false, available: false, unavailableReason: "Sign in to this runtime's CLI to use it here." },
  ],
  send_agent_message: null,
  cancel_agent_message: null,
  set_agent_conversation_runtime: null,
  set_agent_intelligence_preference: null,
  save_agent_product_state: null,
  get_startup_status: { recoveryMode: false },
  get_settings: settings,
  save_settings: settings,
  confirm_healthy_startup: null,
  check_for_updates: null,
  get_update_status: null,
  open_project: project,
  get_project: project,
  list_recent_projects: [project, project2],
  list_projects_overview: [
    { project, workspaces: [workspace, workspace2], folderMissing: false },
    { project: project2, workspaces: [workspace3], folderMissing: false },
  ],
  list_open_projects: [
    { projectId: project.id, project, isActive: true, lastWorkspaceId: workspace.id, openedAt: NOW },
    { projectId: project2.id, project: project2, isActive: false, lastWorkspaceId: workspace3.id, openedAt: NOW },
  ],
  get_workspace: workspace,
  save_workspace: workspace,
  list_workspaces_for_project: [workspace, workspace2],
  list_recent_workspaces: [
    { workspace, projectName: project.name, projectPath: project.rootPath, projectMissing: false },
    { workspace: workspace2, projectName: project.name, projectPath: project.rootPath, projectMissing: false },
    { workspace: workspace3, projectName: project2.name, projectPath: project2.rootPath, projectMissing: false },
  ],
  suggest_workspace_name: 'New workspace',
  detect_agents: agents,
  detect_shells: shells,
  get_layout_preset: layout,
  split_layout_pane: layout,
  remove_layout_pane: layout,
  create_terminal_session: sessions[0],
  list_terminal_sessions: sessions,
  restore_workspace_sessions: { restored: sessions, deferred: [], failed: [] },
  get_sidebar_preferences: { groupBy: 'project', sortMode: 'manual', collapsedGroups: [] },
  get_swarm_execution_defaults: { member: { providerId: 'claude', providerDisplayName: 'Claude', modelId: 'opus-5', modelDisplayName: 'Opus 5', reasoningEffort: 'high', contextStrategy: 'balanced', permissionMode: 'ask' } },
  get_swarm_command_draft: null,
  save_swarm_command_draft: null,
  list_swarms: swarms,
  get_swarm: swarmDetail,
  get_swarm_detail: swarmDetail,
  list_swarm_presets: [
    { id: 'balanced', name: 'Balanced', description: 'One of each role.', roles: [] },
  ],
  list_swarm_model_registry: [
    { providerId: 'claude', providerDisplayName: 'Claude', modelId: 'opus-5', displayName: 'Opus 5', description: 'Deep reasoning and broad repository work.', available: true, deprecated: false, coding: true, planning: true, review: true, toolUse: true, vision: true, supportedReasoningEfforts: ['low', 'medium', 'high', 'max'], supportedExecutionModes: ['ask', 'trusted'], recommendedRoles: ['coordinator', 'reviewer'], authenticated: true },
    { providerId: 'claude', providerDisplayName: 'Claude', modelId: 'sonnet-5', displayName: 'Sonnet 5', description: 'Fast implementation and review.', available: true, deprecated: false, coding: true, planning: true, review: true, toolUse: true, vision: true, supportedReasoningEfforts: ['low', 'medium', 'high'], supportedExecutionModes: ['ask', 'trusted'], recommendedRoles: ['builder'], authenticated: true },
    { providerId: 'codex', providerDisplayName: 'Codex', modelId: 'gpt-5.6', displayName: 'GPT 5.6', description: 'Focused implementation and verification.', available: true, deprecated: false, coding: true, planning: false, review: true, toolUse: true, vision: false, supportedReasoningEfforts: ['low', 'medium', 'high'], supportedExecutionModes: ['ask', 'restricted'], recommendedRoles: ['builder', 'debugger'], authenticated: true },
  ],
  list_project_directory: projectListing,
  read_project_file: projectFile,
  search_project_files: { projectId: project.id, files: ['src/App.tsx', 'src/index.css', 'src-tauri/src/main.rs', 'package.json'], truncated: false },
  watch_project_files: null,
  unwatch_project_files: null,
  inspect_repository: repositorySnapshot,
  list_repository_branches: [
    { name: 'feat/database-studio', isCurrent: true, isRemote: false, ahead: 3, behind: 0, upstream: 'origin/feat/database-studio', lastCommitAt: NOW, lastCommitSummary: 'feat(dbstudio): professional Database Studio UI' },
    { name: 'main', isCurrent: false, isRemote: false, ahead: 0, behind: 12, upstream: 'origin/main', lastCommitAt: NOW, lastCommitSummary: 'release: prepare Stable 0.4.10' },
  ],
  get_ai_usage_snapshots: usageSnapshots,
  refresh_ai_usage: usageSnapshots,
  get_ai_usage_diagnostics: [],
  get_ai_usage_history: usageHistory,
  set_last_active_workspace: null,
  recover_workspace_windows: { recovered: [], reconnectable: [] },
  terminal_session_status: 'running',
  list_monitors: [{ id: 'monitor-1', name: 'Primary', isPrimary: true, position: { x: 0, y: 0 }, size: { width: 2560, height: 1440 }, scaleFactor: 1.25 }],
  list_workspace_placements: [],
  list_live_sessions: sessions,
  get_workspace_canvas_layout: { revision: 1, canvasJson: null },
  save_workspace_canvas_layout: { revision: 2 },
  open_project_session: [
    { projectId: project.id, project, isActive: true, lastWorkspaceId: workspace.id, openedAt: NOW },
    { projectId: project2.id, project: project2, isActive: false, lastWorkspaceId: workspace3.id, openedAt: NOW },
  ],
  set_project_last_active: null,
  get_diagnostics_snapshot: { generatedAt: NOW, entries: [] },
  memory_list: memorySummaries,
  memory_get: memoryDetail,
  memory_search: memorySummaries.slice(0, 2).map((item) => ({ ...item, snippet: 'Refresh tokens rotate after every use...', score: 1, matchReason: 'lexical' })),
  memory_connections: {
    orphan: false,
    backlinks: [
      { sourceItemId: 'mem-2', sourceSlug: 'auth-service', sourceTitle: 'Auth Service', sourceType: 'component', excerpt: 'implements the rotation rule from [[ADR 14: Token Rotation]] in rotate()' },
      { sourceItemId: 'mem-3', sourceSlug: 'adr-9-static-sessions', sourceTitle: 'ADR 9: Static Sessions', sourceType: 'decision', excerpt: 'replaced by [[ADR 14: Token Rotation]] in July' },
    ],
    unlinkedMentions: [
      { sourceItemId: 'mem-4', sourceSlug: 'terminal-lifecycle', sourceTitle: 'Terminal Lifecycle', matchedText: 'ADR 14: Token Rotation', excerpt: 'unrelated to ADR 14: Token Rotation but mentions it in passing' },
    ],
  },
  memory_history: [
    { id: 'rev-4', revisionNumber: 4, title: 'ADR 14: Token Rotation', summary: 'Family invalidation added.', confidence: 0.9, extractionMethod: 'user', modelId: null, contentHash: 'd4e5', createdAt: NOW },
    { id: 'rev-3', revisionNumber: 3, title: 'ADR 14: Token Rotation', summary: 'Hashing note added.', confidence: 0.8, extractionMethod: 'user', modelId: null, contentHash: 'c3d4', createdAt: NOW },
    { id: 'rev-2', revisionNumber: 2, title: 'ADR 14: Token Rotation', summary: 'Consequences section.', confidence: 0.7, extractionMethod: 'user', modelId: null, contentHash: 'b2c3', createdAt: NOW },
    { id: 'rev-1', revisionNumber: 1, title: 'ADR 14 (draft)', summary: 'Initial decision.', confidence: 0.5, extractionMethod: 'user', modelId: null, contentHash: 'a1b2', createdAt: NOW },
  ],
  memory_vocabulary: [
    ['supersedes', 'contradicts', 'supports', 'depends_on', 'implements', 'documents', 'derived_from', 'related_to'],
    ['file', 'commit', 'command', 'test', 'run', 'task', 'url', 'note'],
  ],
  memory_graph: knowledgeGraph,
  memory_health: knowledgeHealth,
  memory_jobs: knowledgeJobs,
  memory_job_cancel: false,
  context_compile: contextPack,
  knowledge_understanding: knowledgeUnderstanding,
  knowledge_analyze_project: true,
  knowledge_review_queue: knowledgeReviewQueue,
  knowledge_decide_candidates: [],
  knowledge_resolve_conflict: [],
  knowledge_timeline: knowledgeTimeline,
  knowledge_timeline_actors: ['system', 'user', 'agent:implementer'],
  knowledge_search: knowledgeSearchResponse,
  knowledge_semantic_health: { mode: 'disabled', provider: 'disabled', model: '', dimensions: 0, available: false, detail: 'Lexical and structured search are unaffected.' },
  knowledge_health_report: knowledgeHealthReport,
}

/** The empty shape a screen expects when a command has no fixture. */
export function defaultFor(command: string): unknown {
  if (command.startsWith('list_') || command.startsWith('detect_')) return []
  if (command.startsWith('get_') || command.startsWith('inspect_')) return null
  return null
}
