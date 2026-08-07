import type { AgentProvider, RecentWorkspace, TerminalSession, Workspace } from '../../native/types'
import { earliestAttentionSince } from './sidebarAgentStatus'
import type {
  ProviderSummary,
  RuntimeDerivationInput,
  WorkspaceRuntimeStatus,
  WorkspaceRuntimeSummary,
} from './sidebarTypes'

const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode']

/** Short identity used in dense Workspace rows (distinct from the verbose settings labels). */
export function shortProviderLabel(provider: string): string {
  return (
    {
      claude: 'Claude',
      codex: 'Codex',
      opencode: 'OpenCode',
      powershell: 'PowerShell',
      command_prompt: 'Cmd',
      wsl: 'WSL',
      custom_shell: 'Shell',
    } as Record<string, string>
  )[provider] ?? provider
}

export function isAgentProvider(provider: string): boolean {
  return AGENT_PROVIDERS.includes(provider as AgentProvider)
}

/**
 * The concise provider identities configured for a Workspace, deduped in Pane order and
 * capped so a long list collapses to `Claude · Codex · OpenCode · +2`.
 */
export function deriveProviderSummary(workspace: Workspace, maxVisible = 3): ProviderSummary {
  const labels: string[] = []
  for (const pane of [...workspace.panes].sort((a, b) => a.positionOrder - b.positionOrder)) {
    const label = shortProviderLabel(pane.provider)
    if (!labels.includes(label)) labels.push(label)
  }
  const overflow = Math.max(0, labels.length - maxVisible)
  const visible = overflow > 0 ? labels.slice(0, maxVisible) : labels
  const text = overflow > 0 ? `${visible.join(' · ')} · +${overflow}` : visible.join(' · ')
  return { labels, visible, overflow, text }
}

/**
 * Collapse the live Terminal Sessions of one Workspace into a single canonical status.
 * Runtime truth comes only from real sessions (and the transient deferred-Pane list of the
 * active Workspace); it is never inferred from previous UI state.
 */
export function deriveWorkspaceRuntimeSummary(
  input: RuntimeDerivationInput,
): WorkspaceRuntimeSummary {
  const {
    workspaceId,
    configuredPaneCount,
    sessions,
    deferredPaneIds = [],
    stopping = false,
    paneAgentStates = [],
  } = input
  // Keep only the newest session per Pane so a restarted Pane is not double-counted.
  const latestByPane = new Map<string, TerminalSession>()
  for (const session of sessions) {
    if (session.workspaceId !== workspaceId) continue
    const existing = latestByPane.get(session.paneId)
    if (!existing || session.startedAt.localeCompare(existing.startedAt) >= 0) {
      latestByPane.set(session.paneId, session)
    }
  }

  let startingCount = 0
  let runningCount = 0
  let waitingCount = 0
  let exitedCount = 0
  let failedCount = 0
  let disconnectedCount = 0
  const activeProviders: string[] = []

  for (const session of latestByPane.values()) {
    switch (session.status) {
      case 'running':
        if (session.restorationState === 'stale') startingCount += 1
        else runningCount += 1
        break
      case 'failed':
        failedCount += 1
        break
      case 'disconnected':
        disconnectedCount += 1
        break
      case 'exited':
      case 'terminated':
        exitedCount += 1
        break
    }
    if (session.status === 'running' && !activeProviders.includes(session.provider)) {
      activeProviders.push(session.provider)
    }
  }

  // A Pane the user chose to defer counts only if it has no live session of its own.
  const deferredCount = deferredPaneIds.filter((paneId) => !latestByPane.has(paneId)).length

  // Split the Panes blocked on a human out of `runningCount`. They are running processes, but the
  // status ladder below treats "running" and "waiting" as disjoint — a Workspace where every Pane
  // sits at a permission prompt is not *working*, and reporting it as such is what made the
  // attention sort useless: its top class could never be reached.
  const blockedPanes = paneAgentStates.filter((state) => {
    const session = latestByPane.get(state.paneId)
    // Must be a Pane that landed in `runningCount` above, or the subtraction below would move a
    // count out of a bucket it was never in. A Pane still restoring is `starting`, not waiting.
    return state.attention === 'needs_you' && session?.status === 'running' && session.restorationState !== 'stale'
  })
  waitingCount = blockedPanes.length
  runningCount = Math.max(0, runningCount - waitingCount)

  const requiresAttention = failedCount > 0 || disconnectedCount > 0 || waitingCount > 0
  const status = deriveStatus({
    configuredPaneCount,
    startingCount,
    runningCount,
    waitingCount,
    exitedCount,
    failedCount,
    disconnectedCount,
    deferredCount,
    stopping,
  })

  return {
    workspaceId,
    configuredPaneCount,
    startingCount,
    runningCount,
    waitingCount,
    exitedCount,
    failedCount,
    disconnectedCount,
    deferredCount,
    activeProviders,
    status,
    requiresAttention,
    attentionSince: earliestAttentionSince(blockedPanes),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }
}

function deriveStatus(counts: {
  configuredPaneCount: number
  startingCount: number
  runningCount: number
  waitingCount: number
  exitedCount: number
  failedCount: number
  disconnectedCount: number
  deferredCount: number
  stopping: boolean
}): WorkspaceRuntimeStatus {
  const live = counts.runningCount + counts.startingCount + counts.waitingCount
  if (counts.stopping && live > 0) return 'stopping'
  // A real launch failure with nothing usable running is the hardest attention state.
  if (counts.runningCount === 0 && counts.startingCount === 0 && counts.failedCount > 0) return 'failed'
  if (counts.failedCount > 0 || counts.disconnectedCount > 0) return 'attention'
  if (counts.waitingCount > 0 && counts.runningCount === 0) return 'waiting'
  if (counts.runningCount === 0 && counts.startingCount > 0) return 'starting'
  if (counts.runningCount > 0) {
    // Some Panes live but others closed/exited/deferred/never-started → partially active. Waiting
    // Panes count as covered: they are live processes, just blocked on a person.
    const covered = counts.runningCount + counts.startingCount + counts.waitingCount
    if (covered < counts.configuredPaneCount) return 'partially_active'
    return 'active'
  }
  return 'closed'
}

/** A short human sentence for the Workspace row's secondary line. */
export function runtimeStatusText(summary: WorkspaceRuntimeSummary): string {
  switch (summary.status) {
    case 'closed':
      return 'Not running'
    case 'starting':
      return 'Starting…'
    case 'stopping':
      return 'Stopping…'
    case 'waiting':
      return summary.waitingCount === 1 ? '1 waiting for input' : `${summary.waitingCount} waiting for input`
    case 'failed':
      return 'No terminal running'
    case 'attention': {
      const affected = summary.failedCount + summary.disconnectedCount
      return affected === 1 ? '1 terminal needs attention' : `${affected} terminals need attention`
    }
    case 'partially_active':
    case 'active': {
      const parts: string[] = []
      if (summary.runningCount > 0) parts.push(`${summary.runningCount} running`)
      if (summary.waitingCount > 0) parts.push(`${summary.waitingCount} waiting`)
      if (summary.deferredCount > 0) parts.push(`${summary.deferredCount} deferred`)
      return parts.join(' · ') || 'Running'
    }
    default:
      return 'Unknown'
  }
}

/** Accessible label for the status indicator (never color-only). */
export function runtimeStatusLabel(status: WorkspaceRuntimeStatus): string {
  return (
    {
      closed: 'Closed',
      starting: 'Starting',
      active: 'Active',
      partially_active: 'Partially active',
      waiting: 'Waiting for input',
      attention: 'Needs attention',
      stopping: 'Stopping',
      failed: 'Failed',
    } as Record<WorkspaceRuntimeStatus, string>
  )[status]
}

/**
 * The one matcher behind the sidebar's live filter. Every primary list (Workspaces, Swarms,
 * detached Workspaces) filters through this so a query behaves identically everywhere: blank
 * matches all, and matching is case-insensitive over whichever text a row actually shows.
 */
export function matchesSidebarFilter(query: string, ...fields: (string | undefined)[]): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return fields.some((field) => field?.toLowerCase().includes(needle))
}

export interface ProjectSwitcherRow {
  projectId: string
  name: string
  path: string
  branch?: string
  workspaceCount: number
  lastOpenedAt: string
  missing: boolean
  lastActiveWorkspaceId: string
}

/**
 * Collapse recent Workspaces into one row per Project for the switcher, keeping each
 * Project's most-recently-opened Workspace as its restore target. Newest Project first.
 */
export function groupRecentsByProject(recents: RecentWorkspace[]): ProjectSwitcherRow[] {
  const byProject = new Map<string, ProjectSwitcherRow>()
  for (const recent of recents) {
    const { workspace } = recent
    const existing = byProject.get(workspace.projectId)
    if (!existing) {
      byProject.set(workspace.projectId, {
        projectId: workspace.projectId,
        name: recent.projectName,
        path: recent.projectPath,
        workspaceCount: 1,
        lastOpenedAt: workspace.lastOpenedAt,
        missing: recent.projectMissing,
        lastActiveWorkspaceId: workspace.id,
      })
    } else {
      existing.workspaceCount += 1
      if (workspace.lastOpenedAt.localeCompare(existing.lastOpenedAt) > 0) {
        existing.lastOpenedAt = workspace.lastOpenedAt
        existing.lastActiveWorkspaceId = workspace.id
      }
    }
  }
  return [...byProject.values()].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
}
