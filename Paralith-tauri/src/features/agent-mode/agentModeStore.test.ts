import { beforeEach, describe, expect, it, vi } from 'vitest'

const { saveAgentProductState } = vi.hoisted(() => ({ saveAgentProductState: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../native/commands', () => ({
  native: { saveAgentProductState },
  asNativeError: (error: unknown) => ({ message: String(error) }),
}))

import { useAgentModeStore } from './agentModeStore'

describe('agentModeStore', () => {
  beforeEach(() => {
    saveAgentProductState.mockClear()
    useAgentModeStore.setState({
      mode: 'code', hydrated: true, busy: false, error: undefined,
      snapshot: { agents: [], conversations: [], entries: [], delegations: [], authorities: [], productState: { selectedMode: 'code' } },
    })
  })

  it('changes only the operating mode and persists the selection', () => {
    const before = useAgentModeStore.getState().snapshot
    useAgentModeStore.getState().setMode('agent')
    expect(useAgentModeStore.getState().mode).toBe('agent')
    expect(useAgentModeStore.getState().snapshot.agents).toBe(before.agents)
    expect(saveAgentProductState).toHaveBeenCalledWith('agent', undefined, undefined)
  })
})
