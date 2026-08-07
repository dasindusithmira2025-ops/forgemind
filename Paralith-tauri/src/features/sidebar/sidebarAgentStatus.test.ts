import { describe, expect, it } from 'vitest'
import type { AgentActivityState, AgentStateEvent, TerminalSession } from '../../native/types'
import {
  agentAttentionFor,
  countPanesNeedingAttention,
  earliestAttentionSince,
  isAgentStateUsable,
  resolvePaneAgentStates,
  WORKING_STATE_STALE_AFTER_MS,
} from './sidebarAgentStatus'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function agentState(paneId: string, state: AgentActivityState, extra: Partial<AgentStateEvent> = {}): AgentStateEvent {
  return {
    terminalSessionId: `s-${paneId}`,
    projectId: 'p',
    workspaceId: 'w',
    paneId,
    provider: 'claude',
    state,
    source: 'provider_hook',
    reason: 'test',
    updatedAt: new Date(NOW).toISOString(),
    ...extra,
  }
}

function session(paneId: string, status: TerminalSession['status'] = 'running'): TerminalSession {
  return {
    id: `s-${paneId}`,
    projectId: 'p',
    workspaceId: 'w',
    paneId,
    provider: 'claude',
    executable: 'x',
    arguments: [],
    title: 't',
    workingDirectory: 'd',
    status,
    startedAt: '2026-01-01T00:00:00Z',
    outputTail: [],
    nextSequence: 0,
    restorationState: 'restored',
    droppedOutputBytes: 0,
  }
}

function index(...events: AgentStateEvent[]): Record<string, AgentStateEvent> {
  return Object.fromEntries(events.map((event) => [`${event.workspaceId}:${event.paneId}`, event]))
}

describe('agentAttentionFor', () => {
  it('ranks the states that block on a person together', () => {
    expect(agentAttentionFor('needs_input')).toBe('needs_you')
    expect(agentAttentionFor('needs_permission')).toBe('needs_you')
    expect(agentAttentionFor('failed')).toBe('needs_you')
  })

  it('separates progress, completion, and silence', () => {
    expect(agentAttentionFor('working')).toBe('working')
    expect(agentAttentionFor('finished')).toBe('settled')
    expect(agentAttentionFor('idle')).toBe('none')
  })
})

describe('isAgentStateUsable', () => {
  it('expires a working claim that has gone quiet', () => {
    const stale = agentState('a', 'working', {
      updatedAt: new Date(NOW - WORKING_STATE_STALE_AFTER_MS - 1).toISOString(),
    })
    expect(isAgentStateUsable(stale, NOW)).toBe(false)
    const fresh = agentState('a', 'working', { updatedAt: new Date(NOW - 1_000).toISOString() })
    expect(isAgentStateUsable(fresh, NOW)).toBe(true)
  })

  it('never expires a state that means the agent is waiting for a person', () => {
    // Silence is what waiting *is*. Ageing these out would erase exactly the signal the sidebar
    // exists to surface, so an hour-old permission prompt is still a permission prompt.
    const old = new Date(NOW - 60 * 60 * 1000).toISOString()
    expect(isAgentStateUsable(agentState('a', 'needs_permission', { updatedAt: old }), NOW)).toBe(true)
    expect(isAgentStateUsable(agentState('a', 'needs_input', { updatedAt: old }), NOW)).toBe(true)
  })

  it('believes a working claim whose timestamp cannot be parsed', () => {
    // Failing open: dropping a real claim over an odd string would show a busy Workspace as idle.
    expect(isAgentStateUsable(agentState('a', 'working', { updatedAt: 'not-a-date' }), NOW)).toBe(true)
  })
})

describe('resolvePaneAgentStates', () => {
  it('reports the Panes that are blocked on a human', () => {
    const resolved = resolvePaneAgentStates(
      [session('a'), session('b')],
      index(agentState('a', 'needs_permission'), agentState('b', 'working')),
      'w',
      NOW,
    )
    expect(countPanesNeedingAttention(resolved)).toBe(1)
    expect(resolved.map((state) => state.attention).sort()).toEqual(['needs_you', 'working'])
  })

  it('ignores agent state for a Pane whose terminal is no longer running', () => {
    // The index is keyed by Pane so a restarted Pane keeps its identity, which means state can
    // outlive the Session that reported it. A Pane that ended is not waiting for anybody.
    const resolved = resolvePaneAgentStates(
      [session('a', 'exited')],
      index(agentState('a', 'needs_input')),
      'w',
      NOW,
    )
    expect(resolved).toEqual([])
  })

  it('ignores agent state belonging to a different Workspace', () => {
    const resolved = resolvePaneAgentStates(
      [{ ...session('a'), workspaceId: 'other' }],
      index(agentState('a', 'needs_input')),
      'w',
      NOW,
    )
    expect(resolved).toEqual([])
  })

  it('drops idle Panes rather than carrying an empty assertion', () => {
    expect(resolvePaneAgentStates([session('a')], index(agentState('a', 'idle')), 'w', NOW)).toEqual([])
  })
})

describe('earliestAttentionSince', () => {
  it('returns the longest-running wait, ignoring Panes that are not waiting', () => {
    const resolved = resolvePaneAgentStates(
      [session('a'), session('b'), session('c')],
      index(
        agentState('a', 'needs_input', { attentionSince: '2026-08-07T11:00:00.000Z' }),
        agentState('b', 'needs_permission', { attentionSince: '2026-08-07T10:00:00.000Z' }),
        agentState('c', 'working', { attentionSince: '2026-08-07T09:00:00.000Z' }),
      ),
      'w',
      NOW,
    )
    expect(earliestAttentionSince(resolved)).toBe('2026-08-07T10:00:00.000Z')
  })

  it('is undefined when nothing is waiting', () => {
    const resolved = resolvePaneAgentStates([session('a')], index(agentState('a', 'working')), 'w', NOW)
    expect(earliestAttentionSince(resolved)).toBeUndefined()
  })
})
