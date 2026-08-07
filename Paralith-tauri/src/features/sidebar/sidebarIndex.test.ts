import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentStateEvent, TerminalSession } from '../../native/types'
import {
  getPaneAgentStatesByWorkspace,
  getSessionsByWorkspace,
  getWorkspaceMap,
  resetSidebarIndexCachesForTest,
} from './sidebarIndex'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function session(paneId: string, workspaceId: string): TerminalSession {
  return {
    id: `s-${workspaceId}-${paneId}`,
    projectId: 'p',
    workspaceId,
    paneId,
    provider: 'claude',
    executable: 'x',
    arguments: [],
    title: 't',
    workingDirectory: 'd',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    outputTail: [],
    nextSequence: 0,
    restorationState: 'restored',
    droppedOutputBytes: 0,
  }
}

function agentState(workspaceId: string, paneId: string): AgentStateEvent {
  return {
    terminalSessionId: `s-${workspaceId}-${paneId}`,
    projectId: 'p',
    workspaceId,
    paneId,
    provider: 'claude',
    state: 'needs_permission',
    source: 'provider_hook',
    reason: 'test',
    updatedAt: new Date(NOW).toISOString(),
  }
}

beforeEach(() => {
  resetSidebarIndexCachesForTest()
})

describe('getSessionsByWorkspace', () => {
  it('groups by Workspace', () => {
    const sessions = [session('a', 'w1'), session('b', 'w1'), session('c', 'w2')]
    const grouped = getSessionsByWorkspace(sessions)
    expect(grouped.get('w1')).toHaveLength(2)
    expect(grouped.get('w2')).toHaveLength(1)
  })

  it('returns the same object for the same input array', () => {
    // Zustand reruns selectors on every write, so an unrelated change must cost a map lookup
    // rather than a full regroup — and must return an identity downstream memoisation can trust.
    const sessions = [session('a', 'w1')]
    expect(getSessionsByWorkspace(sessions)).toBe(getSessionsByWorkspace(sessions))
  })

  it('regroups when the input array is genuinely replaced', () => {
    const first = getSessionsByWorkspace([session('a', 'w1')])
    const second = getSessionsByWorkspace([session('a', 'w1'), session('b', 'w2')])
    expect(second).not.toBe(first)
    expect(second.has('w2')).toBe(true)
  })
})

describe('getWorkspaceMap', () => {
  it('caches on the identity of the list', () => {
    const workspaces = [
      { id: 'w1' } as never,
      { id: 'w2' } as never,
    ]
    expect(getWorkspaceMap(workspaces)).toBe(getWorkspaceMap(workspaces))
    expect(getWorkspaceMap(workspaces).get('w2')).toBe(workspaces[1])
  })
})

describe('getPaneAgentStatesByWorkspace', () => {
  const sessions = [session('a', 'w1'), session('b', 'w2')]
  const agentStates = { 'w1:a': agentState('w1', 'a') }

  it('resolves each Workspace once, omitting those with nothing to say', () => {
    const resolved = getPaneAgentStatesByWorkspace(sessions, agentStates, NOW)
    expect(resolved.get('w1')).toHaveLength(1)
    expect(resolved.has('w2')).toBe(false)
  })

  it('reuses the result across clock reads inside the same bucket', () => {
    // The only time-dependent decision is whether a `working` claim has gone stale, which is a
    // 90-second question — re-resolving on every millisecond of a render clock would make the
    // cache useless for no extra truth.
    const first = getPaneAgentStatesByWorkspace(sessions, agentStates, NOW)
    expect(getPaneAgentStatesByWorkspace(sessions, agentStates, NOW + 10)).toBe(first)
  })

  it('re-resolves once the clock moves into a new bucket', () => {
    const first = getPaneAgentStatesByWorkspace(sessions, agentStates, NOW)
    expect(getPaneAgentStatesByWorkspace(sessions, agentStates, NOW + 10_000)).not.toBe(first)
  })

  it('re-resolves when the agent state index is replaced', () => {
    const first = getPaneAgentStatesByWorkspace(sessions, agentStates, NOW)
    const next = getPaneAgentStatesByWorkspace(sessions, { ...agentStates }, NOW)
    expect(next).not.toBe(first)
  })
})
