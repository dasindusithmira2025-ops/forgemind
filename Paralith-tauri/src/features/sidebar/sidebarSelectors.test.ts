import { describe, expect, it } from 'vitest'
import type { PaneAssignment, RecentWorkspace, TerminalSession, Workspace } from '../../native/types'
import {
  deriveProviderSummary,
  deriveWorkspaceRuntimeSummary,
  groupRecentsByProject,
  groupSessionsByWorkspace,
  runtimeStatusText,
} from './sidebarSelectors'
import { clampSidebarWidth } from './sidebarPreferences'

function pane(id: string, provider: PaneAssignment['provider'], order: number): PaneAssignment {
  return { id, workspaceId: 'w', title: id, provider, executablePath: 'x', args: [], workingDirectory: 'd', workingDirectoryMode: 'project_relative', positionOrder: order }
}

function workspace(panes: PaneAssignment[]): Workspace {
  return { id: 'w', projectId: 'p', name: 'W', normalizedName: 'w', layout: { type: 'pane', paneId: panes[0].id }, activePaneId: panes[0].id, restoreBehavior: 'inherit', panes, createdAt: '', updatedAt: '', lastOpenedAt: '' }
}

function session(paneId: string, status: TerminalSession['status'], extra: Partial<TerminalSession> = {}): TerminalSession {
  return { id: `s-${paneId}-${status}`, projectId: 'p', workspaceId: 'w', paneId, provider: 'claude', executable: 'x', arguments: [], title: 't', workingDirectory: 'd', status, startedAt: '2026-01-01T00:00:00Z', outputTail: [], nextSequence: 0, restorationState: 'restored', droppedOutputBytes: 0, ...extra }
}

describe('deriveWorkspaceRuntimeSummary', () => {
  const base = { workspaceId: 'w', updatedAt: 'now' }

  it('is closed with no sessions', () => {
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 4, sessions: [] })
    expect(summary.status).toBe('closed')
    expect(summary.requiresAttention).toBe(false)
    expect(runtimeStatusText(summary)).toBe('Not running')
  })

  it('is active when every configured pane runs', () => {
    const sessions = [session('a', 'running'), session('b', 'running')]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 2, sessions })
    expect(summary.status).toBe('active')
    expect(summary.runningCount).toBe(2)
  })

  it('is partially_active when some panes ran and others exited', () => {
    const sessions = [session('a', 'running'), session('b', 'exited')]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 4, sessions })
    expect(summary.status).toBe('partially_active')
  })

  it('is attention when a pane disconnected', () => {
    const sessions = [session('a', 'running'), session('b', 'disconnected')]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 2, sessions })
    expect(summary.status).toBe('attention')
    expect(summary.requiresAttention).toBe(true)
    expect(runtimeStatusText(summary)).toBe('1 terminal needs attention')
  })

  it('is failed when launches failed and nothing runs', () => {
    const sessions = [session('a', 'failed'), session('b', 'failed')]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 2, sessions })
    expect(summary.status).toBe('failed')
  })

  it('is starting while a session is still restoring', () => {
    const sessions = [session('a', 'running', { restorationState: 'stale' })]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 1, sessions })
    expect(summary.status).toBe('starting')
    expect(summary.startingCount).toBe(1)
  })

  it('is stopping when shutdown is in progress', () => {
    const sessions = [session('a', 'running')]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 1, sessions, stopping: true })
    expect(summary.status).toBe('stopping')
  })

  it('counts a deferred pane only when it has no live session', () => {
    const sessions = [session('a', 'running')]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 2, sessions, deferredPaneIds: ['a', 'b'] })
    expect(summary.deferredCount).toBe(1)
    expect(summary.status).toBe('partially_active')
  })

  it('keeps only the newest session per pane', () => {
    const sessions = [
      session('a', 'exited', { startedAt: '2026-01-01T00:00:00Z' }),
      session('a', 'running', { startedAt: '2026-01-02T00:00:00Z' }),
    ]
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 1, sessions })
    expect(summary.runningCount).toBe(1)
    expect(summary.exitedCount).toBe(0)
    expect(summary.status).toBe('active')
  })

  it('ignores sessions belonging to other workspaces', () => {
    const foreign = session('a', 'running', { workspaceId: 'other' })
    const summary = deriveWorkspaceRuntimeSummary({ ...base, configuredPaneCount: 1, sessions: [foreign] })
    expect(summary.status).toBe('closed')
  })
})

describe('deriveProviderSummary', () => {
  it('dedupes providers in pane order', () => {
    const ws = workspace([pane('a', 'claude', 0), pane('b', 'powershell', 1), pane('c', 'claude', 2)])
    expect(deriveProviderSummary(ws).text).toBe('Claude · PowerShell')
  })

  it('collapses a long list with an overflow count', () => {
    const ws = workspace([pane('a', 'claude', 0), pane('b', 'codex', 1), pane('c', 'opencode', 2), pane('d', 'wsl', 3), pane('e', 'command_prompt', 4)])
    const summary = deriveProviderSummary(ws, 3)
    expect(summary.visible).toEqual(['Claude', 'Codex', 'OpenCode'])
    expect(summary.overflow).toBe(2)
    expect(summary.text).toBe('Claude · Codex · OpenCode · +2')
  })
})

describe('groupSessionsByWorkspace', () => {
  it('buckets sessions by workspace id', () => {
    const grouped = groupSessionsByWorkspace([
      session('a', 'running'),
      session('b', 'running', { workspaceId: 'other' }),
    ])
    expect(grouped.get('w')).toHaveLength(1)
    expect(grouped.get('other')).toHaveLength(1)
  })
})

describe('groupRecentsByProject', () => {
  it('collapses recents to one row per project with the newest as last-active', () => {
    const recents: RecentWorkspace[] = [
      { workspace: { ...workspace([pane('a', 'claude', 0)]), id: 'w1', projectId: 'p1', lastOpenedAt: '2026-01-01T00:00:00Z' }, projectName: 'One', projectPath: '/one', projectMissing: false },
      { workspace: { ...workspace([pane('a', 'claude', 0)]), id: 'w2', projectId: 'p1', lastOpenedAt: '2026-02-01T00:00:00Z' }, projectName: 'One', projectPath: '/one', projectMissing: false },
      { workspace: { ...workspace([pane('a', 'claude', 0)]), id: 'w3', projectId: 'p2', lastOpenedAt: '2026-03-01T00:00:00Z' }, projectName: 'Two', projectPath: '/two', projectMissing: true },
    ]
    const rows = groupRecentsByProject(recents)
    expect(rows).toHaveLength(2)
    expect(rows[0].projectId).toBe('p2') // newest first
    const one = rows.find((row) => row.projectId === 'p1')!
    expect(one.workspaceCount).toBe(2)
    expect(one.lastActiveWorkspaceId).toBe('w2')
  })
})

describe('clampSidebarWidth', () => {
  it('clamps into the supported range and rounds', () => {
    expect(clampSidebarWidth(100)).toBe(260)
    expect(clampSidebarWidth(999)).toBe(360)
    expect(clampSidebarWidth(300.6)).toBe(301)
    expect(clampSidebarWidth(Number.NaN)).toBe(300)
  })
})
