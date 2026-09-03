import { beforeEach, describe, expect, it, vi } from 'vitest'

const { saveAgentProductState } = vi.hoisted(() => ({ saveAgentProductState: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../native/commands', () => ({
  native: { saveAgentProductState },
  asNativeError: (error: unknown) => ({ message: String(error) }),
}))

import { useAgentModeStore } from './agentModeStore'
import type { AgentWork } from '../../native/types'

describe('agentModeStore', () => {
  beforeEach(() => {
    saveAgentProductState.mockClear()
    useAgentModeStore.setState({
      mode: 'code', hydrated: true, busy: false, error: undefined,
      snapshot: { agents: [], conversations: [], entries: [], delegations: [], work: [], authorities: [], productState: { selectedMode: 'code' } },
    })
  })

  it('changes only the operating mode and persists the selection', () => {
    const before = useAgentModeStore.getState().snapshot
    useAgentModeStore.getState().setMode('agent')
    expect(useAgentModeStore.getState().mode).toBe('agent')
    expect(useAgentModeStore.getState().snapshot.agents).toBe(before.agents)
    expect(saveAgentProductState).toHaveBeenCalledWith('agent', undefined, undefined)
  })

  it('returning from Code restores the exact agent, conversation and mode', () => {
    const work = {
      id: 'work-1', agentId: 'forge', objective: 'Repair the composer.', constraints: '', expectedResult: '',
      projectId: 'project', status: 'working', authority: { read: true, write: true, runCommands: true, commit: false, push: false },
      originConversationId: 'atlas-general', executionWorkspaceId: 'agent-mode-work-project',
      createdAt: 'now', updatedAt: 'now',
    } as AgentWork
    useAgentModeStore.setState({
      snapshot: {
        agents: [], conversations: [{ id: 'atlas-general', agentId: 'atlas', title: 'General', position: 0, createdAt: 'now', updatedAt: 'now' }],
        entries: [], delegations: [], work: [work], authorities: [], productState: { selectedMode: 'agent' },
      },
    })
    useAgentModeStore.getState().openWorkInCode(work)
    expect(useAgentModeStore.getState().mode).toBe('code')
    expect(useAgentModeStore.getState().codeOrigin?.id).toBe('work-1')

    useAgentModeStore.getState().returnToAgent()
    const state = useAgentModeStore.getState()
    expect(state.mode).toBe('agent')
    // The originating conversation, not just the agent: returning has to land where the work was
    // delegated from.
    expect(state.snapshot.productState.selectedConversationId).toBe('atlas-general')
    expect(state.snapshot.productState.selectedAgentId).toBe('atlas')
    expect(state.codeOrigin).toBeUndefined()
  })
})
