import { describe, expect, it } from 'vitest'
import {
  assignedCount,
  changeCount,
  compileLaunchPlan,
  distribute,
  fillRemaining,
  oneOfEach,
  reduceToCapacity,
  regularTerminalCount,
  remainingCapacity,
  splitEvenly,
  type CompileContext,
} from './allocationCompiler'
import type { WorkspaceSetupDraft } from './setupTypes'

const codingContext = (defaultShellId = 'shell:ps'): CompileContext => ({
  order: ['claude', 'codex', 'opencode'],
  isShell: () => false,
  defaultShellId,
  workingDirectory: 'C:\\project',
})

function draftOf(partial: Partial<WorkspaceSetupDraft>): WorkspaceSetupDraft {
  return {
    schemaVersion: 1,
    workspaceName: 'W',
    projectPath: 'C:\\project',
    workingDirectory: 'C:\\project',
    terminalCount: 4,
    layoutId: '4',
    agentAllocations: {},
    customCommands: [],
    defaultShellId: 'shell:ps',
    ...partial,
  }
}

describe('allocation totals', () => {
  it('sums agent + custom counts and ignores negatives', () => {
    expect(assignedCount({ claude: 2, codex: 1 }, [{ id: 'c', label: 'x', command: 'x', count: 2 }])).toBe(5)
    expect(assignedCount({ claude: -3, codex: 1 })).toBe(1)
  })

  it('computes regular terminal remainder without going negative', () => {
    expect(regularTerminalCount(6, { claude: 2 })).toBe(4)
    expect(regularTerminalCount(2, { claude: 5 })).toBe(0)
    expect(remainingCapacity(4, { claude: 1 }, [{ id: 'c', label: 'x', command: 'x', count: 1 }])).toBe(2)
  })
})

describe('changeCount boundaries', () => {
  it('never drops below zero and removes zeroed agents', () => {
    expect(changeCount({ claude: 1 }, 'claude', -1, { terminalCount: 4 })).toEqual({})
    expect(changeCount({}, 'claude', -1, { terminalCount: 4 })).toEqual({})
  })

  it('caps single-instance agents at one', () => {
    const result = changeCount({}, 'wsl', 1, { terminalCount: 4, supportsMultipleInstances: false })
    expect(result.wsl).toBe(1)
    expect(changeCount(result, 'wsl', 1, { terminalCount: 4, supportsMultipleInstances: false }).wsl).toBe(1)
  })

  it('respects a configured maximum instance count', () => {
    expect(changeCount({ codex: 2 }, 'codex', 1, { terminalCount: 8, maximumInstances: 2 }).codex).toBe(2)
  })

  it('never exceeds the terminal capacity', () => {
    expect(changeCount({ claude: 3 }, 'claude', 1, { terminalCount: 3 }).claude).toBe(3)
    expect(changeCount({ claude: 2, codex: 1 }, 'codex', 1, { terminalCount: 3 }).codex).toBe(1)
  })
})

describe('quick-fill actions', () => {
  it('assigns one of each ready agent until slots run out', () => {
    const agents = [{ id: 'claude' }, { id: 'codex' }, { id: 'opencode' }]
    expect(oneOfEach(agents, 2)).toEqual({ claude: 1, codex: 1 })
    expect(oneOfEach(agents, 5)).toEqual({ claude: 1, codex: 1, opencode: 1 })
  })

  it('splits evenly, favouring earlier agents on uneven totals', () => {
    expect(splitEvenly([{ id: 'a' }, { id: 'b' }], 5)).toEqual({ a: 3, b: 2 })
    expect(splitEvenly([{ id: 'a' }, { id: 'b' }], 4)).toEqual({ a: 2, b: 2 })
    expect(splitEvenly([], 4)).toEqual({})
  })

  it('respects caps when splitting evenly', () => {
    expect(splitEvenly([{ id: 'a', supportsMultipleInstances: false }, { id: 'b' }], 5)).toEqual({ a: 1, b: 4 })
  })

  it('fills remaining capacity with one agent up to its cap', () => {
    expect(fillRemaining({ claude: 1 }, 'claude', 4, [])).toEqual({ claude: 4 })
    expect(fillRemaining({}, 'wsl', 4, [], 1)).toEqual({ wsl: 1 })
  })
})

describe('reduceToCapacity', () => {
  it('sheds lowest-priority agents first and is idempotent within capacity', () => {
    const reduced = reduceToCapacity({ claude: 2, codex: 2, opencode: 1, powershell: 1 }, [], ['claude', 'codex', 'opencode', 'powershell'], 4)
    expect(reduced.allocations).toEqual({ claude: 2, codex: 2 })
    // Running it again is a no-op (idempotent).
    const again = reduceToCapacity(reduced.allocations, reduced.customCommands, ['claude', 'codex', 'opencode', 'powershell'], 4)
    expect(again.allocations).toEqual({ claude: 2, codex: 2 })
  })

  it('reduces custom commands after agents', () => {
    const reduced = reduceToCapacity({ claude: 2 }, [{ id: 'c', label: 'x', command: 'x', count: 2 }], ['claude'], 3)
    expect(reduced.allocations).toEqual({ claude: 2 })
    expect(reduced.customCommands).toEqual([{ id: 'c', label: 'x', command: 'x', count: 1 }])
  })
})

describe('round-robin distribution', () => {
  it('spreads repeated agents across panes and fills the rest with the default shell', () => {
    const draft = draftOf({ terminalCount: 6, agentAllocations: { claude: 2, codex: 2, opencode: 1 } })
    const plan = compileLaunchPlan(draft, 'ws-1', codingContext())
    expect(plan.sessions.map((session) => session.agentId ?? 'shell')).toEqual(['claude', 'codex', 'opencode', 'claude', 'codex', 'shell'])
    expect(plan.sessions[5]).toMatchObject({ type: 'shell', shellId: 'shell:ps' })
  })

  it('produces exactly terminalCount sessions with unique pane indexes', () => {
    const draft = draftOf({ terminalCount: 12, agentAllocations: { claude: 3, codex: 2 } })
    const plan = compileLaunchPlan(draft, 'ws', codingContext())
    expect(plan.sessions).toHaveLength(12)
    expect(new Set(plan.sessions.map((session) => session.paneIndex)).size).toBe(12)
  })

  it('is deterministic for identical input', () => {
    const draft = draftOf({ terminalCount: 8, agentAllocations: { claude: 2, codex: 3, opencode: 1 } })
    expect(compileLaunchPlan(draft, 'ws', codingContext())).toEqual(compileLaunchPlan(draft, 'ws', codingContext()))
  })

  it('does not depend on object-key order', () => {
    const a = compileLaunchPlan(draftOf({ terminalCount: 4, agentAllocations: { codex: 1, claude: 1 } }), 'ws', codingContext())
    const b = compileLaunchPlan(draftOf({ terminalCount: 4, agentAllocations: { claude: 1, codex: 1 } }), 'ws', codingContext())
    expect(a).toEqual(b)
    expect(a.sessions.map((session) => session.agentId ?? 'shell')).toEqual(['claude', 'codex', 'shell', 'shell'])
  })

  it('fills every pane with the default shell when there are no agents', () => {
    const plan = compileLaunchPlan(draftOf({ terminalCount: 3 }), 'ws', codingContext())
    expect(plan.sessions.every((session) => session.type === 'shell' && session.shellId === 'shell:ps')).toBe(true)
  })

  it('compiles custom commands into their own sessions', () => {
    const draft = draftOf({ terminalCount: 2, agentAllocations: { claude: 1 }, customCommands: [{ id: 'c1', label: 'Dev', command: 'npm run dev', count: 1 }] })
    const plan = compileLaunchPlan(draft, 'ws', codingContext())
    expect(plan.sessions[1]).toMatchObject({ type: 'custom', agentId: 'c1', command: 'npm run dev' })
  })

  it('classifies shell allocations distinctly from agents', () => {
    const context: CompileContext = { order: ['claude', 'shell:ps'], isShell: (id) => id.startsWith('shell:'), defaultShellId: 'shell:ps', workingDirectory: 'C:\\p' }
    const draft = draftOf({ terminalCount: 2, agentAllocations: { claude: 1, 'shell:ps': 1 } })
    const plan = compileLaunchPlan(draft, 'ws', context)
    expect(plan.sessions.map((session) => session.type)).toEqual(['agent', 'shell'])
    expect(plan.sessions[1].shellId).toBe('shell:ps')
  })

  it('captures a startup command on the plan but never elsewhere', () => {
    const draft = draftOf({ terminalCount: 1, startupCommand: '  npm run dev  ' })
    expect(compileLaunchPlan(draft, 'ws', codingContext()).startupCommand).toBe('npm run dev')
    expect(compileLaunchPlan(draftOf({ terminalCount: 1 }), 'ws', codingContext()).startupCommand).toBeUndefined()
  })
})

describe('distribute invariants', () => {
  it('truncates over-allocation to the terminal count', () => {
    const sessions = distribute([{ key: 'claude', type: 'agent', count: 10 }], 3, codingContext())
    expect(sessions).toHaveLength(3)
    expect(sessions.every((session) => session.agentId === 'claude')).toBe(true)
  })
})
