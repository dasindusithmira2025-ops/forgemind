import { describe, expect, it } from 'vitest'
import type { AgentActivityState, AgentStateEvent } from '../../native/types'
import {
  attentionCells,
  buildFleet,
  fleetStateLabel,
  fleetSummary,
  waitLabel,
  waitPressure,
  waitedMs,
  type FleetPaneInput,
} from './fleetSelectors'

function agent(state: AgentActivityState, attentionSince?: string): AgentStateEvent {
  return {
    terminalSessionId: 's',
    projectId: 'p',
    workspaceId: 'w',
    paneId: 'pane',
    provider: 'claude',
    state,
    source: 'heuristic',
    reason: 'test',
    attentionSince,
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

function pane(overrides: Partial<FleetPaneInput> & { paneId: string; title: string }): FleetPaneInput {
  return { running: true, deferred: false, ...overrides }
}

describe('buildFleet', () => {
  it('orders the fleet by what needs a human, oldest wait first — never by layout position', () => {
    const cells = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('working') }),
      pane({ paneId: 'b', title: 'bravo', agentState: agent('needs_input', '2026-08-01T10:05:00.000Z') }),
      pane({ paneId: 'c', title: 'charlie', agentState: agent('idle') }),
      pane({ paneId: 'd', title: 'delta', agentState: agent('needs_input', '2026-08-01T10:00:00.000Z') }),
      pane({ paneId: 'e', title: 'echo', agentState: agent('failed') }),
    ])
    expect(cells.map((cell) => cell.paneId)).toEqual(['e', 'd', 'b', 'a', 'c'])
  })

  it('treats a failed agent that is also flagged for attention as blocked, not waiting', () => {
    const [cell] = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('failed', '2026-08-01T10:00:00.000Z') }),
    ])
    expect(cell.state).toBe('blocked')
    expect(cell.waitingSince).toBe('2026-08-01T10:00:00.000Z')
  })

  it('reports a deferred pane as paused even while its agent state is stale', () => {
    const [cell] = buildFleet([
      pane({ paneId: 'a', title: 'alpha', deferred: true, agentState: agent('working') }),
    ])
    expect(cell.state).toBe('paused')
  })

  it('reports a pane with no running session as paused rather than idle', () => {
    const [cell] = buildFleet([pane({ paneId: 'a', title: 'alpha', running: false })])
    expect(cell.state).toBe('paused')
  })

  it('keeps a stable order for cells carrying identical information', () => {
    const input = [
      pane({ paneId: 'b', title: 'bravo', agentState: agent('idle') }),
      pane({ paneId: 'a', title: 'alpha', agentState: agent('idle') }),
    ]
    expect(buildFleet(input).map((cell) => cell.title)).toEqual(['alpha', 'bravo'])
    expect(buildFleet([...input].reverse()).map((cell) => cell.title)).toEqual(['alpha', 'bravo'])
  })

  it('carries only cells that need a human into the attention queue', () => {
    const cells = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('working') }),
      pane({ paneId: 'b', title: 'bravo', agentState: agent('needs_permission', '2026-08-01T10:00:00.000Z') }),
    ])
    expect(attentionCells(cells).map((cell) => cell.paneId)).toEqual(['b'])
  })
})

describe('wait duration', () => {
  const now = Date.parse('2026-08-01T10:10:00.000Z')

  it('measures the wait from attentionSince', () => {
    const [cell] = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_input', '2026-08-01T10:04:00.000Z') }),
    ])
    expect(waitedMs(cell, now)).toBe(6 * 60_000)
  })

  it('reports no wait for a cell that is not waiting', () => {
    const [cell] = buildFleet([pane({ paneId: 'a', title: 'alpha', agentState: agent('working') })])
    expect(waitedMs(cell, now)).toBe(0)
  })

  it('never reports a negative wait when a clock skews', () => {
    const [cell] = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_input', '2026-08-01T10:20:00.000Z') }),
    ])
    expect(waitedMs(cell, now)).toBe(0)
  })

  it('survives an unparseable timestamp instead of rendering NaN', () => {
    const [cell] = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_input', 'not-a-date') }),
    ])
    expect(waitedMs(cell, now)).toBe(0)
  })

  it('labels durations compactly enough that the bar never reflows', () => {
    expect(waitLabel(0)).toBe('0s')
    expect(waitLabel(45_000)).toBe('45s')
    expect(waitLabel(60_000)).toBe('1m')
    expect(waitLabel(59 * 60_000)).toBe('59m')
    expect(waitLabel(60 * 60_000)).toBe('1h')
    expect(waitLabel(95 * 60_000)).toBe('1h35m')
    for (const ms of [0, 45_000, 60_000, 59 * 60_000, 60 * 60_000, 95 * 60_000]) {
      expect(waitLabel(ms).length).toBeLessThanOrEqual(5)
    }
  })

  it('raises pressure in four discrete steps so the bar cannot shimmer', () => {
    expect(waitPressure(0)).toBe(1)
    expect(waitPressure(29_000)).toBe(1)
    expect(waitPressure(30_000)).toBe(2)
    expect(waitPressure(2 * 60_000)).toBe(3)
    expect(waitPressure(10 * 60_000)).toBe(4)
    expect(waitPressure(90 * 60_000)).toBe(4)
  })
})

describe('fleet vocabulary', () => {
  it('uses one word per state everywhere the fleet is described', () => {
    expect(fleetStateLabel('waiting')).toBe('waiting')
    expect(fleetStateLabel('blocked')).toBe('blocked')
    expect(fleetStateLabel('working')).toBe('working')
    expect(fleetStateLabel('idle')).toBe('idle')
    expect(fleetStateLabel('paused')).toBe('paused')
  })

  it('summarises only what needs a human, and says nothing when the fleet is healthy', () => {
    const healthy = buildFleet([pane({ paneId: 'a', title: 'alpha', agentState: agent('working') })])
    expect(fleetSummary(healthy)).toBeUndefined()

    const busy = buildFleet([
      pane({ paneId: 'a', title: 'alpha', agentState: agent('needs_input', '2026-08-01T10:00:00.000Z') }),
      pane({ paneId: 'b', title: 'bravo', agentState: agent('needs_input', '2026-08-01T10:01:00.000Z') }),
      pane({ paneId: 'c', title: 'charlie', agentState: agent('failed') }),
    ])
    expect(fleetSummary(busy)).toBe('2 waiting · 1 blocked')
  })
})
