import { describe, expect, it } from 'vitest'
import { attentionClass, sortByAttention } from './sidebarAttention'
import type { SidebarWorkspace, WorkspaceRuntimeStatus } from './sidebarTypes'

function entry(id: string, status: WorkspaceRuntimeStatus, lastOpenedAt = '2026-01-01T00:00:00Z'): SidebarWorkspace {
  return {
    workspace: {
      id,
      projectId: 'project',
      name: id,
      normalizedName: id,
      restoreBehavior: 'inherit',
      layout: { type: 'pane', paneId: `${id}-pane` },
      activePaneId: `${id}-pane`,
      panes: [],
      createdAt: '',
      updatedAt: '',
      lastOpenedAt,
    },
    runtime: {
      workspaceId: id,
      configuredPaneCount: 1,
      startingCount: 0,
      runningCount: 0,
      waitingCount: 0,
      exitedCount: 0,
      failedCount: 0,
      disconnectedCount: 0,
      deferredCount: 0,
      activeProviders: [],
      status,
      requiresAttention: status === 'attention' || status === 'failed',
      updatedAt: '',
    },
    providers: { labels: [], visible: [], overflow: 0, text: '' },
  }
}

const idsOf = (entries: SidebarWorkspace[]) => entries.map((item) => item.workspace.id)

describe('attentionClass', () => {
  it('ranks the states that need a human above the ones that do not', () => {
    expect(attentionClass('failed')).toBe(1)
    expect(attentionClass('attention')).toBe(1)
    expect(attentionClass('waiting')).toBe(1)
    expect(attentionClass('starting')).toBe(2)
    expect(attentionClass('stopping')).toBe(2)
    expect(attentionClass('active')).toBe(3)
    expect(attentionClass('partially_active')).toBe(3)
    expect(attentionClass('closed')).toBe(4)
  })
})

describe('sortByAttention', () => {
  it('orders by attention class before anything else', () => {
    const sorted = sortByAttention([
      entry('idle', 'closed'),
      entry('working', 'active'),
      entry('blocked', 'attention'),
      entry('settling', 'starting'),
    ])
    expect(idsOf(sorted)).toEqual(['blocked', 'settling', 'working', 'idle'])
  })

  it('puts the most recently opened first within one class', () => {
    const sorted = sortByAttention([
      entry('older', 'active', '2026-01-01T00:00:00Z'),
      entry('newer', 'active', '2026-06-01T00:00:00Z'),
    ])
    expect(idsOf(sorted)).toEqual(['newer', 'older'])
  })

  it('is stable for rows that tie completely, so the list never reshuffles under the pointer', () => {
    const tied = [entry('a', 'active'), entry('b', 'active'), entry('c', 'active')]
    expect(idsOf(sortByAttention(tied))).toEqual(['a', 'b', 'c'])
    expect(idsOf(sortByAttention(sortByAttention(tied)))).toEqual(['a', 'b', 'c'])
  })

  it('leaves the input list untouched', () => {
    const input = [entry('idle', 'closed'), entry('blocked', 'attention')]
    sortByAttention(input)
    expect(idsOf(input)).toEqual(['idle', 'blocked'])
  })
})
