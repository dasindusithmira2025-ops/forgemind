/**
 * Fixture data for the visual harness (see `visual/README.md`).
 *
 * These shapes mirror `src/native/types.ts` closely enough for the real screens to render a
 * representative, *populated* state — the states that actually stress the design system. They are
 * deliberately hand-written rather than generated: a screenshot of an empty app proves nothing
 * about density, truncation or hierarchy.
 */

const NOW = '2026-08-12T09:41:00Z'

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

export const FIXTURES: Record<string, unknown> = {
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
}

/** The empty shape a screen expects when a command has no fixture. */
export function defaultFor(command: string): unknown {
  if (command.startsWith('list_') || command.startsWith('detect_')) return []
  if (command.startsWith('get_') || command.startsWith('inspect_')) return null
  return null
}
