import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store imports the api module, which imports Tauri IPC. Stub it so importing the store is
// side-effect free in jsdom; these tests exercise the pure reducers only.
vi.mock('./api', () => ({
  orchestratorApi: {},
  onOrchestratorSession: vi.fn(async () => () => {}),
  onOrchestratorEvent: vi.fn(async () => () => {}),
}))

import { useOrchestratorStore } from './store'
import type { OrchestrationEvent, OrchestrationSession, OrchestrationSessionView } from './types'

function session(overrides: Partial<OrchestrationSession> = {}): OrchestrationSession {
  return {
    id: 's1',
    title: 'Repair the browser',
    originatingSurface: 'invocation_bar',
    projectId: null,
    workspaceId: null,
    operatingMode: 'execute',
    state: 'executing',
    objective: 'Repair the embedded browser and verify it.',
    normalizedObjective: null,
    failureClassification: null,
    tokenBudget: null,
    tokensUsed: 0,
    provider: null,
    model: null,
    createdAt: '2026-07-23T10:00:00Z',
    updatedAt: '2026-07-23T10:00:00Z',
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

function view(): OrchestrationSessionView {
  return { session: session(), turns: [], events: [], executions: [] }
}

function event(sequence: number, sessionId = 's1'): OrchestrationEvent {
  return {
    id: `e${sequence}`,
    sessionId,
    sequence,
    eventType: 'capability_started',
    payloadJson: '{}',
    source: 'kernel',
    createdAt: '2026-07-23T10:00:01Z',
  }
}

describe('orchestrator store reducers', () => {
  beforeEach(() =>
    useOrchestratorStore.setState({
      open: false,
      mode: 'assist',
      view: undefined,
      capabilities: [],
      busy: false,
      lastError: undefined,
    }),
  )

  it('toggles the panel open and closed', () => {
    useOrchestratorStore.getState().toggleOpen()
    expect(useOrchestratorStore.getState().open).toBe(true)
    useOrchestratorStore.getState().toggleOpen()
    expect(useOrchestratorStore.getState().open).toBe(false)
  })

  it('applySession replaces the active session but ignores a stale (older) snapshot', () => {
    useOrchestratorStore.setState({ view: view() })
    useOrchestratorStore
      .getState()
      .applySession(session({ state: 'verifying', updatedAt: '2026-07-23T10:00:05Z' }))
    expect(useOrchestratorStore.getState().view?.session.state).toBe('verifying')

    // An out-of-order older event must not overwrite the newer state.
    useOrchestratorStore
      .getState()
      .applySession(session({ state: 'executing', updatedAt: '2026-07-23T10:00:02Z' }))
    expect(useOrchestratorStore.getState().view?.session.state).toBe('verifying')
  })

  it('applySession ignores a session for a different id', () => {
    useOrchestratorStore.setState({ view: view() })
    useOrchestratorStore.getState().applySession(session({ id: 'other', state: 'failed' }))
    expect(useOrchestratorStore.getState().view?.session.state).toBe('executing')
  })

  it('applyEvent appends in sequence order and dedupes repeats', () => {
    useOrchestratorStore.setState({ view: view() })
    useOrchestratorStore.getState().applyEvent(event(2))
    useOrchestratorStore.getState().applyEvent(event(0))
    useOrchestratorStore.getState().applyEvent(event(1))
    useOrchestratorStore.getState().applyEvent(event(1)) // duplicate

    const events = useOrchestratorStore.getState().view?.events ?? []
    expect(events.map((item) => item.sequence)).toEqual([0, 1, 2])
  })

  it('applyEvent ignores events for another session', () => {
    useOrchestratorStore.setState({ view: view() })
    useOrchestratorStore.getState().applyEvent(event(0, 'different-session'))
    expect(useOrchestratorStore.getState().view?.events).toHaveLength(0)
  })
})
