import { describe, expect, it } from 'vitest'
import { applyPaneRename } from './paneRename'
import type { PaneAssignment, PaneRenamedEvent, Workspace } from '../../native/types'

function pane(id: string, title: string): PaneAssignment {
  return {
    id,
    title,
    provider: 'claude',
    executablePath: 'C:/agents/claude.exe',
    args: [],
    workingDirectory: 'C:/projects/app',
    workingDirectoryMode: 'project_relative',
    positionOrder: 0,
  }
}

function workspace(): Workspace {
  return {
    id: 'workspace-1',
    projectId: 'project-1',
    name: 'Main',
    normalizedName: 'main',
    layout: { type: 'pane', paneId: 'pane-a' },
    restoreBehavior: 'inherit',
    panes: [pane('pane-a', 'Claude Code'), pane('pane-b', 'Codex CLI')],
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    lastOpenedAt: '2026-08-01T00:00:00Z',
  }
}

function event(patch: Partial<PaneRenamedEvent> = {}): PaneRenamedEvent {
  return {
    workspaceId: 'workspace-1',
    paneId: 'pane-a',
    sessionId: 'session-1',
    title: 'Fix login bug',
    source: 'agent_task',
    ...patch,
  }
}

describe('applyPaneRename', () => {
  it('retitles only the Pane named by the event', () => {
    const next = applyPaneRename(workspace(), event())
    expect(next?.panes.map((item) => item.title)).toEqual(['Fix login bug', 'Codex CLI'])
  })

  it('ignores an event for another Workspace', () => {
    const current = workspace()
    expect(applyPaneRename(current, event({ workspaceId: 'workspace-2' }))).toBe(current)
  })

  it('ignores an event for a Pane this Workspace does not hold', () => {
    const current = workspace()
    expect(applyPaneRename(current, event({ paneId: 'pane-z' }))).toBe(current)
  })

  // Returning the same reference is what stops an unchanged title from re-rendering the canvas,
  // which would remount a live terminal.
  it('returns the same Workspace when the title already matches', () => {
    const current = workspace()
    expect(applyPaneRename(current, event({ title: 'Claude Code' }))).toBe(current)
  })

  it('tolerates a Workspace that has not loaded yet', () => {
    expect(applyPaneRename(undefined, event())).toBeUndefined()
  })
})
